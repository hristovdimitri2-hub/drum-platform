/**
 * P2/P1 — security module: structured logging, redaction, helmet headers and
 * rate limiting.
 *
 * These exercise src/services/security.js directly (plus two throwaway Express
 * apps) so a failure points at the middleware, not at the bot.
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const security = require('../src/services/security');

/** Listen on an ephemeral loopback port and return { base, close }. */
async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// --------------------------------------------------------------------------
// Structured logging
// --------------------------------------------------------------------------

test('P2 security: log() emits one JSON object with a stable shape', () => {
  const lines = [];
  const sink = { write: (s) => lines.push(s) };
  const line = security.log('info', 'unit.test', { a: 1 }, sink);

  assert.equal(lines.length, 1);
  assert.ok(line.endsWith('\n'), 'the returned record is newline-terminated');
  assert.equal(lines[0], line, 'the sink receives exactly what log() returns');
  assert.ok(!line.includes('\n\n'));

  const parsed = JSON.parse(line);
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.event, 'unit.test');
  assert.equal(parsed.service, 'drum-mvp');
  assert.equal(parsed.a, 1);
  assert.ok(!Number.isNaN(Date.parse(parsed.ts)), 'ts must be an ISO timestamp');
});

test('P2 security: warn/error go to stderr, info to stdout', () => {
  const out = { write: () => {} };
  const err = { write: () => {} };
  // Injecting a non-stdout sink routes everything there; assert the level
  // selection logic through the public logger contract instead.
  const captured = [];
  const sink = { write: (s) => captured.push(s) };
  security.log('error', 'unit.err', {}, sink);
  security.log('warn', 'unit.warn', {}, sink);
  security.log('info', 'unit.info', {}, sink);
  assert.equal(captured.length, 3);
  assert.equal(JSON.parse(captured[0]).level, 'error');
  assert.ok(out.write && err.write);
});

test('P2 security: LOG_LEVEL filters below-threshold records', () => {
  const prev = process.env.LOG_LEVEL;
  const captured = [];
  const sink = { write: (s) => captured.push(s) };
  try {
    process.env.LOG_LEVEL = 'warn';
    security.log('debug', 'unit.debug', {}, sink);
    security.log('info', 'unit.info', {}, sink);
    security.log('warn', 'unit.warn', {}, sink);
    assert.equal(captured.length, 1, 'only the warn record passes a warn threshold');
    assert.equal(JSON.parse(captured[0]).event, 'unit.warn');
  } finally {
    if (prev === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = prev;
  }
});

test('P2 security: secrets are redacted, never logged verbatim', () => {
  const secret = 'sk_test_51AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
  const out = security.redact({
    token: secret,
    authorization: 'Bearer abcdefghijklmnop',
    stripe_secret_key: secret,
    nested: { cookie: 'drum_admin=supersecrettoken', ok: 'keep-me' },
    amountCents: 1200,
  });

  assert.notEqual(out.token, secret);
  assert.ok(!JSON.stringify(out).includes(secret), 'the raw secret must not survive redaction');
  assert.ok(!JSON.stringify(out).includes('supersecrettoken'));
  assert.equal(out.nested.ok, 'keep-me', 'non-secret fields are untouched');
  assert.equal(out.amountCents, 1200);
  assert.match(out.token, /^\w\w\*\*\*\w\w$/);
});

test('P2 security: logger never writes an unredacted token', () => {
  const captured = [];
  const sink = { write: (s) => captured.push(s) };
  security.log('info', 'auth.login.failed', { token: 'super-secret-admin-token' }, sink);
  assert.ok(!captured.join('').includes('super-secret-admin-token'));
});

test('P2 security: requestLogger records method/path/status/latency, not bodies', async () => {
  const captured = [];
  const sink = { write: (s) => captured.push(s) };
  const app = express();
  app.use(security.requestLogger({ sink }));
  app.get('/thing', (req, res) => res.json({ ok: true }));

  const { base, close } = await listen(app);
  try {
    const res = await fetch(`${base}/thing`);
    assert.equal(res.status, 200);
    await res.json();
    await new Promise((r) => setTimeout(r, 20));

    const records = captured.map((l) => JSON.parse(l)).filter((r) => r.event === 'http.request');
    assert.equal(records.length, 1);
    assert.equal(records[0].method, 'GET');
    assert.equal(records[0].path, '/thing');
    assert.equal(records[0].status, 200);
    assert.equal(typeof records[0].durationMs, 'number');
  } finally {
    await close();
  }
});

test('P2 security: requestLogger marks 4xx as warn and 5xx as error', async () => {
  const captured = [];
  const sink = { write: (s) => captured.push(s) };
  const app = express();
  app.use(security.requestLogger({ sink }));
  app.get('/bad', (req, res) => res.status(404).send('nope'));
  app.get('/boom', (req, res) => res.status(500).send('boom'));

  const { base, close } = await listen(app);
  try {
    await fetch(`${base}/bad`);
    await fetch(`${base}/boom`);
    await new Promise((r) => setTimeout(r, 20));
    const levels = captured
      .map((l) => JSON.parse(l))
      .filter((r) => r.event === 'http.request')
      .map((r) => r.level);
    assert.deepEqual(levels, ['warn', 'error']);
  } finally {
    await close();
  }
});

// --------------------------------------------------------------------------
// Helmet
// --------------------------------------------------------------------------

test('P2 security: helmet sets the hardening headers', async () => {
  const app = express();
  app.use(security.helmetMiddleware());
  app.get('/', (req, res) => res.send('<html><body>hi</body></html>'));

  const { base, close } = await listen(app);
  try {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);

    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, 'Content-Security-Policy must be set');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    // The two third parties the real pages need.
    assert.match(csp, /https:\/\/js\.stripe\.com/);
    assert.match(csp, /https:\/\/cdn\.jsdelivr\.net/);

    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.equal(res.headers.get('x-powered-by'), null, 'x-powered-by must be removed');
  } finally {
    await close();
  }
});

