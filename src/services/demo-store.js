/**
 * Demo Store — in-memory data layer, same interface as services/airtable.js
 *
 * Used when DEMO_MODE=true (investor demo without external credentials).
 * - Persists to data/demo-state.json (gitignored) so the demo survives restarts
 * - Every created record is clearly marked  isDemo: true / '[DEMO]' prefix
 * - GDPR: demo mode stores only Telegram IDs and first names, no phones
 *
 * IMPORTANT: demo data simulates transactions for demonstration only.
 * It is NEVER presented as real traction (see ARCHITECTURE.md).
 */

const fs = require('fs');
const path = require('path');
const trust = require('./trust');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'demo-state.json');

const state = {
  users: {},       // id -> user object (id: 'demo-usr-1')
  shipments: {},   // id -> shipment object (id: 'demo-shp-1')
  trustEvents: [],
  carbonEntries: [],
  counters: { user: 0, shipment: 0 },
};

let dirty = false;

function persist() {
  dirty = true;
}

function flush() {
  if (!dirty) return;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    dirty = false;
  } catch (err) {
    console.error('Demo store persist error:', err.message);
  }
}

function load() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const loaded = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (loaded && loaded.users && loaded.shipments) {
        Object.assign(state, loaded);
      }
    }
  } catch (err) {
    console.error('Demo store load error (starting fresh):', err.message);
  }
}
load();

function nextId(prefix) {
  state.counters[prefix] = (state.counters[prefix] || 0) + 1;
  return `demo-${prefix}-${String(state.counters[prefix]).padStart(4, '0')}`;
}

/* ---------------------------------- Users --------------------------------- */

async function findOrCreateUser({ telegramId, firstName, lastName, username, language }) {
  let user = Object.values(state.users).find((u) => String(u.telegramId) === String(telegramId));
  if (user) return { ...user };

  user = {
    id: nextId('usr'),
    telegramId: Number(telegramId),
    firstName: firstName || null,
    lastName: lastName || null,
    username: username || null,
    phone: null, // GDPR: demo mode does not store real phone numbers
    language: language || 'bg',
    kycStatus: 'pending',
    stripeCustomerId: null,
    stripeConnectAccountId: null,
    trustScore: 50,
    trustTier: 'standard',
    isDemo: true,
    createdAt: new Date().toISOString(),
  };
  state.users[user.id] = user;
  persist();
  return { ...user };
}

async function findUserByTelegramId(telegramId) {
  const user = Object.values(state.users).find(
    (u) => String(u.telegramId) === String(telegramId)
  );
  return user ? { ...user } : null;
}

async function updateUser(telegramId, fields) {
  const user = Object.values(state.users).find(
    (u) => String(u.telegramId) === String(telegramId)
  );
  if (!user) throw new Error('User not found');

  if (fields.phone) user.phone = '(demo — GDPR minimized)';
  if (fields.kycStatus) user.kycStatus = fields.kycStatus;
  if (fields.stripeCustomerId) user.stripeCustomerId = fields.stripeCustomerId;
  if (fields.stripeConnectAccountId) user.stripeConnectAccountId = fields.stripeConnectAccountId;
  if (fields.trustScore !== undefined) {
    user.trustScore = trust.clampScore(fields.trustScore);
    user.trustTier = trust.tierForScore(user.trustScore);
  }
  if (fields.trustTier) user.trustTier = fields.trustTier;
  persist();
  return { ...user };
}

/**
 * Update trust score by trust EVENT type (not a raw delta).
 * Uses the shared trust service so thresholds stay consistent everywhere.
 */
async function updateTrustScore(userId, eventType) {
  const user = state.users[userId];
  if (!user) throw new Error('User not found');

  const result = trust.applyEvent(user.trustScore, eventType);
  user.trustScore = result.score;
  user.trustTier = result.tier;
  persist();

  await logTrustEvent({
    userId,
    eventType,
    eventValue: result.delta,
    shipmentId: null,
    metadata: { newScore: result.score, newTier: result.tier },
  });

  return { ...result };
}

/* -------------------------------- Shipments ------------------------------- */

