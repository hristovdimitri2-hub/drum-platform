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

/**
 * P0 hardening — the guard previously started with `if (DEMO_MODE) return;`,
 * so DEMO_MODE=true disabled all key checking, and `rk_live_` (restricted live)
 * slipped past a bare `startsWith('sk_test')` test.
 */
test('P0 guard: a restricted live key (rk_live_) is refused', () => {
  process.env.STRIPE_SECRET_KEY = 'rk_live_bogus_restricted_key';
  assert.throws(() => stripe.assertTestMode(), /REFUSING/);
  assert.equal(stripe.keyKind(process.env.STRIPE_SECRET_KEY), 'live');
});

test('P0 guard: an unknown key prefix is refused (no silent pass-through)', () => {
  process.env.STRIPE_SECRET_KEY = 'totally_unknown_key_format';
  assert.throws(() => stripe.assertTestMode(), /unrecognised prefix/);
});

test('P0 guard: DEMO_MODE does NOT excuse a live key', () => {
  assert.throws(
    () => stripe.assertTestModeFor({ key: 'sk_live_bogus_key', demoMode: true }),
    /REFUSING/
  );
  assert.throws(
    () => stripe.assertTestModeFor({ key: 'rk_live_bogus_restricted', demoMode: true }),
    /REFUSING/
  );
});

test('P0 guard: DEMO_MODE with NO key at all is allowed', () => {
  assert.equal(stripe.assertTestModeFor({ key: '', demoMode: true }), 'absent-demo');
  assert.equal(stripe.assertTestModeFor({ key: undefined, demoMode: true }), 'absent-demo');
  assert.equal(stripe.keyKind(''), 'absent');
});

test('P0 guard: non-demo mode with NO key at all is refused', () => {
  assert.throws(
    () => stripe.assertTestModeFor({ key: '', demoMode: false }),
    /missing outside DEMO_MODE/
  );
});

test('P0 guard: a test key is accepted in BOTH modes', () => {
  assert.equal(stripe.assertTestModeFor({ key: 'sk_test_ok', demoMode: true }), 'test');
  assert.equal(stripe.assertTestModeFor({ key: 'sk_test_ok', demoMode: false }), 'test');
});

test('P0: unsignedWebhooksAllowed is false unless BOTH opt-ins are set', () => {
  const savedDemo = process.env.DEMO_MODE;
  const savedFlag = process.env.ALLOW_UNSIGNED_WEBHOOKS;
  try {
    delete process.env.ALLOW_UNSIGNED_WEBHOOKS;
    assert.equal(stripe.unsignedWebhooksAllowed(), false);
    process.env.ALLOW_UNSIGNED_WEBHOOKS = 'true';
    assert.equal(stripe.unsignedWebhooksAllowed(), stripe.DEMO_MODE);
  } finally {
    process.env.DEMO_MODE = savedDemo;
    if (savedFlag === undefined) delete process.env.ALLOW_UNSIGNED_WEBHOOKS;
    else process.env.ALLOW_UNSIGNED_WEBHOOKS = savedFlag;
  }
});
