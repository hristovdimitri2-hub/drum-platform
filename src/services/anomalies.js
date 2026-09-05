/**
 * ANOMALIES (B5) — payment & delivery anomaly handling.
 *
 * NOTE ON NUMBERING: the consolidated brief references "аномалии 1-4"
 * without inline definitions. Implemented per context:
 *   1 — Amount mismatch: captured/authenticated amount ≠ shipment total
 *   2 — Double capture / replayed webhook (idempotency)
 *   3 — Recipient declines signature: 24h window for photo proof,
 *       else auto-refund + carrier penalty (DEMO: proof = placeholder
 *       file with metadata; REAL PHOTO: TODO — see ARCHITECTURE.md)
 *   4 — Chargeback: one-action evidence packet (the B5 demo star)
 *
 * If the original brief defines anomalies differently, the delta is a
 * small change here — every rule is an isolated pure/persisted function.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROOF_WINDOW_HOURS = 24;
const PROOFS_DIR = path.join(__dirname, '..', '..', '..', 'data', 'proofs');

/* ---------------------- Anomaly 1: amount mismatch ------------------------ */

/**
 * Compare authenticated amount vs shipment total (in cents).
 */
function checkAmountMismatch(shipment, intentAmountCents) {
  const expected = Math.round((Number(shipment.totalEur) || 0) * 100);
  const actual = Math.round(Number(intentAmountCents) || 0);
  return {
    anomaly: expected !== actual,
    type: 'amount_mismatch',
    expectedCents: expected,
    actualCents: actual,
    deltaCents: actual - expected,
  };
}

/* --------------------- Anomaly 2: double capture / replay ----------------- */

/**
 * True if a capture transaction already exists for this shipment.
 * Webhook replays are additionally blocked by webhook_events idempotency
 * (store.isWebhookProcessed / store.markWebhookProcessed).
 */
async function isDuplicateCapture(store, shipmentId) {
  const txs = await store.listTransactionsByShipment(shipmentId);
  return txs.some((t) => t.type === 'capture');
}

/* --------------- Anomaly 3: recipient declines the signature -------------- */

/**
 * Recipient refuses to sign → open a refusal case with a 24h proof window.
 */
async function openDeliveryRefusal(store, { shipmentId, openedBy, openedAtMs = Date.now() }) {
  const deadline = new Date(openedAtMs + PROOF_WINDOW_HOURS * 3600000).toISOString();
  const d = await store.createDispute({
    shipmentId,
    openedBy: openedBy || 'recipient',
    reason: JSON.stringify({
      type: 'delivery_refusal',
      proofDeadline: deadline,
      proofRequired: true,
      realPhoto: 'TODO (production)',
    }),
  });
  return { dispute: d, proofDeadline: deadline, windowHours: PROOF_WINDOW_HOURS };
}

function isProofExpired(dispute, nowMs = Date.now()) {
  let reason = {};
  try { reason = JSON.parse(dispute.reason || '{}'); } catch { /* ignore */ }
  if (reason.type !== 'delivery_refusal' || !reason.proofDeadline) return false;
  return new Date(reason.proofDeadline).getTime() < nowMs;
}

/**
 * Attach "photo proof". DEMO: writes a placeholder file with metadata
 * (data/proofs/<dispute>.json). REAL PHOTO upload: TODO (production).
 */
async function attachDeliveryProof(store, disputeId, meta = {}) {
  const dispute = await store.getDispute(disputeId);
  if (!dispute) throw new Error('Dispute not found: ' + disputeId);
  if (isProofExpired(dispute)) {
    return { ok: false, reason: 'proof window (24h) expired' };
  }
  fs.mkdirSync(PROOFS_DIR, { recursive: true });
  const record = {
    disputeId,
    shipmentId: dispute.shipmentId,
    attachedAt: new Date().toISOString(),
    demoPlaceholder: true,
    note: 'DEMO placeholder — real photo upload is TODO (production)',
    meta,
  };
  const file = path.join(PROOFS_DIR, disputeId + '.json');
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  await store.updateDisputeStatus(disputeId, 'resolved');
  return { ok: true, proofFile: file };
}

/**
 * Auto-resolve expired refusals: refund + carrier penalty (delivery_failed).
 * @returns {Array<{disputeId, action:'refunded'}>}
 */
async function processExpiredRefusals(store, carrierId) {
  const out = [];
  for (const d of await store.listDisputes({ userId: carrierId })) {
    if (d.status !== 'open') continue;
    if (!isProofExpired(d)) continue;
    const shipment = await store.getShipment(d.shipmentId);
    if (shipment && shipment.stripePaymentIntentId) {
      const r = await require('./stripe').refundEscrow(shipment.stripePaymentIntentId);
      if (!r.success) console.error('Refund failed:', r.error);
    }
    await store.updateTrustScore(carrierId, 'delivery_failed');
    await store.updateDisputeStatus(d.id, 'lost');
    out.push({ disputeId: d.id, action: 'refunded' });
  }
  return out;
}

