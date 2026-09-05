/**
 * Trust Score service
 *
 * Score: 0-100. Tier thresholds (documented in README):
 *   0-30    banned    — output only, no shipments
 *   31-49   limited   — parcels up to €20
 *   50-69   standard  — parcels up to €200
 *   70-89   verified  — parcels up to €500
 *   90-100  premium   — parcels up to €1 000, B2B API
 *
 * Sanctions/bonuses (event-sourced, ebay/reputation-system pattern):
 *   delivery_success    +5     delivery_failed     -15
 *   dispute_resolved    +5     dispute_raised      -10
 *   kyc_verified        +3     cancel_before_pickup -5
 * New users start at 50 (standard).
 *
 * NOTE (technological neutrality / Strict Agent Model): trust tiers only
 * LIMIT what a user may do — they never auto-assign a carrier. The user
 * always chooses (see /accept). This is a legal requirement.
 */

const TIER_THRESHOLDS = [
  { min: 90, tier: 'premium', maxParcelEur: 1000 },
  { min: 70, tier: 'verified', maxParcelEur: 500 },
  { min: 50, tier: 'standard', maxParcelEur: 200 },
  { min: 31, tier: 'limited', maxParcelEur: 20 },
  { min: 0, tier: 'banned', maxParcelEur: 0 },
];

const TRUST_DELTAS = {
  delivery_success: +5,
  delivery_failed: -15,
  dispute_resolved: +5,
  dispute_raised: -10,
  kyc_verified: +3,
  cancel_before_pickup: -5,
};

function tierForScore(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  return TIER_THRESHOLDS.find((t) => s >= t.min).tier;
}

function maxParcelEurForScore(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  return TIER_THRESHOLDS.find((t) => s >= t.min).maxParcelEur;
}

function clampScore(score) {
  return Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
}

/**
 * Compute new score after a trust event.
 * @returns {{score: number, tier: string, delta: number}}
 */
function applyEvent(currentScore, eventType) {
  const delta = TRUST_DELTAS[eventType] ?? 0;
  const score = clampScore(currentScore + delta);
  return { score, tier: tierForScore(score), delta };
}

module.exports = {
  TIER_THRESHOLDS,
  TRUST_DELTAS,
  tierForScore,
  maxParcelEurForScore,
  clampScore,
  applyEvent,
};
