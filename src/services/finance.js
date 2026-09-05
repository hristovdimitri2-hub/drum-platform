/**
 * FINANCE (B8) — canonical financial model. SINGLE SOURCE OF TRUTH.
 *
 * Every number in /docs/data-room/ comes from THIS file via
 * scripts/build-financials.js. The demo pricing (commands/new.js) imports
 * the same corridor table. No number is typed by hand in documents.
 *
 * Watermark rule: every generated figure is ROUNDED DOWN to the cent
 * ("до €0.00" — conservative by construction) and every waterfall row
 * reconciles to exactly €0.00 remainder (tested).
 *
 * Canonical model (per delivery, on the CAPTURED total):
 *   gross           = corridor total (base + 15% fee + 5% insurance)
 *   carrier payout  = 80% (money.splitAmounts)
 *   DRUM fee        = 15% (VAT-INCLUSIVE: net = gross/1.2)
 *   insurance pool  = 5%
 *   Stripe cost     = 1.5% + €0.25/txn (ASSUMPTION: EU cards, Connect)
 *   cross-subsidy   = 15% of DRUM fee + 5% of insurance → social pool
 *   VAT             = 20% on the DRUM fee only (never on the carrier)
 *
 * Carbon revenue is EXCLUDED from the base model (speculative; the synced
 * Excel model includes it — documented in FINANCIAL_NOTES.md as a
 * deliberate difference, not an oversight).
 */

const money = require('./money');

// ---- Corridor prices (single source — used by commands/new.js too) --------
const CORRIDORS = [
  { from: 'София', to: 'Пловдив', basePriceEur: 10 },
  { from: 'Пловдив', to: 'София', basePriceEur: 10 },
  { from: 'София', to: 'Варна', basePriceEur: 15 },
  { from: 'Варна', to: 'София', basePriceEur: 15 },
];

// Corridor mix in scenarios (ASSUMPTION — labeled in output)
const CORRIDOR_MIX = { 'София-Пловдив': 0.7, 'София-Варна': 0.3 };

// ---- Stripe cost (ASSUMPTION: EU cards + Connect, per transaction) --------
const STRIPE = { percent: 0.015, fixedCents: 25 };

// ---- Fixed monthly costs (ASSUMPTIONS — solo founder, organic growth) -----
const FIXED_MONTHLY = [
  { label: 'Infra (Railway + SQLite host + domain)', eurCents: 3500 },
  { label: 'Ops tooling & support', eurCents: 1500 },
];

// ---- Monthly delivery volumes per scenario/year (ASSUMPTIONS) -------------
const SCENARIOS = {
  pessimistic: { y1: 200, y2: 800, y3: 2000 },
  base: { y1: 500, y2: 2500, y3: 8000 },
  optimistic: { y1: 1000, y2: 6000, y3: 20000 },
};

/** Floor to the cent — the B8 "до €0.00" watermark (conservative). */
function floorToCent(eur) {
  return Math.floor((Number(eur) || 0) * 100) / 100;
}

/** Weighted-average captured total per delivery (cents), from corridor mix. */
function avgGrossCents() {
  let cents = 0;
  for (const [key, share] of Object.entries(CORRIDOR_MIX)) {
    const [from, to] = key.split('-');
    const corridor = CORRIDORS.find((c) => c.from === from && c.to === to) || CORRIDORS[0];
    cents += Math.round(money.eurToCents(corridor.basePriceEur) * 1.2) * share;
  }
  return Math.round(cents);
}

/**
 * Per-delivery waterfall in cents. All figures via money.js.
 * Reconciliation: gross = carrier + insurance + fee-net + Stripe + VAT, remainder 0.
 */
function waterfallPerDelivery(grossCents = avgGrossCents()) {
  const split = money.splitAmounts(grossCents);              // 80/15/5, remainder in insurance
  const stripeFeeCents = Math.round(grossCents * STRIPE.percent) + STRIPE.fixedCents;
  const vat = money.vatOnDrumFee(split.drumCents);           // fee gross -> net + VAT
  const socialCents =
    Math.round(split.drumCents * 0.15) + Math.round(split.insuranceCents * 0.05);
  const platformRetainedCents = split.drumCents - vat.vatCents - stripeFeeCents;

  return {
    grossCents,
    carrierCents: split.carrierCents,
    drumFeeGrossCents: split.drumCents,
    drumFeeNetCents: vat.netCents,
    vatCents: vat.vatCents,
    insuranceCents: split.insuranceCents,
    stripeFeeCents,
    socialPoolCents: socialCents,
    platformRetainedCents,
    netMarginPct: Math.floor((platformRetainedCents / grossCents) * 10000) / 100,
    reconciliationRemainderCents:
      grossCents -
      split.carrierCents -
      split.insuranceCents -
      vat.vatCents -
      stripeFeeCents -
      platformRetainedCents,
  };
}

/** Monthly fixed costs (cents). */
function fixedMonthlyCents() {
  return FIXED_MONTHLY.reduce((s, f) => s + f.eurCents, 0);
}

/** Break-even deliveries per month (ceiled). */
function breakEvenDeliveriesPerMonth() {
  const w = waterfallPerDelivery();
  return Math.ceil(fixedMonthlyCents() / w.platformRetainedCents);
}

/** Yearly P&L rows for a scenario (pessimistic | base | optimistic). */
function yearlyPnl(scenarioName) {
  const volumes = SCENARIOS[scenarioName];
  if (!volumes) throw new Error('Unknown scenario: ' + scenarioName);
  const w = waterfallPerDelivery();
  const fixedCents = fixedMonthlyCents() * 12;
  return Object.entries(volumes).map(([year, perMonth]) => {
    const deliveries = perMonth * 12;
    const grossCents = deliveries * w.grossCents;
    const ebitdaCents = deliveries * w.platformRetainedCents - fixedCents;
    return {
      scenario: scenarioName,
      year: year.toUpperCase(),
      deliveries,
      grossCents,
      carrierCents: deliveries * w.carrierCents,
      drumFeeGrossCents: deliveries * w.drumFeeGrossCents,
      vatCents: deliveries * w.vatCents,
      insuranceCents: deliveries * w.insuranceCents,
      stripeFeeCents: deliveries * w.stripeFeeCents,
      socialPoolCents: deliveries * w.socialPoolCents,
      platformRetainedCents: deliveries * w.platformRetainedCents,
      fixedCents,
      ebitdaCents,
      ebitdaMarginPct: Math.floor((ebitdaCents / grossCents) * 10000) / 100,
    };
  });
}

module.exports = {
  CORRIDORS,
  CORRIDOR_MIX,
  STRIPE,
  FIXED_MONTHLY,
  SCENARIOS,
  floorToCent,
  avgGrossCents,
  waterfallPerDelivery,
  fixedMonthlyCents,
  breakEvenDeliveriesPerMonth,
  yearlyPnl,
  money,
};
