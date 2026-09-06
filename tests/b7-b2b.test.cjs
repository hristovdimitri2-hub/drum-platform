/**
 * B7 tests — B2B Reverse Marketplace prototype (Master Blueprint §4.3):
 * caps, broadcast, dual mode, batch economics (canonical money).
 */

const test = require('node:test');
const assert = require('node:assert');
const b2b = require('../src/services/b2b');
const money = require('../src/services/money');

const req = (id, userPaysCents = 798) => ({ id, userPaysCents });

test('B7: caps — 5 parcels/standard car, 10/van', () => {
  assert.equal(b2b.CAPS_PER_VEHICLE.standard, 5);
  assert.equal(b2b.CAPS_PER_VEHICLE.van, 10);
});

test('B7: planBatches — 11 requests, standard car → 3 batches (5+5+1)', () => {
  const requests = Array.from({ length: 11 }, (_, i) => req('r' + String(i + 1).padStart(2, '0')));
  const plan = b2b.planBatches(requests);
  assert.equal(plan.totalParcels, 11);
  assert.equal(plan.batches.length, 3);
  assert.equal(plan.batches[0].parcelCount, 5);
  assert.equal(plan.batches[2].parcelCount, 1);
  assert.equal(plan.batches[0].pickupWindowMinutes, 30);
});

test('B7: van cap 10 — 11 requests → 2 batches (10+1)', () => {
  const requests = Array.from({ length: 11 }, (_, i) => req('r' + String(i + 1).padStart(2, '0')));
  const plan = b2b.planBatches(requests, { vehicleType: 'van' });
  assert.equal(plan.batches.length, 2);
  assert.equal(plan.batches[0].parcelCount, 10);
});

test('B7: broadcast message — guaranteed EUR, parcel count, no auto-assign', () => {
  const batch = { parcelCount: 8, carrierPayoutCents: 4480, pickupWindowMinutes: 30 };
  const msg = b2b.broadcastMessage(batch, 'София → Пловдив');
  assert.match(msg, /Гарантиан?рантов?|Гарантиран/);
  assert.match(msg, /8 пратки/);
  assert.match(msg, /не назначава/);
});

test('B7: batch economics — Stripe fixed fee amortized (canon money)', () => {
  const e = b2b.batchEconomics(10, 437); // GTM ticket, batch of 10
  assert.equal(e.ticketTotalCents, 4370);
  assert.equal(e.userPaysTotalCents, money.userPaysCents(4370)); // 4501
  assert.equal(e.stripeFeeBatchCents, 93);                        // round(67.5)+25
  assert.equal(e.stripeFeeOnDemandTotalCents, 320);               // 10 x 32
  assert.equal(e.stripeFixedSavingsCents, 227);
  assert.equal(e.effectiveRetainedPerParcelCents, 43);            // €0.43 vs €0.21
});

test('B7: batch economics — reconciliation to €0.00 per batch', () => {
  const e = b2b.batchEconomics(10, 437);
  // ticket breakdown (cent-exact): ticket = carrier + insurance + drumFee
  assert.equal(e.carrierCents + e.insuranceCents + e.drumFeeCents, e.ticketTotalCents);
  // fee breakdown: drumFee = VAT(on top) + stripe + retained
  assert.equal(e.drumFeeCents, e.vatCents + e.stripeFeeBatchCents + e.retainedTotalCents);
  // userPays = ticket + VAT
  assert.equal(e.userPaysTotalCents, e.ticketTotalCents + e.vatCents);
});

test('B7: dual mode — +1.50 individual / -1.50 batch wait', () => {
  const individual = b2b.dualModePricing(798, true);
  assert.equal(individual.priceCents, 798 + 150);
  assert.equal(individual.mode, 'individual');
  const batch = b2b.dualModePricing(798, false);
  assert.equal(batch.priceCents, 798 - 150);
  assert.equal(batch.mode, 'batch');
});