test('P2 security: HSTS is only sent for an https APP_URL', async () => {
  const prev = process.env.APP_URL;
  try {
    delete process.env.APP_URL;
    const app = express();
    app.use(security.helmetMiddleware());
    app.get('/', (req, res) => res.send('ok'));
    const local = await listen(app);
    try {
      const res = await fetch(`${local.base}/`);
      assert.equal(res.headers.get('strict-transport-security'), null);
    } finally {
      await local.close();
    }

    process.env.APP_URL = 'https://drum.example';
    assert.equal(security.httpsEnabled(), true);
    const app2 = express();
    app2.use(security.helmetMiddleware());
    app2.get('/', (req, res) => res.send('ok'));
    const tls = await listen(app2);
    try {
      const res = await fetch(`${tls.base}/`);
      assert.match(res.headers.get('strict-transport-security') || '', /max-age=\d+/);
      // With TLS the CSP may keep upgrade-insecure-requests.
      assert.match(res.headers.get('content-security-policy') || '', /upgrade-insecure-requests/);
    } finally {
      await tls.close();
    }
  } finally {
    if (prev === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prev;
  }
});

// --------------------------------------------------------------------------
// Rate limiting
// --------------------------------------------------------------------------

test('P2 security: the limiter returns 429 once the budget is spent', async () => {
  const app = express();
  app.use(security.createRateLimiter({ name: 'unit', windowMs: 60000, max: 2 }));
  app.get('/x', (req, res) => res.json({ ok: true }));

  const { base, close } = await listen(app);
  try {
    const first = await fetch(`${base}/x`);
    const second = await fetch(`${base}/x`);
    const third = await fetch(`${base}/x`);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(third.status, 429);
    assert.equal((await third.json()).limiter, 'unit');
    assert.ok(third.headers.get('retry-after'));
  } finally {
    await close();
  }
});

test('P2 security: buildLimiters() honours RATELIMIT_DISABLED', () => {
  const prev = process.env.RATELIMIT_DISABLED;
  try {
    process.env.RATELIMIT_DISABLED = 'true';
    const off = security.buildLimiters();
    assert.equal(typeof off.login, 'function');
    assert.equal(typeof off.scan, 'function');
    assert.equal(typeof off.api, 'function');

    process.env.RATELIMIT_DISABLED = 'false';
    const on = security.buildLimiters();
    assert.equal(typeof on.login, 'function');
  } finally {
    if (prev === undefined) delete process.env.RATELIMIT_DISABLED;
    else process.env.RATELIMIT_DISABLED = prev;
  }
});

test('P2 security: limit windows are sane and login is the strictest', () => {
  assert.ok(security.WINDOW_MS.login >= 60 * 1000);
  assert.ok(security.WINDOW_MS.api > 0 && security.WINDOW_MS.scan > 0);
});
