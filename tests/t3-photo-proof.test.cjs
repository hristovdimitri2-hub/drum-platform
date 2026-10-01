/**
 * Batch 2 / T3 — photo → hash → evidence chain (anomaly 3).
 * Headless: injected download (no network, no camera), temp SQLite,
 * DEMO_MODE=true. Acceptance: photo → sha256 → evidence packet;
 * no metadata → no file; DEMO placeholder clearly marked; no keys/tokens
 * in logs, replies or metadata.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drum-t3-'));
process.env.SQLITE_PATH = path.join(tmp, 'test.db');
process.env.DATA_BACKEND = 'sqlite';
process.env.DEMO_MODE = 'true';

const store = require('../src/services/store');
const photoProof = require('../src/services/photoProof');
const anomalies = require('../src/services/anomalies');
const { createPhotoHandler } = require('../src/commands/photo');
const { createMockCtx, transcript } = require('../src/services/telegramMock');
const refuseCmd = require('../src/commands/refuse');

const BUFFER = Buffer.from('fake-jpeg-bytes-DRUM-T3-proof');
const SHA = crypto.createHash('sha256').update(BUFFER).digest('hex');

async function makeShipment(tag) {
  const sender = await store.findOrCreateUser({ telegramId: 830001, firstName: 'S' });
  return store.createShipment({
    senderId: sender.id, senderTelegramId: sender.telegramId,
    originCity: 'София', destinationCity: 'Пловдив',
    totalEur: 12, baseEur: 10, feeEur: 1.5, insuranceEur: 0.5,
    stripePaymentIntentId: 'pi_test_t3_' + tag, status: 'picked_up', isDemo: true,
  });
}

function photoCtx(shipmentId) {
  return createMockCtx({
    from: { id: 840001, first_name: 'Recipient' },
    photo: [{ file_id: 'f1', file_unique_id: 'u1', file_size: BUFFER.length }],
    caption: 'dokazatelstvo ' + shipmentId,
  });
}

function cleanupEvidence(shipmentId) {
  fs.rmSync(path.join(photoProof.EVIDENCE_DIR, shipmentId), { recursive: true, force: true });
}

/* ---------------- T3.1: photo → sha256 + metadata ------------------------ */

test('T3.1: photo → sha256 + metadata sidecar; NO metadata → NO file', () => {
  const saved = photoProof.saveProofPhoto({
    shipmentId: 'shp-t3-001', chatId: 840001, buffer: BUFFER, caption: 'отказ',
  });
  assert.equal(saved.sha256, SHA, 'sha256 of the exact bytes');
  assert.ok(fs.existsSync(saved.filePath));
  assert.deepEqual(fs.readFileSync(saved.filePath), BUFFER, 'file content === uploaded bytes');

  const meta = JSON.parse(fs.readFileSync(saved.metaPath, 'utf8'));
  assert.equal(meta.sha256, SHA);
  assert.ok(meta.timestamp, 'timestamp present');
  assert.equal(meta.shipmentId, 'shp-t3-001');
  assert.equal(meta.chatId, '840001', 'chatId of the sender present');
  assert.equal(meta.demo, false, 'real photo is never marked demo');
  // metadata carries NO filesystem paths / usernames — basename only
  assert.ok(!/[\\/]/.test(meta.file), 'basename only: ' + meta.file);
  const rawMeta = fs.readFileSync(saved.metaPath, 'utf8');
  assert.ok(!rawMeta.includes('Users') && !rawMeta.includes('C:'), 'no home path in metadata');

  // validation happens BEFORE any write
  assert.throws(() => photoProof.saveProofPhoto({ shipmentId: '../evil', chatId: 1, buffer: BUFFER }), /invalid shipmentId/);
  assert.throws(() => photoProof.saveProofPhoto({ shipmentId: '', chatId: 1, buffer: BUFFER }), /invalid shipmentId/);
  assert.throws(() => photoProof.saveProofPhoto({ shipmentId: 'shp-x-001', chatId: '', buffer: BUFFER }), /chatId missing/);
  assert.throws(() => photoProof.saveProofPhoto({ shipmentId: 'shp-x-001', chatId: 1, buffer: Buffer.alloc(0) }), /empty photo/);
  assert.ok(!fs.existsSync(path.join(photoProof.EVIDENCE_DIR, 'shp-x-001')), 'nothing written on rejection');

  cleanupEvidence('shp-t3-001');
});

