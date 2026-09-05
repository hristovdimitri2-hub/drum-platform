/**
 * MONEY — the single canonical money module (B5/B8/B1).
 *
 * EVERY split/VAT/rounding calculation in the codebase goes through here.
 * No second implementation is allowed (brief rule: zero duplication).
 *
 * Split of the CAPTURED amount (Business Plan §2.2):
 *   80% carrier · 15% DRUM facilitation · 5% insurance pool
 *
 * Rounding policy (deterministic, cent-exact):
 *   carrier = round(total × 80%)
 *   drum    = round(total × 15%)
 *   insurance = total − carrier − drum   (insurance absorbs the rounding
 *   remainder so the waterfall ALWAYS reconciles to €0.00 remainder)
 *
 * VAT (B8, canonical model): 20% applies to DRUM's facilitation fee ONLY —
 * never to the carrier payout (the carrier is an independent party).
 * The fee is treated as VAT-INCLUSIVE (gross): net = gross / 1.2.
 *
 * Cross-subsidy (B8): 15% of the DRUM fee + 5% of the insurance premium
 * flow into the social pool (subsidised deliveries). Defined in finance.js.
 */

const CARRIER_RATE = Number(process.env.CARRIER_PAYOUT_PERCENT || 80) / 100;
const DRUM_RATE = Number(process.env.FACILITATION_FEE_PERCENT || 15) / 100;
const INSURANCE_RATE = Number(process.env.INSURANCE_PREMIUM_PERCENT || 5) / 100;
const VAT_RATE = 0.20;

function eurToCents(eur) {
  return Math.round((Number(eur) || 0) * 100);
}

function centsToEur(cents) {
  return (Number(cents) || 0) / 100;
}

/**
 * Split totalCents into carrier/drum/insurance cents.
 * @returns {{totalCents, carrierCents, drumCents, insuranceCents}}
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
 * VAT breakdown of the DRUM facilitation fee (VAT-inclusive gross).
 * @returns {{grossCents, netCents, vatCents}}
 */
function vatOnDrumFee(drumFeeCents) {
  const gross = Math.round(Number(drumFeeCents) || 0);
  const netCents = Math.round(gross / (1 + VAT_RATE));
  return { grossCents: gross, netCents, vatCents: gross - netCents };
}

module.exports = {
  CARRIER_RATE,
  DRUM_RATE,
  INSURANCE_RATE,
  VAT_RATE,
  eurToCents,
  centsToEur,
  splitAmounts,
  vatOnDrumFee,
};
