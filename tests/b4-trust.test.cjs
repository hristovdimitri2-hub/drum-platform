/**
 * B4 tests — Trust Score full rule table (Business Plan Step 2.2).
 * Criterion: EVERY rule + EVERY tier transition is tested.
 * Run: node --test
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drum-b4-'));
process.env.SQLITE_PATH = path.join(tmp, 'test.db');
process.env.DATA_BACKEND = 'sqlite';

const trust = require('../src/services/trust');
const store = require('../src/services/store');

/* ------------------------- Pure rule unit tests --------------------------- */

test('B4: start score is 50 (standard)', () => {
  assert.equal(trust.START_SCORE, 50);
  assert.equal(trust.tierForScore(50), 'standard');
});

test('B4: +5 successful delivery as CARRIER', () => {
  const r = trust.applyEvent(50, 'delivery_success_carrier');
  assert.equal(r.delta, 5); assert.equal(r.score, 55); assert.ok(r.applied);
});

test('B4: carrier +5 daily cap — 2nd same day does not apply', () => {
  const r = trust.applyEvent(55, 'delivery_success_carrier', { todayCount: 1 });
  assert.equal(r.delta, 0); assert.equal(r.applied, false);
  assert.match(r.reason, /daily cap/);
});

test('B4: +3 successful delivery as SENDER', () => {
  const r = trust.applyEvent(50, 'delivery_success_sender');
  assert.equal(r.delta, 3); assert.equal(r.score, 53);
});

test('B4: sender +3 daily cap', () => {
  const r = trust.applyEvent(53, 'delivery_success_sender', { todayCount: 1 });
  assert.equal(r.delta, 0);
});

test('B4: carrier cumulative cap +100 — stops and partially awards', () => {
  const full = trust.applyEvent(50, 'delivery_success_carrier', { earnedFromEvent: 100 });
  assert.equal(full.delta, 0); assert.match(full.reason, /cap \+100/);
  const partial = trust.applyEvent(50, 'delivery_success_carrier', { earnedFromEvent: 97 });
  assert.equal(partial.delta, 3); assert.match(partial.reason, /partial/);
});

test('B4: sender cumulative cap +60 — partial award to exactly 60', () => {
  const r = trust.applyEvent(50, 'delivery_success_sender', { earnedFromEvent: 58 });
  assert.equal(r.delta, 2);
});

test('B4: −15 failed delivery (user fault)', () => {
  const r = trust.applyEvent(50, 'delivery_failed');
  assert.equal(r.delta, -15); assert.equal(r.score, 35); assert.equal(r.tier, 'limited');
});

test('B4: −50 lost dispute', () => {
  const r = trust.applyEvent(70, 'dispute_lost');
  assert.equal(r.delta, -50); assert.equal(r.score, 20); assert.equal(r.tier, 'banned');
});

test('B4: 2 lost disputes in 90 days → BAN (shouldBan)', () => {
  assert.equal(trust.shouldBan(1), false);
  assert.equal(trust.shouldBan(2), true);
  assert.equal(trust.shouldBan(3), true);
});

test('B4: +10 KYC verified', () => {
  const r = trust.applyEvent(50, 'kyc_verified');
  assert.equal(r.delta, 10); assert.equal(r.score, 60);
});

test('B4: +5 phone verified', () => {
  const r = trust.applyEvent(50, 'phone_verified');
  assert.equal(r.delta, 5); assert.equal(r.score, 55);
});

test('B4: +10 referral — requires referrer Score >= 80', () => {
  const rejected = trust.applyEvent(50, 'referral_received', { referrerScore: 79 });
  assert.equal(rejected.delta, 0); assert.match(rejected.reason, /80/);
  const ok = trust.applyEvent(50, 'referral_received', { referrerScore: 80, referralsCount: 0 });
  assert.equal(ok.delta, 10); assert.equal(ok.score, 60);
});

