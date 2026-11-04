/**
 * SECURITY — HTTP hardening, rate limiting and structured logging (P1).
 *
 * Why this module exists
 * ----------------------
 * The MVP shipped with no security headers, no rate limiting and string-only
 * (`console.log`) logging on the public routes. The audit flagged this as P1:
 * "Добавете helmet, rate limiting и structured logging — поне на публичните
 * маршрути". Everything here is deliberately dependency-light (helmet +
 * express-rate-limit only) and unit-testable without booting the whole bot.
 *
 * Contents
 *   1. logger            — one-line JSON logs (level, event, fields, ts)
 *   2. requestLogger()   — per-request access log + X-Response-Time
 *   3. helmetMiddleware()— security headers (CSP tuned for the real pages)
 *   4. createRateLimiter / limiters — per-route throttles
 *
 * CSP note (honest limitation)
 * ----------------------------
 * `public/index.html`, `public/scan.html` и `public/pay.html` contain INLINE
 * `<script>` blocks and `onclick=` attributes, so `script-src` must keep
 * `'unsafe-inline'`. Moving those blocks into external .js files is the
 * follow-up that lets us drop it — tracked in ARCHITECTURE.md.
 * Allowed origins are limited to the two third parties the pages actually use:
 * js.stripe.com (Stripe Elements) and cdn.jsdelivr.net (jsQR).
 */

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// ---------------------------------------------------------------------------
// 1. Structured logging
// ---------------------------------------------------------------------------

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/** Fields that must never reach the log sink verbatim. */
const REDACT_KEYS = new Set([
  'token',
  'admin_token',
  'admintoken',
  'authorization',
  'cookie',
  'stripe_secret_key',
  'airtable_api_key',
  'telegram_bot_token',
  'scan_api_token',
  'password',
  'secret',
]);

function redactValue(value) {
  const s = String(value);
  if (!s) return s;
  return s.length <= 4 ? '***' : `${s.slice(0, 2)}***${s.slice(-2)}`;
}

/** Shallow-then-deep redaction of well-known secret-ish keys. */
function redact(fields, depth = 0) {
  if (!fields || typeof fields !== 'object' || depth > 4) return fields;
  if (Array.isArray(fields)) return fields.map((f) => redact(f, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (REDACT_KEYS.has(String(k).toLowerCase())) {
      out[k] = redactValue(v);
    } else if (v && typeof v === 'object') {
      out[k] = redact(v, depth + 1);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function currentLevel() {
  const raw = String(process.env.LOG_LEVEL || 'info').toLowerCase();
  return LEVELS[raw] !== undefined ? raw : 'info';
}

/**
 * Emit one JSON line. Shape is stable so log search/aggregation works:
 *   {"ts":"…","level":"info","event":"http.request",…,"service":"drum-mvp"}
 */
function log(level, event, fields = {}, sink = process.stdout) {
  if (LEVELS[level] === undefined) level = 'info';
  if (LEVELS[level] < LEVELS[currentLevel()]) return null;
  const record = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    service: 'drum-mvp',
    ...redact(fields),
  }) + '\n';
  if (level === 'error' || level === 'warn') {
    // Diagnostics go to stderr so `npm start 1>app.log` keeps them visible.
    (sink === process.stdout ? process.stderr : sink).write(record);
  } else {
    sink.write(record);
  }
  return record;
}

const logger = {
  debug: (event, fields) => log('debug', event, fields),
  info: (event, fields) => log('info', event, fields),
  warn: (event, fields) => log('warn', event, fields),
  error: (event, fields) => log('error', event, fields),
  /** Exposed for tests: same JSON contract, capture-friendly sink. */
  _log: log,
  _redact: redact,
};

// ---------------------------------------------------------------------------
// 2. Request logging
// ---------------------------------------------------------------------------

/** Paths we do not log: static assets and the health probe. */
const QUIET_PATHS = /^\/(favicon\.ico|robots\.txt|.*\.(css|js|png|jpg|jpeg|svg|ico|webp|map))$/;

/**
 * Access log in one JSON line per request, with latency.
 * Logs the outcome only (never the body), so no secrets leak.
 */
function requestLogger({ sink = process.stdout } = {}) {
  return function requestLoggerMiddleware(req, res, next) {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      if (QUIET_PATHS.test(req.path) || req.path === '/health') return;
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      log(
        res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
        'http.request',
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
          ip: req.ip,
          ua: req.get('user-agent'),
          // Deliberately NOT logged: query strings (may carry tokens) or bodies.
        },
        sink
      );
    });
    next();
  };
}

