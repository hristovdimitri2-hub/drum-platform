/**
 * P1 — the README Trust Score table must match src/services/trust.js.
 *
 * Before the fix the README advertised `dispute_raised −10`,
 * `dispute_resolved +5` and `kyc_verified +3`. None of those existed in the
 * code (real: kyc_verified +10; both dispute events are no-ops). This test
 * parses the README table and fails if it drifts again — in either direction:
 * a documented rule that is not in RULES, a RULES entry that is not
 * documented, or a mismatched delta.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const trust = require('../src/services/trust');

const README = fs.readFileSync(path.resolve(__dirname, '..', 'README.md'), 'utf8');

/**
 * Parse rows shaped `| `event_name` | +5 | … |`.
 * Accepts U+2212 MINUS SIGN and the ASCII hyphen, and strips a trailing
 * "/мес" style unit so `−1/мес` yields −1.
 */
function parseTrustTable(md) {
  const rows = {};
  const re = /^\|\s*`([a-z0-9_]+)`\s*\|\s*([+\u2212-]?\d+)(?:\/[^\s|]*)?\s*\|/gm;
  let m;
  while ((m = re.exec(md)) !== null) {
    const raw = m[2].replace('\u2212', '-');
    rows[m[1]] = Number(raw);
  }
  return rows;
}

const documented = parseTrustTable(README);

test('P1 README parity: the Trust Score table is parseable', () => {
  assert.ok(
    Object.keys(documented).length >= 10,
    `expected to parse the trust table, got ${JSON.stringify(documented)}`
  );
});

test('P1 README parity: every documented delta equals trust.RULES', () => {
  for (const [event, delta] of Object.entries(documented)) {
    if (trust.NOOP_EVENTS.has(event)) {
      assert.equal(delta, 0, `${event} is a no-op in code → README must say 0`);
      continue;
    }
    if (event === 'inactive_month') {
      // Handled outside RULES (floor at 30), documented as −1 per month.
      assert.equal(delta, -1, 'inactive_month is −1/month in code');
      continue;
    }
    const rule = trust.RULES[event];
    assert.ok(rule, `README documents "${event}" but trust.RULES has no such rule`);
    assert.equal(
      delta,
      rule.delta,
      `README says ${event} ${delta}, trust.RULES says ${rule.delta}`
    );
  }
});

test('P1 README parity: every scored rule in trust.RULES is documented', () => {
  for (const event of Object.keys(trust.RULES)) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(documented, event),
      `trust.RULES defines "${event}" (delta ${trust.RULES[event].delta}) but the README table omits it`
    );
  }
});

test('P1 README parity: the three stale pre-fix values are gone', () => {
  // These were wrong in three different ways; assert the shape of the error is
  // no longer present rather than just the exact string.
  const kycRow = /`kyc_verified`\s*\|\s*([+\u2212-]?\d+)/.exec(README);
  assert.ok(kycRow, 'kyc_verified must be documented');
  assert.notEqual(kycRow[1], '+3', 'kyc_verified is +10 in code, not +3');

  assert.ok(!/`dispute_raised`\s*\|\s*[\u2212-]10/.test(README), 'dispute_raised is not −10');
  assert.ok(!/`dispute_resolved`\s*\|\s*\+5/.test(README), 'dispute_resolved is not +5');
});

test('P1 README parity: the pricing table matches money.splitAmounts', () => {
  const money = require('../src/services/money');

  // The documented numbers must be exactly the canonical split of €12.00.
  const s = money.splitAmounts(money.eurToCents(12));
  assert.equal(money.centsToEur(s.carrierCents).toFixed(2), '9.60');
  assert.equal(money.centsToEur(s.drumCents).toFixed(2), '1.80');
  assert.equal(money.centsToEur(s.insuranceCents).toFixed(2), '0.60');

  const row = /\|\s*София ↔ Пловдив\s*\|[^|]*\|\s*\*\*€12\.00\*\*\s*\|\s*€9\.60\s*\|\s*€1\.80\s*\|\s*€0\.60\s*\|/.exec(
    README
  );
  assert.ok(
    row,
    'README pricing row for Sofia↔Plovdiv must read: base €10.00 | total €12.00 | carrier €9.60 | fee €1.80 | insurance €0.60'
  );
});
