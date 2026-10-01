/**
 * CHECKOUT service — the smallest possible server-side glue between a
 * stored shipment and Stripe's client-side payment step (Stripe Elements).
 *
 *   POST /api/checkout/:shipmentId  →  { paymentIntentId, clientSecret, ... }
 *
 * Money rules (batch-1 brief):
 *   - The amount is READ from the stored shipment (server-side only —
 *     never from the client) and converted with money.eurToCents.
 *     No fee/VAT/split math happens here; the 80/15/5 split stays
 *     exclusively in money.js and applies at CAPTURE.
 *   - The sk_live guard lives in stripe.assertTestMode, called inside
 *     stripe.createCheckoutIntent before anything else.
 *   - DEMO_MODE returns simulated pi_demo_* ids with zero network calls.
 */
const money = require('./money');

const PAYABLE_STATUS = 'requested'; // escrow intent exists, not captured yet

async function createCheckout({ store, stripe, shipmentId }) {
  if (!shipmentId) return { ok: false, status: 400, error: 'Missing shipment id' };

  let shipment = null;
  try {
    shipment = await store.getShipment(shipmentId);
  } catch (err) {
    console.error('Checkout: store error:', err.message);
    return { ok: false, status: 500, error: 'Store error' };
  }
  if (!shipment) return { ok: false, status: 404, error: 'Shipment not found' };
  if (shipment.status !== PAYABLE_STATUS) {
    return {
      ok: false,
      status: 409,
      error: `Shipment is ${shipment.status} — payment is only possible while it is requested`,
    };
  }

  const amountCents = money.eurToCents(shipment.totalEur);
  if (amountCents < 50) return { ok: false, status: 400, error: 'Shipment has no valid amount' };

  const intent = await stripe.createCheckoutIntent({
    amountCents,
    existingPaymentIntentId: shipment.stripePaymentIntentId,
    description: `DRUM ${shipment.originCity} → ${shipment.destinationCity} (${shipment.id})`,
    metadata: { shipment_id: shipment.id },
  });
  if (!intent.success) return { ok: false, status: 502, error: intent.error || 'Stripe error' };

  return {
    ok: true,
    status: 200,
    checkout: {
      paymentIntentId: intent.paymentIntentId,
      clientSecret: intent.clientSecret,
      paymentIntentStatus: intent.status,
      amountCents,
      currency: 'eur',
      shipmentId: shipment.id,
      demo: intent.demo === true,
      publishableKey: intent.demo === true ? null : (process.env.STRIPE_PUBLISHABLE_KEY || null),
    },
  };
}

/** Express route factory — dependency-injected so tests need no server. */
function createCheckoutRoute({ store, stripe }) {
  return async (req, res) => {
    try {
      const out = await createCheckout({ store, stripe, shipmentId: req.params && req.params.shipmentId });
      res.status(out.status).json(out.ok ? out.checkout : { error: out.error });
    } catch (err) {
      console.error('Checkout route error:', err);
      res.status(500).json({ error: 'Checkout failed' });
    }
  };
}

module.exports = { createCheckout, createCheckoutRoute, PAYABLE_STATUS };