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
const checkoutService = require('./services/checkout');
const auth = require('./services/auth');
const security = require('./services/security');

const startCommand = require('./commands/start');
const newCommand = require('./commands/new');
const listCommand = require('./commands/list');
const acceptCommand = require('./commands/accept');
const scanCommand = require('./commands/scan');
const statusCommand = require('./commands/status');
const helpCommand = require('./commands/help');
const matchesCommand = require('./commands/matches');
const evidenceCommand = require('./commands/evidence');
const refuseCommand = require('./commands/refuse');
const { createPhotoHandler } = require('./commands/photo');
const scanWeb = require('./services/scanWeb');
const stripeEvents = require('./services/stripeEvents');

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

// P0 security: the operational surface (/dashboard/*, /api/evidence, /api/checkout)
// requires ADMIN_TOKEN. Fail closed — warn loudly when it is unset.
if (!auth.isConfigured()) {
  console.warn(
    '⚠️  ADMIN_TOKEN is not set — /dashboard/ops, /dashboard/carbon, ' +
      '/api/evidence/:id and /api/checkout/:id are DISABLED (401). ' +
      'Set ADMIN_TOKEN to enable them.'
  );
}

/** Suffix shown next to dashboard URLs in the startup banner. */
function adminHint() {
  return auth.isConfigured() ? '  🔑 (login: password = ADMIN_TOKEN)' : '  ⛔ (ADMIN_TOKEN not set)';
}

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
  // Anomaly 3: refusal opens the 24h window; the next PHOTO in the chat
  // (or with the shipment id in its caption) becomes sha256-verified
  // evidence under data/evidence/<shipmentId>/ — see commands/photo.js.
  bot.command('refuse', refuseCommand);
  bot.on('photo', createPhotoHandler());
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

// P1 hardening — security headers + structured access log on every route.
// Mounted first so 4xx/5xx responses carry the headers too.
app.disable('x-powered-by');
app.set('trust proxy', true); // Railway terminates TLS in front of the app
app.use(security.helmetMiddleware());
app.use(security.requestLogger());

const limiters = security.buildLimiters();