// ---------------------------------------------------------------------------
// 3. Security headers (helmet)
// ---------------------------------------------------------------------------

function httpsEnabled() {
  return String(process.env.APP_URL || '').startsWith('https://');
}

/**
 * Helmet configuration tuned to the pages actually served by this app.
 * Verified against public/{index,pay,scan}.html:
 *   - js.stripe.com      → Stripe.js (pay.html)
 *   - cdn.jsdelivr.net   → jsQR (scan.html)
 *   - inline scripts/styles → see the CSP note in the module header
 */
function helmetMiddleware() {
  const directives = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", 'https://js.stripe.com', 'https://cdn.jsdelivr.net'],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'", 'https://api.stripe.com', 'https://cdn.jsdelivr.net'],
    frameSrc: ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
    fontSrc: ["'self'", 'data:'],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
  };
  // Plain-HTTP local demos must not be force-upgraded; only do it when the
  // deployment declares an https APP_URL.
  // `useDefaults: false` means this must be set explicitly in BOTH directions:
  // `[]` emits the directive, `null` drops it.
  directives.upgradeInsecureRequests = httpsEnabled() ? [] : null;

  return helmet({
    contentSecurityPolicy: { useDefaults: false, directives },
    // HSTS only makes sense behind TLS; sending it over http://localhost can
    // pin a browser to https for localhost in some setups.
    hsts: httpsEnabled()
      ? { maxAge: 15552000, includeSubDomains: true, preload: false }
      : false,
    // Stripe Elements renders cross-origin iframes → COEP would block them.
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
}

// ---------------------------------------------------------------------------
// 4. Rate limiting
// ---------------------------------------------------------------------------

const WINDOW_MS = {
  login: 15 * 60 * 1000, // 15 min
  scan: 60 * 1000,
  api: 60 * 1000,
  global: 60 * 1000,
};

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Build one limiter. `validate: false` silences express-rate-limit's
 * proxy/header validation warnings — this app is deployed both behind a proxy
 * (Railway) and directly (local demo), so the default checks are noise here.
 *
 * @param {{name: string, windowMs: number, max: number}} opts
 */
function createRateLimiter({ name, windowMs, max, skip }) {
  const limiter = rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    validate: false,
    skip: skip || (() => false),
    handler: (req, res) => {
      logger.warn('ratelimit.blocked', { limiter: name, path: req.path, method: req.method, ip: req.ip });
      res.status(429).json({ error: 'Too many requests', limiter: name, retryAfterSeconds: Math.ceil(windowMs / 1000) });
    },
  });
  logger.debug('ratelimit.created', { limiter: name, windowMs, max });
  return limiter;
}

/**
 * The limiters used by bot.js. Limits are env-overridable
 * (RATELIMIT_LOGIN_MAX, RATELIMIT_API_MAX, RATELIMIT_SCAN_MAX) and can be
 * raised to 0-disabled in tests via RATELIMIT_DISABLED=true.
 */
function buildLimiters() {
  const disabled = String(process.env.RATELIMIT_DISABLED || '').toLowerCase() === 'true';
  const skip = () => disabled;
  return {
    login: createRateLimiter({
      name: 'login',
      windowMs: WINDOW_MS.login,
      max: envInt('RATELIMIT_LOGIN_MAX', 10),
      skip,
    }),
    scan: createRateLimiter({
      name: 'scan',
      windowMs: WINDOW_MS.scan,
      max: envInt('RATELIMIT_SCAN_MAX', 30),
      skip,
    }),
    api: createRateLimiter({
      name: 'api',
      windowMs: WINDOW_MS.api,
      max: envInt('RATELIMIT_API_MAX', 120),
      skip,
    }),
  };
}

module.exports = {
  logger,
  log,
  redact,
  requestLogger,
  helmetMiddleware,
  createRateLimiter,
  buildLimiters,
  WINDOW_MS,
  httpsEnabled,
};
