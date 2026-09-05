/**
 * SQLite data adapter — DEFAULT backend (B1)
 *
 * Self-contained: pure node:sqlite (Node >= 22.5), zero external services.
 * A clean clone runs with no Telegram/Stripe/Airtable credentials.
 *
 * Interface (adapter contract — see docs/DATABASE.md):
 *   users:      findOrCreateUser, findUserByTelegramId, updateUser, updateTrustScore
 *   shipments:  createShipment, getShipment, updateShipment,
 *               listShipmentsByUser, listPendingShipments, listAllShipments
 *   trust:      logTrustEvent, listTrustHistory
 *   carbon:     createCarbonEntry, listCarbonEntries
 *   transactions: recordTransaction, listTransactionsByShipment
 *   qr:         saveQrCode, getQrCode, markQrScanned
 *   disputes:   createDispute, updateDisputeStatus, listDisputes
 *   seed:       resetSeed, clear
 *
 * Postgres path: documented in docs/DATABASE.md (not implemented — honest ❌).
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const trust = require('../trust');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const DB_PATH = process.env.SQLITE_PATH || path.join(DATA_DIR, 'drum.db');

let db;

function init() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  createSchema();
  return db;
}

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      telegram_id INTEGER UNIQUE,
      first_name TEXT, last_name TEXT, username TEXT, phone TEXT,
      language TEXT DEFAULT 'bg',
      kyc_status TEXT DEFAULT 'pending',
      stripe_customer_id TEXT, stripe_connect_account_id TEXT,
      routes TEXT,
      trust_score INTEGER NOT NULL DEFAULT 50,
      trust_tier TEXT NOT NULL DEFAULT 'standard',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY,
      sender_id TEXT, carrier_id TEXT,
      sender_telegram_id INTEGER, carrier_telegram_id INTEGER,
      carrier_stripe_account_id TEXT,
      origin_city TEXT NOT NULL, destination_city TEXT NOT NULL,
      description TEXT, parcel_value_eur REAL,
      deadline TEXT,
      total_eur REAL, base_eur REAL, fee_eur REAL, insurance_eur REAL,
      stripe_payment_intent_id TEXT, stripe_transfer_id TEXT,
      pickup_qr_code TEXT, delivery_qr_code TEXT,
      status TEXT NOT NULL DEFAULT 'requested',
      is_demo INTEGER NOT NULL DEFAULT 0,
      matched_at TEXT, pickup_scanned_at TEXT, delivery_scanned_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      shipment_id TEXT,
      type TEXT NOT NULL,             -- escrow_auth | capture | transfer | refund
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'eur',
      stripe_id TEXT,
      split_carrier_cents INTEGER, split_drum_cents INTEGER,
      split_insurance_cents INTEGER,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS qr_codes (
      id TEXT PRIMARY KEY,
      shipment_id TEXT NOT NULL,
      kind TEXT NOT NULL,             -- pickup | delivery
      payload TEXT NOT NULL,
      image TEXT,
      scanned_at TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trust_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      delta INTEGER NOT NULL,
      score_after INTEGER,
      tier_after TEXT,
      shipment_id TEXT,
      metadata TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS disputes (
      id TEXT PRIMARY KEY,
      shipment_id TEXT NOT NULL,
      opened_by TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'open',  -- open | won | lost | resolved
      resolved_at TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS carbon_ledger (
      id TEXT PRIMARY KEY,
      shipment_id TEXT,
      origin_city TEXT, destination_city TEXT,
      baseline_co2_kg REAL, actual_co2_kg REAL, saved_co2_kg REAL,
      distance_km INTEGER,
      methodology TEXT,
      factors TEXT,                    -- audit trail (JSON of exact factors)
      verification_status TEXT DEFAULT 'pending',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS counters (
      name TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_shipments_sender ON shipments(sender_telegram_id);
    CREATE INDEX IF NOT EXISTS idx_shipments_carrier ON shipments(carrier_telegram_id);
    CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);
    CREATE INDEX IF NOT EXISTS idx_trust_user ON trust_history(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_carbon_shipment ON carbon_ledger(shipment_id);
  `);
}

function nextId(prefix) {
  init();
  const row = db
    .prepare('INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value')
    .get(prefix);
  return `${prefix}-${String(row.value).padStart(6, '0')}`;
}

const now = () => new Date().toISOString();

/* ---------------------------------- Users --------------------------------- */

function mapUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    telegramId: r.telegram_id,
    firstName: r.first_name,
    lastName: r.last_name,
    username: r.username,
    phone: r.phone,
    language: r.language,
    kycStatus: r.kyc_status,
    stripeCustomerId: r.stripe_customer_id,
    stripeConnectAccountId: r.stripe_connect_account_id,
    routes: r.routes ? JSON.parse(r.routes) : null,
    trustScore: r.trust_score,
    trustTier: r.trust_tier,
    isDemo: !!r.is_demo,
    createdAt: r.created_at,
  };
}

function mapShipmentRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    senderId: r.sender_id,
    carrierId: r.carrier_id,
    senderTelegramId: r.sender_telegram_id,
    carrierTelegramId: r.carrier_telegram_id,
    carrierStripeAccountId: r.carrier_stripe_account_id,
    originCity: r.origin_city,
    destinationCity: r.destination_city,
    description: r.description,
    parcelValueEur: r.parcel_value_eur,
    deadline: r.deadline,
    totalEur: r.total_eur,
    baseEur: r.base_eur,
    feeEur: r.fee_eur,
    insuranceEur: r.insurance_eur,
    stripePaymentIntentId: r.stripe_payment_intent_id,
    stripeTransferId: r.stripe_transfer_id,
    status: r.status,
    isDemo: !!r.is_demo,
    matchedAt: r.matched_at,
    pickupScannedAt: r.pickup_scanned_at,
    deliveryScannedAt: r.delivery_scanned_at,
    createdAt: r.created_at,
  };
}

async function findOrCreateUser({ telegramId, firstName, lastName, username, language }) {
  init();
  const existing = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(Number(telegramId));
  if (existing) return mapUser(existing);

  const id = nextId('usr');
  db.prepare(
    `INSERT INTO users (id, telegram_id, first_name, last_name, username, language,
       kyc_status, trust_score, trust_tier, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 50, 'standard', ?)`
  ).run(id, Number(telegramId), firstName || null, lastName || null, username || null,
        language || 'bg', now());
  return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

async function findUserByTelegramId(telegramId) {
  init();
  return mapUser(db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(Number(telegramId)));
}

async function updateUser(telegramId, fields) {
  init();
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(Number(telegramId));
  if (!user) throw new Error('User not found');
  const sets = [];
  const vals = [];
  if (fields.phone) { sets.push('phone = ?'); vals.push(fields.phone); }
  if (fields.kycStatus) { sets.push('kyc_status = ?'); vals.push(fields.kycStatus); }
  if (fields.stripeCustomerId) { sets.push('stripe_customer_id = ?'); vals.push(fields.stripeCustomerId); }
  if (fields.stripeConnectAccountId) { sets.push('stripe_connect_account_id = ?'); vals.push(fields.stripeConnectAccountId); }
  if (fields.routes) { sets.push('routes = ?'); vals.push(JSON.stringify(fields.routes)); }
  if (fields.trustScore !== undefined) {
    sets.push('trust_score = ?'); vals.push(trust.clampScore(fields.trustScore));
    sets.push('trust_tier = ?'); vals.push(trust.tierForScore(fields.trustScore));
  }
  if (fields.trustTier) { sets.push('trust_tier = ?'); vals.push(fields.trustTier); }
  if (sets.length) {
    vals.push(user.id);
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));
}

