/**
 * Trust Score service — v2 (B4: full rule table, Business Plan Step 2.2)
 *
 * Start: 50.
 *
 * | Event                     | Delta | Caps / conditions                        |
 * |---------------------------|-------|------------------------------------------|
 * | delivery_success_carrier  | +5    | max 1/day, cumulative cap +100           |
 * | delivery_success_sender   | +3    | max 1/day, cumulative cap +60            |
 * | delivery_failed (fault)   | −15   |                                          |
 * | dispute_lost              | −50   | 2× lost in 90 days → BAN                 |
 * | kyc_verified              | +10   |                                          |
 * | phone_verified            | +5    |                                          |
 * | referral_received         | +10   | referrer Score ≥ 80, max 5 referrals     |
 * | referral_abandoned        | −10   | referred user abandons < 30 days         |
 * | rating_reciprocal_5       | +2    | only after min 3 completed deliveries    |
 * | rating_bad (1–2/5+reason) | −5    |                                          |
 * | inactive_month            | −1/mo | floor at 30 (inactivity never bans)      |
 * | off_platform / spam       | −25   |                                          |
 *
 * Tiers: <31 Banned (output only) / 31–49 Limited (≤€20, 1/week) /
 * 50–69 Standard (≤€200, 10/month) / 70–89 Verified (≤€500, premium
 * corridors) / 90–100 Premium (≤€1000, B2B API access).
 *
 * STRICT AGENT MODEL: tiers only LIMIT actions — they never auto-assign
 * carriers (legal requirement).
 */

const SCORE_MIN = 0;
const SCORE_MAX = 100;
const START_SCORE = 50;

const TIER_LIMITS = [
  { min: 90, tier: 'premium', maxParcelEur: 1000, rate: null, perks: ['premium_corridors', 'b2b_api'] },
  { min: 70, tier: 'verified', maxParcelEur: 500, rate: null, perks: ['premium_corridors'] },
  { min: 50, tier: 'standard', maxParcelEur: 200, rate: { max: 10, per: 'month' }, perks: [] },
  { min: 31, tier: 'limited', maxParcelEur: 20, rate: { max: 1, per: 'week' }, perks: [] },
  { min: 0, tier: 'banned', maxParcelEur: 0, rate: { max: 0, per: 'never' }, perks: [] },
];

const RULES = {
  delivery_success_carrier: { delta: 5, dailyMax: 1, totalCap: 100 },
  delivery_success_sender: { delta: 3, dailyMax: 1, totalCap: 60 },
  delivery_failed: { delta: -15 },
  dispute_lost: { delta: -50 },
  kyc_verified: { delta: 10 },
  phone_verified: { delta: 5 },
  referral_received: {
    delta: 10,
    requires: (ctx) => (ctx.referrerScore || 0) >= 80,
    requiresReason: 'referrer Score must be >= 80',
    maxCount: 5,
    maxCountField: 'referralsCount',
    maxCountReason: 'max 5 referrals',
  },
  referral_abandoned: { delta: -10 },
  rating_reciprocal_5: {
    delta: 2,
    requires: (ctx) => (ctx.deliveriesCompleted || 0) >= 3,
    requiresReason: 'requires >= 3 completed deliveries',
  },
  rating_bad: { delta: -5 },
  off_platform: { delta: -25 },
};

const BAN_RULES = { disputeLostCount: 2, withinDays: 90 };

function clampScore(score) {
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, Math.round(Number(score) || 0)));
}

function tierForScore(score) {
  const s = clampScore(score);
  return TIER_LIMITS.find((t) => s >= t.min).tier;
}

function limitsForScore(score) {
  const s = clampScore(score);
  return TIER_LIMITS.find((t) => s >= t.min);
}

function maxParcelEurForScore(score) {
  return limitsForScore(score).maxParcelEur;
}

function shouldBan(lostDisputesInWindow) {
  return (lostDisputesInWindow || 0) >= BAN_RULES.disputeLostCount;
}

/**
 * Apply a trust event (pure function).
 * @param {number} currentScore
 * @param {string} eventType
 * @param {object} [ctx] DB-derived context:
 *   todayCount      — positive events of this type already today (frequency cap)
 *   earnedFromEvent — cumulative delta earned from this event type (total caps)
 *   deliveriesCompleted — completed deliveries as carrier (for rating rule)
 *   monthsInactive  — months of inactivity (for inactive_month)
 *   referrerScore   — referrer's score (referral rule)
 *   referralsCount  — successful referrals so far (max 5)
 * @returns {{score, tier, delta, applied, reason}}
 */
function applyEvent(currentScore, eventType, ctx = {}) {
  const current = clampScore(currentScore);

  // Inactivity: -1 per month, floor at 30 (never bans)
  if (eventType === 'inactive_month') {
    const months = Math.max(0, Number(ctx.monthsInactive) || 0);
    let delta = -1 * months;
    const floorScore = Math.max(current + delta, Math.min(30, current));
    delta = floorScore - current;
    const score = clampScore(floorScore);
    return {
      score, tier: tierForScore(score), delta,
      applied: delta !== 0,
      reason: delta === 0 ? 'inactive floor (min 30) reached' : null,
    };
  }

  const rule = RULES[eventType];
  if (!rule) {
    return { score: current, tier: tierForScore(current), delta: 0,
      applied: false, reason: `unknown event: ${eventType}` };
  }

  let delta = rule.delta;
  let reason = null;

  // Conditional rules (referral / reciprocal rating)
  if (rule.requires && !rule.requires(ctx)) {
    return { score: current, tier: tierForScore(current), delta: 0,
      applied: false, reason: rule.requiresReason };
  }
  if (rule.maxCount && (ctx[rule.maxCountField] || 0) >= rule.maxCount) {
    return { score: current, tier: tierForScore(current), delta: 0,
      applied: false, reason: rule.maxCountReason };
  }

  // Frequency cap (per day)
  if (rule.dailyMax && (ctx.todayCount || 0) >= rule.dailyMax) {
    return { score: current, tier: tierForScore(current), delta: 0,
      applied: false, reason: 'daily cap reached (1/day)' };
  }

  // Cumulative cap (+100 / +60 lifetime from this event type)
  if (rule.totalCap !== undefined) {
    const earned = ctx.earnedFromEvent || 0;
    if (earned >= rule.totalCap) {
      return { score: current, tier: tierForScore(current), delta: 0,
        applied: false, reason: `cumulative cap +${rule.totalCap} reached` };
    }
    if (earned + delta > rule.totalCap) {
      delta = rule.totalCap - earned;
      reason = `capped at +${rule.totalCap} (partial award)`;
    }
  }

  const score = clampScore(current + delta);
  return { score, tier: tierForScore(score), delta: score - current,
    applied: delta !== 0, reason };
}

/** Legacy alias map (v1 event names). Prefer the explicit names above. */
const LEGACY_ALIASES = {
  delivery_success: 'delivery_success_carrier',
  delivery_failed: 'delivery_failed',
  dispute_raised: null,        // no score change on raise (only on loss)
  dispute_resolved: null,      // use dispute_lost / won flow
  kyc_verified: 'kyc_verified',
};

function normalizeEventType(eventType) {
  return LEGACY_ALIASES[eventType] === undefined ? eventType : LEGACY_ALIASES[eventType];
}

module.exports = {
  SCORE_MIN, SCORE_MAX, START_SCORE,
  TIER_LIMITS,
  RULES,
  BAN_RULES,
  clampScore,
  tierForScore,
  limitsForScore,
  maxParcelEurForScore,
  shouldBan,
  applyEvent,
  normalizeEventType,
};
