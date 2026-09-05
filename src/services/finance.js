/**
 * FINANCE (B8.1) — canonical financial model. SINGLE SOURCE OF TRUTH.
 *
 * PRICE AS A SCENARIO AXIS: TICKET_CALIBRATIONS with 3 documented
 * calibrations (ticket T = the captured amount the 80/15/5 split runs on):
 *   (a) GTM_ENTRY — user pays ≈ €4.50 (T = €4.37): entry price vs Econt.
 *       Explicit model finding: the €0.25 fixed Stripe fee crushes the
 *       margin to ~€0.21/delivery here (see FINANCIAL_NOTES.md).
 *   (b) BASE      — user pays ≈ €8.00 (T = €7.75): THE data-room base.
 *   (c) PREMIUM   — T = €13.80 (current demo pricing): honestly labeled
 *       "optimistic/premium basket", NOT the base.
 * NOTE: userPays for (a)/(b) ≈ T × 1.03 (marketing rounding); the exact
 * surcharge mechanism is an OPEN QUESTION for brief revision. For (c)
 * userPays = T (already loaded). Corridor mix (70/30 Пд/Вн) is a
 * documented parameter that applied to the premium basket.
 *
 * VAT canon (B8.1): 20% ON TOP of the DRUM fee (tax-exclusive), absorbed
 * by the platform (user price unchanged) — see money.vatOnDrumFee.
 * Stripe canon (B8.1): 1.5% + €0.25, base = captured amount (money.js).
 *
 * Watermark: all outputs floored to the cent ("до €0.00"), every
 * waterfall reconciles to zero remainder (tested), and every table row
 * exposes its derivation (retained/delivery, fixed/delivery).
 *
 * Carbon revenue stays EXCLUDED from the base model (see FINANCIAL_NOTES).
 */

const money = require('./money');

// Corridor prices (used by commands/new.js — premium basket in the bot)
const CORRIDORS = [
  { from: 'София', to: 'Пловдив', basePriceEur: 10 },
  { from: 'Пловдив', to: 'София', basePriceEur: 10 },
  { from: 'София', to: 'Варна', basePriceEur: 15 },
  { from: 'Варна', to: 'София', basePriceEur: 15 },
];

// Documented corridor mix (applied to the premium basket in v0.2.0 model)
const CORRIDOR_MIX = { 'София-Пловдив': 0.7, 'София-Варна': 0.3 };

// ---- B8.1: price as a scenario axis ---------------------------------------
const TICKET_CALIBRATIONS = [
  {
    key: 'GTM_ENTRY',
    label: 'GTM-ENTRY (конкурентно срещу Econt)',
    ticketCents: 437,
    userPaysEur: money.centsToEur(money.userPaysCents(437)), // €4.50 (canon B8.2)
    note: 'Фикс. Stripe такса смачка маржа — виж FINANCIAL_NOTES',
  },
  {
    key: 'BASE',
    label: 'BASE (среден чек по документите) — data-room канон',
    ticketCents: 775,
    userPaysEur: money.centsToEur(money.userPaysCents(775)), // €7.98 ≈ €8.00 (canon B8.2)
  },
  {
    key: 'PREMIUM',
    label: 'PREMIUM (сегашни демо цени) — оптимистичен/премиум кош',
    ticketCents: 1380,
    userPaysEur: money.centsToEur(money.userPaysCents(1380)), // €14.21 (B8.2: VAT on top)
  },
];

function calibrationByKey(key) {
  return TICKET_CALIBRATIONS.find((c) => c.key === key);
}

/** Floor to the cent — the B8 "до €0.00" watermark (conservative). */
function floorToCent(eur) {
  return Math.floor((Number(eur) || 0) * 100) / 100;
}

// ---- Fixed monthly costs — BREAK-EVEN LADDER (B8.1) -----------------------
const FIXED_MONTHLY = [
  { label: 'Infra (технически, без екип)', eurCents: 5000 },
  { label: 'Lean', eurCents: 300000 },
  { label: 'Scale A', eurCents: 1000000 },
  { label: 'Документиран Y1 burn', eurCents: 1660000 },
];

// ---- Monthly delivery volumes per scenario/year (ASSUMPTIONS) -------------
const SCENARIOS = {
  pessimistic: { y1: 200, y2: 800, y3: 2000 },
  base: { y1: 500, y2: 2500, y3: 8000 },
  optimistic: { y1: 1000, y2: 6000, y3: 20000 },
};

