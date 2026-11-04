/**
 * MONEY — the single canonical money module (B5/B8/B1).
 *
 * EVERY split/VAT/Stripe-fee/rounding calculation goes through here.
 * No second implementation is allowed (brief rule: zero duplication).
 *
 * Split of the CAPTURED amount (Business Plan §2.2):
 *   80% carrier · 15% DRUM facilitation · 5% insurance pool
 * Rounding policy (deterministic, cent-exact):
 *   carrier = round(total × 80%); drum = round(total × 15%);
 *   insurance = total − carrier − drum  (absorbs the remainder → €0.00)
 *
 * VAT canon (B8.1): 20% charged ON TOP of the DRUM facilitation fee
 * (tax-exclusive): vat = round(fee × 20%); the platform absorbs the VAT
 * out of the fee (user price unchanged) — conservative by construction.
 * The old VAT-inclusive path (gross/1.2) was REMOVED after the 0.34 vs
 * 0.414 clarification.
 *
 * Stripe canon (B8.1): 1.5% + €0.25 per transaction, base = the CAPTURED
 * amount (incl. any VAT). Shared constant — finance.js imports this.
 */

/**
 * Percent parsing + validation (P2).
 *
 * The three split rates used to be read with a bare `Number(env || default)`,
 * so `CARRIER_PAYOUT_PERCENT=abc` silently produced NaN and
 * `CARRIER_PAYOUT_PERCENT=80 FACILITATION_FEE_PERCENT=80` silently produced a
 * split that does not add up to 100% (the insurance leg went negative). Both
 * are configuration errors on a money path — fail loudly at load time instead.
 */
function parsePercent(rawValue, fallback, name) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') return fallback;
  const n = Number(rawValue);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid ${name}: "${rawValue}" is not a number (expected 0–100).`);
  }
  if (n < 0 || n > 100) {
    throw new Error(`Invalid ${name}: ${n} is outside the allowed range 0–100.`);
  }
  return n;
}

function validateRates({ carrierPercent, drumPercent, insurancePercent }) {
  const legs = [
    ['CARRIER_PAYOUT_PERCENT', carrierPercent],
    ['FACILITATION_FEE_PERCENT', drumPercent],
    ['INSURANCE_PREMIUM_PERCENT', insurancePercent],
  ];
  for (const [name, value] of legs) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`Invalid ${name}: ${value} is outside the allowed range 0–100.`);
    }
  }
  // Cent-level tolerance: the rates are percentages, so 100% must be exact.
  const sum = carrierPercent + drumPercent + insurancePercent;
  if (Math.abs(sum - 100) > 1e-9) {
    throw new Error(
      `Split rates must sum to exactly 100% — got ${sum}% ` +
        `(carrier ${carrierPercent} + facilitation ${drumPercent} + insurance ${insurancePercent}).`
    );
  }
  return { carrierPercent, drumPercent, insurancePercent, sum };
}

const CARRIER_PERCENT = parsePercent(process.env.CARRIER_PAYOUT_PERCENT, 80, 'CARRIER_PAYOUT_PERCENT');
const DRUM_PERCENT = parsePercent(process.env.FACILITATION_FEE_PERCENT, 15, 'FACILITATION_FEE_PERCENT');
const INSURANCE_PERCENT = parsePercent(process.env.INSURANCE_PREMIUM_PERCENT, 5, 'INSURANCE_PREMIUM_PERCENT');

validateRates({
  carrierPercent: CARRIER_PERCENT,
  drumPercent: DRUM_PERCENT,
  insurancePercent: INSURANCE_PERCENT,
});

const CARRIER_RATE = CARRIER_PERCENT / 100;
const DRUM_RATE = DRUM_PERCENT / 100;
const INSURANCE_RATE = INSURANCE_PERCENT / 100;
const VAT_RATE = 0.20;
const STRIPE = { percent: 0.015, fixedCents: 25 };

function eurToCents(eur) {
  return Math.round((Number(eur) || 0) * 100);
}

function centsToEur(cents) {
  return (Number(cents) || 0) / 100;
}

/**
 * Split totalCents into carrier/drum/insurance cents.
 * Guarantees: carrierCents + drumCents + insuranceCents === totalCents.
 */
function splitAmounts(totalCents) {
  const total = Math.round(Number(totalCents) || 0);
  const carrierCents = Math.round(total * CARRIER_RATE);
  const drumCents = Math.round(total * DRUM_RATE);
  const insuranceCents = total - carrierCents - drumCents;
  return { totalCents: total, carrierCents, drumCents, insuranceCents };
}

/**
 * VAT ON TOP of the DRUM facilitation fee (B8.1 canon, tax-exclusive).
 * @returns {{feeCents, vatCents, netCents}} netCents === feeCents
 * (the fee is net; the VAT is owed on top and absorbed by the platform).
 */
function vatOnDrumFee(feeCents) {
  const fee = Math.round(Number(feeCents) || 0);
  const vatCents = Math.round(fee * VAT_RATE);
  return { feeCents: fee, vatCents, netCents: fee };
}

/**
 * Stripe processing cost (canon B8.1): 1.5% + €0.25 fixed,
 * base = the captured amount (incl. any VAT).
 */
function stripeFeeCents(totalCents) {
  const total = Math.round(Number(totalCents) || 0);
  return Math.round(total * STRIPE.percent) + STRIPE.fixedCents;
}

/**
 * USER-PAYS canon (B8.2): the client-facing price = ticket T + the VAT
 * owed on the DRUM fee (VAT ON TOP, tax-exclusive — B8.1 canon):
 *   userPays(T) = T + round(20% × round(15% × T))
 * ONE function here; demo, finance.js and tests all use it.
 * Calibrated results: T=437 → 450 (€4.50) · T=775 → 798 (€7.98) ·
 * T=1380 → 1421 (€14.21).
 */
function userPaysCents(ticketCents) {
  const split = splitAmounts(ticketCents);
  const vat = Math.round(split.drumCents * VAT_RATE);
  return ticketCents + vat;
}

module.exports = {
  CARRIER_RATE,
  DRUM_RATE,
  INSURANCE_RATE,
  CARRIER_PERCENT,
  DRUM_PERCENT,
  INSURANCE_PERCENT,
  VAT_RATE,
  STRIPE,
  eurToCents,
  centsToEur,
  splitAmounts,
  vatOnDrumFee,
  stripeFeeCents,
  userPaysCents,
  // Configuration validation (P2) — exported so the env matrix is unit-testable
  // without reloading the module (the rates are read once, at load time).
  parsePercent,
  validateRates,
};
