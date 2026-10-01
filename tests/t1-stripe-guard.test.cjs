/**
 * Batch 1 / Task 1 — the live-key guard must still refuse sk_live keys,
 * and createCheckoutIntent must refuse BEFORE attempting any Stripe call.
 *
 * NOTE: DEMO_MODE must be falsy here and is read at module load.
 * node --test runs each test file in its own process → isolated env.
 */

process.env.DEMO_MODE = '';
process.env.STRIPE_SECRET_KEY = 'sk_live_bogus_key_must_be_refused';

const test = require('node:test');
const assert = require('node:assert');
const stripe = require('../src/services/stripe');

test('guard: assertTestMode refuses an sk_live key', () => {
  assert.throws(() => stripe.assertTestMode(), /REFUSING/);
});

test('guard: createCheckoutIntent refuses sk_live BEFORE any Stripe call', async () => {
  await assert.rejects(
    () => stripe.createCheckoutIntent({ amountCents: 798, description: 'x', metadata: {} }),
    /REFUSING/
  );
});

test('guard: an sk_test key passes the guard', () => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_bogus_but_allowed';
  assert.doesNotThrow(() => stripe.assertTestMode());
});
