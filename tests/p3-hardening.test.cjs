/**
 * P3 — the "improvements" tier of the audit, pinned down as tests.
 *
 * P3.1 evidence checksum must be reproducible (volatile fields excluded)
 * P3.2 the 0.005 marginal carbon factor is a documented engineering margin,
 *      with an opt-in physics-based alternative that refuses to invent inputs
 * P3.3 the silent 200 km corridor fallback is gone
 * P3.4/P3.5 the remaining decisions (repo licence, Postgres path) are recorded
 *      in ARCHITECTURE.md rather than left implicit
 */

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const anomalies = require('../src/services/anomalies');
const carbon = require('../src/services/carbon');

const ROOT = path.resolve(__dirname, '..');

// --------------------------------------------------------------------------
// P3.1 — reproducible evidence checksum
// --------------------------------------------------------------------------

function syntheticPacket(generatedAt, amountCents = 1200) {
  return {
    shipment: { id: 'shp-p3-1', totalEur: 12, status: 'delivered' },
    financialTimeline: [
      { amountCents, splitCents: { carrier: 960, drum: 180, insurance: 60 } },
    ],
    photoProof: { source: 'NONE', realPhotos: [], attachments: [] },
    carbonLedger: { savedCo2Kg: 25.38, calculatedAt: generatedAt, createdAt: generatedAt },
    generatedAt,
    checksum: null,
  };
}

test('P3.1: two packets with identical data hash the SAME despite generatedAt', () => {
  const a = syntheticPacket('2026-11-03T20:00:00.000Z');
  const b = syntheticPacket('2026-12-01T09:30:00.000Z');
  assert.equal(anomalies.evidenceChecksum(a), anomalies.evidenceChecksum(b));
  assert.match(anomalies.evidenceChecksum(a), /^[a-f0-9]{64}$/);
});

test('P3.1: the OLD inline algorithm was NOT reproducible (why this changed)', () => {
  const legacy = (p) =>
    crypto
      .createHash('sha256')
      .update(JSON.stringify(Object.assign({}, p, { checksum: null })))
      .digest('hex');
  assert.notEqual(
    legacy(syntheticPacket('2026-11-03T20:00:00.000Z')),
    legacy(syntheticPacket('2026-12-01T09:30:00.000Z')),
    'the pre-fix hash moved with generatedAt — that is the defect P3.1 fixed'
  );
});

test('P3.1: a substantive change still flips the checksum', () => {
  const a = syntheticPacket('2026-11-03T20:00:00.000Z', 1200);
  const b = syntheticPacket('2026-11-03T20:00:00.000Z', 1201);
  assert.notEqual(anomalies.evidenceChecksum(a), anomalies.evidenceChecksum(b));

  // and a split change, not just the total
  const c = syntheticPacket('2026-11-03T20:00:00.000Z');
  c.financialTimeline[0].splitCents.carrier = 961;
  assert.notEqual(anomalies.evidenceChecksum(a), anomalies.evidenceChecksum(c));
});

test('P3.1: the excluded fields are an explicit, documented list', () => {
  assert.deepEqual(anomalies.CHECKSUM_VOLATILE_PATHS, [
    'checksum',
    'generatedAt',
    'carbonLedger.calculatedAt',
    'carbonLedger.createdAt',
  ]);

  const canonical = anomalies.canonicalEvidencePayload(syntheticPacket('2026-11-03T20:00:00.000Z'));
  assert.equal(canonical.generatedAt, undefined);
  assert.equal(canonical.checksum, undefined);
  assert.equal(canonical.carbonLedger.calculatedAt, undefined);
  assert.equal(canonical.carbonLedger.createdAt, undefined);
  // substantive content survives
  assert.equal(canonical.shipment.totalEur, 12);
  assert.equal(canonical.carbonLedger.savedCo2Kg, 25.38);
});

test('P3.1: missing nested paths are ignored, never an error', () => {
  assert.doesNotThrow(() => anomalies.canonicalEvidencePayload({ shipment: {} }));
  assert.equal(anomalies.canonicalEvidencePayload(null), null);
  assert.equal(typeof anomalies.evidenceChecksum({ a: 1 }), 'string');
});

// --------------------------------------------------------------------------
// P3.2 — marginal carbon factor
// --------------------------------------------------------------------------

test('P3.2: the default mode is the documented engineering margin', () => {
  const prev = process.env.CO2_MARGINAL_MODE;
  delete process.env.CO2_MARGINAL_MODE;
  try {
    assert.equal(carbon.marginalMode(), 'engineering');
    assert.equal(carbon.FACTORS.mode, 'engineering');
  } finally {
    if (prev !== undefined) process.env.CO2_MARGINAL_MODE = prev;
  }
  assert.equal(carbon.FACTORS.marginalKgPerKm, 0.005);
  assert.match(carbon.marginalFactorBasis(), /engineering-margin/);
  // it is deliberately a small fraction of the baseline — pessimistic, not inflated
  assert.ok(carbon.FACTORS.marginalKgPerKm < carbon.FACTORS.baselineKgPerKm);
});

