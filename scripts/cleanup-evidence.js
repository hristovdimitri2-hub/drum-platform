#!/usr/bin/env node
/**
 * GDPR retention cleanup for evidence data (batch 3 / T2).
 * Removes photos/metadata/packets/proof-records older than
 * EVIDENCE_RETENTION_DAYS (default 90, Art. 5(1)(e)).
 * Usage: npm run evidence:cleanup
 */
const { cleanupExpiredEvidence } = require('../src/services/photoProof');
const { EVIDENCE_DIR, EVIDENCE_RETENTION_DAYS } = require('../src/services/evidencePaths');

console.log(`Evidence root: ${EVIDENCE_DIR}`);
console.log(`Retention: ${EVIDENCE_RETENTION_DAYS} days (GDPR Art. 5(1)(e))`);
const result = cleanupExpiredEvidence();
console.log(`Removed ${result.removedFiles} file(s), ${result.bytes} bytes (older than ${result.cutoff}).`);
