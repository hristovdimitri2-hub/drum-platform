/**
 * P2 — normalizeEventType() must never return null, and the v1 dispute events
 * must be explicit no-ops.
 *
 * Before the fix, LEGACY_ALIASES mapped `dispute_raised` and
 * `dispute_resolved` to `null`, so normalizeEventType() returned null. Feeding
 * that into applyEvent() produced the misleading reason "unknown event: null",
 * and a null event name could reach persistence.
 */

const test = require('node:test');
const assert = require('node:assert');

const trust = require('../src/services/trust');

test('P2 trust: normalizeEventType never returns null/undefined', () => {
  const inputs = [
    'delivery_success',
    'dispute_raised',
    'dispute_resolved',
    'kyc_verified',
    'delivery_success_carrier',
    'totally_made_up_event',
    '',
    null,
    undefined,
  ];
  for (const i of inputs) {
    const out = trust.normalizeEventType(i);
    assert.equal(typeof out, 'string', `normalizeEventType(${JSON.stringify(i)}) must be a string`);
    assert.notEqual(out, null);
    assert.notEqual(out, undefined);
  }
});

test('P2 trust: legacy aliases still map to the canonical names', () => {
  assert.equal(trust.normalizeEventType('delivery_success'), 'delivery_success_carrier');
  assert.equal(trust.normalizeEventType('kyc_verified'), 'kyc_verified');
  // Canonical names pass through untouched.
  assert.equal(trust.normalizeEventType('dispute_lost'), 'dispute_lost');
  assert.equal(trust.normalizeEventType('off_platform'), 'off_platform');
});

test('P2 trust: dispute_raised / dispute_resolved are no-ops, not "unknown event"', () => {
  for (const ev of ['dispute_raised', 'dispute_resolved']) {
    assert.equal(trust.normalizeEventType(ev), ev, `${ev} normalises to itself`);
    assert.ok(trust.NOOP_EVENTS.has(ev), `${ev} must be a declared no-op`);

    const r = trust.applyEvent(50, ev, {});
    assert.equal(r.score, 50, `${ev} must not move the score`);
    assert.equal(r.delta, 0);
    assert.equal(r.applied, false);
    assert.match(r.reason, /does not change the score/);
    assert.doesNotMatch(r.reason, /unknown event/);
  }
});

test('P2 trust: a genuinely unknown event still reports "unknown event"', () => {
  const r = trust.applyEvent(50, 'not_a_real_event', {});
  assert.equal(r.score, 50);
  assert.equal(r.applied, false);
  assert.match(r.reason, /unknown event: not_a_real_event/);
});

test('P2 trust: clamp boundaries hold for extreme and malformed scores', () => {
  // clampScore is the single clamp used by every public entry point.
  assert.equal(trust.clampScore(-999), 0);
  assert.equal(trust.clampScore(0), 0);
  assert.equal(trust.clampScore(100), 100);
  assert.equal(trust.clampScore(999), 100);
  assert.equal(trust.clampScore(49.6), 50); // rounds
  assert.equal(trust.clampScore('80'), 80); // numeric string
  assert.equal(trust.clampScore(NaN), 0); // malformed → floor
  assert.equal(trust.clampScore(undefined), 0);
  assert.equal(trust.clampScore(null), 0);

  // applyEvent must never escape the [0,100] band, even with a huge ctx.
  const up = trust.applyEvent(99, 'kyc_verified', {});
  assert.equal(up.score, 100);
  const down = trust.applyEvent(10, 'dispute_lost', {});
  assert.equal(down.score, 0);
});

test('P2 trust: tier thresholds match the documented bands (31/50/70/90)', () => {
  const cases = [
    [0, 'banned'], [30, 'banned'], [31, 'limited'], [49, 'limited'],
    [50, 'standard'], [69, 'standard'], [70, 'verified'], [89, 'verified'],
    [90, 'premium'], [100, 'premium'],
  ];
  for (const [score, tier] of cases) {
    assert.equal(trust.tierForScore(score), tier, `score ${score} → ${tier}`);
  }
});

test('P2 trust: cumulative caps award only the remaining delta', () => {
  // delivery_success_carrier totals cap at +100; 98 earned → only +2 awarded.
  const r = trust.applyEvent(50, 'delivery_success_carrier', { earnedFromEvent: 98 });
  assert.equal(r.delta, 2);
  assert.match(r.reason, /capped at \+100/);

  // Fully capped → no award at all.
  const capped = trust.applyEvent(50, 'delivery_success_carrier', { earnedFromEvent: 100 });
  assert.equal(capped.delta, 0);
  assert.match(capped.reason, /cumulative cap/);
});

test('P2 trust: daily frequency cap blocks the second event of the day', () => {
  const first = trust.applyEvent(50, 'delivery_success_carrier', { todayCount: 0 });
  assert.equal(first.delta, 5);
  const second = trust.applyEvent(50, 'delivery_success_carrier', { todayCount: 1 });
  assert.equal(second.delta, 0);
  assert.match(second.reason, /daily cap/);
});

test('P2 trust: inactivity never bans (floor at 30)', () => {
  const r = trust.applyEvent(45, 'inactive_month', { monthsInactive: 100 });
  assert.equal(r.score, 30);
  const atFloor = trust.applyEvent(30, 'inactive_month', { monthsInactive: 5 });
  assert.equal(atFloor.score, 30);
  assert.equal(atFloor.applied, false);
  // Below the floor the score is untouched — inactivity cannot ban a user.
  const belowFloor = trust.applyEvent(20, 'inactive_month', { monthsInactive: 5 });
  assert.equal(belowFloor.score, 20);
});
