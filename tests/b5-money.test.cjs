/**
 * B5 money tests — THE canonical split/VAT module.
 * Criterion: cent-exact, waterfall always reconciles to €0.00 remainder.
 */

const test = require('node:test');
const assert = require('node:assert');
const money = require('../src/services/money');

test('MONEY: rates are 80/15/5 and VAT 20%', () => {
  assert.equal(money.CARRIER_RATE, 0.8);
  assert.equal(money.DRUM_RATE, 0.15);
  assert.equal(money.INSURANCE_RATE, 0.05);
  assert.equal(money.VAT_RATE, 0.2);
});

test('MONEY: split 12.00 EUR → 960/180/60', () => {
  const s = money.splitAmounts(1200);
  assert.deepEqual(s, { totalCents: 1200, carrierCents: 960, drumCents: 180, insuranceCents: 60 });
});

test('MONEY: split reconciles to €0.00 remainder for 1000 tricky values', () => {
  for (let t = 1; t <= 1000; t++) {
    const s = money.splitAmounts(t);
    const sum = s.carrierCents + s.drumCents + s.insuranceCents;
    assert.equal(sum, t, `split of ${t} does not reconcile`);
    assert.ok(s.insuranceCents >= 0, `negative insurance for ${t}`);
    assert.ok(s.drumCents >= 0);
  }
});

test('MONEY: rounding table (documented cases)', () => {
  // 10.01 EUR: 801 + 150 + 50 = 1001
  assert.deepEqual(
    [money.splitAmounts(1001).carrierCents, money.splitAmounts(1001).drumCents, money.splitAmounts(1001).insuranceCents],
    [801, 150, 50],
  );
  // 9.99: 799 + 150 + 50 = 999
  assert.deepEqual(
    [money.splitAmounts(999).carrierCents, money.splitAmounts(999).drumCents, money.splitAmounts(999).insuranceCents],
    [799, 150, 50],
  );
  // 3.33: 267 (266.4 rounds to 266? 333*0.8=266.4 → round → 266) — verify:
  const s = money.splitAmounts(333);
  assert.equal(s.carrierCents, 266);
  assert.equal(s.carrierCents + s.drumCents + s.insuranceCents, 333);
});

test('MONEY: eur/cents conversions are exact for cent-precision inputs', () => {
  assert.equal(money.eurToCents(12), 1200);
  assert.equal(money.eurToCents(12.34), 1234);
  assert.equal(money.centsToEur(1234), 12.34);
  assert.equal(money.centsToEur(money.eurToCents(0.07)), 0.07);
});

test('MONEY: VAT on DRUM fee — canon B8.1: 20% ON TOP (tax-exclusive)', () => {
  const v = money.vatOnDrumFee(180);
  assert.deepEqual(v, { feeCents: 180, vatCents: 36, netCents: 180 });
  // 0.414 case: fee 2.07 → VAT 0.414 → 41c
  assert.equal(money.vatOnDrumFee(207).vatCents, 41);
});

test('MONEY: VAT applies to DRUM fee ONLY — carrier payout untouched', () => {
  const split = money.splitAmounts(1200);
  const v = money.vatOnDrumFee(split.drumCents);
  assert.equal(split.carrierCents, 960);                 // carrier unaffected
  assert.equal(split.insuranceCents, 60);                // insurance unaffected
  assert.equal(v.feeCents, 180);                         // only the fee
});

test('MONEY: Stripe canon 1.5% + €0.25 on the captured amount', () => {
  assert.equal(money.STRIPE.percent, 0.015);
  assert.equal(money.STRIPE.fixedCents, 25);
  assert.equal(money.stripeFeeCents(1200), 43);          // 18 + 25
  assert.equal(money.stripeFeeCents(437), 32);           // 7 + 25 (GTM-ENTRY)
  assert.equal(money.stripeFeeCents(775), 37);           // 12 + 25 (BASE)
});
