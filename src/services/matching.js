/**
 * Matching v1 (B3) — Master Blueprint §2.3
 *
 * Score = 0.4 × TrustScore + 0.3 × routeProximity
 *       + 0.2 × historicalSuccess + 0.1 × priceAlignment
 *
 * STRICT AGENT MODEL (legal requirement — Uber Spain precedent):
 * This module RANKS and DISPLAYS candidates only. It NEVER assigns,
 * auto-matches or dispatches a carrier. The sender/ops picks from the
 * TOP 5 shown; the carrier still confirms via /accept. Violating this
 * is a legal non-starter — do not "optimize" it away.
 *
 * Auto-escalation (visibility only, still no assignment):
 *   2h without a match → boosted=true (shown prominently in ops feed)
 *   6h without a match → needsOpsAttention=true (human intervention)
 *
 * Neutral defaults (documented, deterministic):
 *   no declared routes            → routeProximity = 50
 *   no carrier history            → historicalSuccess = 50
 *   no price signal               → priceAlignment = 100
 */

const WEIGHTS = {
  trust: 0.4,
  route: 0.3,
  history: 0.2,
  price: 0.1,
};

const ESCALATION = { boostHours: 2, opsHours: 6 };
const TOP_N = 5;

function clampScore(n) {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}

/**
 * Route proximity (deterministic):
 *   exact corridor match          → 100
 *   shares exactly one city       → 50
 *   routes declared, no overlap   → 0
 *   no route data at all          → 50 (neutral)
 */
function routeProximity(carrierRoutes, originCity, destinationCity) {
  const routes = carrierRoutes || [];
  if (!Array.isArray(routes) || routes.length === 0) return { value: 50, kind: 'neutral' };
  for (const r of routes) {
    // exact corridor in EITHER direction (a carrier on Варна→София can carry София→Варна)
    if ((r[0] === originCity && r[1] === destinationCity) ||
        (r[0] === destinationCity && r[1] === originCity)) {
      return { value: 100, kind: 'exact' };
    }
  }
  for (const r of routes) {
    if (r[0] === originCity || r[1] === originCity ||
        r[0] === destinationCity || r[1] === destinationCity) {
      return { value: 50, kind: 'shared_city' };
    }
  }
  return { value: 0, kind: 'no_overlap' };
}

/**
 * Historical success rate as carrier, in percent.
 * @param {number} delivered completed deliveries
 * @param {number} assigned total accepted shipments
 */
function historicalSuccess(delivered, assigned) {
  if (!assigned || assigned <= 0) return { value: 50, kind: 'neutral' };
  return { value: Math.round((delivered / assigned) * 100), kind: 'measured' };
}

/**
 * Price alignment. v1: carriers have no asking price → neutral 100.
 * When carrierAskEur is provided: 100 − |ask − base| / base × 100, clamped.
 */
function priceAlignment(baseEur, carrierAskEur) {
  if (carrierAskEur === undefined || carrierAskEur === null || baseEur <= 0) {
    return { value: 100, kind: 'neutral' };
  }
  const dev = Math.abs(carrierAskEur - baseEur) / baseEur;
  return { value: clampScore(100 - dev * 100), kind: 'measured' };
}

/**
 * Score one carrier against one shipment.
 * @returns {{carrierId, score, components: {trust, route, history, price}}}
 */
function scoreCandidate(carrier, shipment, stats = {}) {
  const route = routeProximity(carrier.routes, shipment.originCity, shipment.destinationCity);
  const history = historicalSuccess(stats.delivered || 0, stats.assigned || 0);
  const price = priceAlignment(shipment.baseEur, stats.carrierAskEur);
  const t = clampScore(carrier.trustScore);

  const score = Math.round(
    WEIGHTS.trust * t +
    WEIGHTS.route * route.value +
    WEIGHTS.history * history.value +
    WEIGHTS.price * price.value
  );

  return {
    carrierId: carrier.id,
    telegramId: carrier.telegramId,
    username: carrier.username,
    firstName: carrier.firstName,
    trustScore: t,
    trustTier: carrier.trustTier,
    score,
    components: {
      trust: t,
      route: route.value,
      routeKind: route.kind,
      history: history.value,
      historyKind: history.kind,
      price: price.value,
      priceKind: price.kind,
    },
  };
}

/**
 * TOP N candidates, sorted by score (desc), deterministic
 * (ties broken by carrierId for reproducibility).
 *
 * @param {object} shipment
 * @param {Array} carriers       — user objects (with routes, trustScore)
 * @param {Function} statsFor    — carrierId => {delivered, assigned, carrierAskEur}
 * @param {number} n
 */
function topCandidates(shipment, carriers, statsFor = () => ({}), n = TOP_N) {
  if (!carriers || carriers.length === 0) return [];
  return carriers
    .map((c) => scoreCandidate(c, shipment, statsFor(c.id) || {}))
    .sort((a, b) => (b.score - a.score) || (a.carrierId < b.carrierId ? -1 : 1))
    .slice(0, n);
}

/**
 * Escalation level for an unmatched shipment (visibility only).
 * @returns {{level: 'none'|'boost'|'ops', hoursElapsed: number, boosted: boolean, needsOpsAttention: boolean}}
 */
function escalation(shipment, nowMs = Date.now()) {
  const created = new Date(shipment.createdAt).getTime();
  const hours = (nowMs - created) / 3600000;
  const level = hours >= ESCALATION.opsHours ? 'ops'
    : hours >= ESCALATION.boostHours ? 'boost' : 'none';
  return {
    level,
    hoursElapsed: Math.round(hours * 10) / 10,
    boosted: level !== 'none',
    needsOpsAttention: level === 'ops',
  };
}

module.exports = {
  WEIGHTS,
  ESCALATION,
  TOP_N,
  routeProximity,
  historicalSuccess,
  priceAlignment,
  scoreCandidate,
  topCandidates,
  escalation,
};
