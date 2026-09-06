/**
 * B9 — Ops/KPI engine. Pure functions over arrays (store-agnostic),
 * so the /dashboard/ops route and tests share the exact same math.
 *
 * Kill-switch metrics (Master Blueprint / kill switches):
 *   match rate, avg time to match, repeat rate 30d, dispute rate,
 *   lost parcel rate, NPS, active users (30d).
 *
 * HONEST gaps: NPS needs a survey module (not built) → null;
 * lost parcel rate needs a dedicated field → derived from lost DISPUTES
 * as proxy, labeled as proxy.
 */

const DAY = 86400000;

function isDelivered(s) { return s.status === 'delivered'; }
function isMatched(s) { return !!s.carrierId && s.status !== 'requested' && s.status !== 'cancelled'; }

/**
 * @param {{users:[], shipments:[], disputes:[], nowMs?:number}} input
 */
function computeKpis({ users = [], shipments = [], disputes = [], nowMs = Date.now() }) {
  const total = shipments.length;
  const delivered = shipments.filter(isDelivered);
  const matched = shipments.filter(isMatched);
  const requested = shipments.filter((s) => s.status === 'requested');

  // match rate: share of shipments that ever got a carrier
  const matchRatePct = total ? round1((matched.length / total) * 100) : null;

  // avg time to match (hours) for matched shipments
  const times = matched
    .filter((s) => s.matchedAt && s.createdAt)
    .map((s) => (new Date(s.matchedAt) - new Date(s.createdAt)) / 3600000);
  const avgTimeToMatchHours = times.length
    ? round1(times.reduce((a, b) => a + b, 0) / times.length)
    : null;

  // active users: any shipment activity in the last 30 days
  const cutoff = nowMs - 30 * DAY;
  const activeIds = new Set(
    shipments
      .filter((s) => new Date(s.createdAt).getTime() >= cutoff)
      .flatMap((s) => [s.senderId, s.carrierId].filter(Boolean))
  );
  const activeUsers30d = activeIds.size;

  // repeat rate 30d: senders with >=2 deliveries in 30d / senders with >=1 delivery in 30d
  const recentDelivered = delivered.filter(
    (s) => s.deliveryScannedAt && new Date(s.deliveryScannedAt).getTime() >= nowMs - 30 * DAY
  );
  const perSender = {};
  for (const s of recentDelivered) {
    if (!s.senderId) continue;
    perSender[s.senderId] = (perSender[s.senderId] || 0) + 1;
  }
  const senders1 = Object.values(perSender).filter((n) => n >= 1).length;
  const senders2 = Object.values(perSender).filter((n) => n >= 2).length;
  const repeatRate30dPct = senders1 ? round1((senders2 / senders1) * 100) : null;

  // dispute rate: disputes / shipments
  const disputeRatePct = total ? round1((disputes.length / total) * 100) : null;

  // lost parcel rate — PROXY: lost disputes over delivered+lost disputes
  const lost = disputes.filter((d) => d.status === 'lost').length;
  const lostParcelRatePct =
    delivered.length + lost > 0
      ? round1((lost / (delivered.length + lost)) * 100)
      : null;

  return {
    generatedAt: new Date(nowMs).toISOString(),
    totalUsers: users.length,
    activeUsers30d,
    totalShipments: total,
    requested: requested.length,
    delivered: delivered.length,
    matchRatePct,                 // kill switch: <50% at day 60 → pivot
    avgTimeToMatchHours,          // ops escalation metric
    repeatRate30dPct,             // B2B driver
    disputeRatePct,
    lostParcelRatePct,            // PROXY from lost disputes (labeled)
    nps: null,                    // UNMODELED — survey module not built (honest)
    npsNote: 'n/a — survey module not built yet',
  };
}

function round1(n) { return Math.round(n * 10) / 10; }

module.exports = { computeKpis, DAY };
