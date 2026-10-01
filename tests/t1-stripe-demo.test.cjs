/**
 * Batch 1 / Task 1 — DEMO_MODE behaviour of the checkout intent:
 * simulated pi_demo_* ids, ZERO network calls (the stripe client is
 * null in demo mode — any network path would throw a TypeError).
 *
 * NOTE: DEMO_MODE is read at module load → must be set BEFORE require.
 * node --test runs each test file in its own process, so env here is isolated.
 */

process.env.DEMO_MODE = 'true';
delete process.env.STRIPE_SECRET_KEY;

const test = require('node:test');
const assert = require('node:assert');
const stripe = require('../src/services/stripe');

test('demo checkout reuses the shipment\'s existing simulated pi_demo_* intent', async () => {
  const out = await stripe.createCheckoutIntent({
    amountCents: 798,
    existingPaymentIntentId: 'pi_demo_000123',
    description: 'DRUM София → Пловдив',
    metadata: { shipment_id: 'recX' },
  });
  assert.equal(out.success, true);
  assert.equal(out.demo, true);
  assert.equal(out.paymentIntentId, 'pi_demo_000123');
  assert.equal(out.clientSecret, 'pi_demo_000123_secret_demo');
  assert.equal(out.status, 'requires_capture');
  assert.equal(stripe.DEMO_MODE, true);
});

test('demo checkout without an existing intent creates a fresh simulated escrow intent', async () => {
  const out = await stripe.createCheckoutIntent({
    amountCents: 1421,
    description: 'DRUM demo',
    metadata: {},
  });
  assert.equal(out.success, true);
  assert.equal(out.demo, true);
  assert.match(out.paymentIntentId, /^pi_demo_/);
  assert.ok(out.clientSecret, 'clientSecret present for the demo page');
});

test('demo checkout never returns a publishable key path (no Stripe.js needed)', async () => {
  const out = await stripe.createCheckoutIntent({ amountCents: 450, description: 'x', metadata: {} });
  // demo flag is what checkout.js uses to skip publishableKey/Stripe.js
  assert.equal(out.demo, true);
});
