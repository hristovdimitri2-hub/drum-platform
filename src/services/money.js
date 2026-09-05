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

const CARRIER_RATE = Number(process.env.CARRIER_PAYOUT_PERCENT || 80) / 100;
const DRUM_RATE = Number(process.env.FACILITATION_FEE_PERCENT || 15) / 100;
const INSURANCE_RATE = Number(process.env.INSURANCE_PREMIUM_PERCENT || 5) / 100;
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
  VAT_RATE,
  STRIPE,
  eurToCents,
  centsToEur,
  splitAmounts,
  vatOnDrumFee,
  stripeFeeCents,
  userPaysCents,
};