test('B4: referral max 5 — 6th does not apply', () => {
  const r = trust.applyEvent(50, 'referral_received', { referrerScore: 90, referralsCount: 5 });
  assert.equal(r.delta, 0); assert.match(r.reason, /max 5/);
});

test('B4: −10 referral abandonment (<30 days)', () => {
  const r = trust.applyEvent(60, 'referral_abandoned');
  assert.equal(r.delta, -10); assert.equal(r.score, 50);
});

test('B4: +2 reciprocal 5/5 rating — only after >= 3 deliveries', () => {
  const locked = trust.applyEvent(50, 'rating_reciprocal_5', { deliveriesCompleted: 2 });
  assert.equal(locked.delta, 0); assert.match(locked.reason, /3 completed deliveries/);
  const ok = trust.applyEvent(50, 'rating_reciprocal_5', { deliveriesCompleted: 3 });
  assert.equal(ok.delta, 2);
});

test('B4: −5 bad rating (1-2/5)', () => {
  const r = trust.applyEvent(50, 'rating_bad');
  assert.equal(r.delta, -5); assert.equal(r.score, 45); assert.equal(r.tier, 'limited');
});

test('B4: −1/month inactivity with floor at 30', () => {
  const r3 = trust.applyEvent(50, 'inactive_month', { monthsInactive: 3 });
  assert.equal(r3.score, 47);
  const atFloor = trust.applyEvent(31, 'inactive_month', { monthsInactive: 5 });
  assert.equal(atFloor.score, 30);
  assert.equal(atFloor.tier, 'banned'); // 30 < 31 — spec: inactivity floor is 30, tier table says banned
  const neverBelow = trust.applyEvent(30, 'inactive_month', { monthsInactive: 12 });
  assert.equal(neverBelow.score, 30); assert.equal(neverBelow.delta, 0);
  const belowStays = trust.applyEvent(10, 'inactive_month', { monthsInactive: 12 });
  assert.equal(belowStays.score, 10); assert.equal(belowStays.delta, 0);
});

test('B4: −25 off-platform / spam detection', () => {
  const r = trust.applyEvent(60, 'off_platform');
  assert.equal(r.delta, -25); assert.equal(r.score, 35); assert.equal(r.tier, 'limited');
});

/* ----------------------- Tier transition matrix --------------------------- */

test('B4: tier transitions — every boundary', () => {
  // banned < 31
  assert.equal(trust.tierForScore(0), 'banned');
  assert.equal(trust.tierForScore(30), 'banned');
  assert.equal(trust.tierForScore(31), 'limited');   // 30 -> 31 = banned -> limited
  assert.equal(trust.tierForScore(49), 'limited');
  assert.equal(trust.tierForScore(50), 'standard');  // 49 -> 50 = limited -> standard
  assert.equal(trust.tierForScore(69), 'standard');
  assert.equal(trust.tierForScore(70), 'verified');  // 69 -> 70 = standard -> verified
  assert.equal(trust.tierForScore(89), 'verified');
  assert.equal(trust.tierForScore(90), 'premium');   // 89 -> 90 = verified -> premium
  assert.equal(trust.tierForScore(100), 'premium');
  // downward transitions
  assert.equal(trust.tierForScore(90 - 1), 'verified');
  assert.equal(trust.tierForScore(70 - 1), 'standard');
  assert.equal(trust.tierForScore(50 - 1), 'limited');
  assert.equal(trust.tierForScore(31 - 1), 'banned');
});

test('B4: clamp at 0 and 100', () => {
  const up = trust.applyEvent(99, 'kyc_verified');           // +10 -> capped 100
  assert.equal(up.score, 100);
  const down = trust.applyEvent(10, 'dispute_lost');         // -50 -> floor 0
  assert.equal(down.score, 0);
});