test('T3.1b: extractShipmentId — caption token, session fallback, none', () => {
  assert.equal(photoProof.extractShipmentId({ message: { caption: ' evidence for shp-000001 ' } }), 'shp-000001');
  assert.equal(photoProof.extractShipmentId({ message: { caption: '/accept recABC123' } }), 'recABC123');
  assert.equal(photoProof.extractShipmentId({ message: {}, session: { activeRefusalShipmentId: 'shp-9' } }), 'shp-9');
  assert.equal(photoProof.extractShipmentId({ message: { caption: 'няма id' }, session: {} }), null);
});

/* ---------------- T3.2: handler — photo → download → save → attach ------- */

test('T3.2: handler saves the photo and closes the open refusal (injected download)', async () => {
  const shipment = await makeShipment('h');
  const opened = await anomalies.openDeliveryRefusal(store, {
    shipmentId: shipment.id, openedBy: 'recipient',
  });

  const handler = createPhotoHandler({ download: async () => BUFFER }); // no network
  const ctx = photoCtx(shipment.id);
  ctx.airtable = store;
  await handler(ctx);

  const t = transcript(ctx);
  assert.ok(t.includes('Доказателство записано'), 'confirmation sent:\n' + t);
  assert.ok(t.includes(SHA), 'sha256 shown to the user');
  assert.ok(t.includes('свързана с отказ'), 'linked to the refusal');
  // security: no filesystem path, no token in the reply
  assert.ok(!t.includes('C:\\Users') && !t.includes('C:/Users'), 'no absolute paths in replies');
  assert.ok(!/bot\d+:[A-Za-z0-9_-]+/.test(t), 'no bot token in replies');

  // dispute resolved with a REAL photo record
  const dispute = await store.getDispute(opened.dispute.id);
  assert.equal(dispute.status, 'resolved');
  const recFile = path.join(anomalies.PROOFS_DIR, opened.dispute.id + '.json');
  const rec = JSON.parse(fs.readFileSync(recFile, 'utf8'));
  assert.equal(rec.demoPlaceholder, false, 'REAL photo → not a placeholder');
  assert.equal(rec.photo.sha256, SHA);
  assert.equal(rec.photo.chatId, '840001');
  assert.ok(!/[\\/]/.test(rec.photo.file), 'record keeps basename only');

  // photo + metadata on disk for the shipment
  const photos = photoProof.listProofPhotos(shipment.id);
  assert.equal(photos.length, 1);
  assert.equal(photos[0].sha256, SHA);

  cleanupEvidence(shipment.id);
});

/* ---------------- T3.3: evidence packet — REAL / [DEMO] / NONE ---------- */

test('T3.3: evidence packet photoProof — REAL, [DEMO] placeholder, NONE', async () => {
  // (a) REAL — photo first, then the packet
  const realShip = await makeShipment('real');
  await anomalies.openDeliveryRefusal(store, { shipmentId: realShip.id, openedBy: 'recipient' });
  const handler = createPhotoHandler({ download: async () => BUFFER });
  const ctx = photoCtx(realShip.id);
  ctx.airtable = store;
  await handler(ctx);

  const outReal = await anomalies.buildEvidencePacket(store, realShip.id);
  const packetReal = JSON.parse(fs.readFileSync(outReal.jsonPath, 'utf8'));
  assert.equal(packetReal.photoProof.source, 'REAL');
  assert.equal(packetReal.photoProof.realPhotos[0].sha256, SHA);
  assert.equal(packetReal.photoProof.attachments[0].demoPlaceholder, false);
  const mdReal = fs.readFileSync(outReal.mdPath, 'utf8');
  assert.ok(mdReal.includes('## Photo proof') && mdReal.includes('REAL photo'), 'md marks REAL');
  // checksum still reproducible with the new section
  const rehash = crypto.createHash('sha256')
    .update(JSON.stringify(Object.assign({}, packetReal, { checksum: null })))
    .digest('hex');
  assert.equal(rehash, outReal.sha256);
  cleanupEvidence(realShip.id);
  fs.rmSync(path.dirname(outReal.jsonPath), { recursive: true, force: true });

  // (b) [DEMO] placeholder only — the camera-less path
  const demoShip = await makeShipment('demo');
  const openedB = await anomalies.openDeliveryRefusal(store, { shipmentId: demoShip.id });
  const att = await anomalies.attachDeliveryProof(store, openedB.dispute.id, {});
  assert.equal(att.ok, true);
  assert.equal(att.demoPlaceholder, true, 'no photo → honest placeholder');
  const outDemo = await anomalies.buildEvidencePacket(store, demoShip.id);
  const packetDemo = JSON.parse(fs.readFileSync(outDemo.jsonPath, 'utf8'));
  assert.equal(packetDemo.photoProof.source, 'DEMO_PLACEHOLDER');
  const mdDemo = fs.readFileSync(outDemo.mdPath, 'utf8');
  assert.ok(mdDemo.includes('[DEMO] placeholder proof only'), 'md marks [DEMO]');
  fs.rmSync(path.dirname(outDemo.jsonPath), { recursive: true, force: true });

  // (c) NONE — nothing captured at all
  const bareShip = await makeShipment('bare');
  const outNone = await anomalies.buildEvidencePacket(store, bareShip.id);
  const packetNone = JSON.parse(fs.readFileSync(outNone.jsonPath, 'utf8'));
  assert.equal(packetNone.photoProof.source, 'NONE');
  assert.ok(fs.readFileSync(outNone.mdPath, 'utf8').includes('- none'));
  fs.rmSync(path.dirname(outNone.jsonPath), { recursive: true, force: true });
});