/* ------------------- Anomaly 4: chargeback evidence pack ------------------ */

/**
 * THE B5 DEMO STAR: one action -> complete chargeback evidence packet.
 * Collects the full transaction story, hashes it, writes JSON + Markdown.
 * @returns {{jsonPath, mdPath, sha256}}
 */
async function buildEvidencePacket(store, shipmentId) {
  const shipment = await store.getShipment(shipmentId);
  if (!shipment) throw new Error('Shipment not found: ' + shipmentId);
  const transactions = await store.listTransactionsByShipment(shipmentId);
  const allDisputes = await store.listDisputes({});
  const disputes = allDisputes.filter((d) => d.shipmentId === shipmentId);
  const carbon = (await store.listCarbonEntries()).find((c) => c.shipmentId === shipmentId) || null;

  const packet = {
    packetVersion: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: 'DRUM evidence builder (B5) — one-action chargeback evidence',
    shipment: {
      id: shipment.id,
      corridor: shipment.originCity + ' -> ' + shipment.destinationCity,
      description: shipment.description,
      totalEur: shipment.totalEur,
      baseEur: shipment.baseEur,
      status: shipment.status,
      isDemo: shipment.isDemo === true,
      createdAt: shipment.createdAt,
      matchedAt: shipment.matchedAt,
      pickupScannedAt: shipment.pickupScannedAt,
      deliveryScannedAt: shipment.deliveryScannedAt,
    },
    stripe: {
      paymentIntentId: shipment.stripePaymentIntentId,
      transferId: shipment.stripeTransferId,
      mode: shipment.isDemo ? 'DEMO (simulated rails)' : 'TEST',
    },
    financialTimeline: transactions.map((t) => ({
      at: t.createdAt,
      type: t.type,
      amountCents: t.amountCents,
      splitCents: {
        carrier: t.splitCarrierCents,
        drum: t.splitDrumCents,
        insurance: t.splitInsuranceCents,
      },
      stripeId: t.stripeId,
    })),
    disputes,
    carbonLedger: carbon,
    checksum: null,
  };

  packet.checksum = crypto
    .createHash('sha256')
    .update(JSON.stringify(Object.assign({}, packet, { checksum: null })))
    .digest('hex');

  const dir = path.join(__dirname, '..', '..', '..', 'reports', 'evidence');
  fs.mkdirSync(dir, { recursive: true });
  const base = 'evidence_' + shipmentId + '_' + packet.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = path.join(dir, base + '.json');
  fs.writeFileSync(jsonPath, JSON.stringify(packet, null, 2));

  const md = [
    '# Evidence packet — ' + shipmentId,
    '',
    '- Generated: ' + packet.generatedAt + ' (SHA-256: `' + packet.checksum + '`)',
    '- Corridor: ' + packet.shipment.corridor,
    '- Status: ' + packet.shipment.status + ' | Stripe mode: ' + packet.stripe.mode,
    '- PaymentIntent: ' + packet.stripe.paymentIntentId + ' | Transfer: ' + packet.stripe.transferId,
    '',
    '## Financial timeline',
    '| Time | Type | Amount (cents) | Carrier | DRUM | Insurance | Stripe ID |',
    '|---|---|---|---|---|---|---|',
    ...packet.financialTimeline.map((t) =>
      '| ' + t.at + ' | ' + t.type + ' | ' + t.amountCents + ' | ' +
      t.splitCents.carrier + ' | ' + t.splitCents.drum + ' | ' +
      t.splitCents.insurance + ' | ' + (t.stripeId || '-') + ' |'),
    '',
    '## Disputes',
    disputes.length
      ? disputes.map((d) => '- ' + d.id + ': ' + d.status + ' (' + d.createdAt + ')').join('\n')
      : '_none_',
    '',
    carbon
      ? '## Carbon Ledger\n- ' + carbon.savedCo2Kg + ' kg CO2 saved (' + carbon.methodology + ')'
      : '',
  ].join('\n');
  const mdPath = path.join(dir, base + '.md');
  fs.writeFileSync(mdPath, md);

  return { jsonPath, mdPath, sha256: packet.checksum };
}

module.exports = {
  PROOF_WINDOW_HOURS,
  checkAmountMismatch,
  isDuplicateCapture,
  openDeliveryRefusal,
  isProofExpired,
  attachDeliveryProof,
  processExpiredRefusals,
  buildEvidencePacket,
};
