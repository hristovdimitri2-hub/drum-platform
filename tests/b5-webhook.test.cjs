/**
 * B5/P0 — webhook SIGNATURE verification.
 *
 * Policy after the P0 hardening:
 *   - signatures are ALWAYS verified in non-demo mode;
 *   - DEMO_MODE no longer accepts unsigned payloads by default;
 *   - the only escape hatch needs DEMO_MODE=true AND ALLOW_UNSIGNED_WEBHOOKS=true;
 *   - when DEMO_MODE is on AND a webhook secret exists, the HMAC signature is
 *     verified (demo deployments get real integrity checking);
 *   - unsigned/forged payloads are rejected.
 *
 * NOTE: these tests exercise the REAL code path by spawning a child process so
 * that DEMO_MODE (read at module load) can be varied. Where the environment
 * forbids spawning (restricted sandboxes), the snippet is evaluated in-process
 * with a fresh module registry instead — same assertions, no loss of coverage.
 */

const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/**
 * Evaluate a snippet with the given env, in this process.
 *
 * The whole src/services subtree is evicted from require.cache and the snippet
 * is compiled in a child Module that shares only node_modules. This is what
 * makes module-load-time constants (DEMO_MODE) respond to the env at all.
 */
function runInProcess(env, code) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  const busted = {};
  const servicesDir = path.join(ROOT, 'src', 'services') + path.sep;
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(servicesDir)) {
      busted[key] = require.cache[key];
      delete require.cache[key];
    }
  }
  const savedCwd = process.cwd();
  const captured = [];
  const realLog = console.log;
  const realWarn = console.warn;
  console.log = (...args) => captured.push(args.join(' '));
  console.warn = () => {};
  process.chdir(ROOT);
  try {
    const m = new Module(path.join(ROOT, '__inline__.cjs'), null);
    m.filename = path.join(ROOT, '__inline__.cjs');
    m.paths = Module._nodeModulePaths(ROOT);
    m._compile(code, m.filename);
  } finally {
    process.chdir(savedCwd);
    console.log = realLog;
    console.warn = realWarn;
    Object.assign(require.cache, busted);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return captured.join('\n') + '\n';
}

/**
 * Child-process isolation is preferred (it is the only way to test module-load
 * env exactly as production sees it). Where the sandbox forbids spawning, the
 * cache-busting in-process path above runs the SAME assertions.
 */
function runSnippet(env, code) {
  try {
    return require('node:child_process').execFileSync(process.execPath, ['-e', code], {
      cwd: ROOT,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (err && err.code === 'EPERM' && err.status === null) return runInProcess(env, code);
    throw err;
  }
}

const payload = JSON.stringify({
  id: 'evt_test_sig_1',
  type: 'payment_intent.succeeded',
  data: { object: { id: 'pi_test_1', amount: 1200 } },
});

const SNIPPET_BODY = `
  const stripe = require('./src/services/stripe');
  const payload = ${JSON.stringify(payload)};
  const t = Math.floor(Date.now() / 1000);
`;

/** Build a valid Stripe-style signature header for `secret`. */
function snippetWithSignature(secret, tamper) {
  return `
    ${SNIPPET_BODY}
    const sig = 't=' + t + ',v1=' +
      require('node:crypto').createHmac('sha256', '${secret}')
        .update(t + '.' + payload${tamper ? " + 'TAMPERED'" : ''}).digest('hex');
    const event = stripe.verifyWebhook(Buffer.from(payload), sig);
    console.log(JSON.stringify({ id: event.id, type: event.type }));
  `;
}

const UNSIGNED_SNIPPET = `
  ${SNIPPET_BODY}
  const event = stripe.verifyWebhook(Buffer.from(payload), '');
  console.log(JSON.stringify({ id: event.id }));
`;

test('B5: valid webhook signature is accepted (real code path)', () => {
  const out = runSnippet(
    {
      DEMO_MODE: 'false',
      STRIPE_SECRET_KEY: 'sk_test_dummy',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_123',
    },
    snippetWithSignature('whsec_test_123', false)
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
      snippetWithSignature('whsec_test_123', true)
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
      snippetWithSignature('whsec_OTHER_SECRET', false)
    )
  );
});

test('P0: DEMO mode REJECTS unsigned payloads by default', () => {
  assert.throws(() => runSnippet({ DEMO_MODE: 'true' }, UNSIGNED_SNIPPET));
});

test('P0: DEMO mode verifies the HMAC signature when a secret is configured', () => {
  const out = runSnippet(
    { DEMO_MODE: 'true', STRIPE_WEBHOOK_SECRET: 'whsec_demo_sig' },
    snippetWithSignature('whsec_demo_sig', false)
  );
  const event = JSON.parse(out.trim().split('\n').pop());
  assert.equal(event.id, 'evt_test_sig_1');
});

test('P0: DEMO mode rejects a forged signature even with a secret configured', () => {
  assert.throws(() =>
    runSnippet(
      { DEMO_MODE: 'true', STRIPE_WEBHOOK_SECRET: 'whsec_demo_sig' },
      snippetWithSignature('whsec_ATTACKER', false)
    )
  );
});

test('P0: unsigned payloads pass only with the explicit double opt-in', () => {
  const out = runSnippet(
    { DEMO_MODE: 'true', ALLOW_UNSIGNED_WEBHOOKS: 'true', STRIPE_WEBHOOK_SECRET: '' },
    UNSIGNED_SNIPPET
  );
  const event = JSON.parse(out.trim().split('\n').pop());
  assert.equal(event.id, 'evt_test_sig_1');
});

test('P0: non-demo mode without a webhook secret refuses instead of falling back', () => {
  assert.throws(() =>
    runSnippet(
      { DEMO_MODE: 'false', STRIPE_SECRET_KEY: 'sk_test_dummy', STRIPE_WEBHOOK_SECRET: '' },
      UNSIGNED_SNIPPET
    )
  );
});
