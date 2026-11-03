/**
 * P0 security — access control for the operator surface.
 *
 * Covers src/services/auth.js: token extraction (Bearer / X-Admin-Token /
 * HttpOnly cookie), constant-time comparison, fail-closed behaviour when
 * ADMIN_TOKEN is unset, and the two Express middlewares used by bot.js to
 * protect /dashboard/ops, /dashboard/carbon, /api/evidence/:id and
 * /api/checkout/:id.
 */

const test = require('node:test');
const assert = require('node:assert');

const auth = require('../src/services/auth');

const TOKEN = 'sup3r-secret-admin-token-value';

function req(headers = {}) {
  return { headers, originalUrl: '/dashboard/ops' };
}

function withToken(token, fn) {
  const saved = process.env.ADMIN_TOKEN;
  const savedLegacy = process.env.DASHBOARD_TOKEN;
  if (token === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = token;
  delete process.env.DASHBOARD_TOKEN;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = saved;
    if (savedLegacy === undefined) delete process.env.DASHBOARD_TOKEN;
    else process.env.DASHBOARD_TOKEN = savedLegacy;
  }
}

/** Minimal Express response double. */
function resDouble() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    set(k, v) {
      this.headers[k] = v;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
      return this;
    },
    redirect(url) {
      this.redirectedTo = url;
      return this;
    },
  };
}

// ---------------------------------------------------------------- token compare

test('P0 auth: constant-time comparison accepts the exact token only', () => {
  assert.equal(auth.tokenMatches(TOKEN, TOKEN), true);
});

test('P0 auth: comparison rejects wrong, partial and empty tokens', () => {
  assert.equal(auth.tokenMatches('wrong', TOKEN), false);
  assert.equal(auth.tokenMatches(TOKEN.slice(0, -1), TOKEN), false); // prefix
  assert.equal(auth.tokenMatches('', TOKEN), false);
  assert.equal(auth.tokenMatches(undefined, TOKEN), false);
  assert.equal(auth.tokenMatches(TOKEN, ''), false);
});

// ------------------------------------------------------------------- fail closed

test('P0 auth: with no ADMIN_TOKEN configured everything is denied', () => {
  withToken(undefined, () => {
    assert.equal(auth.isConfigured(), false);
    const access = auth.checkAccess(req({ authorization: 'Bearer anything' }));
    assert.equal(access.allowed, false);
    assert.match(access.reason, /not configured/);
  });
});

test('P0 auth: DASHBOARD_TOKEN is accepted as a legacy fallback', () => {
  const savedAdmin = process.env.ADMIN_TOKEN;
  const savedLegacy = process.env.DASHBOARD_TOKEN;
  try {
    delete process.env.ADMIN_TOKEN;
    process.env.DASHBOARD_TOKEN = TOKEN;
    assert.equal(auth.adminToken(), TOKEN);
    assert.equal(auth.checkAccess(req({ authorization: `Bearer ${TOKEN}` })).allowed, true);
  } finally {
    if (savedAdmin === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = savedAdmin;
    if (savedLegacy === undefined) delete process.env.DASHBOARD_TOKEN;
    else process.env.DASHBOARD_TOKEN = savedLegacy;
  }
});

// ------------------------------------------------------------------ transports

test('P0 auth: Authorization Bearer is accepted', () => {
  withToken(TOKEN, () => {
    const access = auth.checkAccess(req({ authorization: `Bearer ${TOKEN}` }));
    assert.equal(access.allowed, true);
    assert.equal(access.via, 'bearer');
  });
});

test('P0 auth: X-Admin-Token is accepted', () => {
  withToken(TOKEN, () => {
    const access = auth.checkAccess(req({ 'x-admin-token': TOKEN }));
    assert.equal(access.allowed, true);
  });
});

test('P0 auth: the HttpOnly login cookie is accepted', () => {
  withToken(TOKEN, () => {
    const cookie = `other=x; ${auth.COOKIE_NAME}=${encodeURIComponent(TOKEN)}`;
    assert.equal(auth.checkAccess(req({ cookie })).allowed, true);
  });
});

test('P0 auth: missing / wrong credentials are rejected with a reason', () => {
  withToken(TOKEN, () => {
    assert.match(auth.checkAccess(req({})).reason, /credentials required/);
    assert.match(
      auth.checkAccess(req({ authorization: 'Bearer nope' })).reason,
      /invalid credentials/
    );
    // A non-Bearer Authorization scheme must not be treated as a token.
    assert.equal(auth.checkAccess(req({ authorization: `Basic ${TOKEN}` })).allowed, false);
  });
});

// ----------------------------------------------------------------- middleware

test('P0 auth: requireAdminApi returns 401 JSON without a token', () => {
  withToken(TOKEN, () => {
    const res = resDouble();
    let nextCalled = false;
    auth.requireAdminApi(req({}), res, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 401);
    assert.match(res.body.error, /Unauthorized/);
    assert.equal(nextCalled, false);
  });
});

test('P0 auth: requireAdminApi calls next() with a valid token', () => {
  withToken(TOKEN, () => {
    const res = resDouble();
    let nextCalled = false;
    auth.requireAdminApi(req({ authorization: `Bearer ${TOKEN}` }), res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null);
  });
});

test('P0 auth: requireAdminApi fails closed when no token is configured', () => {
  withToken(undefined, () => {
    const res = resDouble();
    auth.requireAdminApi(req({ authorization: 'Bearer anything' }), res, () => {
      throw new Error('next() must not be called');
    });
    assert.equal(res.statusCode, 401);
  });
});

test('P0 auth: requireAdminPage serves the login form instead of content', () => {
  withToken(TOKEN, () => {
    const res = resDouble();
    auth.requireAdminPage(req({}), res, () => {
      throw new Error('next() must not be called');
    });
    assert.equal(res.statusCode, 401);
    assert.match(res.body, /ADMIN_TOKEN/);
    assert.match(res.body, /<form/);
  });
});

test('P0 auth: requireAdminPage lets an authenticated operator through', () => {
  withToken(TOKEN, () => {
    let nextCalled = false;
    auth.requireAdminPage(req({ authorization: `Bearer ${TOKEN}` }), resDouble(), () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });
});

test('P0 auth: the login form escapes untrusted values (no HTML injection)', () => {
  const html = auth.renderLoginPage({ error: '<script>alert(1)</script>', next: '"/><img>' });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!html.includes('"/><img>'));
});
