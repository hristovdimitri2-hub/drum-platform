/**
 * Batch 3 / T3 — WEB (camera) scan entry: mock decode → POST handler →
 * the REAL /scan command → capture + split + Trust + CO2.
 * Headless: no camera/network; the "decode" is the payload string that
 * jsQR would return (same format as the QR shown on screen).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drum-t4-'));
process.env.SQLITE_PATH = path.join(tmp, 'test.db');
process.env.DATA_BACKEND = 'sqlite';
process.env.DEMO_MODE = 'true';

const store = require('../src/services/store');
const stripe = require('../src/services/stripe');
const qr = require('../src/services/qr');
const carbon = require('../src/services/carbon');
const { handleScanRequest, parsePayload } = require('../src/services/scanWeb');

function deps(body) {
  return { body, store, stripe, qr, carbon };
}

async function makeMatched() {
  const sender = await store.findOrCreateUser({ telegramId: 850001, firstName: 'S' });
  const carrier = await store.findOrCreateUser({ telegramId: 850002, firstName: 'C' });
  const s = await store.createShipment({
    senderId: sender.id, senderTelegramId: sender.telegramId,
    originCity: 'София', destinationCity: 'Пловдив',
    totalEur: 12, baseEur: 10, feeEur: 1.5, insuranceEur: 0.5,
    stripePaymentIntentId: 'pi_demo_t4', status: 'requested',
    isDemo: true,
  });
  // carrier columns are set via update (sqlite INSERT covers sender only)
  await store.updateShipment(s.id, {
    carrierId: carrier.id,
    carrierTelegramId: carrier.telegramId,
    carrierStripeAccountId: 'acct_demo_t4',
    status: 'matched',
    matchedAt: new Date().toISOString(),
  });
  return s;
}

test('T4: parsePayload accepts drum:pickup|delivery only', () => {
  assert.deepEqual(parsePayload('drum:pickup:shp-1'), { action: 'pickup', shipmentId: 'shp-1' });
  assert.deepEqual(parsePayload('drum:delivery:recABC'), { action: 'delivery', shipmentId: 'recABC' });
  assert.equal(parsePayload('garbage'), null);
  assert.equal(parsePayload('drum:weird:id'), null);
  assert.equal(parsePayload(''), null);
  assert.equal(parsePayload(undefined), null);
});

test('T4: camera entry — pickup (mock decode) runs the REAL scan flow', async () => {
  const s = await makeMatched();
  const out = await handleScanRequest(deps({ payload: `drum:pickup:${s.id}` }));
  assert.equal(out.ok, true);
  assert.equal(out.status, 200);
  assert.ok(out.replies.includes('Pickup confirmed'), out.replies);
  assert.equal(out.shipment.status, 'picked_up');
});

test('T4: camera entry — delivery → capture + split + Trust + CO2', async () => {
  const s = await makeMatched();
  await handleScanRequest(deps({ payload: `drum:pickup:${s.id}` })); // → picked_up
  const out = await handleScanRequest(deps({ payload: `drum:delivery:${s.id}` }));
  assert.equal(out.ok, true);
  assert.ok(out.replies.includes('Доставката е завършена'), out.replies);

  const after = await store.getShipment(s.id);
  assert.equal(after.status, 'delivered');

  // canonical split of the captured €12.00 (money.js)
  const txs = await store.listTransactionsByShipment(s.id);
  assert.equal(txs.length, 1);
  assert.equal(txs[0].amountCents, 1200);
  assert.equal(txs[0].splitCarrierCents, 960);
  assert.equal(txs[0].splitDrumCents, 180);
  assert.equal(txs[0].splitInsuranceCents, 60);

  // trust + carbon recorded
  const carrier = await store.findUserByTelegramId(850002);
  assert.equal(carrier.trustScore, 55);
  const entries = await store.listCarbonEntries();
  assert.ok(entries.some((e) => e.shipmentId === s.id), 'carbon entry exists');
});

test('T4: invalid payload → 400; unknown shipment → friendly reply, no crash', async () => {
  const bad = await handleScanRequest(deps({ payload: 'not-a-qr' }));
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 400);

  const badAction = await handleScanRequest(deps({ payload: 'drum:explode:shp-1' }));
  assert.equal(badAction.status, 400);

  const missing = await handleScanRequest(deps({}));
  assert.equal(missing.status, 400);

  const unknown = await handleScanRequest(deps({ payload: 'drum:delivery:shp-nope-999' }));
  assert.equal(unknown.ok, true);
  assert.ok(unknown.replies.includes('не е намерена'), unknown.replies);
  assert.equal(unknown.shipment, null);
});
