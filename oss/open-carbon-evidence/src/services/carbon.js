/**
 * Carbon Ledger — CO2 savings calculator
 *
 * Methodology: GHG Protocol Corporate Value Chain (Scope 3),
 * Category 4 — Upstream Transportation and Distribution.
 *
 * Baseline (counterfactual): a dedicated courier van trip carrying only
 * this parcel. Emission factor: BASELINE_EMISSIONS_KG_PER_KM
 * (default 0.18 kg CO2e/km — light commercial vehicle, ~50% load, EU mix).
 *
 * Actual (DRUM scenario): the parcel rides in a private car that was
 * already making the trip with an empty trunk. The MARGINAL emission
 * factor is ABSOLUTE (B6.1 canon):
 *   actual = distance × MARGINAL_KG_PER_KM   (default 0.005 kg CO2e/km)
 *   saved  = (baseline − marginal) × km = 0.175 × km
 * (conservative per GHG Protocol allocation hierarchy — marginal weight of
 * one small parcel in an existing journey).
 *
 * saved = baseline - actual
 *
 * Every calculation returns the full factor set used, so each Carbon
 * Ledger entry is reproducible (audit trail).
 */

const BASELINE_EMISSIONS_KG_PER_KM = parseFloat(
  process.env.CO2_BASELINE_KG_PER_KM || '0.18'
);
const MARGINAL_KG_PER_KM = parseFloat(
  process.env.CO2_MARGINAL_KG_PER_KM || '0.005'
);
const METHODOLOGY_TAG = 'GHG-Protocol-Scope3-Cat4-v1';

/**
 * Known corridor distances in km (road, Bulgaria). Extend as corridors open.
 */
const CORRIDOR_DISTANCES_KM = {
  'София-Пловдив': 145,
  'Пловдив-София': 145,
  'София-Варна': 415,
  'Варна-София': 415,
  'София-Бургас': 385,
  'Бургас-София': 385,
  'София-Велико Търново': 220,
  'Велико Търново-София': 220,
};

const DEFAULT_DISTANCE_KM = 200;

/**
 * @param {{originCity: string, destinationCity: string, distanceKm?: number}} params
 * @returns {{
 *   distanceKm: number,
 *   baselineCo2Kg: number,
 *   actualCo2Kg: number,
 *   savedCo2Kg: number,
 *   methodology: string,
 *   factors: {baselineKgPerKm: number, marginalKgPerKm: number},
 *   calculatedAt: string,
 * }}
 * @returns {{distanceKm: number, baselineCo2Kg: number, actualCo2Kg: number, savedCo2Kg: number, methodology: string, factors: {baselineKgPerKm: number, marginalKgPerKm: number}, calculatedAt: string}}
 */
function calculateCo2Saved({ originCity, destinationCity, distanceKm }) {
  const km =
    Number(distanceKm) > 0
      ? Number(distanceKm)
      : CORRIDOR_DISTANCES_KM[`${originCity}-${destinationCity}`] ||
        DEFAULT_DISTANCE_KM;

  // CANON (B6.1): saved = (baseline − marginal) × km = 0.175 × km
  const baselineCo2Kg = round2(km * BASELINE_EMISSIONS_KG_PER_KM);
  const actualCo2Kg = round2(km * MARGINAL_KG_PER_KM);
  const savedCo2Kg = round2((BASELINE_EMISSIONS_KG_PER_KM - MARGINAL_KG_PER_KM) * km);

  return {
    distanceKm: km,
    baselineCo2Kg,
    actualCo2Kg,
    savedCo2Kg,
    methodology: METHODOLOGY_TAG,
    factors: {
      baselineKgPerKm: BASELINE_EMISSIONS_KG_PER_KM,
      marginalKgPerKm: MARGINAL_KG_PER_KM,
    },
    calculatedAt: new Date().toISOString(),
  };
}

/** Aggregate a list of carbon ledger entries for reporting. */
function summarize(entries = []) {
  const total = {
    shipments: entries.length,
    distanceKm: 0,
    baselineCo2Kg: 0,
    actualCo2Kg: 0,
    savedCo2Kg: 0,
    byCorridor: {},
  };
  for (const e of entries) {
    total.distanceKm += Number(e.distanceKm) || 0;
    total.baselineCo2Kg += Number(e.baselineCo2Kg) || 0;
    total.actualCo2Kg += Number(e.actualCo2Kg) || 0;
    total.savedCo2Kg += Number(e.savedCo2Kg) || 0;
  }
  for (const k of Object.keys(total)) {
    if (typeof total[k] === 'number') total[k] = round2(total[k]);
  }
  return total;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

module.exports = {
  calculateCo2Saved,
  summarize,
  CORRIDOR_DISTANCES_KM,
  METHODOLOGY_TAG,
  FACTORS: {
    get baselineKgPerKm() {
      return BASELINE_EMISSIONS_KG_PER_KM;
    },
    get marginalKgPerKm() {
      return MARGINAL_KG_PER_KM;
    },
  },
};
