/**
 * OCE standalone tests — carbon math (pure, no store, no network).
 * Adapted from DRUM tests/b6-carbon.test.cjs — DB/export parts stay in the
 * main app (see README limitations).
 */

const test = require('node:test');
const assert = require('node:assert');

const carbon = require('../src/services/carbon');

test('OCE carbon: Sofia-Plovdiv 25.38 kg saved with default factors', () => {
  const r = carbon.calculateCo2Saved({ originCity: 'София', destinationCity: 'Пловдив' });
  assert.equal(r.distanceKm, 145);
  assert.equal(r.baselineCo2Kg, 26.1);
  assert.equal(r.actualCo2Kg, 0.73);
  assert.equal(r.savedCo2Kg, 25.38);
  assert.equal(r.methodology, 'GHG-Protocol-Scope3-Cat4-v1');
  assert.deepEqual(r.factors, { baselineKgPerKm: 0.18, marginalKgPerKm: 0.005 });
});

test('OCE carbon: canon formula — saved = (0.18 - 0.005) x km = 0.175 x km', () => {
  const r = carbon.calculateCo2Saved({ originCity: 'София', destinationCity: 'Пловдив' });
  assert.equal(r.savedCo2Kg, 25.38); // 0.175 x 145
  assert.notEqual(r.savedCo2Kg, 25.97); // old double-counted-share value (B6.1)
});

test('OCE carbon: SELF-VERIFYING result — recalc from its own stored factors+km', () => {
  const r = carbon.calculateCo2Saved({ originCity: 'София', destinationCity: 'Варна' });
  // the same shape the DRUM ledger stores per entry
  const entry = {
    distanceKm: r.distanceKm,
    factors: r.factors,
    baselineCo2Kg: r.baselineCo2Kg,
    actualCo2Kg: r.actualCo2Kg,
    savedCo2Kg: r.savedCo2Kg,
  };
  const round2 = (x) => Math.round(x * 100) / 100;
  assert.equal(round2(entry.distanceKm * entry.factors.baselineKgPerKm), entry.baselineCo2Kg);
  assert.equal(round2(entry.distanceKm * entry.factors.marginalKgPerKm), entry.actualCo2Kg);
  assert.equal(
    round2(entry.distanceKm * entry.factors.baselineKgPerKm - entry.distanceKm * entry.factors.marginalKgPerKm),
    entry.savedCo2Kg
  );
});

test('OCE carbon: summarize aggregates match entry sum', () => {
  const entries = [
    { savedCo2Kg: 25.38 },
    { savedCo2Kg: 32.55 },
    { savedCo2Kg: 0.7 },
  ];
  const agg = carbon.summarize(entries);
  assert.equal(agg.savedCo2Kg, 58.63);
});