// Stripe webhook MUST use raw body for signature verification —
// mount it BEFORE any JSON body parser.
// NOTE: deliberately NOT rate limited — Stripe retries on 429 and a dropped
// payment event is worse than a burst. Signature verification + the
// idempotency table (isWebhookProcessed) are the controls here.
app.post(
  '/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    try {
      const event = stripeService.verifyWebhook(req.body, sig);
      // Anomaly 2 — replay protection: each webhook id is processed ONCE
      if (await airtableService.isWebhookProcessed(event.id)) {
        security.logger.info('stripe.webhook.replay', { eventId: event.id, type: event.type });
        return res.json({ received: true, replay: true });
      }
      const paid = await stripeEvents.handleStripeEvent(event, airtableService);
      if (paid.handled) {
        security.logger.info('stripe.webhook.paid', {
          eventId: event.id,
          type: event.type,
          shipmentId: paid.shipmentId,
          from: paid.from,
          to: paid.to,
        });
      }
      await airtableService.markWebhookProcessed(event.id, event.type);
      res.json({ received: true });
    } catch (err) {
      // 400 tells Stripe to retry; the failure reason is logged, not echoed.
      security.logger.error('stripe.webhook.rejected', { reason: err.message });
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

app.use(express.json());

// ------------------- Operator authentication (P0 security) -----------------
// Login form → HttpOnly, SameSite=Strict cookie holding ADMIN_TOKEN.
// The cookie value is the token itself (constant-time compared server-side);
// no session store is required, which keeps this dependency-free. Rotating
// ADMIN_TOKEN invalidates every existing cookie.
app.get('/login', (req, res) => {
  if (auth.isConfigured() && auth.checkAccess(req).allowed) return res.redirect('/dashboard/ops');
  res.set('Cache-Control', 'no-store');
  res.send(auth.renderLoginPage({ error: '', next: req.query.next || '/dashboard/ops' }));
});

// P1: brute-force throttle on the only credential-bearing public form.
app.post('/login', limiters.login, express.urlencoded({ extended: false }), (req, res) => {
  const body = req.body || {};
  const expected = auth.adminToken();
  const nextUrl = typeof body.next === 'string' && body.next.startsWith('/') ? body.next : '/dashboard/ops';

  if (!expected) {
    security.logger.warn('auth.login.unconfigured', { path: req.path });
    res
      .status(503)
      .send(auth.renderLoginPage({ error: 'ADMIN_TOKEN не е конфигуриран на сървъра.', next: nextUrl }));
    return;
  }
  if (!auth.tokenMatches(body.token, expected)) {
    security.logger.warn('auth.login.failed', { path: req.path, ip: req.ip });
    res.status(401).send(auth.renderLoginPage({ error: 'Грешен токен.', next: nextUrl }));
    return;
  }
  security.logger.info('auth.login.success', { path: req.path, ip: req.ip });
  const secure = String(process.env.APP_URL || '').startsWith('https://') ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${auth.COOKIE_NAME}=${encodeURIComponent(expected)}; HttpOnly; SameSite=Strict; Path=/${secure}`
  );
  res.redirect(nextUrl);
});

// Client-side checkout (Stripe TEST mode only) — smallest server step:
// returns the stored shipment's escrow PaymentIntent clientSecret for
// public/pay.html (Stripe Elements). The amount comes from the stored
// record; the 80/15/5 split stays in money.js (applied at capture).
// P0 security: this returns a chargeable clientSecret → ADMIN_TOKEN required.
app.post(
  '/api/checkout/:shipmentId',
  limiters.api,
  auth.requireAdminApi,
  checkoutService.createCheckoutRoute({ store: airtableService, stripe: stripeService })
);

// Camera scan (batch 3 / T3): public/scan.html decodes the QR (jsQR via CDN)
// and POSTs the payload here → executed through the REAL /scan command
// (mock-ctx adapter — same production code path as the Telegram text entry).
// Batch 4 guard: localhost без токен; нелокален IP → SCAN_API_TOKEN (401 иначе).
app.post(
  '/api/scan',
  limiters.scan,
  scanWeb.createScanRoute({
    store: airtableService,
    stripe: stripeService,
    qr: qrService,
    carbon,
  })
);
app.get('/scan', (req, res) => res.redirect('/scan.html'));

app.use(express.static(path.join(__dirname, '..', 'public')));

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
// P0 security: exposes all users/shipments/disputes → ADMIN_TOKEN required.
app.get('/dashboard/ops', auth.requireAdminPage, async (req, res) => {
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
    security.logger.error('dashboard.ops.error', { reason: err.message });
    res.status(500).send('Ops dashboard error: ' + err.message);
  }
});

// Evidence packet endpoint (B5 anomaly 4 — ONE action, demo star)
// P0 security: exposes the financial timeline, disputes and photo hashes.
app.get('/api/evidence/:shipmentId', limiters.api, auth.requireAdminApi, async (req, res) => {
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
// P0 security: exposes all carbon entries + shipments → ADMIN_TOKEN required.
app.get('/dashboard/carbon', auth.requireAdminPage, async (req, res) => {
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
    security.logger.error('dashboard.carbon.error', { reason: err.message });
    res.status(500).send('Dashboard error: ' + err.message);
  }
});

// ------------------------------- Start -------------------------------------
const PORT = process.env.PORT || 3000;

/**
 * Bind the HTTP listener (and, when a token is present, the Telegram bot).
 *
 * This runs ONLY when the file is the process entry point (`npm start` /
 * `node src/bot.js`). When the module is `require()`d — which is exactly what
 * the P2 route tests do — the Express `app` is exported WITHOUT binding a port,
 * so the real production routes can be tested in-process (the sandbox forbids
 * spawning child servers).
 */
function startServer() {
  if (bot && process.env.TELEGRAM_WEBHOOK_URL) {
    // Production: webhook mode
    app.listen(PORT, async () => {
      security.logger.info('server.listening', { port: Number(PORT), mode: 'telegram-webhook' });
      await bot.telegram.setWebhook(`${process.env.TELEGRAM_WEBHOOK_URL}/webhooks/telegram`);
      security.logger.info('telegram.webhook.set');
    });
    bot.startWebhook('/webhooks/telegram', null, PORT);
  } else if (bot) {
    // Development: polling mode
    app.listen(PORT, () => {
      security.logger.info('server.listening', { port: Number(PORT), mode: 'telegram-polling' });
      console.log(`🌐 Web server running on port ${PORT} (webhooks endpoint ready)`);
      console.log(`🔒 Ops/KPI dashboard: http://localhost:${PORT}/dashboard/ops${adminHint()}`);
      console.log(`🌿 Carbon dashboard:  http://localhost:${PORT}/dashboard/carbon${adminHint()}`);
      console.log(`🏠 Landing:           http://localhost:${PORT}/`);
    });
    bot.launch().then(() => {
      console.log('🤖 DRUM bot started in polling mode');
      console.log('   Send /start to begin');
    });
  } else {
    // Dashboard-only mode (DEMO without Telegram credentials)
    app.listen(PORT, () => {
      security.logger.info('server.listening', { port: Number(PORT), mode: 'dashboard-only' });
      console.log('⚠️  TELEGRAM_BOT_TOKEN not set — bot disabled, dashboard-only mode.');
      console.log(`🌐 Web server running on port ${PORT}`);
      console.log(`🔒 Ops/KPI dashboard: http://localhost:${PORT}/dashboard/ops${adminHint()}`);
      console.log(`🌿 Carbon dashboard:  http://localhost:${PORT}/dashboard/carbon${adminHint()}`);
      console.log(`🏠 Landing:           http://localhost:${PORT}/`);
    });
  }
  return app;
}

if (require.main === module) {
  startServer();

  // Graceful shutdown
  process.once('SIGINT', () => bot && bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot && bot.stop('SIGTERM'));
}

module.exports = { app, bot, IS_DEMO, startServer, adminHint, limiters };
