/**
 * B6 — VCS-ready Carbon Ledger export (CSV + JSON + methodology statement).
 * Run: node scripts/export-carbon.js
 * Testable: require('./export-carbon').buildExport() returns the payload.
 */

const fs = require('fs');
const path = require('path');
const store = require('../src/services/store');
const carbon = require('../src/services/carbon');

const OUT_DIR = path.join(__dirname, '..', 'docs', 'data-room');

const METHODOLOGY_STATEMENT = {
  standard: 'GHG Protocol Corporate Value Chain (Scope 3), Category 4 — Upstream Transportation and Distribution',
  methodologyTag: carbon.METHODOLOGY_TAG,
  baseline: {
    description: 'Dedicated courier van carrying only this parcel on the same route',
    kgPerKm: carbon.FACTORS.baselineKgPerKm,
  },
  allocation: {
    approach: 'Marginal share of an already-travelling private vehicle (conservative, GHG allocation hierarchy)',
    marginalShareFactor: carbon.FACTORS.marginalShareFactor,
  },
  formula: 'saved_kg = distance_km * baseline_kg_per_km * (1 - marginal_share_factor)',
  verificationStatus: 'pending — eligible for VCS (Verra) / Gold Standard registration (Year 3+)',
  exclusions: ['first/last mile', 'administrative travel', 'air transport'],
  factorsSource: 'env-configurable; every ledger entry stores the exact factors used (audit trail)',
};

async function buildExport() {
  const entries = await store.listCarbonEntries();
  const summary = carbon.summarize(entries);
  return {
    jsonPath: null, // filled by main()
    csvPath: null,
    methodologyStatement: METHODOLOGY_STATEMENT,
    summary,
    entries,
  };
}

function toCsv(entries) {
  const rows = ['shipment_id,origin_city,destination_city,distance_km,baseline_co2_kg,actual_co2_kg,saved_co2_kg,methodology,verification_status,is_demo,created_at'];
  for (const e of entries) {
    rows.push([
      e.shipmentId || '', e.originCity || '', e.destinationCity || '',
      e.distanceKm ?? '', e.baselineCo2Kg ?? '', e.actualCo2Kg ?? '',
      e.savedCo2Kg ?? '', e.methodology || '', e.verificationStatus || '',
      e.isDemo ? 'true' : 'false', e.createdAt || '',
    ].join(','));
  }
  return rows.join('\n');
}

async function main() {
  const out = await buildExport();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, 'CARBON_EXPORT.json');
  const csvPath = path.join(OUT_DIR, 'CARBON_LEDGER.csv');
  const payload = {
    exportVersion: 1,
    generatedAt: new Date().toISOString(),
    methodologyStatement: out.methodologyStatement,
    summary: out.summary,
    entries: out.entries,
  };
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(csvPath, toCsv(out.entries));
  console.log('VCS-ready carbon export: ' + out.entries.length + ' entries ->');
  console.log('  ' + jsonPath);
  console.log('  ' + csvPath);
  console.log('  Total saved: ' + out.summary.savedCo2Kg + ' kg CO2e (' + out.summary.distanceKm + ' km)');
}

if (require.main === module) main();
module.exports = { buildExport, toCsv, METHODOLOGY_STATEMENT };
