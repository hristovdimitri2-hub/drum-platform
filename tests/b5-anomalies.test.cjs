/**
 * B5 tests — Stripe anomalies 1-4 + one-action evidence packet.
 * Uses the default SQLite backend on an isolated temp DB.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drum-b5-'));
process.env.SQLITE_PATH = path.join(tmp, 'test.db');
process.env.DATA_BACKEND = 'sqlite';
process.env.DEMO_MODE = 'true';

const store = require('../src/services/store');
const money = require('../src/services/money');
const anomalies = require('../src/services/anomalies');

async function makeDeliveredShipment() {
  const sender = await store.findOrCreateUser({ telegramId: 810001, firstName: 'S' });
  const carrier = await store.findOrCreateUser({ telegramId: 810002, firstName: 'C' });
  await store.updateUser(carrier.telegramId, { stripeConnectAccountId: 'acct_test_c1' });
  const s = await store.createShipment({
    senderId: sender.id, senderTelegramId: sender.telegramId,
    originCity: 'София', destinationCity: 'Пловдив',
    totalEur: 12, baseEur: 10, feeEur: 1.5, insuranceEur: 0.5,
    stripePaymentIntentId: 'pi_test_b5_1', status: 'picked_up',
    isDemo: true,
  });
  return { sender, carrier, shipment: s };
}

/* ---------------- Anomaly 1: amount mismatch ---------------- */

test('B5.1: amount mismatch — detected with exact cents delta', () => {
  const shipment = { totalEur: 12 };
  assert.equal(anomalies.checkAmountMismatch(shipment, 1200).anomaly, false);
  const a = anomalies.checkAmountMismatch(shipment, 1300);
  assert.equal(a.anomaly, true);
  assert.equal(a.expectedCents, 1200);
  assert.equal(a.actualCents, 1300);
  assert.equal(a.deltaCents, 100);
});

/* ---------------- Anomaly 2: double capture / replay ---------------- */

test('B5.2: double capture blocked via transactions + webhook idempotency', async () => {
  const { shipment } = await makeDeliveredShipment();

  const r1 = await store.stripeCaptureForTest
    ? null
    : await require('../src/services/stripe').captureAndSplit({
        paymentIntentId: shipment.stripePaymentIntentId,
        carrierConnectAccountId: 'acct_test_c1',
        totalEur: 12,
      });
  assert.equal(r1.success, true);

  // canonical transaction recorded once
  await store.recordTransaction({
    shipmentId: shipment.id, type: 'capture',
    amountCents: r1.splitCents.totalCents,
    stripeId: r1.captureId,
    splitCarrierCents: r1.splitCents.carrierCents,
    splitDrumCents: r1.splitCents.drumCents,
    splitInsuranceCents: r1.splitCents.insuranceCents,
  });

  assert.equal(await anomalies.isDuplicateCapture(store, shipment.id), true);
  // split from the canonical money module, cent-exact
  assert.equal(r1.splitCents.carrierCents, 960);
  assert.equal(r1.splitCents.drumCents, 180);
  assert.equal(r1.splitCents.insuranceCents, 60);

  // webhook idempotency: same event id processed once
  assert.equal(await store.isWebhookProcessed('evt_1'), false);
  await store.markWebhookProcessed('evt_1', 'payment_intent.captured');
  assert.equal(await store.isWebhookProcessed('evt_1'), true);
});

/* ---------------- Anomaly 3: recipient declines signature ----------------- */

test('B5.3: refusal opens 24h proof window; proof attaches while open', async () => {
  const { shipment } = await makeDeliveredShipment();
  const opened = await anomalies.openDeliveryRefusal(store, { shipmentId: shipment.id, openedAtMs: Date.now() });
  assert.equal(opened.windowHours, 24);
  assert.ok(opened.dispute.id.startsWith('dsp-'));

  const att = await anomalies.attachDeliveryProof(store, opened.dispute.id, { kind: 'demo-placeholder' });
  assert.equal(att.ok, true);
  assert.ok(fs.existsSync(att.proofFile));
  const record = JSON.parse(fs.readFileSync(att.proofFile, 'utf8'));
  assert.equal(record.demoPlaceholder, true);   // honest: DEMO placeholder
  assert.equal((await store.getDispute(opened.dispute.id)).status, 'resolved');
});

