/**
 * Coverage gate — assert a line-coverage floor on the modules that carry
 * money, trust, identity, evidence and the public HTTP surface.
 *
 * Reads `coverage/coverage-summary.json` (c8's `json-summary` reporter, written
 * by `npm run coverage`) and exits non-zero if any listed module is below the
 * floor or has no coverage data at all.
 *
 * ## Why the list grew from 4 to 19 modules
 *
 * The original gate covered only money/trust/carbon/matching. Every module
 * below was measured over the full suite on 2026-11-10; the number in brackets
 * is the *measured* line coverage, so the 80% floor is a ratchet that documents
 * real headroom rather than an aspiration:
 *
 *   security.js 100 · auth.js 100 · b2b.js 100 · store.js 100 · kpi.js 100
 *   evidencePaths.js 100 · money.js 100 · matching.js 100
 *   carbon.js 99.09 · trust.js 98.62 · finance.js 96.84 · airtable.js 95.82
 *   scanWeb.js 95.49 · anomalies.js 94.05 · stripeEvents.js 92.68
 *   checkout.js 92.41 · carbonDashboard.js 90.32 · db/sqlite.js 87.22
 *   photoProof.js 83.98
 *
 * `db/sqlite.js` and `photoProof.js` are the two closest to the floor; if a
 * refactor drops one below 80 the gate is telling you something real.
 *
 * ## Deliberately NOT in the list (known, documented gaps)
 *
 *   src/services/stripe.js  67.17% — the uncovered branches are the live-mode
 *     and network paths (Stripe SDK calls, Connect account creation, dispute
 *     webhooks). They cannot be exercised without real API credentials, so
 *     gating them at 80% would fail CI permanently. Covering them needs an
 *     HTTP-level fake of the Stripe API — the same trick
 *     tests/p2-airtable-contract.test.cjs uses for Airtable.
 *   src/bot.js  64.45% — the process entry point. Its route handlers ARE
 *     covered (tests/p2-routes.test.cjs); the uncovered lines are the
 *     startServer/listen/Telegram-transport wiring that only runs as a real
 *     process. Gating it would measure the wrong thing.
 *   src/commands/{help,list,evidence}.js — thin Telegram presenters.
 *
 * The floor can be overridden for a one-off experiment:
 *   COVERAGE_MIN=70 node scripts/coverage-gate.js
 * Print every measured file:
 *   node scripts/coverage-gate.js --report
 */

const fs = require('fs');
const path = require('path');

const SUMMARY = path.join(__dirname, '..', 'coverage', 'coverage-summary.json');

const CRITICAL = [
  // money canon and everything that decides what leaves the escrow
  'src/services/money.js',
  'src/services/finance.js',
  'src/services/b2b.js',
  // trust + anomaly handling
  'src/services/trust.js',
  'src/services/anomalies.js',
  // identity and the public HTTP surface
  'src/services/auth.js',
  'src/services/security.js',
  'src/services/scanWeb.js',
  'src/services/checkout.js',
  // persistence facade and the backends
  'src/services/store.js',
  'src/services/db/sqlite.js',
  'src/services/airtable.js',
  // evidence + carbon (the audit's P2/P3 surface)
  'src/services/photoProof.js',
  'src/services/evidencePaths.js',
  'src/services/carbon.js',
  'src/services/carbonDashboard.js',
  'src/services/stripeEvents.js',
  // matching + KPIs
  'src/services/matching.js',
  'src/services/kpi.js',
];

const MIN = Number(process.env.COVERAGE_MIN || 80);
const REPORT = process.argv.includes('--report');

if (!fs.existsSync(SUMMARY)) {
  console.error(`GATE FAIL: ${SUMMARY} not found — run "npm run coverage" first.`);
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(SUMMARY, 'utf8'));

/** Match a repo-relative module path against the summary's absolute keys. */
function findEntry(rel) {
  const want = rel.replace(/\\/g, '/');
  for (const [key, value] of Object.entries(summary)) {
    if (key === 'total') continue;
    if (key.replace(/\\/g, '/').endsWith('/' + want)) return value;
  }
  return null;
}

let ok = true;
const rows = [];

for (const rel of CRITICAL) {
  const entry = findEntry(rel);
  if (!entry) {
    rows.push({ rel, pct: null, status: 'NO DATA' });
    console.error(`GATE FAIL: no coverage data for ${rel} (renamed, or never loaded?)`);
    ok = false;
    continue;
  }
  const pct = entry.lines.pct;
  const status = pct >= MIN ? 'OK' : 'FAIL';
  if (status === 'FAIL') ok = false;
  rows.push({ rel, pct, status, total: entry.lines.total, covered: entry.lines.covered });
}

const width = Math.max(...rows.map((r) => r.rel.length));
console.log(`Coverage gate — ${CRITICAL.length} critical modules, floor ${MIN}% lines\n`);
for (const r of rows.sort((a, b) => (a.pct ?? -1) - (b.pct ?? -1))) {
  const pct = r.pct === null ? '   n/a' : String(r.pct).padStart(6);
  const detail = r.pct === null ? '' : `  (${r.covered}/${r.total} lines)`;
  console.log(`  ${r.status.padEnd(7)} ${pct}%  ${r.rel.padEnd(width)}${detail}`);
}

if (REPORT) {
  console.log('\nAll measured files:');
  for (const [key, value] of Object.entries(summary)) {
    if (key === 'total') continue;
    console.log(`  ${String(value.lines.pct).padStart(6)}%  ${key.replace(/\\/g, '/')}`);
  }
}

console.log(`\nOverall line coverage: ${summary.total ? summary.total.lines.pct : 'n/a'}%`);
console.log(
  ok
    ? `\nGATE PASS (all ${CRITICAL.length} modules >= ${MIN}%)`
    : `\nGATE FAIL (floor ${MIN}%)`
);
process.exit(ok ? 0 : 1);
