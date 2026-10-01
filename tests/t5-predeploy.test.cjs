/**
 * Batch 4 / T2 — pre-deploy guards:
 *  1. POST /api/scan access: localhost без токен; нелокален IP изисква
 *     SCAN_API_TOKEN (Bearer или X-Demo-Token) → 401 иначе.
 *  2. Leftover 'paid' status: webhook event → requested→paid; /accept и
 *     pending списъците приемат 'paid'.
 * Headless: temp SQLite, DEMO rails, injected download (no network).
 */

process.env.SQLITE_PATH = require('node:path').join(
  require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'drum-t5-')),
  'test.db'
);
process.env.DATA_BACKEND = 'sqlite';
process.env.DEMO_MODE = 'true';
process.env.SCAN_API_TOKEN = 'test-token-abc123';

const test = require('node:test');
const assert = require('node:assert');

const store = require('../src/services/store');
const stripe = require('../src/services/stripe');
const qr = require('../src/services/qr');
const carbon = require('../src/services/carbon');
const { checkScanAccess, createScanRoute } = require('../src/services/scanWeb');
const stripeEvents = require('../src/services/stripeEvents');
const { createMockCtx, transcript } = require('../src/services/telegramMock');
const acceptCmd = require('../src/commands/accept');

function fakeRes() {
  return {
    code: null,
    body: null,
    status(c) { this.code = c; return this; },
    json(o) { this.body = o; return this; },
  };
}

const route = createScanRoute({ store, stripe, qr, carbon });

async function req(ip, headers, payload) {
  const res = fakeRes();
  await route({ ip, headers, body: { payload } }, res);
  return res;
}

async function makeRequested(tag, status = 'requested') {
  const sender = await store.findOrCreateUser({ telegramId: 860001, firstName: 'S' });
  const s = await store.createShipment({
    senderId: sender.id, senderTelegramId: sender.telegramId,
    originCity: 'София', destinationCity: 'Пловдив',
    totalEur: 12, baseEur: 10, feeEur: 1.5, insuranceEur: 0.5,
    stripePaymentIntentId: 'pi_test_' + tag, status, isDemo: true,
  });
  return s;
}

async function makeMatched(tag) {
  const s = await makeRequested(tag);
  const carrier = await store.findOrCreateUser({ telegramId: 860002, firstName: 'C' });
  await store.updateShipment(s.id, {
    carrierId: carrier.id,
    carrierTelegramId: carrier.telegramId,
    carrierStripeAccountId: 'acct_demo_t5',
    status: 'matched',
    matchedAt: new Date().toISOString(),
  });
  return s;
}

/* ---------------- 1. /api/scan access guard ---------------- */

test('T5 guard: localhost passes WITHOUT a token (demo flows keep working)', async () => {
  // garbage payload → 400 (access granted) — 401 would mean the guard blocked
  const res = await req('127.0.0.1', {}, 'garbage');
  assert.equal(res.code, 400, 'local request reaches the handler');
  const res6 = await req('::1', {}, 'garbage');
  assert.equal(res6.code, 400, 'IPv6 loopback is local too');
});

test('T5 guard: remote without token → 401; wrong token → 401', async () => {
  const noTok = await req('203.0.113.7', {}, 'garbage');
  assert.equal(noTok.code, 401);
  assert.match(noTok.body.error, /token required/);

  const wrong = await req('203.0.113.7', { 'x-demo-token': 'nope' }, 'garbage');
  assert.equal(wrong.code, 401);
  assert.match(wrong.body.error, /invalid token/);
});

test('T5 guard: remote + X-Demo-Token → real pickup scan runs (200)', async () => {
  const s = await makeMatched('guard1');
  const res = await req('203.0.113.7', { 'x-demo-token': 'test-token-abc123' }, `drum:pickup:${s.id}`);
  assert.equal(res.code, 200);
  assert.equal(res.body.shipment.status, 'picked_up');
  assert.ok(res.body.replies.includes('Pickup confirmed'));
});

