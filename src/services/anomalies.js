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
const { listProofPhotos } = require('./photoProof');
// batch 3: unified evidence storage — INSIDE the repo (data/evidence, gitignored),
// no '..' escapes. See docs/GDPR_EVIDENCE.md (retention + legacy migration).
const { EVIDENCE_ROOT, PROOFS_DIR } = require('./evidencePaths');

const PROOF_WINDOW_HOURS = 24;
// PROOFS_DIR now comes from evidencePaths (batch 3) — inside the repo, no '..'.

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
      realPhoto: 'via photo handler (commands/photo.js) → data/evidence/<shipmentId>/',
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
 * Attach "photo proof". REAL photo (meta.photo = photoProof metadata) →
 * record with demoPlaceholder:false + sha256; DEMO (no camera/no file) →
 * clearly-marked [DEMO] placeholder record (data/proofs/<dispute>.json).
 */
async function attachDeliveryProof(store, disputeId, meta = {}) {
  const dispute = await store.getDispute(disputeId);
  if (!dispute) throw new Error('Dispute not found: ' + disputeId);
  if (isProofExpired(dispute)) {
    return { ok: false, reason: 'proof window (24h) expired' };
  }
  fs.mkdirSync(PROOFS_DIR, { recursive: true });

  const photo = meta.photo;
  const isRealPhoto = !!(photo && photo.sha256 && photo.file);
  const { photo: _photo, ...restMeta } = meta;
  const record = {
    disputeId,
    shipmentId: dispute.shipmentId,
    attachedAt: new Date().toISOString(),
    demoPlaceholder: !isRealPhoto,
    note: isRealPhoto
      ? 'REAL photo proof — sha256-verified, stored under data/evidence/<shipmentId>/'
      : 'DEMO placeholder — no camera/photo in this run (anomaly 3)',
    ...(isRealPhoto
      ? {
          photo: {
            sha256: photo.sha256,
            file: photo.file,
            timestamp: photo.timestamp,
            chatId: photo.chatId,
            bytes: photo.bytes,
            source: photo.source || 'telegram',
          },
        }
      : {}),
    meta: restMeta,
  };
  const file = path.join(PROOFS_DIR, disputeId + '.json');
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  await store.updateDisputeStatus(disputeId, 'resolved');
  return {
    ok: true,
    proofFile: file,
    demoPlaceholder: !isRealPhoto,
    sha256: isRealPhoto ? photo.sha256 : null,
  };
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

  // Photo proof (batch 2/T3): REAL photos from data/evidence/<shipmentId>/
  // + dispute attach records ([DEMO] placeholders clearly marked).
  const proofPhotos = listProofPhotos(shipmentId);
  const attachRecords = disputes
    .map((d) => {
      const pf = path.join(PROOFS_DIR, d.id + '.json');
      try { return JSON.parse(fs.readFileSync(pf, 'utf8')); } catch { return null; }
    })
    .filter(Boolean);
  const photoProof = {
    source: proofPhotos.length
      ? 'REAL'
      : (attachRecords.some((r) => r.demoPlaceholder) ? 'DEMO_PLACEHOLDER' : 'NONE'),
    realPhotos: proofPhotos.map((p) => ({
      file: p.file, sha256: p.sha256, timestamp: p.timestamp,
      chatId: p.chatId, bytes: p.bytes, source: p.source,
    })),
    attachments: attachRecords.map((r) => ({
      disputeId: r.disputeId, attachedAt: r.attachedAt,
      demoPlaceholder: r.demoPlaceholder, note: r.note, photo: r.photo || null,
    })),
  };

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
    photoProof,
    carbonLedger: carbon,
    checksum: null,
  };

  packet.checksum = crypto
    .createHash('sha256')
    .update(JSON.stringify(Object.assign({}, packet, { checksum: null })))
    .digest('hex');

  // batch 3: packets live with the shipment's evidence — inside the repo,
  // gitignored (no more DRUM/reports/evidence outside the repo).
  const dir = path.join(EVIDENCE_ROOT, shipmentId);
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
    '## Photo proof',
    photoProof.source === 'REAL'
      ? photoProof.realPhotos
          .map((p) => '- REAL photo: ' + p.file + ' (sha256 ' + p.sha256.slice(0, 16) + '…, ' + p.timestamp + ', chat ' + p.chatId + ')')
          .join('\n')
      : photoProof.source === 'DEMO_PLACEHOLDER'
        ? '- [DEMO] placeholder proof only — no real photo captured'
        : '- none',
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
  PROOFS_DIR,
  PROOF_WINDOW_HOURS,
  checkAmountMismatch,
  isDuplicateCapture,
  openDeliveryRefusal,
  isProofExpired,
  attachDeliveryProof,
  processExpiredRefusals,
  buildEvidencePacket,
};
