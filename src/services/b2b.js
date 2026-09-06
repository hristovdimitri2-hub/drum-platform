/**
 * B7 — B2B Reverse Marketplace ПРОТОТИП (Master Blueprint §4.3).
 *
 * Модел: седмичен batch по коридор. Ops/B2B клиент подава N заявки;
 * платформата broadcast-ва към превозвачи ("гарантиран €X, N пратки"),
 * pickup в 30-минутен прозорец; капацитет 5 пратки/standard car, 10/van.
 * Дуален режим: +€1.50 individual (не чакаш batch) / −€1.50 batch wait.
 *
 * STRICT AGENT MODEL: batch-ът РАНГВА и ГРУПИРА — превозвачът винаги
 * потвърждава сам. Никакво auto-dispatch.
 *
 * Всички пари през money.js (канон). Batch economic: ЕДНА Stripe такса
 * върху общата сума (фикс €0.25 се амортизира) — ядрото на GTM-ENTRY
 * аргумента (вж. FINANCIAL_MODEL.md §B2B batch economics).
 */

const money = require('./money');

const CAPS_PER_VEHICLE = { standard: 5, van: 10 };
const PICKUP_WINDOW_MINUTES = 30;
const DUAL_MODE = {
  individualSurchargeCents: money.eurToCents(1.5),  // +€1.50: не чакаш batch
  batchDiscountCents: money.eurToCents(1.5),        // −€1.50: чакаш batch
};

/**
 * Разпределя заявки по коридор в batch-ове с капацитет на превозно средство.
 * @param {{id: string, userPaysCents: number}[]} requests — B2B заявки (по един коридор)
 * @param {{vehicleType?: 'standard'|'van'}} opts
 * @returns {{batches: Array, capped: number, totalParcels: number}}
 */
function planBatches(requests, opts = {}) {
  const cap = CAPS_PER_VEHICLE[opts.vehicleType || 'standard'] || CAPS_PER_VEHICLE.standard;
  const sorted = [...requests].sort((a, b) => a.id < b.id ? -1 : 1); // детерминирано
  const batches = [];
  for (let i = 0; i < sorted.length; i += cap) {
    const parcels = sorted.slice(i, i + cap);
    const ticketTotalCents = parcels.reduce((s, p) => s + p.userPaysCents, 0);
    const carrierPayoutCents = Math.round(ticketTotalCents * money.CARRIER_RATE);
    batches.push({
      batchIndex: batches.length + 1,
      parcels,
      parcelCount: parcels.length,
      pickupWindowMinutes: PICKUP_WINDOW_MINUTES,
      carrierPayoutCents,
    });
  }
  return {
    batches,
    capped: 0, // cap-ът е вграден в разрезa (по cap на batch); нищо не се отхвърля
    totalParcels: sorted.length,
    vehicleCap: cap,
  };
}

/**
 * Broadcast съобщение към превозвачи ("гарантиран €X, N пратки").
 * Само ПОКАЗВА офертата — превощачът сам се включва (Strict Agent Model).
 */
function broadcastMessage(batch, corridor) {
  return (
    `📣 B2B BATCH | ${corridor}\n` +
    `Гарантиран €${eur(batch.carrierPayoutCents)} за ${batch.parcelCount} пратки\n` +
    `Pickup: ${batch.pickupWindowMinutes}-минутен прозорец · капацитет ${batch.parcelCount}/${CAPS_PER_VEHICLE.standard} (standard)\n` +
    `Включи се сам — платформата не назначава.`
  );
}

function eur(cents) {
  return (cents / 100).toFixed(2);
}

/**
 * Batch economics: ЕДНА Stripe транзакция на batch (фикс. €0.25 веднъж).
 * @param {{parcels: number, ticketCents: number}} batch — ticket = per-parcel T
 * @returns {object} цент-точна икономика; effectiveRetainedPerParcelCents
 *   се закръгля НАДОЛУ (watermark), всичко през money.js.
 */
function batchEconomics(parcels, ticketCents) {
  const ticketTotalCents = ticketCents * parcels;
  const userPaysTotal = money.userPaysCents(ticketTotalCents);
  const stripeFee = money.stripeFeeCents(userPaysTotal);
  const split = money.splitAmounts(ticketTotalCents);
  const vat = Math.round(split.drumCents * money.VAT_RATE);
  const retainedTotal = split.drumCents - vat - stripeFee;
  const onDemandStripeFeeTotal = parcels * money.stripeFeeCents(ticketCents);
  return {
    parcels,
    ticketTotalCents,
    userPaysTotalCents: userPaysTotal,
    stripeFeeBatchCents: stripeFee,
    stripeFeeOnDemandTotalCents: onDemandStripeFeeTotal,
    stripeFixedSavingsCents: onDemandStripeFeeTotal - stripeFee,
    carrierCents: split.carrierCents,
    drumFeeCents: split.drumCents,
    vatCents: vat,
    insuranceCents: split.insuranceCents,
    retainedTotalCents: retainedTotal,
    effectiveRetainedPerParcelCents: Math.floor(retainedTotal / parcels),
    effectiveRetainedPerParcelEur: eur(Math.floor(retainedTotal / parcels)),
  };
}

/**
 * Дуален режим: +€1.50 individual (веднага) / −€1.50 batch (изчакване).
 * @returns {{individualCents, batchCents}}
 */
function dualModePricing(userPaysCents, wantImmediate) {
  return wantImmediate
    ? { priceCents: userPaysCents + DUAL_MODE.individualSurchargeCents, mode: 'individual' }
    : { priceCents: userPaysCents - DUAL_MODE.batchDiscountCents, mode: 'batch' };
}

module.exports = {
  CAPS_PER_VEHICLE,
  PICKUP_WINDOW_MINUTES,
  DUAL_MODE,
  planBatches,
  broadcastMessage,
  batchEconomics,
  dualModePricing,
};
