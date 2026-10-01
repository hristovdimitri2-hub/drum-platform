/**
 * STRIPE EVENTS (batch 4 / T2) — webhook event handling, extracted from
 * bot.js so the "paid" status transition is testable without a server.
 *
 * Trigger: payment_intent.amount_capturable_updated (manual capture — the
 * client's card was authorised, funds capturable) → shipment
 * `requested` → `paid`. `payment_intent.succeeded` is included as a safe
 * fallback (after delivery the shipment is already `delivered` → no-op).
 * Everything else returns { handled: false } (bot.js ignores it).
 */

const PAID_TRIGGER_EVENTS = [
  'payment_intent.amount_capturable_updated',
  'payment_intent.succeeded',
];

async function handleStripeEvent(event, store) {
  if (!event || !event.type || !PAID_TRIGGER_EVENTS.includes(event.type)) {
    return { handled: false };
  }
  const pi = event.data && event.data.object ? event.data.object : null;
  if (!pi || !pi.id) return { handled: false };

  let shipments;
  try {
    shipments = await store.listAllShipments();
  } catch (err) {
    console.error('stripeEvents: store error:', err.message);
    return { handled: false };
  }

  const s = shipments.find(
    (x) => x.stripePaymentIntentId === pi.id && x.status === 'requested'
  );
  if (!s) return { handled: false };

  await store.updateShipment(s.id, { status: 'paid' });
  return { handled: true, shipmentId: s.id, from: 'requested', to: 'paid' };
}

module.exports = { handleStripeEvent, PAID_TRIGGER_EVENTS };