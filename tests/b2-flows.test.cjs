/**
 * B2 tests — FULL user flows through the REAL command handlers with the
 * Telegram mock adapter, headless (no token, no network, SQLite temp DB):
 *   /start → phone contact → /new wizard (escrow) → ops notify →
 *   /accept (carrier chooses) → QR → pickup scan → delivery scan →
 *   capture + split → Trust → CO2 → /matches → /status.
 * STRICT AGENT MODEL is asserted end-to-end.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drum-b2-'));
process.env.SQLITE_PATH = path.join(tmp, 'test.db');
process.env.DATA_BACKEND = 'sqlite';
process.env.DEMO_MODE = 'true';
delete process.env.TELEGRAM_BOT_TOKEN;

const store = require('../src/services/store');
const money = require('../src/services/money');
const carbon = require('../src/services/carbon');
const { createMockCtx, transcript } = require('../src/services/telegramMock');

const start = require('../src/commands/start');
const newCmd = require('../src/commands/new');
const accept = require('../src/commands/accept');
const scan = require('../src/commands/scan');
const matches = require('../src/commands/matches');
const status = require('../src/commands/status');

const SERVICES = { airtable: store, stripe: require('../src/services/stripe'), qr: require('../src/services/qr'), carbon: require('../src/services/carbon') };

function ctx(user, text, extra = {}) {
  const c = createMockCtx({ from: user, text, ...extra });
  Object.assign(c, SERVICES);
  return c;
}

const SENDER = { id: 920001, first_name: 'Стефан', username: 'sender_bg' };
const CARRIER = { id: 920002, first_name: 'Мира', username: 'carrier_bg' };

test('B2: /start registers the sender', async () => {
  const c = ctx(SENDER, '/start');
  await start(c);
  const u = await store.findUserByTelegramId(SENDER.id);
  assert.ok(u, 'sender registered');
  assert.equal(u.trustScore, 50);
  assert.ok(transcript(c).includes('DRUM 3.0'));
});

test('B2: contact sharing verifies phone (GDPR-safe in demo)', async () => {
  const c = ctx(SENDER, '', { contact: { phone_number: '+359888111222' } });
  await start.contactHandler(c);
  const u = await store.findUserByTelegramId(SENDER.id);
  assert.equal(u.kycStatus, 'phone_verified');
});

test('B2: /new wizard — corridor → description → value → deadline → confirm', async () => {
  const c = ctx(SENDER, '/new'); // one persistent session per user (like the bot)
  await newCmd(c);
  c.message.text = 'София → Пловдив';
  await newCmd.handleTextInput(c);
  c.message.text = 'Малък пакет, 2 kg, телефон за ремонт';
  await newCmd.handleTextInput(c);
  c.message.text = '50';
  await newCmd.handleTextInput(c);
  c.message.text = 'Днес';
  await newCmd.handleTextInput(c);
  c.message.text = '✅ Потвърждавам';
  await newCmd.handleTextInput(c);

  const pending = await store.listPendingShipments();
  assert.equal(pending.length, 1);
  const s = pending[0];
  assert.equal(s.status, 'requested');
  assert.equal(s.originCity, 'София');
  assert.equal(s.totalEur, 12); // premium corridor ticket €10 → €12 (bot basket)
  assert.ok(s.stripePaymentIntentId.startsWith('pi_demo_'), 'escrow frozen (demo)');
  global.__B2_SHIPMENT = s;
});

test('B2: carrier /accept — USER CHOOSES, no auto-assign (Strict Agent Model)', async () => {
  const s = global.__B2_SHIPMENT;
  // carrier onboarding: /start + phone (required for /accept)
  const onb = ctx(CARRIER, '/start');
  await start(onb);
  await start.contactHandler(ctx(CARRIER, '', { contact: { phone_number: '+359888222333' } }));
  const c = ctx(CARRIER, '/accept ' + s.id);
  await accept(c);
  const got = await store.getShipment(s.id);
  assert.equal(got.status, 'matched');
  assert.equal(got.carrierTelegramId, CARRIER.id);
  assert.ok(c.__photos.length >= 2, 'pickup + delivery QR photos sent');
});

test('B2: pickup scan → picked_up, sender notified', async () => {
  const s = global.__B2_SHIPMENT;
  const c = ctx(CARRIER, '/scan drum:pickup:' + s.id);
  await scan(c);
  const got = await store.getShipment(s.id);
  assert.equal(got.status, 'picked_up');
  assert.ok(got.pickupScannedAt);
});

test('B2: delivery scan → capture+split (canon money) → Trust → CO2', async () => {
  const s = global.__B2_SHIPMENT;
  const c = ctx(CARRIER, '/scan drum:delivery:' + s.id);
  await scan(c);

  const got = await store.getShipment(s.id);
  assert.equal(got.status, 'delivered');
  assert.ok(got.deliveryScannedAt);

  // canonical split of the captured €12.00 (bot premium ticket)
  const txs = await store.listTransactionsByShipment(s.id);
  assert.equal(txs.length, 1);
  assert.equal(txs[0].amountCents, 1200);
  assert.equal(txs[0].splitCarrierCents, 960);
  assert.equal(txs[0].splitDrumCents, 180);
  assert.equal(txs[0].splitInsuranceCents, 60);

  // trust: carrier +5 (58), sender +3 (53) — role-specific (B4)
  const carrier = await store.findUserByTelegramId(CARRIER.id);
  assert.equal(carrier.trustScore, 55);
  const sender = await store.findUserByTelegramId(SENDER.id);
  assert.equal(sender.trustScore, 53);

  // carbon entry with audit trail
  const entries = await store.listCarbonEntries();
  const e = entries.find((x) => x.shipmentId === s.id);
  assert.equal(e.savedCo2Kg, 25.97);
  assert.ok(e.factors);
});

test('B2: /matches ranks candidates (display-only)', async () => {
  const s = global.__B2_SHIPMENT;
  const c = ctx(SENDER, '/matches ' + s.id);
  await matches(c);
  const t = transcript(c);
  assert.ok(t.includes('ТОП'), 'ranking shown');
  assert.ok(t.includes('/accept'), 'points to carrier self-accept');
});

test('B2: /status shows trust score', async () => {
  const c = ctx(CARRIER, '/status');
  await status(c);
  assert.ok(transcript(c).includes('55'));
});
