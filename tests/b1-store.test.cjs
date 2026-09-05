/**
 * B1 contract tests — SQLite store adapter.
 * Run: node --test tests/
 * A clean clone must pass these with ZERO external services.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Isolated temp DB per run
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drum-b1-'));
process.env.SQLITE_PATH = path.join(tmp, 'test.db');
process.env.DATA_BACKEND = 'sqlite';

const store = require('../src/services/store');

test('B1: backend is sqlite by default and self-contained', () => {
  assert.equal(store.backend, 'sqlite');
  assert.ok(fs.existsSync(store.dbPath), 'db file exists after init');
});

test('B1: users — findOrCreate is idempotent by telegram_id', async () => {
  const a = await store.findOrCreateUser({ telegramId: 777001, firstName: 'Тест', lastName: 'П.' });
  const b = await store.findOrCreateUser({ telegramId: 777001, firstName: 'Тест' });
  assert.equal(a.id, b.id);
  assert.equal(b.trustScore, 50, 'starts at 50');
  assert.equal(b.trustTier, 'standard');
  assert.equal(b.kycStatus, 'pending');
});

test('B1: updateUser — phone/kyc/stripe/routes roundtrip', async () => {
  const u = await store.findOrCreateUser({ telegramId: 777002, firstName: 'Кари' });
  await store.updateUser(u.telegramId, {
    phone: '+359888000000',
    kycStatus: 'phone_verified',
    stripeConnectAccountId: 'acct_test_1',
    routes: [['София', 'Пловдив']],
  });
  const r = await store.findUserByTelegramId(u.telegramId);
  assert.equal(r.kycStatus, 'phone_verified');
  assert.equal(r.stripeConnectAccountId, 'acct_test_1');
  assert.deepEqual(r.routes, [['София', 'Пловдив']]);
});

test('B1: shipments — create/get/update/list lifecycle', async () => {
  const sender = await store.findOrCreateUser({ telegramId: 777003, firstName: 'Изп' });
  const s = await store.createShipment({
    senderId: sender.id, senderTelegramId: sender.telegramId,
    originCity: 'София', destinationCity: 'Пловдив',
    description: 'тестова пратка', parcelValueEur: 50, deadline: 'Днес',
    totalEur: 12, baseEur: 10, feeEur: 1.5, insuranceEur: 0.5,
    stripePaymentIntentId: 'pi_test_1', status: 'requested',
  });
  assert.ok(s.id.startsWith('shp-'));

  await store.updateShipment(s.id, {
    carrierId: 'usr-000001', carrierTelegramId: 777002,
    carrierStripeAccountId: 'acct_test_1', status: 'matched',
    matchedAt: new Date().toISOString(),
  });
  const got = await store.getShipment(s.id);
  assert.equal(got.status, 'matched');
  assert.equal(got.carrierStripeAccountId, 'acct_test_1');

  const byUser = await store.listShipmentsByUser(sender.telegramId);
  assert.ok(byUser.length >= 1);
  const pending = await store.listPendingShipments();
  assert.ok(!pending.some((p) => p.id === s.id), 'matched shipment is not pending');
});

test('B1: transactions + QR + disputes roundtrip', async () => {
  const s = await store.createShipment({
    senderTelegramId: 777003, originCity: 'София', destinationCity: 'Варна',
    status: 'delivered', totalEur: 18, baseEur: 15,
  });
  await store.recordTransaction({
    shipmentId: s.id, type: 'capture', amountCents: 1800, stripeId: 'ch_test',
    splitCarrierCents: 1440, splitDrumCents: 270, splitInsuranceCents: 90,
  });
  const txs = await store.listTransactionsByShipment(s.id);
  assert.equal(txs.length, 1);
  assert.equal(txs[0].splitCarrierCents, 1440);

  await store.saveQrCode({ shipmentId: s.id, kind: 'pickup', payload: `drum:pickup:${s.id}` });
  const qr = await store.getQrCode(s.id, 'pickup');
  assert.equal(qr.payload, `drum:pickup:${s.id}`);
  await store.markQrScanned(s.id, 'pickup');
  assert.ok((await store.getQrCode(s.id, 'pickup')).scannedAt);

  const d = await store.createDispute({ shipmentId: s.id, openedBy: 'usr-000001', reason: 'test' });
  assert.equal(d.status, 'open');
  await store.updateDisputeStatus(d.id, 'lost');
  assert.equal((await store.listDisputes({ userId: 'usr-000001' }))[0].status, 'lost');
});

test('B1: carbon ledger roundtrip with audit trail', async () => {
  await store.createCarbonEntry({
    shipmentId: 'shp-000001', originCity: 'София', destinationCity: 'Пловдив',
    baselineCo2Kg: 26.1, actualCo2Kg: 0.13, savedCo2Kg: 25.97, distanceKm: 145,
    methodology: 'GHG-Protocol-Scope3-Cat4-v1',
    factors: { baselineKgPerKm: 0.18, marginalShareFactor: 0.005 },
  });
  const entries = await store.listCarbonEntries();
  const e = entries.find((x) => x.shipmentId === 'shp-000001');
  assert.ok(e);
  assert.equal(e.methodology, 'GHG-Protocol-Scope3-Cat4-v1');
  assert.deepEqual(e.factors, { baselineKgPerKm: 0.18, marginalShareFactor: 0.005 });
});
