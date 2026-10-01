/**
 * WEB SCAN (batch 3 / T3) — server side of the camera scanner.
 *
 * Architecture: `public/scan.html` decodes the QR (jsQR via CDN) and POSTs
 * the payload here; the payload is executed through the REAL /scan command
 * via the mock-ctx adapter (the exact pattern of the b2 integration tests),
 * so pickup/delivery/capture/money-split/trust/CO2 run the production code
 * path with ZERO duplication.
 *
 * Identity: pickup scans run AS the shipment's carrier (web/ops demo entry —
 * the Telegram text path keeps the real identity check); delivery has no
 * party check (recipient scans). Limitation documented in ARCHITECTURE.md.
 * The legacy text payload path is untouched — this is an additional entry.
 *
 * Access guard (batch 4 / T2): localhost/127.0.0.1 pass WITHOUT a token
 * (demo /scan.html + demo-camera keep working); every non-local IP must
 * send `Authorization: Bearer <SCAN_API_TOKEN>` or `X-Demo-Token:
 * <SCAN_API_TOKEN>` (env) — otherwise 401.
 */

const crypto = require('node:crypto');
const { createMockCtx, transcript } = require('./telegramMock');
const scanCommand = require('../commands/scan');

const LOCAL_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Length-gated timing-safe token comparison. */
function tokenMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * @returns {{allowed: true, local: boolean}|{allowed: false, reason: string}}
 */
function checkScanAccess({ ip, headers }) {
  const h = headers || {};
  if (LOCAL_IPS.has(ip)) return { allowed: true, local: true };

  const expected = process.env.SCAN_API_TOKEN;
  let provided = null;
  const auth = h.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) provided = auth.slice(7).trim();
  if (!provided && h['x-demo-token']) provided = String(h['x-demo-token']).trim();

  if (!expected) return { allowed: false, reason: 'SCAN_API_TOKEN is not configured' };
  if (!provided) return { allowed: false, reason: 'token required for non-local requests' };
  if (!tokenMatches(provided, expected)) return { allowed: false, reason: 'invalid token' };
  return { allowed: true, local: false };
}

/** `drum:pickup:ID` / `drum:delivery:ID` — same format as the bot/QR. */
function parsePayload(payload) {
  const parts = String(payload === undefined || payload === null ? '' : payload).trim().split(':');
  if (parts.length !== 3 || parts[0] !== 'drum') return null;
  if (parts[1] !== 'pickup' && parts[1] !== 'delivery') return null;
  if (!parts[2]) return null;
  return { action: parts[1], shipmentId: parts[2] };
}

/**
 * @param {{body: {payload?: string}, store, stripe, qr, carbon}} args
 * @returns {Promise<{ok: true, status: number, replies: string, photos: number, shipment: object|null}|{ok: false, status: number, error: string}>}
 */
async function handleScanRequest({ body, store, stripe, qr, carbon }) {
  const parsed = parsePayload(body && body.payload);
  if (!parsed) {
    return {
      ok: false,
      status: 400,
      error: 'Невалиден QR payload — очаква се drum:pickup:ID или drum:delivery:ID',
    };
  }

  let shipment = null;
  try {
    shipment = await store.getShipment(parsed.shipmentId);
  } catch (err) {
    console.error('Web scan store error:', err.message);
    return { ok: false, status: 500, error: 'Store error' };
  }

  // pickup: run as the shipment's carrier (web/ops demo identity)
  const fromId = shipment && parsed.action === 'pickup' && shipment.carrierTelegramId
    ? shipment.carrierTelegramId
    : 0;

  const ctx = createMockCtx({
    from: { id: fromId, first_name: 'Web scan' },
    text: '/scan ' + String((body && body.payload) || '').trim(),
  });
  ctx.airtable = store;
  ctx.stripe = stripe;
  ctx.qr = qr;
  ctx.carbon = carbon;

  await scanCommand(ctx);

  const after = await store.getShipment(parsed.shipmentId);
  return {
    ok: true,
    status: 200,
    replies: transcript(ctx),
    photos: ctx.__photos.length,
    shipment: after ? { id: after.id, status: after.status } : null,
  };
}

/**
 * Express route factory: access guard (batch 4) → scan handling.
 * Local IPs bypass the token; non-local need SCAN_API_TOKEN (401 otherwise).
 */
function createScanRoute({ store, stripe, qr, carbon }) {
  return async (req, res) => {
    const access = checkScanAccess({ ip: req.ip, headers: req.headers });
    if (!access.allowed) {
      res.status(401).json({ error: 'Unauthorized: ' + access.reason });
      return;
    }
    try {
      const out = await handleScanRequest({ body: req.body, store, stripe, qr, carbon });
      res.status(out.status).json(out.ok ? out : { error: out.error });
    } catch (err) {
      console.error('Web scan error:', err.message);
      res.status(500).json({ error: 'Scan failed' });
    }
  };
}

module.exports = { handleScanRequest, parsePayload, checkScanAccess, createScanRoute, LOCAL_IPS };