async function getUserById(id) {
  init();
  return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

async function listUsers() {
  init();
  return db.prepare('SELECT * FROM users ORDER BY created_at').all().map(mapUser);
}

/* -------------------------------- Shipments ------------------------------- */

async function createShipment(data) {
  init();
  const id = data.id || nextId('shp');
  db.prepare(
    `INSERT INTO shipments (id, sender_id, sender_telegram_id, origin_city,
      destination_city, description, parcel_value_eur, deadline, total_eur,
      base_eur, fee_eur, insurance_eur, stripe_payment_intent_id, status,
      is_demo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, data.senderId || null, data.senderTelegramId || null,
    data.originCity, data.destinationCity, data.description || null,
    data.parcelValueEur ?? null, data.deadline || null, data.totalEur ?? null,
    data.baseEur ?? null, data.feeEur ?? null, data.insuranceEur ?? null,
    data.stripePaymentIntentId || null, data.status || 'requested',
    data.isDemo ? 1 : 0, data.createdAt || now());
  return mapShipmentRow(db.prepare('SELECT * FROM shipments WHERE id = ?').get(id));
}

async function getShipment(shipmentId) {
  init();
  return mapShipmentRow(db.prepare('SELECT * FROM shipments WHERE id = ?').get(shipmentId));
}

async function updateShipment(shipmentId, fields) {
  init();
  const col = {
    carrierId: 'carrier_id', carrierTelegramId: 'carrier_telegram_id',
    carrierStripeAccountId: 'carrier_stripe_account_id',
    status: 'status', matchedAt: 'matched_at',
    pickupScannedAt: 'pickup_scanned_at', deliveryScannedAt: 'delivery_scanned_at',
    stripeTransferId: 'stripe_transfer_id', pickupQrCode: 'pickup_qr_code',
    deliveryQrCode: 'delivery_qr_code',
  };
  const sets = [];
  const vals = [];
  for (const [k, c] of Object.entries(col)) {
    if (fields[k] !== undefined) { sets.push(`${c} = ?`); vals.push(fields[k]); }
  }
  if (sets.length) {
    vals.push(shipmentId);
    db.prepare(`UPDATE shipments SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  }
  return mapShipmentRow(db.prepare('SELECT * FROM shipments WHERE id = ?').get(shipmentId));
}

async function listShipmentsByUser(telegramId) {
  init();
  const rows = db.prepare(
    `SELECT * FROM shipments WHERE sender_telegram_id = ? OR carrier_telegram_id = ?
     ORDER BY created_at DESC`
  ).all(Number(telegramId), Number(telegramId));
  return rows.map(mapShipmentRow);
}

async function listPendingShipments() {
  init();
  return db.prepare("SELECT * FROM shipments WHERE status = 'requested' ORDER BY created_at ASC").all().map(mapShipmentRow);
}

async function listAllShipments() {
  init();
  return db.prepare('SELECT * FROM shipments ORDER BY created_at ASC').all().map(mapShipmentRow);
}

/* ---------------------------------- Trust --------------------------------- */

async function logTrustEvent({ userId, eventType, eventValue, scoreAfter, tierAfter, shipmentId, metadata }) {
  init();
  db.prepare(
    `INSERT INTO trust_history (user_id, event_type, delta, score_after, tier_after,
       shipment_id, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, eventType, eventValue ?? 0, scoreAfter ?? null, tierAfter ?? null,
    shipmentId || null, metadata ? JSON.stringify(metadata) : null, now());
}

async function listTrustHistory(userId) {
  init();
  return db.prepare('SELECT * FROM trust_history WHERE user_id = ? ORDER BY id ASC').all(userId)
    .map((r) => ({
      id: r.id, userId: r.user_id, eventType: r.event_type, delta: r.delta,
      scoreAfter: r.score_after, tierAfter: r.tier_after, shipmentId: r.shipment_id,
      metadata: r.metadata ? JSON.parse(r.metadata) : null, createdAt: r.created_at,
    }));
}

/* ------------------------------ Carbon Ledger ----------------------------- */

async function createCarbonEntry(entry) {
  init();
  const id = entry.id || nextId('car');
  db.prepare(
    `INSERT INTO carbon_ledger (id, shipment_id, origin_city, destination_city,
      baseline_co2_kg, actual_co2_kg, saved_co2_kg, distance_km, methodology,
      factors, verification_status, is_demo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, entry.shipmentId || null, entry.originCity || null,
    entry.destinationCity || null, Number(entry.baselineCo2Kg) || 0,
    Number(entry.actualCo2Kg) || 0, Number(entry.savedCo2Kg) || 0,
    entry.distanceKm ?? null, entry.methodology || null,
    entry.factors ? JSON.stringify(entry.factors) : null,
    entry.verificationStatus || 'pending', entry.isDemo ? 1 : 0,
    entry.createdAt || now());
  return getCarbonEntry(id);
}

function getCarbonEntry(id) {
  const r = db.prepare('SELECT * FROM carbon_ledger WHERE id = ?').get(id);
  return r ? {
    id: r.id, shipmentId: r.shipment_id,
    originCity: r.origin_city, destinationCity: r.destination_city,
    baselineCo2Kg: r.baseline_co2_kg, actualCo2Kg: r.actual_co2_kg,
    savedCo2Kg: r.saved_co2_kg, distanceKm: r.distance_km,
    methodology: r.methodology,
    factors: r.factors ? JSON.parse(r.factors) : null,
    verificationStatus: r.verification_status,
    isDemo: !!r.is_demo, createdAt: r.created_at,
  } : null;
}

async function listCarbonEntries() {
  init();
  return db.prepare('SELECT * FROM carbon_ledger ORDER BY created_at ASC').all()
    .map((r) => getCarbonEntry(r.id));
}

/* ------------------------------ Transactions ------------------------------ */

async function recordTransaction(tx) {
  init();
  const id = tx.id || nextId('txn');
  db.prepare(
    `INSERT INTO transactions (id, shipment_id, type, amount_cents, currency,
      stripe_id, split_carrier_cents, split_drum_cents, split_insurance_cents,
      is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, tx.shipmentId || null, tx.type, tx.amountCents,
    tx.currency || 'eur', tx.stripeId || null,
    tx.splitCarrierCents ?? null, tx.splitDrumCents ?? null,
    tx.splitInsuranceCents ?? null, tx.isDemo ? 1 : 0, now());
  return id;
}

async function listTransactionsByShipment(shipmentId) {
  init();
  return db.prepare('SELECT * FROM transactions WHERE shipment_id = ? ORDER BY created_at').all(shipmentId)
    .map((r) => ({
      id: r.id, shipmentId: r.shipment_id, type: r.type,
      amountCents: r.amount_cents, currency: r.currency, stripeId: r.stripe_id,
      splitCarrierCents: r.split_carrier_cents, splitDrumCents: r.split_drum_cents,
      splitInsuranceCents: r.split_insurance_cents,
      isDemo: !!r.is_demo, createdAt: r.created_at,
    }));
}

/* ---------------------------------- QR ------------------------------------ */

async function saveQrCode({ shipmentId, kind, payload, image }) {
  init();
  const id = nextId('qr');
  db.prepare(
    'INSERT INTO qr_codes (id, shipment_id, kind, payload, image, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, shipmentId, kind, payload, image || null, 0, now());
  return id;
}

async function getQrCode(shipmentId, kind) {
  init();
  const r = db.prepare('SELECT * FROM qr_codes WHERE shipment_id = ? AND kind = ?').get(shipmentId, kind);
  return r ? { id: r.id, shipmentId: r.shipment_id, kind: r.kind, payload: r.payload, image: r.image, scannedAt: r.scanned_at } : null;
}

async function markQrScanned(shipmentId, kind) {
  init();
  db.prepare('UPDATE qr_codes SET scanned_at = ? WHERE shipment_id = ? AND kind = ?').run(now(), shipmentId, kind);
}

/* -------------------------------- Disputes -------------------------------- */

async function createDispute({ shipmentId, openedBy, reason }) {
  init();
  const id = nextId('dsp');
  db.prepare(
    'INSERT INTO disputes (id, shipment_id, opened_by, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, shipmentId, openedBy, reason || null, 'open', now());
  return getDispute(id);
}

function getDispute(id) {
  const r = db.prepare('SELECT * FROM disputes WHERE id = ?').get(id);
  return r ? {
    id: r.id, shipmentId: r.shipment_id, openedBy: r.opened_by,
    reason: r.reason, status: r.status, resolvedAt: r.resolved_at,
    isDemo: !!r.is_demo, createdAt: r.created_at,
  } : null;
}

async function updateDisputeStatus(id, status) {
  init();
  db.prepare('UPDATE disputes SET status = ?, resolved_at = ? WHERE id = ?')
    .run(status, status === 'open' ? null : now(), id);
  return getDispute(id);
}

async function listDisputes(filter = {}) {
  init();
  let sql = 'SELECT * FROM disputes';
  const vals = [];
  if (filter.userId) { sql += ' WHERE opened_by = ?'; vals.push(filter.userId); }
  sql += ' ORDER BY created_at';
  return db.prepare(sql).all(...vals).map((r) => getDispute(r.id));
}

async function countLostDisputes(userId, sinceDaysAgo = 90) {
  init();
  const since = new Date(Date.now() - sinceDaysAgo * 86400000).toISOString();
  const r = db.prepare(
    "SELECT COUNT(*) AS n FROM disputes WHERE opened_by = ? AND status = 'lost' AND created_at >= ?"
  ).get(userId, since);
  return r.n;
}

/* ------------------- Trust score (full B4 rule set) ----------------------- */

/**
 * Apply a trust event with the FULL B4 rule set (caps, frequencies, conditions).
 * Rules live in services/trust.js (pure); here we gather the DB context.
 * @returns {{score, tier, delta, applied, reason}}
 */
async function updateTrustScore(userId, eventType, context = {}) {
  init();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('User not found');

  // DB-derived context for caps/conditions
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const todayCount = db.prepare(
    "SELECT COUNT(*) AS n FROM trust_history WHERE user_id = ? AND event_type = ? AND delta > 0 AND created_at >= ?"
  ).get(userId, eventType, new Date(startOfDay).toISOString()).n;

  const earned = db.prepare(
    'SELECT COALESCE(SUM(delta), 0) AS s FROM trust_history WHERE user_id = ? AND event_type = ?'
  ).get(userId, eventType).s;

  const deliveriesCompleted = db.prepare(
    "SELECT COUNT(*) AS n FROM shipments WHERE carrier_id = ? AND status = 'delivered'"
  ).get(userId).n;

  const monthsInactive = context.monthsInactive || 0;

  const result = trust.applyEvent(user.trust_score, eventType, {
    todayCount,
    earnedFromEvent: earned,
    deliveriesCompleted,
    monthsInactive,
    referrerScore: context.referrerScore ?? 0,
    referralsCount: context.referralsCount ?? 0,
  });

  // Ban rule: 2 lost disputes in 90 days
  let banned = false;
  if (eventType === 'dispute_lost') {
    const lost = await countLostDisputes(userId, 90);
    if (lost >= 2) { result.score = 0; result.tier = 'banned'; banned = true; }
  }

  db.prepare('UPDATE users SET trust_score = ?, trust_tier = ? WHERE id = ?')
    .run(result.score, result.tier, userId);

  await logTrustEvent({
    userId, eventType,
    eventValue: result.delta,
    scoreAfter: result.score,
    tierAfter: result.tier,
    shipmentId: context.shipmentId || null,
    metadata: { applied: result.applied, reason: result.reason || null, banned, ...context.meta },
  });

  return { ...result, banned };
}

/* ---------------------------------- Seed ---------------------------------- */

/**
 * Bulk seed (used by scripts/seed-demo.js). Accepts the same shape as
 * demo-store.resetSeed: { users:{id:obj}, shipments:{id:obj}, trustEvents:[],
 * carbonEntries:[], counters:{user,shipment} }.
 * Replaces ALL existing rows (seed is authoritative).
 */
async function resetSeed(data) {
  init();
  const tx = db.begin ? null : null; // node:sqlite: manual transaction below
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM users; DELETE FROM shipments; DELETE FROM transactions; DELETE FROM qr_codes; DELETE FROM trust_history; DELETE FROM disputes; DELETE FROM carbon_ledger; DELETE FROM counters;');

    const insUser = db.prepare(
      `INSERT INTO users (id, telegram_id, first_name, last_name, username, phone,
        language, kyc_status, stripe_customer_id, stripe_connect_account_id,
        trust_score, trust_tier, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const u of Object.values(data.users || {})) {
      insUser.run(u.id, u.telegramId, u.firstName || null, u.lastName || null,
        u.username || null, u.phone || null, u.language || 'bg',
        u.kycStatus || 'pending', u.stripeCustomerId || null,
        u.stripeConnectAccountId || null, u.trustScore ?? 50,
        u.trustTier || trust.tierForScore(u.trustScore ?? 50), u.isDemo ? 1 : 0,
        u.createdAt || now());
    }

    const insShp = db.prepare(
      `INSERT INTO shipments (id, sender_id, sender_telegram_id, carrier_id,
        carrier_telegram_id, carrier_stripe_account_id, origin_city,
        destination_city, description, parcel_value_eur, deadline, total_eur,
        base_eur, fee_eur, insurance_eur, stripe_payment_intent_id,
        stripe_transfer_id, status, is_demo, matched_at, pickup_scanned_at,
        delivery_scanned_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const s of Object.values(data.shipments || {})) {
      insShp.run(s.id, s.senderId || null, s.senderTelegramId ?? null,
        s.carrierId || null, s.carrierTelegramId ?? null,
        s.carrierStripeAccountId || null, s.originCity, s.destinationCity,
        s.description || null, s.parcelValueEur ?? null, s.deadline || null,
        s.totalEur ?? null, s.baseEur ?? null, s.feeEur ?? null,
        s.insuranceEur ?? null, s.stripePaymentIntentId || null,
        s.stripeTransferId || null, s.status || 'requested',
        s.isDemo ? 1 : 0, s.matchedAt || null, s.pickupScannedAt || null,
        s.deliveryScannedAt || null, s.createdAt || now());
    }

    const insTrust = db.prepare(
      `INSERT INTO trust_history (user_id, event_type, delta, score_after,
        tier_after, shipment_id, metadata, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const e of data.trustEvents || []) {
      insTrust.run(e.userId, e.eventType, e.eventValue ?? 0, e.scoreAfter ?? null,
        e.tierAfter ?? null, e.shipmentId || null, e.metadata || null,
        e.isDemo ? 1 : 0, e.createdAt || now());
    }

    const insCar = db.prepare(
      `INSERT INTO carbon_ledger (id, shipment_id, origin_city, destination_city,
        baseline_co2_kg, actual_co2_kg, saved_co2_kg, distance_km, methodology,
        factors, verification_status, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const c of data.carbonEntries || []) {
      insCar.run(c.id, c.shipmentId || null, c.originCity || null,
        c.destinationCity || null, c.baselineCo2Kg ?? 0, c.actualCo2Kg ?? 0,
        c.savedCo2Kg ?? 0, c.distanceKm ?? null, c.methodology || null,
        c.factors ? JSON.stringify(c.factors) : null,
        c.verificationStatus || 'pending', c.isDemo ? 1 : 0, c.createdAt || now());
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // Restore counters so post-seed generated ids never collide with seeded ids
  const cnt = data.counters || {};
  const setCounter = db.prepare('INSERT INTO counters (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value');
  for (const [name, value] of Object.entries(cnt)) {
    setCounter.run(name, Number(value) || 0);
  }

  return { users: Object.keys(data.users || {}).length, shipments: Object.keys(data.shipments || {}).length };
}

async function clear() {
  init();
  db.exec('DELETE FROM users; DELETE FROM shipments; DELETE FROM transactions; DELETE FROM qr_codes; DELETE FROM trust_history; DELETE FROM disputes; DELETE FROM carbon_ledger; DELETE FROM counters;');
}

init();

module.exports = {
  backend: 'sqlite',
  dbPath: DB_PATH,
  // users
  findOrCreateUser, findUserByTelegramId, updateUser, getUserById, listUsers,
  updateTrustScore,
  // shipments
  createShipment, getShipment, updateShipment,
  listShipmentsByUser, listPendingShipments, listAllShipments,
  // trust
  logTrustEvent, listTrustHistory, countLostDisputes,
  // carbon
  createCarbonEntry, listCarbonEntries,
  // transactions / qr / disputes
  recordTransaction, listTransactionsByShipment,
  saveQrCode, getQrCode, markQrScanned,
  createDispute, updateDisputeStatus, listDisputes,
  // seed
  resetSeed, clear,
  isDemoMode: false,
};
