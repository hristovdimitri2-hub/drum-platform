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
 * Marginal-factor mode (P3.2).
 *
 * `engineering` (default, canon B6.1) — a fixed 0.005 kg CO2e/km. Read this as
 * a CONSERVATIVE ENGINEERING MARGIN, not a measured physical constant: a small
 * parcel rides in a car that was going anyway, so it only adds a mass penalty
 * (rolling resistance + acceleration). For a ≤5 kg parcel in a ~1.5 t vehicle
 * that is well under 1% of the vehicle's per-km emissions; 0.005 is ~2.8% of
 * the 0.18 baseline, i.e. deliberately pessimistic — the reported saving is
 * understated, never inflated.
 *
 * `physics` (opt-in) — marginal = parcelMassKg × massPenaltyKgPerKgKm. Both
 * inputs are REQUIRED via env; there is deliberately NO default, because
 * inventing a physics constant is exactly the class of unverified number this
 * project removed from its own materials.
 */
/** Read at CALL time so tests (and ops) can switch mode without a reload. */
function marginalMode() {
  return String(process.env.CO2_MARGINAL_MODE || 'engineering').toLowerCase();
}

function resolveMarginalFactor() {
  const mode = marginalMode();
  if (mode === 'engineering') {
    return {
      kgPerKm: MARGINAL_KG_PER_KM,
      basis: 'engineering-margin (fixed, deliberately conservative)',
    };
  }
  if (mode === 'physics') {
    const mass = parseFloat(process.env.CO2_PARCEL_MASS_KG || '');
    const penalty = parseFloat(process.env.CO2_MASS_PENALTY_KG_PER_KG_KM || '');
    if (!(mass > 0) || !(penalty > 0)) {
      throw new Error(
        'CO2_MARGINAL_MODE=physics requires CO2_PARCEL_MASS_KG and ' +
          'CO2_MASS_PENALTY_KG_PER_KG_KM, both > 0 — no defaults are invented.'
      );
    }
    return {
      kgPerKm: mass * penalty,
      basis: `physics (${mass} kg x ${penalty} kgCO2e/kg.km)`,
    };
  }
  throw new Error(`Unknown CO2_MARGINAL_MODE "${mode}" (expected engineering|physics).`);
}

// Resolved once at load: a misconfigured mode is a boot error, not a per-call
// surprise, and the dashboards read exactly the factor the ledger used.
const MARGINAL = resolveMarginalFactor();

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

/**
 * Unknown-corridor policy (P3.3).
 *
 * There used to be a silent `DEFAULT_DISTANCE_KM = 200` fallback: any corridor
 * that was not in the table silently produced a 200 km carbon figure. A made-up
 * distance feeding an ESG number is worse than an error, so the fallback is now
 * OPT-IN: set CO2_UNKNOWN_CORRIDOR_FALLBACK_KM to a real, reviewed value to
 * restore one, otherwise an unknown corridor throws with instructions.
 */
const UNKNOWN_CORRIDOR_FALLBACK_KM = parseFloat(
  process.env.CO2_UNKNOWN_CORRIDOR_FALLBACK_KM || ''
);

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
/**
 * Resolve the distance for a corridor, and record WHERE it came from.
 * Priority: explicit `distanceKm` → corridor table → opt-in env fallback → throw.
 * @returns {{km: number, source: string}}
 */
function resolveDistance({ originCity, destinationCity, distanceKm }) {
  if (Number(distanceKm) > 0) return { km: Number(distanceKm), source: 'explicit' };

  const key = `${originCity}-${destinationCity}`;
  const known = CORRIDOR_DISTANCES_KM[key];
  if (known) return { km: known, source: 'corridor' };

  if (UNKNOWN_CORRIDOR_FALLBACK_KM > 0) {
    return { km: UNKNOWN_CORRIDOR_FALLBACK_KM, source: 'env-fallback' };
  }

  throw new Error(
    `Unknown corridor "${key}" and no distanceKm supplied. Add it to ` +
      `CORRIDOR_DISTANCES_KM, pass distanceKm explicitly, or set ` +
      `CO2_UNKNOWN_CORRIDOR_FALLBACK_KM to a reviewed value. ` +
      `(The silent 200 km default was removed — EIC audit P3.3.)`
  );
}

function calculateCo2Saved({ originCity, destinationCity, distanceKm }) {
  const { km, source } = resolveDistance({ originCity, destinationCity, distanceKm });

  // CANON (B6.1): saved = (baseline − marginal) × km = 0.175 × km
  const baselineCo2Kg = round2(km * BASELINE_EMISSIONS_KG_PER_KM);
  const actualCo2Kg = round2(km * MARGINAL.kgPerKm);
  const savedCo2Kg = round2((BASELINE_EMISSIONS_KG_PER_KM - MARGINAL.kgPerKm) * km);

  return {
    distanceKm: km,
    // Where the distance came from: 'explicit' | 'corridor' | 'env-fallback'.
    // Stored with entries so an auditor can tell a measured corridor from a
    // configured fallback without guessing.
    distanceSource: source,
    baselineCo2Kg,
    actualCo2Kg,
    savedCo2Kg,
    methodology: METHODOLOGY_TAG,
    factors: {
      baselineKgPerKm: BASELINE_EMISSIONS_KG_PER_KM,
      marginalKgPerKm: MARGINAL.kgPerKm,
    },
    marginalFactorBasis: MARGINAL.basis,
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
  resolveDistance,
  resolveMarginalFactor,
  CORRIDOR_DISTANCES_KM,
  METHODOLOGY_TAG,
  marginalMode,
  marginalFactorBasis: () => MARGINAL.basis,
  FACTORS: {
    get baselineKgPerKm() {
      return BASELINE_EMISSIONS_KG_PER_KM;
    },
    get marginalKgPerKm() {
      return MARGINAL.kgPerKm;
    },
    get mode() {
      return marginalMode();
    },
  },
};
