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
 */

const { createMockCtx, transcript } = require('./telegramMock');
const scanCommand = require('../commands/scan');

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

module.exports = { handleScanRequest, parsePayload };