/* ---------------- T3.4: /refuse opens the 24h window (DEMO, no camera) --- */

test('T3.4: /refuse works without a camera; next photo binds via session', async () => {
  const shipment = await makeShipment('ref');
  const ctx = createMockCtx({ from: { id: 840002 }, text: '/refuse ' + shipment.id });
  ctx.airtable = store;
  await refuseCmd(ctx);

  const t = transcript(ctx);
  assert.ok(t.includes('Отказ за подпис'), t);
  assert.ok(t.includes('24ч'), '24h window announced');
  assert.equal(ctx.session.activeRefusalShipmentId, shipment.id, 'session binds next photo');

  const disputes = await store.listDisputes({});
  const d = disputes.find((x) => x.shipmentId === shipment.id);
  assert.ok(d && d.status === 'open', 'refusal dispute opened');
  assert.equal(anomalies.isProofExpired(await store.getDispute(d.id)), false);
});

/* ---------- batch 3 / T2: evidence path hygiene + GDPR retention ---------- */

test('T2: evidence paths are INSIDE the repo — no ".." escapes; retention = 90', () => {
  const ep = require('../src/services/evidencePaths');
  for (const p of [ep.EVIDENCE_ROOT, ep.EVIDENCE_DIR, ep.PROOFS_DIR]) {
    assert.ok(!p.split(/[\\/]/).includes('..'), 'no ".." segment in ' + p);
    assert.ok(p.startsWith(ep.REPO_ROOT), 'resolves inside the repo: ' + p);
  }
  assert.equal(ep.EVIDENCE_ROOT, path.join(ep.REPO_ROOT, 'data', 'evidence'));
  assert.equal(ep.PROOFS_DIR, path.join(ep.EVIDENCE_ROOT, 'proofs'));
  assert.equal(ep.EVIDENCE_RETENTION_DAYS, 90, 'GDPR default retention');
  // the runtime modules use the shared constants (no private copies)
  assert.equal(photoProof.EVIDENCE_DIR, ep.EVIDENCE_DIR);
  assert.equal(anomalies.PROOFS_DIR, ep.PROOFS_DIR);
});

test('T2: cleanup removes expired evidence (>90d) and keeps fresh files', () => {
  const dir = path.join(photoProof.EVIDENCE_DIR, 'shp-t3-clean');
  fs.mkdirSync(dir, { recursive: true });
  const oldF = path.join(dir, 'old.jpg');
  const freshF = path.join(dir, 'fresh.jpg');
  fs.writeFileSync(oldF, 'old-bytes');
  fs.writeFileSync(freshF, 'fresh-bytes');
  const past = new Date(Date.now() - 120 * 86400000); // 120 days old
  fs.utimesSync(oldF, past, past);

  const res = photoProof.cleanupExpiredEvidence({ days: 90 });
  assert.equal(res.days, 90);
  assert.ok(res.removedFiles >= 1, 'expired file removed');
  assert.ok(!fs.existsSync(oldF), 'expired evidence is gone');
  assert.ok(fs.existsSync(freshF), 'fresh evidence survives');

  fs.rmSync(dir, { recursive: true, force: true });
});
