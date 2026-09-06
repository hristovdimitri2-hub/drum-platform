/**
 * DRUM 3.0 — Concierge MVP Telegram Bot
 *
 * Architecture: Telegraf (Telegram) + Stripe Connect (payments/escrow) +
 *               Airtable or Demo Store (database) + QR codes
 *
 * Bot commands:
 *   /start    — Welcome + register user
 *   /new      — Create new shipment request (sender flow)
 *   /list     — List user's shipments
 *   /accept   — Carrier accepts a shipment (carrier flow)
 *   /scan     — Scan QR code (pickup or delivery)
 *   /status   — Show user's trust score and tier
 *   /help     — Show help
 *   /cancel   — Cancel any in-progress flow
 *
 * Flow:
 *   1. Sender creates request via /new → Stripe auth-only charge → QR codes generated
 *   2. Ops Lead (manually) finds carrier → carrier accepts via /accept
 *      (STRICT AGENT MODEL: the bot never assigns carriers — users choose)
 *   3. Carrier scans pickup QR → status picked_up
 *   4. Carrier/recipient scans delivery QR → Stripe capture + split 80/15/5
 *   5. Trust Score updated for both parties, Carbon Ledger entry created
 */

require('dotenv').config();
const path = require('path');
const { Telegraf, Markup } = require('telegraf');
const express = require('express');

const stripeService = require('./services/stripe');
const airtableService = require('./services/store'); // demo store or Airtable
const qrService = require('./services/qr');
const carbon = require('./services/carbon');
const carbonDashboard = require('./services/carbonDashboard');
const opsDashboard = require('./services/opsDashboard');
const kpi = require('./services/kpi');

const startCommand = require('./commands/start');
const newCommand = require('./commands/new');
const listCommand = require('./commands/list');
const acceptCommand = require('./commands/accept');
const scanCommand = require('./commands/scan');
const statusCommand = require('./commands/status');
const helpCommand = require('./commands/help');
const matchesCommand = require('./commands/matches');
const evidenceCommand = require('./commands/evidence');

const IS_DEMO = airtableService.isDemoMode === true || stripeService.DEMO_MODE === true;

// Validate required environment variables (relaxed in demo mode)
const requiredEnv = IS_DEMO
  ? []
  : ['TELEGRAM_BOT_TOKEN', 'STRIPE_SECRET_KEY', 'AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`❌ Missing required environment variable: ${key}`);
    console.error('   Copy .env.example to .env and fill in your values.');
    console.error('   (Or set DEMO_MODE=true for the investor demo without credentials.)');
    process.exit(1);
  }
}
stripeService.assertTestMode();

if (IS_DEMO) {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  ⚠️  DEMO MODE — simulated payments & local SQLite DB ║');
  console.log('║  All data is marked [DEMO]. NOT real traction.       ║');
  console.log('╚══════════════════════════════════════════════════════╝');
}

// Telegram bot (created only if a token is provided; dashboard runs without it)
const bot = process.env.TELEGRAM_BOT_TOKEN
  ? new Telegraf(process.env.TELEGRAM_BOT_TOKEN)
  : null;

if (bot) {
  // Middleware: attach services to context
  bot.use((ctx, next) => {
    ctx.stripe = stripeService;
    ctx.airtable = airtableService;
    ctx.qr = qrService;
    ctx.carbon = carbon;
    return next();
  });

  // Simple session (in-memory; replace with Redis for production)
  const sessions = {};
  bot.use((ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();
    if (!sessions[userId]) sessions[userId] = {};
    ctx.session = sessions[userId];
    return next();
  });

  // Commands
  bot.start(startCommand);
  bot.help(helpCommand);
  bot.command('new', newCommand);
  bot.command('list', listCommand);
  bot.command('accept', acceptCommand);
  bot.command('scan', scanCommand);
  bot.command('status', statusCommand);
  bot.command('matches', matchesCommand);
  bot.command('evidence', evidenceCommand);
  bot.command('cancel', async (ctx) => {
    if (ctx.session) delete ctx.session.newShipment;
    await ctx.reply('✅ Текущото действие е отменено.', Markup.removeKeyboard());
  });

  // Contact sharing (phone verification)
  bot.on('contact', startCommand.contactHandler);

  // Skip-phone button
  bot.hears('⏭️ Пропусни за сега', startCommand.skipHandler);

  // Multi-step text input (drives the /new wizard). Commands still pass
  // through Telegraf's command handlers first; anything that reaches here
  // and isn't part of a wizard is acknowledged politely.
  bot.on('text', async (ctx, next) => {
    const handled = await newCommand.handleTextInput(ctx);
    if (handled) return;
    return next();
  });
}

// ---------------------------- Web server ----------------------------------
const app = express();

