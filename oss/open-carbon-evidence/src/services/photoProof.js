/**
 * PHOTO PROOF (batch 2 / T3) — real photo evidence for anomaly 3
 * (recipient declines the signature).
 *
 * Storage: drum-mvp/data/evidence/<shipmentId>/ (gitignored — no photos
 * ever reach git). For EVERY saved photo there is a sidecar metadata JSON:
 *   { sha256, timestamp, shipmentId, chatId, caption, source, bytes, file }
 * Rule (brief): NO metadata → NO evidence — validation happens BEFORE any
 * file is written; filenames contain the sha256 prefix (content-addressed).
 * Metadata contains only a BASENAME (no filesystem paths / usernames).
 *
 * DEMO_MODE: this module is passive — without a camera/photo nothing is
 * written and anomalies.attachDeliveryProof keeps its [DEMO] placeholder.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { EVIDENCE_DIR, EVIDENCE_RETENTION_DAYS } = require('./evidencePaths'); // batch 3: single source, no '..' escapes

function sanitizeShipmentId(id) {
  const s = String(id === undefined || id === null ? '' : id).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/.test(s)) {
    throw new Error('invalid shipmentId');
  }
  return s;
}

/**
 * Persist a photo + metadata. Throws (writing nothing) when any required
 * metadata (shipmentId / chatId) or the image itself is missing.
 * @returns {{ok: true, filePath, metaPath, sha256, meta}}
 */
function saveProofPhoto({ shipmentId, chatId, buffer, caption = '', source = 'telegram' }) {
  const id = sanitizeShipmentId(shipmentId);
  if (chatId === undefined || chatId === null || String(chatId).trim() === '') {
    throw new Error('chatId missing — no metadata, no evidence');
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('empty photo — nothing to prove with');
  }

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const dir = path.join(EVIDENCE_DIR, id);
  fs.mkdirSync(dir, { recursive: true });

  const timestamp = new Date().toISOString();
  const base = timestamp.replace(/[:.]/g, '-') + '_' + sha256.slice(0, 12);
  const filePath = path.join(dir, base + '.jpg');
  fs.writeFileSync(filePath, buffer);

  const meta = {
    sha256,
    timestamp,
    shipmentId: id,
    chatId: String(chatId),
    caption: String(caption).slice(0, 500),
    source,
    bytes: buffer.length,
    file: base + '.jpg', // basename only — no paths in metadata
    demo: false,
  };
  const metaPath = path.join(dir, base + '.json');
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  return { ok: true, filePath, metaPath, sha256, meta };
}

/** All photo-proof metadata records for a shipment (sorted by time). */
function listProofPhotos(shipmentId) {
  let id;
  try { id = sanitizeShipmentId(shipmentId); } catch { return []; }
  const dir = path.join(EVIDENCE_DIR, id);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; }
    })
    .filter(Boolean);
}

/**
 * Which shipment does this photo document? Caption first
 * (shp-.../rec... token), then the session set by /refuse.
 */
function extractShipmentId(ctx) {
  const caption = (ctx.message && ctx.message.caption) || '';
  const fromCaption = caption.match(/(?:^|\s|\/)((?:shp|rec)[A-Za-z0-9_-]+)/);
  if (fromCaption) return fromCaption[1];
  const sess = ctx.session && ctx.session.activeRefusalShipmentId;
  if (sess) return String(sess);
  return null;
}

/**
 * GDPR retention cleanup — Art. 5(1)(e) storage limitation.
 * Deletes everything under the evidence root older than
 * `days` (default EVIDENCE_RETENTION_DAYS = 90) and prunes empty dirs.
 * Manual entry point: npm run evidence:cleanup. Never throws on missing dir.
 * @returns {{removedFiles: number, bytes: number, cutoff: string, days: number}}
 */
function cleanupExpiredEvidence({ nowMs = Date.now(), days = EVIDENCE_RETENTION_DAYS } = {}) {
  const cutoff = nowMs - days * 86400000;
  const out = { removedFiles: 0, bytes: 0, cutoff: new Date(cutoff).toISOString(), days };
  if (!fs.existsSync(EVIDENCE_DIR)) return out;

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      const st = fs.statSync(p);
      if (st.mtimeMs < cutoff) {
        out.bytes += st.size;
        fs.unlinkSync(p);
        out.removedFiles += 1;
      }
    }
  };
  walk(EVIDENCE_DIR);

  const prune = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        const p = path.join(dir, e.name);
        prune(p);
        try { fs.rmdirSync(p); } catch { /* not empty */ }
      }
    }
  };
  prune(EVIDENCE_DIR);
  return out;
}

module.exports = { EVIDENCE_DIR, saveProofPhoto, listProofPhotos, extractShipmentId, sanitizeShipmentId, cleanupExpiredEvidence };
