/**
 * AUTH (P0 security) — mandatory access control for the operational surface.
 *
 * Background: /dashboard/ops, /dashboard/carbon, /api/evidence/:id and
 * /api/checkout/:id were mounted with NO authentication. The dashboards expose
 * every user, shipment, dispute and KYC chat id; /api/evidence exposes the full
 * financial timeline; /api/checkout returns a PaymentIntent clientSecret for any
 * shipment id an attacker can guess. All four are now gated.
 *
 * Model (deliberately small and auditable):
 *   - ONE shared operator token, supplied as ADMIN_TOKEN (fallback
 *     DASHBOARD_TOKEN for compatibility). No token configured -> everything
 *     denied (fail closed, never fail open).
 *   - API routes accept `Authorization: Bearer <token>` or `X-Admin-Token`.
 *   - Browser dashboards accept the same token via a login form, stored in an
 *     HttpOnly, SameSite=Strict cookie (no JS access).
 *   - Comparison is length-gated and constant-time (no timing oracle, no
 *     partial-prefix match).
 *
 * This is intentionally a stop-gap for a single-operator MVP. Before any real
 * multi-user launch this must become real identity (Telegram-login / OIDC) with
 * per-user authorisation — see docs/DEPLOYMENT.md.
 */

const crypto = require('node:crypto');

const COOKIE_NAME = 'drum_admin';

function adminToken() {
  return process.env.ADMIN_TOKEN || process.env.DASHBOARD_TOKEN || '';
}

function isConfigured() {
  return adminToken().length > 0;
}

/** Length-gated constant-time comparison (guards against timing oracles). */
function tokenMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string' || !header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/**
 * Extract the presented credential from any supported transport.
 * @returns {string|null}
 */
function extractToken(req) {
  const h = (req && req.headers) || {};

  const auth = h.authorization;
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '').trim();
  }
  if (h['x-admin-token']) return String(h['x-admin-token']).trim();

  const cookie = parseCookies(h.cookie)[COOKIE_NAME];
  if (cookie) return cookie;

  return null;
}

/**
 * @returns {{allowed: true, via: string}|{allowed: false, reason: string}}
 */
function checkAccess(req) {
  const expected = adminToken();
  if (!expected) {
    return {
      allowed: false,
      reason:
        'ADMIN_TOKEN is not configured — admin surface is disabled (fail closed). ' +
        'Set ADMIN_TOKEN in the environment to enable the dashboards.',
    };
  }
  const provided = extractToken(req);
  if (!provided) return { allowed: false, reason: 'credentials required' };
  if (!tokenMatches(provided, expected)) return { allowed: false, reason: 'invalid credentials' };

  const auth = (req.headers || {}).authorization;
  const via = typeof auth === 'string' && /^Bearer\s+/i.test(auth) ? 'bearer' : 'token';
  return { allowed: true, via };
}

/**
 * Express middleware for JSON/API routes: 401 instead of content.
 */
function requireAdminApi(req, res, next) {
  const access = checkAccess(req);
  if (access.allowed) return next();
  res.status(401).json({ error: 'Unauthorized: ' + access.reason });
}

/**
 * Express middleware for browser dashboards: humans get the login form.
 */
function requireAdminPage(req, res, next) {
  const access = checkAccess(req);
  if (access.allowed) return next();
  const next_ = encodeURIComponent(req.originalUrl || '/');
  res.status(401).send(renderLoginPage({ error: access.reason, next: next_ }));
}

function esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Minimal self-contained login form (no static asset dependency). */
function renderLoginPage({ error = '', next = '/' } = {}) {
  return `<!doctype html>
<html lang="bg"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>DRUM — операторски достъп</title>
<style>
 body{font-family:system-ui,sans-serif;background:#0f1720;color:#e6edf3;display:flex;
      min-height:100vh;align-items:center;justify-content:center;margin:0}
 form{background:#161f2b;padding:2rem;border-radius:10px;width:22rem;border:1px solid #24303f}
 h1{font-size:1.05rem;margin:0 0 1rem}
 input{width:100%;padding:.6rem;margin:.35rem 0 1rem;border-radius:6px;border:1px solid #33475f;
       background:#0f1720;color:#e6edf3;box-sizing:border-box}
 button{width:100%;padding:.6rem;border:0;border-radius:6px;background:#2f81f7;color:#fff;
        font-weight:600;cursor:pointer}
 .err{color:#ff7b72;font-size:.85rem;margin:0 0 .5rem}
 .hint{color:#8b98a5;font-size:.75rem;margin-top:1rem}
</style></head><body>
<form method="POST" action="/login">
  <h1>🔒 DRUM — операторски достъп</h1>
  ${error ? `<p class="err">${esc(error)}</p>` : ''}
  <input type="hidden" name="next" value="${esc(next)}">
  <input type="password" name="token" placeholder="ADMIN_TOKEN" autocomplete="current-password" autofocus required>
  <button type="submit">Влез</button>
  <p class="hint">Достъпът се записва в HttpOnly бисквитка. Токенът се задава чрез ADMIN_TOKEN.</p>
</form></body></html>`;
}

module.exports = {
  COOKIE_NAME,
  adminToken,
  isConfigured,
  tokenMatches,
  parseCookies,
  extractToken,
  checkAccess,
  requireAdminApi,
  requireAdminPage,
  renderLoginPage,
};