// Stripe webhook MUST use raw body for signature verification —
// mount it BEFORE any JSON body parser.
app.post(
  '/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    try {
      const event = stripeService.verifyWebhook(req.body, sig);
      // Anomaly 2 — replay protection: each webhook id is processed ONCE
      if (await airtableService.isWebhookProcessed(event.id)) {
        console.log(`Webhook ${event.id} replayed — ignored (idempotent)`);
        return res.json({ received: true, replay: true });
      }
      await handleStripeEvent(event);
      await airtableService.markWebhookProcessed(event.id, event.type);
      res.json({ received: true });
    } catch (err) {
      console.error('Webhook error:', err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

async function handleStripeEvent(event) {
  console.log(`Stripe event: ${event.type}`);
  switch (event.type) {
    case 'payment_intent.succeeded':
      // TODO: update Airtable shipment status
      break;
    case 'payment_intent.payment_failed':
      // TODO: notify sender
      break;
    default:
      // Ignore unhandled events
  }
}

// Health check
app.get('/health', (req, res) =>
  res.json({
    status: 'ok',
    mode: IS_DEMO ? 'demo' : 'live-test',
    backend: airtableService.backend || 'sqlite',
    timestamp: new Date().toISOString(),
  })
);

// ------------------- Ops/KPI dashboard (B9) --------------------------------
app.get('/dashboard/ops', async (req, res) => {
  try {
    const lang = req.query.lang === 'en' ? 'en' : 'bg';
    const [users, shipments, disputes] = await Promise.all([
      airtableService.listUsers ? airtableService.listUsers() : Promise.resolve([]),
      airtableService.listAllShipments(),
      airtableService.listDisputes ? airtableService.listDisputes({}) : Promise.resolve([]),
    ]);
    const kpis = kpi.computeKpis({ users, shipments, disputes });
    res.send(opsDashboard.renderOpsDashboard({ kpis, lang, isDemo: IS_DEMO }));
  } catch (err) {
    console.error('Ops dashboard error:', err);
    res.status(500).send('Ops dashboard error: ' + err.message);
  }
});

// Evidence packet endpoint (B5 anomaly 4 — ONE action, demo star)
app.get('/api/evidence/:shipmentId', async (req, res) => {
  try {
    const anomalies = require('./services/anomalies');
    const out = await anomalies.buildEvidencePacket(airtableService, req.params.shipmentId);
    res.json(out);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});
// ----------------------- Carbon Ledger dashboard (P1/B6) -------------------
// Investor-facing ESG report, bilingual (BG/EN via ?lang=). Demo mode marks
// everything [DEMO]. Renderer: src/services/carbonDashboard.js
app.get('/dashboard/carbon', async (req, res) => {
  try {
    const lang = req.query.lang === 'en' ? 'en' : 'bg';
    const [entries, shipments] = await Promise.all([
      airtableService.listCarbonEntries(),
      airtableService.listAllShipments(),
    ]);
    const summary = carbon.summarize(entries);
    const delivered = shipments.filter((s) => s.status === 'delivered').length;
    res.send(carbonDashboard.renderCarbonDashboard({
      entries, summary, delivered, lang, isDemo: IS_DEMO, factors: carbon.FACTORS,
    }));
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Dashboard error: ' + err.message);
  }
});

// ------------------------------- Start -------------------------------------
const PORT = process.env.PORT || 3000;

if (bot && process.env.TELEGRAM_WEBHOOK_URL) {
  // Production: webhook mode
  app.listen(PORT, async () => {
    console.log(`🌐 Web server running on port ${PORT}`);
    await bot.telegram.setWebhook(`${process.env.TELEGRAM_WEBHOOK_URL}/webhooks/telegram`);
    console.log('🤖 Telegram webhook set');
  });
  bot.startWebhook(`/webhooks/telegram`, null, PORT);
} else if (bot) {
  // Development: polling mode
  app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT} (webhooks endpoint ready)`);
    console.log(`🌿 Carbon dashboard: http://localhost:${PORT}/dashboard/carbon`);
    console.log(`🏠 Landing:           http://localhost:${PORT}/`);
  });
  bot.launch().then(() => {
    console.log('🤖 DRUM bot started in polling mode');
    console.log('   Send /start to begin');
  });
} else {
  // Dashboard-only mode (DEMO without Telegram credentials)
  app.listen(PORT, () => {
    console.log('⚠️  TELEGRAM_BOT_TOKEN not set — bot disabled, dashboard-only mode.');
    console.log(`🌐 Web server running on port ${PORT}`);
    console.log(`🌿 Carbon dashboard: http://localhost:${PORT}/dashboard/carbon`);
    console.log(`🏠 Landing:           http://localhost:${PORT}/`);
  });
}

// Graceful shutdown
process.once('SIGINT', () => bot && bot.stop('SIGINT'));
process.once('SIGTERM', () => bot && bot.stop('SIGTERM'));

if (bot) module.exports = bot;