test('T5 guard: remote + Authorization Bearer passes; no SCAN_API_TOKEN env → 401', async () => {
  const ok = await req('198.51.100.9', { authorization: 'Bearer test-token-abc123' }, 'garbage');
  assert.equal(ok.code, 400, 'Bearer token accepted (handler reached)');

  const saved = process.env.SCAN_API_TOKEN;
  delete process.env.SCAN_API_TOKEN;
  try {
    const noEnv = await req('198.51.100.9', { authorization: 'Bearer test-token-abc123' }, 'garbage');
    assert.equal(noEnv.code, 401);
    assert.match(noEnv.body.error, /not configured/);
  } finally {
    process.env.SCAN_API_TOKEN = saved;
  }
});

test('T5 guard: checkScanAccess unit matrix', () => {
  assert.deepEqual(checkScanAccess({ ip: '127.0.0.1', headers: {} }), { allowed: true, local: true });
  assert.deepEqual(checkScanAccess({ ip: '::ffff:127.0.0.1', headers: {} }), { allowed: true, local: true });
  const denied = checkScanAccess({ ip: '192.0.2.1', headers: {} });
  assert.equal(denied.allowed, false);
  const ok = checkScanAccess({ ip: '192.0.2.1', headers: { 'x-demo-token': 'test-token-abc123' } });
  assert.deepEqual(ok, { allowed: true, local: false });
});

/* ---------------- 2. 'paid' status (leftover from batch 1) ---------------- */

test('T5 paid: amount_capturable_updated → requested becomes paid', async () => {
  const s = await makeRequested('paid1');
  assert.equal(s.status, 'requested');

  const out = await stripeEvents.handleStripeEvent({
    type: 'payment_intent.amount_capturable_updated',
    data: { object: { id: 'pi_test_paid1' } },
  }, store);

  assert.deepEqual(out, { handled: true, shipmentId: s.id, from: 'requested', to: 'paid' });
  const after = await store.getShipment(s.id);
  assert.equal(after.status, 'paid');
});

test('T5 paid: no-ops — matched shipments, unknown PI, unrelated events', async () => {
  const matched = await makeMatched('paid2');
  const out1 = await stripeEvents.handleStripeEvent({
    type: 'payment_intent.amount_capturable_updated',
    data: { object: { id: 'pi_test_paid2' } },
  }, store);
  assert.equal(out1.handled, false, 'matched shipment untouched');
  assert.equal((await store.getShipment(matched.id)).status, 'matched');

  const out2 = await stripeEvents.handleStripeEvent({
    type: 'payment_intent.amount_capturable_updated',
    data: { object: { id: 'pi_test_does_not_exist' } },
  }, store);
  assert.equal(out2.handled, false, 'unknown PI is a no-op');

  const out3 = await stripeEvents.handleStripeEvent(
    { type: 'payment_intent.payment_failed', data: { object: { id: 'pi_test_paid1' } } },
    store
  );
  assert.equal(out3.handled, false, 'unrelated event types ignored');
});

test('T5 paid: /accept accepts a PAID shipment (requested-like state)', async () => {
  const s = await makeRequested('paid3');
  await stripeEvents.handleStripeEvent({
    type: 'payment_intent.amount_capturable_updated',
    data: { object: { id: 'pi_test_paid3' } },
  }, store);

  const carrier = await store.findOrCreateUser({ telegramId: 860002, firstName: 'C' });
  await store.updateUser(carrier.telegramId, { phone: '+359888000001', kycStatus: 'phone_verified' });

  const ctx = createMockCtx({ from: { id: 860002, first_name: 'C' }, text: '/accept ' + s.id });
  ctx.airtable = store;
  ctx.qr = qr;
  ctx.telegram = { sendMessage: async () => {} };
  await acceptCmd(ctx);

  const after = await store.getShipment(s.id);
  assert.equal(after.status, 'matched', 'paid shipment accepted');
  assert.ok(transcript(ctx).includes('Приета заявка'), transcript(ctx));
});

test('T5 paid: listPendingShipments includes BOTH requested and paid', async () => {
  const a = await makeRequested('pend1');          // stays requested
  const b = await makeRequested('pend2');
  await stripeEvents.handleStripeEvent({
    type: 'payment_intent.amount_capturable_updated',
    data: { object: { id: 'pi_test_pend2' } },
  }, store);                                       // → paid

  const pending = await store.listPendingShipments();
  const ids = pending.map((p) => p.id);
  assert.ok(ids.includes(a.id), 'requested visible');
  assert.ok(ids.includes(b.id), 'paid visible');
});
