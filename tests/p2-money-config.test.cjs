/**
 * P2 — money.js configuration must be validated, not silently trusted.
 *
 * Before: the three split percentages were read with
 * `Number(process.env.X || default) / 100`, so
 *   - `CARRIER_PAYOUT_PERCENT=abc`      → NaN rates → NaN money
 *   - carrier=80 + facilitation=80      → insurance leg = −60% (negative pool)
 * both silently accepted on a path that moves real money.
 *
 * The parsing/validation core is exported so the env matrix can be tested
 * without reloading the module (the rates are read once, at import time).
 */

const test = require('node:test');
const assert = require('node:assert');

const money = require('../src/services/money');

test('P2 money-config: defaults are 80/15/5 and sum to 100', () => {
  assert.equal(money.CARRIER_PERCENT, 80);
  assert.equal(money.DRUM_PERCENT, 15);
  assert.equal(money.INSURANCE_PERCENT, 5);
  assert.equal(money.CARRIER_PERCENT + money.DRUM_PERCENT + money.INSURANCE_PERCENT, 100);
});

test('P2 money-config: parsePercent falls back when unset or blank', () => {
  assert.equal(money.parsePercent(undefined, 80, 'X'), 80);
  assert.equal(money.parsePercent(null, 15, 'X'), 15);
  assert.equal(money.parsePercent('', 5, 'X'), 5);
  assert.equal(money.parsePercent('   ', 5, 'X'), 5);
});

test('P2 money-config: parsePercent accepts valid values and numeric strings', () => {
  assert.equal(money.parsePercent('70', 80, 'X'), 70);
  assert.equal(money.parsePercent(70, 80, 'X'), 70);
  assert.equal(money.parsePercent('0', 80, 'X'), 0);
  assert.equal(money.parsePercent('100', 80, 'X'), 100);
  assert.equal(money.parsePercent(12.5, 80, 'X'), 12.5);
});

test('P2 money-config: parsePercent rejects non-numeric and out-of-range values', () => {
  assert.throws(() => money.parsePercent('abc', 80, 'CARRIER_PAYOUT_PERCENT'), /is not a number/);
  assert.throws(() => money.parsePercent('NaN', 80, 'X'), /is not a number/);
  assert.throws(() => money.parsePercent('-1', 80, 'X'), /outside the allowed range/);
  assert.throws(() => money.parsePercent('101', 80, 'X'), /outside the allowed range/);
});

test('P2 money-config: validateRates accepts 80/15/5 and rejects a split that is not 100%', () => {
  assert.doesNotThrow(() =>
    money.validateRates({ carrierPercent: 80, drumPercent: 15, insurancePercent: 5 })
  );

  // The previously-silent bad configurations.
  assert.throws(
    () => money.validateRates({ carrierPercent: 80, drumPercent: 80, insurancePercent: 5 }),
    /must sum to exactly 100%/
  );
  assert.throws(
    () => money.validateRates({ carrierPercent: 60, drumPercent: 15, insurancePercent: 5 }),
    /must sum to exactly 100%/
  );
  assert.throws(
    () => money.validateRates({ carrierPercent: NaN, drumPercent: 15, insurancePercent: 5 }),
    /outside the allowed range/
  );
});

test('P2 money-config: validateRates accepts other splits that DO sum to 100', () => {
  const out = money.validateRates({ carrierPercent: 70, drumPercent: 20, insurancePercent: 10 });
  assert.equal(out.sum, 100);
  assert.equal(out.carrierPercent, 70);
});

test('P2 money-config: the loaded rates drive splitAmounts consistently', () => {
  // Nothing may produce a negative insurance leg.
  for (const cents of [1, 5, 100, 437, 775, 1200, 1380, 99999]) {
    const s = money.splitAmounts(cents);
    assert.ok(s.insuranceCents >= 0, `negative insurance at ${cents}`);
    assert.ok(s.carrierCents >= 0 && s.drumCents >= 0);
    assert.equal(
      s.carrierCents + s.drumCents + s.insuranceCents,
      s.totalCents,
      `split must reconcile at ${cents}`
    );
  }
});