test('P3.2: physics mode refuses to run without its two inputs', () => {
  const prev = { ...process.env };
  try {
    process.env.CO2_MARGINAL_MODE = 'physics';
    delete process.env.CO2_PARCEL_MASS_KG;
    delete process.env.CO2_MASS_PENALTY_KG_PER_KG_KM;
    assert.throws(() => carbon.resolveMarginalFactor(), /requires CO2_PARCEL_MASS_KG/);

    process.env.CO2_PARCEL_MASS_KG = '5';
    assert.throws(() => carbon.resolveMarginalFactor(), /requires CO2_PARCEL_MASS_KG/);
  } finally {
    process.env.CO2_MARGINAL_MODE = prev.CO2_MARGINAL_MODE;
    if (prev.CO2_MARGINAL_MODE === undefined) delete process.env.CO2_MARGINAL_MODE;
    if (prev.CO2_PARCEL_MASS_KG === undefined) delete process.env.CO2_PARCEL_MASS_KG;
    if (prev.CO2_MASS_PENALTY_KG_PER_KG_KM === undefined) delete process.env.CO2_MASS_PENALTY_KG_PER_KG_KM;
  }
});

test('P3.2: physics mode computes mass x penalty when both are given', () => {
  const prev = { ...process.env };
  try {
    process.env.CO2_MARGINAL_MODE = 'physics';
    process.env.CO2_PARCEL_MASS_KG = '5';
    process.env.CO2_MASS_PENALTY_KG_PER_KG_KM = '0.00004';
    const f = carbon.resolveMarginalFactor();
    assert.equal(f.kgPerKm, 5 * 0.00004);
    assert.match(f.basis, /^physics/);
  } finally {
    if (prev.CO2_MARGINAL_MODE === undefined) delete process.env.CO2_MARGINAL_MODE;
    else process.env.CO2_MARGINAL_MODE = prev.CO2_MARGINAL_MODE;
    if (prev.CO2_PARCEL_MASS_KG === undefined) delete process.env.CO2_PARCEL_MASS_KG;
    else process.env.CO2_PARCEL_MASS_KG = prev.CO2_PARCEL_MASS_KG;
    if (prev.CO2_MASS_PENALTY_KG_PER_KG_KM === undefined) delete process.env.CO2_MASS_PENALTY_KG_PER_KG_KM;
    else process.env.CO2_MASS_PENALTY_KG_PER_KG_KM = prev.CO2_MASS_PENALTY_KG_PER_KG_KM;
  }
});

test('P3.2: an unknown mode is an explicit error', () => {
  const prev = process.env.CO2_MARGINAL_MODE;
  try {
    process.env.CO2_MARGINAL_MODE = 'guesswork';
    assert.throws(() => carbon.resolveMarginalFactor(), /Unknown CO2_MARGINAL_MODE/);
  } finally {
    if (prev === undefined) delete process.env.CO2_MARGINAL_MODE;
    else process.env.CO2_MARGINAL_MODE = prev;
  }
});

// --------------------------------------------------------------------------
// P3.3 — no silent 200 km fallback
// --------------------------------------------------------------------------

test('P3.3: an unknown corridor is an explicit error, not 200 km', () => {
  assert.throws(
    () => carbon.calculateCo2Saved({ originCity: 'Плевен', destinationCity: 'Добрич' }),
    /Unknown corridor/
  );
  assert.throws(
    () => carbon.calculateCo2Saved({ originCity: 'Плевен', destinationCity: 'Добрич' }),
    /CO2_UNKNOWN_CORRIDOR_FALLBACK_KM/
  );
});

test('P3.3: the magic 200 constant is gone from the source', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'src', 'services', 'carbon.js'), 'utf8');
  // Comments still NAME the removed constant (that is the explanation), so the
  // assertions run against the code with comments stripped.
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  assert.ok(!/DEFAULT_DISTANCE_KM/.test(src), 'the silent fallback must be gone from the code');
  assert.ok(!/=\s*200\b/.test(src), 'no hard-coded 200 km distance may remain in the code');
  // The replacement is env-gated, so it cannot silently apply.
  assert.match(raw, /CO2_UNKNOWN_CORRIDOR_FALLBACK_KM/);
});

test('P3.3: known corridors resolve from the table and report their source', () => {
  const r = carbon.resolveDistance({ originCity: 'София', destinationCity: 'Пловдив' });
  assert.deepEqual(r, { km: 145, source: 'corridor' });
});

test('P3.3: an explicit distanceKm wins and is labelled', () => {
  const r = carbon.resolveDistance({
    originCity: 'Плевен',
    destinationCity: 'Добрич',
    distanceKm: 310,
  });
  assert.deepEqual(r, { km: 310, source: 'explicit' });

  const calc = carbon.calculateCo2Saved({
    originCity: 'Плевен',
    destinationCity: 'Добрич',
    distanceKm: 310,
  });
  assert.equal(calc.distanceKm, 310);
  assert.equal(calc.distanceSource, 'explicit');
  assert.equal(calc.savedCo2Kg, Math.round(310 * 0.175 * 100) / 100);
});

test('P3.3: the canon numbers for the documented corridors are unchanged', () => {
  const r = carbon.calculateCo2Saved({ originCity: 'София', destinationCity: 'Пловдив' });
  assert.equal(r.distanceKm, 145);
  assert.equal(r.distanceSource, 'corridor');
  assert.equal(r.savedCo2Kg, 25.38);
  assert.deepEqual(r.factors, { baselineKgPerKm: 0.18, marginalKgPerKm: 0.005 });
});

// --------------------------------------------------------------------------
// P3.4 / P3.5 — decisions recorded, not implied
// --------------------------------------------------------------------------

test('P3.4/P3.5: ARCHITECTURE.md records the licence and Postgres decisions', () => {
  const md = fs.readFileSync(path.join(ROOT, 'ARCHITECTURE.md'), 'utf8');
  assert.match(md, /[Ll]icen[cs]e/, 'the repo licence decision must be recorded');
  assert.match(md, /Postgres/i, 'the persistence/scaling path must be recorded');
  assert.match(md, /UNLICENSED/, 'the current spdx value must be stated');
});