async function createShipment(data) {
  const id = nextId('shp');
  const shipment = {
    id,
    senderId: data.senderId,
    senderTelegramId: data.senderTelegramId,
    carrierId: null,
    carrierTelegramId: null,
    carrierStripeAccountId: null,
    originCity: data.originCity,
    destinationCity: data.destinationCity,
    description: data.description,
    parcelValueEur: data.parcelValueEur,
    deadline: data.deadline,
    totalEur: data.totalEur,
    baseEur: data.baseEur,
    feeEur: data.feeEur,
    insuranceEur: data.insuranceEur,
    stripePaymentIntentId: data.stripePaymentIntentId,
    stripeTransferId: null,
    pickupQrCode: null,
    deliveryQrCode: null,
    status: data.status || 'requested',
    isDemo: true, // every demo shipment is clearly marked
    matchedAt: null,
    pickupScannedAt: null,
    deliveryScannedAt: null,
    createdAt: new Date().toISOString(),
  };
  state.shipments[id] = shipment;
  persist();
  return { ...shipment };
}

async function getShipment(shipmentId) {
  const s = state.shipments[shipmentId];
  return s ? { ...s } : null;
}

async function updateShipment(shipmentId, fields) {
  const s = state.shipments[shipmentId];
  if (!s) throw new Error('Shipment not found');
  Object.assign(s, fields);
  persist();
  return { ...s };
}

async function listShipmentsByUser(telegramId) {
  return Object.values(state.shipments)
    .filter(
      (s) =>
        String(s.senderTelegramId) === String(telegramId) ||
        String(s.carrierTelegramId) === String(telegramId)
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((s) => ({ ...s }));
}

async function listPendingShipments() {
  return Object.values(state.shipments)
    .filter((s) => s.status === 'requested')
    .sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1))
    .map((s) => ({ ...s }));
}

async function listAllShipments() {
  return Object.values(state.shipments)
    .sort((a, b) => (a.createdAt > b.createdAt ? 1 : -1))
    .map((s) => ({ ...s }));
}

/* ------------------------------- Trust events ------------------------------ */

async function logTrustEvent({ userId, eventType, eventValue, shipmentId, metadata }) {
  const event = {
    id: `demo-trust-${state.trustEvents.length + 1}`,
    userId,
    eventType,
    eventValue: eventValue ?? 0,
    shipmentId: shipmentId || null,
    metadata: JSON.stringify(metadata || {}),
    isDemo: true,
    createdAt: new Date().toISOString(),
  };
  state.trustEvents.push(event);
  persist();
  return { ...event };
}

/* ------------------------------ Carbon Ledger ------------------------------ */

async function createCarbonEntry(entry) {
  const record = {
    id: `demo-carbon-${state.carbonEntries.length + 1}`,
    shipmentId: entry.shipmentId,
    originCity: entry.originCity || null,
    destinationCity: entry.destinationCity || null,
    baselineCo2Kg: Number(entry.baselineCo2Kg) || 0,
    actualCo2Kg: Number(entry.actualCo2Kg) || 0,
    savedCo2Kg: Number(entry.savedCo2Kg) || 0,
    distanceKm: entry.distanceKm,
    methodology: entry.methodology,
    factors: entry.factors || null, // audit trail: exact factors used
    verificationStatus: 'pending',
    isDemo: true,
    createdAt: new Date().toISOString(),
  };
  state.carbonEntries.push(record);
  persist();
  return { ...record };
}

async function listCarbonEntries() {
  return state.carbonEntries.map((e) => ({ ...e }));
}

/* --------------------------------- Seeding --------------------------------- */

/** Replace all state (used by scripts/seed-demo.js). */
function resetSeed(seedData) {
  state.users = seedData.users || {};
  state.shipments = seedData.shipments || {};
  state.trustEvents = seedData.trustEvents || [];
  state.carbonEntries = seedData.carbonEntries || [];
  state.counters = seedData.counters || { user: 0, shipment: 0 };
  persist();
  flush();
}

/** Test/demo helper: wipe all data. */
function clear() {
  state.users = {};
  state.shipments = {};
  state.trustEvents = [];
  state.carbonEntries = [];
  state.counters = { user: 0, shipment: 0 };
  persist();
  flush();
}

module.exports = {
  // users
  findOrCreateUser,
  findUserByTelegramId,
  updateUser,
  updateTrustScore,
  // shipments
  createShipment,
  getShipment,
  updateShipment,
  listShipmentsByUser,
  listPendingShipments,
  listAllShipments,
  // trust
  logTrustEvent,
  // carbon
  createCarbonEntry,
  listCarbonEntries,
  // demo utilities
  resetSeed,
  clear,
  flush,
  isDemoMode: true,
};
