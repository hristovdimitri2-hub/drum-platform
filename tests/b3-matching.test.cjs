/**
 * B3 tests — Matching v1 (Master Blueprint §2.2).
 * Criterion: deterministic unit tests; weights; TOP 5; escalation;
 * and proof of NO auto-assignment (Strict Agent Model).
 */

const test = require('node:test');
const assert = require('node:assert');
const matching = require('../src/services/matching');

const S = { id: 'shp-1', originCity: 'София', destinationCity: 'Пловдив', baseEur: 10, createdAt: new Date().toISOString() };

test('B3: weights sum to exactly 1.0 (floating-point tolerance)', () => {
  const sum = matching.WEIGHTS.trust + matching.WEIGHTS.route +
    matching.WEIGHTS.history + matching.WEIGHTS.price;
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum ${sum} !== 1`);
});

test('B3: routeProximity — exact / shared city / no overlap / neutral', () => {
  const routes = [['София', 'Пловдив'], ['Варна', 'София']];
  assert.equal(matching.routeProximity(routes, 'София', 'Пловдив').value, 100);
  assert.equal(matching.routeProximity(routes, 'София', 'Варна').value, 100);
  const shared = matching.routeProximity(routes, 'София', 'Бургас');   // shares София only
  assert.equal(shared.value, 50);
  assert.equal(matching.routeProximity(routes, 'Русе', 'Видин').value, 0);
  assert.equal(matching.routeProximity([], 'София', 'Пловдив').value, 50);
  assert.equal(matching.routeProximity(null, 'София', 'Пловдив').value, 50);
});

test('B3: historicalSuccess — measured and neutral', () => {
  assert.equal(matching.historicalSuccess(9, 10).value, 90);
  assert.equal(matching.historicalSuccess(0, 0).value, 50);
  assert.equal(matching.historicalSuccess(3, 4).value, 75);
});

test('B3: priceAlignment — neutral without ask, clamped with ask', () => {
  assert.equal(matching.priceAlignment(10, undefined).value, 100);
  assert.equal(matching.priceAlignment(10, 10).value, 100);
  assert.equal(matching.priceAlignment(10, 5).value, 50);
  assert.equal(matching.priceAlignment(10, 0).value, 0);
  assert.equal(matching.priceAlignment(10, 20).value, 0);
});

test('B3: score formula — hand-computed example', () => {
  const carrier = { id: 'c1', trustScore: 80, routes: [['София', 'Пловдив']] };
  const stats = { delivered: 8, assigned: 10 };  // history 80; price neutral 100
  // 0.4*80 + 0.3*100 + 0.2*80 + 0.1*100 = 32 + 30 + 16 + 10 = 88
  const r = matching.scoreCandidate(carrier, S, stats);
  assert.equal(r.score, 88);
});

test('B3: higher trust wins at equal route/history', () => {
  const strong = matching.scoreCandidate(
    { id: 'a', trustScore: 90, routes: [['София', 'Пловдив']] }, S,
    { delivered: 10, assigned: 10 });
  const weak = matching.scoreCandidate(
    { id: 'b', trustScore: 40, routes: [['София', 'Пловдив']] }, S,
    { delivered: 10, assigned: 10 });
  assert.ok(strong.score > weak.score);
});

test('B3: TOP 5 — sorted desc, deterministic on ties, max 5 returned', () => {
  const carriers = [];
  for (let i = 1; i <= 8; i++) {
    carriers.push({ id: `c-${String(i).padStart(2, '0')}`, trustScore: 50, routes: [] });
  }
  const top = matching.topCandidates(S, carriers, () => ({}));
  assert.equal(top.length, 5);                       // capped at 5
  for (let i = 1; i < top.length; i++) {
    assert.ok(top[i - 1].score >= top[i].score);     // descending
    if (top[i - 1].score === top[i].score) {
      assert.ok(top[i - 1].carrierId < top[i].carrierId); // deterministic tie-break
    }
  }
  assert.deepEqual(
    top.map((t) => t.carrierId),
    [...top.map((t) => t.carrierId)].sort(),         // all neutral → tie-break order
  );
});

test('B3: empty carrier list → empty candidates (no crash, no assignment)', () => {
  assert.deepEqual(matching.topCandidates(S, []), []);
});

test('B3: escalation — none < 2h, boost >= 2h, ops >= 6h', () => {
  const now = Date.now();
  const fresh = { ...S, createdAt: new Date(now - 1 * 3600000).toISOString() };
  const stale = { ...S, createdAt: new Date(now - 3 * 3600000).toISOString() };
  const critical = { ...S, createdAt: new Date(now - 7 * 3600000).toISOString() };
  assert.equal(matching.escalation(fresh, now).level, 'none');
  assert.equal(matching.escalation(stale, now).level, 'boost');
  assert.equal(matching.escalation(critical, now).level, 'ops');
  assert.equal(matching.escalation(critical, now).needsOpsAttention, true);
  assert.equal(matching.escalation(critical, now).boosted, true);
});

test('B3: STRICT AGENT MODEL — API surface has no assign/dispatch function', () => {
  const forbidden = ['assign', 'assignCarrier', 'dispatch', 'autoMatch',
    'autoAssign', 'matchShipment', 'book', 'commit'];
  for (const key of Object.keys(matching)) {
    for (const f of forbidden) {
      assert.ok(!key.toLowerCase().includes(f), `forbidden function name: ${key}`);
    }
  }
  // topCandidates returns RANKS, never mutates shipment or marks carrier
  const shipment = { ...S };
  const carriers = [{ id: 'c1', trustScore: 90, routes: [['София', 'Пловдив']] }];
  const before = JSON.stringify(shipment);
  matching.topCandidates(shipment, carriers);
  assert.equal(JSON.stringify(shipment), before, 'shipment unchanged');
});
