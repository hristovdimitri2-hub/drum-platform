/**
 * Batch 1 / Task 1 — checkout service + route tests (no server, no network).
 *
 * Acceptance: "checkout creates PaymentIntent with correct amount".
 * The amount must come from the STORED shipment, converted with the
 * canonical money.eurToCents — no fee/split/VAT math in the checkout path
 * (the 80/15/5 split stays in money.js at capture time).
 */

const test = require('node:test');
const assert = require('node:assert');
const money = require('../src/services/money');
const checkout = require('../src/services/checkout');

function fakeRes() {
  return {
    code: null,
    body: null,
    status(c) { this.code = c; return this; },
    json(o) { this.body = o; return this; },
  };
}

/** Fixture: store with a map of shipments + a fake stripe capturing args. */
function fixture(shipments, stripeImpl) {
  const calls = [];
  const store = {
    getShipment: async (id) => shipments[id] || null,
  };
  const stripe = {
    createCheckoutIntent: async (args) => {
      calls.push(args);
      if (stripeImpl) return stripeImpl(args);
      return {
        success: true,
        demo: true,
        paymentIntentId: 'pi_demo_000777',
        clientSecret: 'pi_demo_000777_secret_demo',
        status: 'requires_capture',
      };
    },
  };
  return { store, stripe, calls };
}

const SHIPMENT = {
  id: 'recSHIP1',
  status: 'requested',
  totalEur: 7.98, // B8.2 BASE user price
  originCity: 'София',
  destinationCity: 'Пловдив',
  senderTelegramId: 700100001,
  stripePaymentIntentId: 'pi_demo_123',
};

test('checkout creates the intent with the exact stored amount (cents, no local math)', async () => {
  const f = fixture({ recSHIP1: SHIPMENT });
  const out = await checkout.createCheckout({ store: f.store, stripe: f.stripe, shipmentId: 'recSHIP1' });

  assert.equal(out.status, 200);
  assert.equal(out.checkout.amountCents, 798);
  assert.equal(out.checkout.amountCents, money.eurToCents(7.98)); // canonical conversion
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].amountCents, 798);
  assert.equal(f.calls[0].existingPaymentIntentId, 'pi_demo_123'); // reuse, no duplicate auth
  assert.equal(out.checkout.clientSecret, 'pi_demo_000777_secret_demo');
  assert.equal(out.checkout.demo, true);
  // no split/fee fields leak from checkout — split math lives only in money.js
  assert.ok(!('splitCents' in out.checkout));
  assert.ok(!('carrierCents' in out.checkout));
});

test('amount follows the stored record for other prices (€14.21 → 1421)', async () => {
  const f = fixture({ recP: { ...SHIPMENT, id: 'recP', totalEur: 14.21 } });
  const out = await checkout.createCheckout({ store: f.store, stripe: f.stripe, shipmentId: 'recP' });
  assert.equal(f.calls[0].amountCents, 1421);
  assert.equal(out.checkout.amountCents, 1421);
});

test('errors: 400 missing/invalid id+amount, 404 unknown, 409 not requested, 502 stripe failure', async () => {
  const f = fixture({
    recOK: SHIPMENT,
    recDONE: { ...SHIPMENT, id: 'recDONE', status: 'delivered' },
    recZERO: { ...SHIPMENT, id: 'recZERO', totalEur: 0 },
  });

  assert.equal((await checkout.createCheckout({ store: f.store, stripe: f.stripe, shipmentId: undefined })).status, 400);
  assert.equal((await checkout.createCheckout({ store: f.store, stripe: f.stripe, shipmentId: 'recNOPE' })).status, 404);
  assert.equal((await checkout.createCheckout({ store: f.store, stripe: f.stripe, shipmentId: 'recDONE' })).status, 409);
  assert.equal((await checkout.createCheckout({ store: f.store, stripe: f.stripe, shipmentId: 'recZERO' })).status, 400);

  const failing = fixture({ recOK: SHIPMENT }, () => ({ success: false, error: 'card_declined' }));
  const out502 = await checkout.createCheckout({ store: failing.store, stripe: failing.stripe, shipmentId: 'recOK' });
  assert.equal(out502.status, 502);
  assert.equal(out502.error, 'card_declined');
});

test('route handler maps results to HTTP statuses (wiring)', async () => {
  const f = fixture({ recSHIP1: SHIPMENT });
  const handler = checkout.createCheckoutRoute({ store: f.store, stripe: f.stripe });

  const okRes = fakeRes();
  await handler({ params: { shipmentId: 'recSHIP1' } }, okRes);
  assert.equal(okRes.code, 200);
  assert.equal(okRes.body.paymentIntentId, 'pi_demo_000777');
  assert.equal(okRes.body.amountCents, 798);

  const errRes = fakeRes();
  await handler({ params: { shipmentId: 'missing' } }, errRes);
  assert.equal(errRes.code, 404);
  assert.equal(errRes.body.error, 'Shipment not found');
});