test('B4: tier limits — parcel caps and rate limits', () => {
  const l = trust.limitsForScore(20);
  assert.equal(l.tier, 'banned'); assert.equal(l.maxParcelEur, 0); assert.equal(l.rate.max, 0);
  const lim = trust.limitsForScore(35);
  assert.equal(lim.tier, 'limited'); assert.equal(lim.maxParcelEur, 20);
  assert.deepEqual(lim.rate, { max: 1, per: 'week' });
  const std = trust.limitsForScore(55);
  assert.equal(std.tier, 'standard'); assert.equal(std.maxParcelEur, 200);
  assert.deepEqual(std.rate, { max: 10, per: 'month' });
  const ver = trust.limitsForScore(75);
  assert.equal(ver.tier, 'verified'); assert.equal(ver.maxParcelEur, 500);
  assert.ok(ver.perks.includes('premium_corridors'));
  const prem = trust.limitsForScore(95);
  assert.equal(prem.tier, 'premium'); assert.equal(prem.maxParcelEur, 1000);
  assert.ok(prem.perks.includes('b2b_api'));
});

/* ------------------- Integration: SQLite + dispute ban -------------------- */

async function freshUser() {
  const u = await store.findOrCreateUser({ telegramId: Math.floor(800000 + Math.random() * 100000), firstName: 'B4' });
  return u;
}

test('B4: sqlite updateTrustScore applies +5 and records history', async () => {
  const u = await freshUser();
  const s = await store.createShipment({
    senderTelegramId: u.telegramId, originCity: 'София', destinationCity: 'Пловдив',
    status: 'delivered',
  });
  await store.updateShipment(s.id, { carrierId: u.id, status: 'delivered' });
  const r = await store.updateTrustScore(u.id, 'delivery_success_carrier');
  assert.equal(r.delta, 5); assert.equal(r.score, 55); assert.equal(r.tier, 'standard');
  const h = await store.listTrustHistory(u.id);
  assert.equal(h.length, 1);
  assert.equal(h[0].scoreAfter, 55); assert.equal(h[0].tierAfter, 'standard');
});

test('B4: sqlite daily cap enforced from DB history', async () => {
  const u = await freshUser();
  await store.updateTrustScore(u.id, 'delivery_success_carrier');   // +5
  const second = await store.updateTrustScore(u.id, 'delivery_success_carrier');
  assert.equal(second.delta, 0); assert.equal(second.applied, false);
});

test('B4: 2 lost disputes in 90 days -> automatic BAN in DB', async () => {
  const u = await freshUser();
  await store.updateUser(u.telegramId, { trustScore: 90 }); // start high
  const s1 = await store.createShipment({ senderTelegramId: u.telegramId, originCity: 'София', destinationCity: 'Варна', status: 'delivered' });
  const d1 = await store.createDispute({ shipmentId: s1.id, openedBy: u.id, reason: 'lost 1' });
  await store.updateDisputeStatus(d1.id, 'lost');
  const r1 = await store.updateTrustScore(u.id, 'dispute_lost');
  assert.equal(r1.banned, false); assert.equal(r1.score, 40);

  const s2 = await store.createShipment({ senderTelegramId: u.telegramId, originCity: 'София', destinationCity: 'Варна', status: 'delivered' });
  const d2 = await store.createDispute({ shipmentId: s2.id, openedBy: u.id, reason: 'lost 2' });
  await store.updateDisputeStatus(d2.id, 'lost');
  const r2 = await store.updateTrustScore(u.id, 'dispute_lost');
  assert.equal(r2.banned, true); assert.equal(r2.score, 0); assert.equal(r2.tier, 'banned');

  // user row is actually banned
  const row = await store.findUserByTelegramId(u.telegramId);
  assert.equal(row.trustScore, 0); assert.equal(row.trustTier, 'banned');
});

test('B4: unknown event does not change score', async () => {
  const r = trust.applyEvent(50, 'nonexistent_event');
  assert.equal(r.delta, 0); assert.equal(r.applied, false);
});