test('B5.3: expired window -> refund + carrier penalty (-15)', async () => {
  const { carrier, shipment } = await makeDeliveredShipment();
  const pastMs = Date.now() - 25 * 3600000;     // opened 25h ago
  const opened = await anomalies.openDeliveryRefusal(store, {
    shipmentId: shipment.id, openedBy: carrier.id, openedAtMs: pastMs,
  });
  const expired = anomalies.isProofExpired(await store.getDispute(opened.dispute.id));
  assert.equal(expired, true);

  const resolved = await anomalies.processExpiredRefusals(store, carrier.id);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].action, 'refunded');
  const after = await store.findUserByTelegramId(carrier.telegramId);
  assert.equal(after.trustScore, 35);            // 50 - 15 delivery_failed
  assert.equal((await store.getDispute(opened.dispute.id)).status, 'lost');
});

test('B5.3: proof within window is accepted; expired proof rejected', async () => {
  const { shipment } = await makeDeliveredShipment();
  const opened = await anomalies.openDeliveryRefusal(store, { shipmentId: shipment.id });
  assert.equal(anomalies.isProofExpired(await store.getDispute(opened.dispute.id)), false);
  // attach works (accepted)
  assert.equal((await anomalies.attachDeliveryProof(store, opened.dispute.id, {})).ok, true);

  // a NEW refusal, expired at attach time
  const opened2 = await anomalies.openDeliveryRefusal(store, { shipmentId: shipment.id, openedAtMs: Date.now() - 48 * 3600000 });
  const rejected = await anomalies.attachDeliveryProof(store, opened2.dispute.id, {});
  assert.equal(rejected.ok, false);
  assert.match(rejected.reason, /expired/);
});

/* ---------------- Anomaly 4: one-action evidence packet ------------------- */

test('B5.4: evidence packet — one action, complete + hashed', async () => {
  const { shipment } = await makeDeliveredShipment();
  // a capture transaction so the timeline is not empty
  await store.recordTransaction({
    shipmentId: shipment.id, type: 'capture', amountCents: 1200,
    stripeId: 'ch_demo_b5', splitCarrierCents: 960,
    splitDrumCents: 180, splitInsuranceCents: 60,
  });
  await store.createCarbonEntry({
    shipmentId: shipment.id, originCity: 'София', destinationCity: 'Пловдив',
    baselineCo2Kg: 26.1, actualCo2Kg: 0.13, savedCo2Kg: 25.97,
    distanceKm: 145, methodology: 'GHG-Protocol-Scope3-Cat4-v1',
  });

  const out = await anomalies.buildEvidencePacket(store, shipment.id);
  assert.ok(fs.existsSync(out.jsonPath));
  assert.ok(fs.existsSync(out.mdPath));
  assert.match(out.sha256, /^[a-f0-9]{64}$/);

  const packet = JSON.parse(fs.readFileSync(out.jsonPath, 'utf8'));
  assert.equal(packet.shipment.id, shipment.id);
  assert.equal(packet.financialTimeline.length, 1);
  assert.equal(packet.financialTimeline[0].splitCents.carrier, 960);
  assert.equal(packet.carbonLedger.savedCo2Kg, 25.97);
  assert.ok(packet.stripe.mode.startsWith('DEMO'));

  // checksum is reproducible: same content -> same hash
  const crypto = require('node:crypto');
  const rehash = crypto.createHash('sha256')
    .update(JSON.stringify(Object.assign({}, packet, { checksum: null })))
    .digest('hex');
  assert.equal(rehash, out.sha256);

  fs.rmSync(path.dirname(out.jsonPath), { recursive: true, force: true });
});
