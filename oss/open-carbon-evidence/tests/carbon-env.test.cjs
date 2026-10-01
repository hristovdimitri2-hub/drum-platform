/**
 * OCE standalone tests — env-configurable factors.
 * Runs in its OWN process (node --test = 1 file per process) with the
 * baseline overridden before the module is required.
 */

process.env.CO2_BASELINE_KG_PER_KM = '0.25';
process.env.CO2_MARGINAL_KG_PER_KM = '0.004'; // absolute kg/km (B6.1 canon)

const test = require('node:test');
const assert = require('node:assert');

const carbon = require('../src/services/carbon');

test('OCE carbon: factors are env-configurable (0.25 / 0.004)', () => {
  const r = carbon.calculateCo2Saved({ originCity: 'София', destinationCity: 'Пловдив' });
  assert.equal(r.factors.baselineKgPerKm, 0.25);
  assert.equal(r.factors.marginalKgPerKm, 0.004);
  // saved = (0.25 - 0.004) x 145 = 35.67
  assert.equal(r.savedCo2Kg, 35.67);
  assert.equal(r.baselineCo2Kg, 36.25); // 0.25 x 145
  assert.equal(r.actualCo2Kg, 0.58); // 0.004 x 145
});