const DEFAULT_CALIBRATION = 'BASE';

/**
 * Per-delivery waterfall for a given ticket (captured cents).
 * Canonical paths: money.splitAmounts + money.stripeFeeCents + money.vatOnDrumFee.
 * Reconciliation: ticket = carrier + insurance + vat + stripe + retained (€0.00).
 */
function waterfall(ticketCents) {
  const split = money.splitAmounts(ticketCents);
  const stripeFeeCents = money.stripeFeeCents(ticketCents);
  const vat = money.vatOnDrumFee(split.drumCents);
  const socialCents =
    Math.round(split.drumCents * 0.15) + Math.round(split.insuranceCents * 0.05);
  const platformRetainedCents =
    split.drumCents - vat.vatCents - stripeFeeCents;
  return {
    ticketCents,
    carrierCents: split.carrierCents,
    drumFeeCents: split.drumCents,
    vatCents: vat.vatCents,
    insuranceCents: split.insuranceCents,
    stripeFeeCents,
    socialPoolCents: socialCents,
    platformRetainedCents,
    netMarginPct: Math.floor((platformRetainedCents / ticketCents) * 10000) / 100,
    reconciliationRemainderCents:
      ticketCents -
      split.carrierCents -
      split.insuranceCents -
      vat.vatCents -
      stripeFeeCents -
      platformRetainedCents,
  };
}

const Y1_BURN_CENTS = FIXED_MONTHLY[3].eurCents; // documented Y1 burn
function fixedMonthlyBurnCents() {
  return Y1_BURN_CENTS;
}

/**
 * Break-even ladder for a calibration: every burn level x retained/delivery.
 */
function breakEvenLadder(ticketCents) {
  const w = waterfall(ticketCents);
  return FIXED_MONTHLY.map((f) => ({
    label: f.label,
    monthlyBurnCents: f.eurCents,
    breakEvenDeliveries: Math.ceil(f.eurCents / w.platformRetainedCents),
  }));
}

/** Yearly P&L for a scenario on a calibration (default BASE). */
function yearlyPnl(scenarioName, calibrationKey = DEFAULT_CALIBRATION) {
  const cal = calibrationByKey(calibrationKey);
  if (!cal) throw new Error('Unknown calibration: ' + calibrationKey);
  const volumes = SCENARIOS[scenarioName];
  if (!volumes) throw new Error('Unknown scenario: ' + scenarioName);
  const w = waterfall(cal.ticketCents);
  const fixedCents = Y1_BURN_CENTS * 12; // documented Y1 burn (B8.1)
  return Object.entries(volumes).map(([year, perMonth]) => {
    const deliveries = perMonth * 12;
    const grossCents = deliveries * w.ticketCents;
    return {
      scenario: scenarioName,
      calibration: cal.key,
      year: year.toUpperCase(),
      deliveries,
      ticketEur: money.centsToEur(w.ticketCents),
      retainedPerDeliveryCents: w.platformRetainedCents,
      fixedPerDeliveryCents: Math.round(fixedCents / deliveries),
      grossCents,
      carrierCents: deliveries * w.carrierCents,
      drumFeeCents: deliveries * w.drumFeeCents,
      vatCents: deliveries * w.vatCents,
      insuranceCents: deliveries * w.insuranceCents,
      stripeFeeCents: deliveries * w.stripeFeeCents,
      socialPoolCents: deliveries * w.socialPoolCents,
      platformRetainedCents: deliveries * w.platformRetainedCents,
      fixedCents,
      ebitdaCents: deliveries * w.platformRetainedCents - fixedCents,
      ebitdaMarginPct:
        Math.floor(((deliveries * w.platformRetainedCents - fixedCents) / grossCents) * 10000) / 100,
    };
  });
}

module.exports = {
  CORRIDORS,
  CORRIDOR_MIX,
  TICKET_CALIBRATIONS,
  DEFAULT_CALIBRATION,
  FIXED_MONTHLY,
  SCENARIOS,
  calibrationByKey,
  floorToCent,
  waterfall,
  fixedMonthlyBurnCents,
  Y1_BURN_CENTS,
  breakEvenLadder,
  yearlyPnl,
  money,
};
