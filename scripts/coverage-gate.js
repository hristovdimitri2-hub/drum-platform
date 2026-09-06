/**
 * Coverage gate (Етап 4): assert >= 80% line coverage on the critical
 * money/trust/carbon/matching modules. c8 writes coverage/summary.json —
 * we read it and fail loudly if the gate is missed.
 * (Reported per-module in CI log; the gate covers the four critical files.)
 */

const fs = require('fs');

const CRITICAL = [
  'src/services/money.js',
  'src/services/trust.js',
  'src/services/carbon.js',
  'src/services/matching.js',
];

const summary = JSON.parse(fs.readFileSync('coverage/coverage-summary.json', 'utf8'));

let ok = true;
for (const crit of CRITICAL) {
  const critNorm = crit.replace(/\//g, '\\');
  const match = Object.entries(summary).find(
    ([k]) => k.endsWith(critNorm) || k.endsWith(crit) || k.replace(/\\/g, '/').endsWith(crit)
  );
  if (!match) {
    console.error(`GATE FAIL: no coverage data for ${crit}`);
    ok = false;
    continue;
  }
  const pct = match[1].lines.pct;
  const status = pct >= 80 ? 'OK' : 'FAIL';
  console.log(`${status}: ${crit} — ${pct}% lines (gate: 80%)`);
  if (pct < 80) ok = false;
}
process.exit(ok ? 0 : 1);
