/**
 * B5 — webhook SIGNATURE verification tests (explicit brief requirement).
 *
 * Runs the real code path in a child process with a TEST webhook secret:
 *   - valid HMAC signature (t=timestamp,v1=HMAC-SHA256(secret, t.payload)) → event parsed
 *   - tampered payload → rejected
 *   - wrong secret → rejected
 *   - DEMO mode → unsigned payloads accepted (documented behavior)
 */

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function runSnippet(env, code) {
  return execFileSync(process.execPath, ['-e', code], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

const payload = JSON.stringify({
  id: 'evt_test_sig_1',
  type: 'payment_intent.succeeded',
  data: { object: { id: 'pi_test_1', amount: 1200 } },
});


test('B5: valid webhook signature is accepted (real code path)', () => {
  const out = runSnippet(
    {
      DEMO_MODE: 'false',
      STRIPE_SECRET_KEY: 'sk_test_dummy',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_123',
    },
    `
      const stripe = require('./src/services/stripe');
      const payload = ${JSON.stringify(payload)};
            const t = Math.floor(Date.now() / 1000);
      const sig = 't=' + t + ',v1=' +
        crypto.createHmac('sha256', 'whsec_test_123').update(t + '.' + payload).digest('hex');
      const event = stripe.verifyWebhook(Buffer.from(payload), sig);
      console.log(JSON.stringify({ id: event.id, type: event.type }));
    `
  );
  const event = JSON.parse(out.trim().split('\n').pop());
  assert.equal(event.id, 'evt_test_sig_1');
  assert.equal(event.type, 'payment_intent.succeeded');
});

test('B5: tampered payload is rejected by signature check', () => {
  assert.throws(() =>
    runSnippet(
      {
        DEMO_MODE: 'false',
        STRIPE_SECRET_KEY: 'sk_test_dummy',
        STRIPE_WEBHOOK_SECRET: 'whsec_test_123',
      },
      `
        const stripe = require('./src/services/stripe');
        const payload = ${JSON.stringify(payload)};
                const t = Math.floor(Date.now() / 1000);
        const sig = 't=' + t + ',v1=' +
          crypto.createHmac('sha256', 'whsec_test_123')
            .update(t + '.' + payload + 'TAMPERED').digest('hex');
        stripe.verifyWebhook(Buffer.from(payload), sig);
      `
    )
  );
});

test('B5: wrong webhook secret is rejected', () => {
  assert.throws(() =>
    runSnippet(
      {
        DEMO_MODE: 'false',
        STRIPE_SECRET_KEY: 'sk_test_dummy',
        STRIPE_WEBHOOK_SECRET: 'whsec_test_123',
      },
      `
        const stripe = require('./src/services/stripe');
        const payload = ${JSON.stringify(payload)};
                const t = Math.floor(Date.now() / 1000);
        const sig = 't=' + t + ',v1=' +
          crypto.createHmac('sha256', 'whsec_OTHER_SECRET')
            .update(t + '.' + payload).digest('hex');
        stripe.verifyWebhook(Buffer.from(payload), sig);
      `
    )
  );
});

test('B5: DEMO mode accepts unsigned payloads (documented behavior)', () => {
  const out = runSnippet(
    { DEMO_MODE: 'true' },
    `
      const stripe = require('./src/services/stripe');
      const payload = ${JSON.stringify(payload)};
      const event = stripe.verifyWebhook(Buffer.from(payload), '');
      console.log(JSON.stringify({ id: event.id, type: event.type }));
    `
  );
  const event = JSON.parse(out.trim().split('\n').pop());
  assert.equal(event.id, 'evt_test_sig_1');
});
