/**
 * EVIDENCE PATHS (batch 3 / T2) — single source of truth for where
 * evidence data lives. NO '..' escapes: everything resolves INSIDE the
 * repo (drum-mvp), which is gitignored under data/.
 *
 * Layout (default):
 *   drum-mvp/data/evidence/<shipmentId>/   photos + metadata + packets
 *   drum-mvp/data/evidence/proofs/         dispute attach records
 *
 * Override (ops): EVIDENCE_DIR=<absolute path>.
 * GDPR retention: EVIDENCE_RETENTION_DAYS (default 90) — Art. 5(1)(e)
 * storage limitation; enforced by photoProof.cleanupExpiredEvidence()
 * (npm run evidence:cleanup). See docs/GDPR_EVIDENCE.md for migration
 * of legacy files stored OUTSIDE the repo.
 */

const path = require('path');

/** drum-mvp repo root (resolved once — no '..' remains in results). */
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Root for ALL evidence artifacts — inside the repo, gitignored. */
const EVIDENCE_ROOT = process.env.EVIDENCE_DIR
  ? path.resolve(process.env.EVIDENCE_DIR)
  : path.join(REPO_ROOT, 'data', 'evidence');

/** Per-shipment photos/metadata/packets: EVIDENCE_ROOT/<shipmentId>/ */
const EVIDENCE_DIR = EVIDENCE_ROOT;

/** Dispute attach records (anomaly 3): EVIDENCE_ROOT/proofs/ */
const PROOFS_DIR = path.join(EVIDENCE_ROOT, 'proofs');

/** GDPR storage limitation for real photos/evidence (Art. 5(1)(e)). */
const EVIDENCE_RETENTION_DAYS = Number(process.env.EVIDENCE_RETENTION_DAYS || 90);

module.exports = {
  REPO_ROOT,
  EVIDENCE_ROOT,
  EVIDENCE_DIR,
  PROOFS_DIR,
  EVIDENCE_RETENTION_DAYS,
};
