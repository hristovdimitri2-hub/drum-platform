/**
 * OCE standalone tests — photo-evidence layer (sha256 + metadata + GDPR).
 * Adapted from DRUM tests/t3-photo-proof.test.cjs — dispute/anomaly wiring
 * stays in the main app (see README limitations).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const photoProof = require('../src/services/photoProof');
const evidencePaths = require('../src/services/evidencePaths');

const BUFFER = Buffer.from('fake-jpeg-bytes-OCE-proof');
const SHA = crypto.createHash('sha256').update(BUFFER).digest('hex');

test('OCE photo: photo → sha256 + metadata sidecar; NO metadata → NO file', () => {
  const saved = photoProof.saveProofPhoto({
    shipmentId: 'oce-0001', chatId: 42, buffer: BUFFER, caption: 'declined',
  });
  assert.equal(saved.sha256, SHA);
  assert.ok(fs.existsSync(saved.filePath));
  assert.deepEqual(fs.readFileSync(saved.filePath), BUFFER);

  const meta = JSON.parse(fs.readFileSync(saved.metaPath, 'utf8'));
  assert.equal(meta.sha256, SHA);
  assert.ok(meta.timestamp);
  assert.equal(meta.shipmentId, 'oce-0001');
  assert.equal(meta.chatId, '42');
  assert.equal(meta.demo, false);
  assert.ok(!/[\\/]/.test(meta.file), 'basename only — no paths in metadata');

  // validation BEFORE any write
  assert.throws(() => photoProof.saveProofPhoto({ shipmentId: '../evil', chatId: 1, buffer: BUFFER }), /invalid shipmentId/);
  assert.throws(() => photoProof.saveProofPhoto({ shipmentId: 'oce-x1', chatId: '', buffer: BUFFER }), /chatId missing/);
  assert.throws(() => photoProof.saveProofPhoto({ shipmentId: 'oce-x1', chatId: 1, buffer: Buffer.alloc(0) }), /empty photo/);
  assert.ok(!fs.existsSync(path.join(photoProof.EVIDENCE_DIR, 'oce-x1')), 'nothing written on rejection');

  fs.rmSync(path.join(photoProof.EVIDENCE_DIR, 'oce-0001'), { recursive: true, force: true });
});

test('OCE photo: extractShipmentId — caption token, session fallback, none', () => {
  assert.equal(photoProof.extractShipmentId({ message: { caption: ' evidence for shp-000001 ' } }), 'shp-000001');
  assert.equal(photoProof.extractShipmentId({ message: { caption: '/accept recABC123' } }), 'recABC123');
  assert.equal(photoProof.extractShipmentId({ message: {}, session: { activeRefusalShipmentId: 'shp-9' } }), 'shp-9');
  assert.equal(photoProof.extractShipmentId({ message: { caption: 'no id' }, session: {} }), null);
});

test('OCE paths: evidence root resolves INSIDE the package — no ".." escapes', () => {
  const pkgRoot = path.resolve(__dirname, '..'); // tests/ → package root
  for (const p of [evidencePaths.EVIDENCE_ROOT, evidencePaths.EVIDENCE_DIR, evidencePaths.PROOFS_DIR]) {
    assert.ok(!p.split(/[\\/]/).includes('..'), 'no ".." segment in ' + p);
    assert.ok(p.startsWith(evidencePaths.REPO_ROOT), 'inside package root: ' + p);
  }
  assert.equal(evidencePaths.REPO_ROOT, pkgRoot);
  assert.equal(evidencePaths.EVIDENCE_ROOT, path.join(pkgRoot, 'data', 'evidence'));
  assert.equal(evidencePaths.PROOFS_DIR, path.join(evidencePaths.EVIDENCE_ROOT, 'proofs'));
  assert.equal(evidencePaths.EVIDENCE_RETENTION_DAYS, 90, 'GDPR default retention');
  assert.equal(photoProof.EVIDENCE_DIR, evidencePaths.EVIDENCE_DIR);
});

test('OCE photo: GDPR cleanup removes expired evidence (>90d), keeps fresh', () => {
  const dir = path.join(photoProof.EVIDENCE_DIR, 'oce-clean');
  fs.mkdirSync(dir, { recursive: true });
  const oldF = path.join(dir, 'old.jpg');
  const freshF = path.join(dir, 'fresh.jpg');
  fs.writeFileSync(oldF, 'old');
  fs.writeFileSync(freshF, 'fresh');
  const past = new Date(Date.now() - 120 * 86400000);
  fs.utimesSync(oldF, past, past);

  const res = photoProof.cleanupExpiredEvidence({ days: 90 });
  assert.equal(res.days, 90);
  assert.ok(res.removedFiles >= 1);
  assert.ok(!fs.existsSync(oldF), 'expired evidence removed');
  assert.ok(fs.existsSync(freshF), 'fresh evidence kept');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('OCE photo: listProofPhotos returns saved records (and [] for unknown)', async () => {
  const saved = photoProof.saveProofPhoto({ shipmentId: 'oce-list', chatId: 7, buffer: BUFFER });
  const list = photoProof.listProofPhotos('oce-list');
  assert.equal(list.length, 1);
  assert.equal(list[0].sha256, SHA);
  assert.deepEqual(photoProof.listProofPhotos('oce-unknown'), []);
  fs.rmSync(path.join(photoProof.EVIDENCE_DIR, 'oce-list'), { recursive: true, force: true });
  assert.ok(saved.ok);
});
