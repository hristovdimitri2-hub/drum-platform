/**
 * P2 — HTTP route tests for src/bot.js (the P2 coverage-gate item).
 *
 * bot.js used to bind a port and launch Telegram as a side effect of being
 * imported, so the Express routes could not be tested at all — and the audit
 * noted that `bot.js` carries the operator/dashboard surface with 0% coverage.
 * The module now exports `app` and only listens when it is the entry point
 * (`require.main === module`), which makes this file possible.
 *
 * The app is served on an ephemeral loopback port and driven with the real
 * production routes — no mocks of the router itself. Rate limits are disabled
 * here; their own behaviour is covered in p2-security.test.cjs.
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drum-p2-routes-'));
process.env.SQLITE_PATH = path.join(tmp, 'test.db');
process.env.DATA_BACKEND = 'sqlite';
process.env.DEMO_MODE = 'true';
process.env.ADMIN_TOKEN = 'p2-routes-admin-token';
process.env.RATELIMIT_DISABLED = 'true';
process.env.PORT = '0';
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.TELEGRAM_WEBHOOK_URL;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.ALLOW_UNSIGNED_WEBHOOKS;

const auth = require('../src/services/auth');
const { app, IS_DEMO } = require('../src/bot');

let server;
let base;
const COOKIE = `${auth.COOKIE_NAME}=${encodeURIComponent(process.env.ADMIN_TOKEN)}`;

test.before(async () => {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

// --------------------------------------------------------------------------

test('P2 routes: bot.js exports the app without binding a port', () => {
  assert.equal(typeof app, 'function', 'app must be exported');
  assert.equal(IS_DEMO, true, 'these tests run in demo mode');
});

test('P2 routes: GET /health reports ok + demo mode', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.mode, 'demo');
  assert.ok(body.timestamp);
});

test('P2 routes: hardening headers are present on a real route', async () => {
  const res = await fetch(`${base}/health`);
  assert.ok(res.headers.get('content-security-policy'));
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('P2 routes: GET /login serves the login form', async () => {
  const res = await fetch(`${base}/login`, { redirect: 'manual' });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<form/i);
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('P2 routes: POST /login rejects a wrong token and accepts the right one', async () => {
  const bad = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'token=definitely-wrong&next=/dashboard/ops',
    redirect: 'manual',
  });
  assert.equal(bad.status, 401);
  assert.match(await bad.text(), /Грешен токен/);

  const good = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `token=${encodeURIComponent(process.env.ADMIN_TOKEN)}&next=/dashboard/ops`,
    redirect: 'manual',
  });
  assert.equal(good.status, 302);
  assert.equal(good.headers.get('location'), '/dashboard/ops');
  const cookie = good.headers.get('set-cookie') || '';
  assert.match(cookie, new RegExp(`${auth.COOKIE_NAME}=`));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
});

test('P2 routes: POST /login cannot be used as an open redirect', async () => {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `token=${encodeURIComponent(process.env.ADMIN_TOKEN)}&next=https://evil.example/steal`,
    redirect: 'manual',
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/dashboard/ops', 'non-relative next must be ignored');
});

test('P2 routes: /dashboard/ops requires ADMIN_TOKEN', async () => {
  const anon = await fetch(`${base}/dashboard/ops`, { redirect: 'manual' });
  assert.equal(anon.status, 401, 'the ops dashboard must fail closed');
  assert.match(await anon.text(), /<form/i, 'humans get the login form');

  const authed = await fetch(`${base}/dashboard/ops`, {
    headers: { cookie: COOKIE },
    redirect: 'manual',
  });
  assert.equal(authed.status, 200);
  const html = await authed.text();
  assert.match(html, /</, 'must render HTML');
});

test('P2 routes: /dashboard/carbon requires ADMIN_TOKEN and renders when authed', async () => {
  const anon = await fetch(`${base}/dashboard/carbon`, { redirect: 'manual' });
  assert.equal(anon.status, 401);

  const authed = await fetch(`${base}/dashboard/carbon`, { headers: { cookie: COOKIE } });
  assert.equal(authed.status, 200);
  assert.match(authed.headers.get('content-type') || '', /text\/html/);
});

test('P2 routes: /api/evidence/:id requires ADMIN_TOKEN', async () => {
  const anon = await fetch(`${base}/api/evidence/does-not-exist`, { redirect: 'manual' });
  assert.equal(anon.status, 401);
  assert.match(anon.headers.get('content-type') || '', /application\/json/);

  const authed = await fetch(`${base}/api/evidence/does-not-exist`, {
    headers: { cookie: COOKIE },
  });
  // 404 for an unknown shipment — authenticated but empty. Never 5xx.
  assert.equal(authed.status, 404);
});

test('P2 routes: /api/checkout/:id requires ADMIN_TOKEN', async () => {
  const anon = await fetch(`${base}/api/checkout/does-not-exist`, {
    method: 'POST',
    redirect: 'manual',
  });
  assert.equal(anon.status, 401);
  assert.match(anon.headers.get('content-type') || '', /application\/json/);
});

test('P2 routes: /scan redirects to the static scanner page', async () => {
  const res = await fetch(`${base}/scan`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/scan.html');
});

test('P2 routes: the landing page and scanner are served', async () => {
  for (const p of ['/', '/scan.html', '/pay.html']) {
    const res = await fetch(`${base}${p}`);
    assert.equal(res.status, 200, `${p} must be served`);
  }
});

test('P2 routes: POST /webhooks/stripe rejects an unsigned payload', async () => {
  const res = await fetch(`${base}/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'evt_forged', type: 'payment_intent.succeeded' }),
  });
  // 400 tells Stripe to retry; the point is that a forged event is NOT accepted.
  assert.equal(res.status, 400);
  assert.match(await res.text(), /Webhook/);
});

test('P2 routes: /api/scan is reachable from loopback and never 5xx', async () => {
  const res = await fetch(`${base}/api/scan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ payload: 'not-a-drum-qr' }),
  });
  assert.ok(res.status < 500, `unexpected ${res.status}`);
  assert.ok([200, 400, 401, 403].includes(res.status), `unexpected ${res.status}`);
});
