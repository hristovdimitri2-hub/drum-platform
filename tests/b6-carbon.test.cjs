/**
 * B6 tests — Carbon Ledger v2: calculator, VCS-ready export, audit trail.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drum-b6-'));
process.env.SQLITE_PATH = path.join(tmp, 'test.db');
process.env.DATA_BACKEND = 'sqlite';
process.env.DEMO_MODE = 'true';

const carbon = require('../src/services/carbon');
const store = require('../src/services/store');
const exportModule = require('../scripts/export-carbon');

test('B6: calculator — Sofia-Plovdiv 25.97 kg saved with default factors', () => {
  const r = carbon.calculateCo2Saved({ originCity: 'София', destinationCity: 'Пловдив' });
  assert.equal(r.distanceKm, 145);
  assert.equal(r.baselineCo2Kg, 26.1);
  assert.equal(r.actualCo2Kg, 0.13);
  assert.equal(r.savedCo2Kg, 25.97);
  assert.equal(r.methodology, 'GHG-Protocol-Scope3-Cat4-v1');
  assert.deepEqual(r.factors, { baselineKgPerKm: 0.18, marginalShareFactor: 0.005 });
});

test('B6: audit trail — factors stored with every entry', async () => {
  const r = carbon.calculateCo2Saved({ originCity: 'София', destinationCity: 'Варна' });
  const e = await store.createCarbonEntry({
    shipmentId: 'shp-b6-1', originCity: 'София', destinationCity: 'Варна',
    baselineCo2Kg: r.baselineCo2Kg, actualCo2Kg: r.actualCo2Kg,
    savedCo2Kg: r.savedCo2Kg, distanceKm: r.distanceKm,
    methodology: r.methodology, factors: r.factors, isDemo: true,
  });
  const entries = await store.listCarbonEntries();
  const found = entries.find((x) => x.id === e.id);
  assert.deepEqual(found.factors, { baselineKgPerKm: 0.18, marginalShareFactor: 0.005 });
  assert.equal(found.verificationStatus, 'pending');
});

test('B6: VCS-ready export — JSON + CSV with methodology statement', async () => {
  const out = exportModule.buildExport();
  assert.ok(out.entries.length >= 1);
  assert.equal(out.methodologyStatement.standard,
    'GHG Protocol Corporate Value Chain (Scope 3), Category 4 — Upstream Transportation and Distribution');
  assert.equal(out.methodologyStatement.verificationStatus.indexOf('pending'), 0);

  const csv = exportModule.toCsv(out.entries);
  const lines = csv.split('\n');
  assert.equal(lines[0], 'shipment_id,origin_city,destination_city,distance_km,baseline_co2_kg,actual_co2_kg,saved_co2_kg,methodology,verification_status,is_demo,created_at');
  assert.equal(lines.length, out.entries.length + 1);
});

test('B6: summary aggregates match entry sum', async () => {
  const entries = await store.listCarbonEntries();
  const sum = entries.reduce((s, e) => s + e.savedCo2Kg, 0);
  const agg = carbon.summarize(entries);
  assert.equal(agg.savedCo2Kg, Math.round(sum * 100) / 100);
});
