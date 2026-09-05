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

const startCommand = require('./commands/start');
const newCommand = require('./commands/new');
const listCommand = require('./commands/list');
const acceptCommand = require('./commands/accept');
const scanCommand = require('./commands/scan');
const statusCommand = require('./commands/status');
const helpCommand = require('./commands/help');
const matchesCommand = require('./commands/matches');

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
      await handleStripeEvent(event);
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
    timestamp: new Date().toISOString(),
  })
);
// ----------------------- Carbon Ledger dashboard (P1) ----------------------
// Investor-facing ESG report. In demo mode everything is clearly marked [DEMO].
app.get('/dashboard/carbon', async (req, res) => {
  try {
    const [entries, shipments] = await Promise.all([
      airtableService.listCarbonEntries(),
      airtableService.listAllShipments(),
    ]);
    const summary = carbon.summarize(entries);
    const delivered = shipments.filter((s) => s.status === 'delivered').length;

    const rows = entries
      .slice(-50)
      .reverse()
      .map(
        (e) => `<tr>
          <td>${e.shipmentId || '—'}</td>
          <td>${e.originCity || '—'} → ${e.destinationCity || '—'}</td>
          <td>${e.distanceKm ?? '—'}</td>
          <td>${(e.baselineCo2Kg ?? 0).toFixed(2)}</td>
          <td>${(e.actualCo2Kg ?? 0).toFixed(2)}</td>
          <td><b>${(e.savedCo2Kg ?? 0).toFixed(2)}</b></td>
          <td>${e.methodology || '—'}</td>
          <td>${(e.createdAt || '').replace('T', ' ').slice(0, 16)}</td>
        </tr>`
      )
      .join('\n');

    res.send(renderDashboard(summary, delivered, rows));
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Dashboard error: ' + err.message);
  }
});

function renderDashboard(summary, delivered, rows) {
  return `<!DOCTYPE html>
<html lang="bg"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>DRUM 3.0 — Carbon Ledger</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; background: #0d1b12; color: #e8f5ee; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 24px; }
  h1 { color: #34d17b; margin: 0 0 4px; }
  .sub { opacity: .75; margin-bottom: 20px; }
  .banner { background: #7a1f1f; border: 1px solid #c0392b; padding: 10px 14px; border-radius: 8px; margin-bottom: 20px; font-weight: 600; }
  .cards { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 24px; }
  .card { background: #13291c; border: 1px solid #1f4630; border-radius: 12px; padding: 16px 20px; min-width: 160px; }
  .card .v { font-size: 26px; font-weight: 700; color: #34d17b; }
  .card .l { font-size: 12px; opacity: .7; text-transform: uppercase; letter-spacing: .05em; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; background: #13291c; border-radius: 12px; overflow: hidden; }
  th { text-align: left; background: #1f4630; padding: 10px; }
  td { padding: 8px 10px; border-top: 1px solid #1f4630; }
  .foot { margin-top: 20px; font-size: 12px; opacity: .6; }
</style></head><body><div class="wrap">
  <h1>🌿 DRUM 3.0 — Carbon Ledger</h1>
  <div class="sub">CO₂ спестяване на доставка · GHG Protocol Scope 3, Category 4 (Upstream Transportation)</div>
  ${IS_DEMO ? '<div class="banner">⚠️ DEMO ДАННИ — симулирани транзакции за демонстрация. НЕ са реален traction.</div>' : ''}
  <div class="cards">
    <div class="card"><div class="v">${summary.shipments}</div><div class="l">Доставки в ledger</div></div>
    <div class="card"><div class="v">${summary.savedCo2Kg.toLocaleString('bg-BG')} kg</div><div class="l">CO₂ спестено</div></div>
    <div class="card"><div class="v">${summary.distanceKm.toLocaleString('bg-BG')} km</div><div class="l">Км споделен превоз</div></div>
    <div class="card"><div class="v">${delivered}</div><div class="l">Завършени доставки</div></div>
  </div>
  <table>
    <thead><tr>
      <th>Shipment</th><th>Коридор</th><th>km</th><th>Baseline kg CO₂</th><th>Actual kg CO₂</th><th>Спестено kg CO₂</th><th>Методология</th><th>Дата</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="8">Няма записи още — стартирай npm run demo:e2e</td></tr>'}</tbody>
  </table>
  <p class="foot">
    Baseline: ${carbon.FACTORS.baselineKgPerKm} kg CO₂e/km (специализирана куриерска кола) ·
    Marginal share: ${carbon.FACTORS.marginalShareFactor} (пратка в вече пътуващ автомобил с празен багажник).
    Всеки запис съдържа факторите, използвани при изчислението (audit trail).
  </p>
</div></body></html>`;
}

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
