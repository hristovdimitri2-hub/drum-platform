/**
 * Airtable service
 *
 * Handles all database operations for DRUM MVP.
 * Tables:
 *   - Users
 *   - Shipments
 *   - Trust Events
 *   - Carbon Ledger
 *
 * Schema: see docs/AIRTABLE_SCHEMA.md
 */

const Airtable = require('airtable');
const trust = require('./trust');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(
  process.env.AIRTABLE_BASE_ID
);

const USERS_TABLE = process.env.AIRTABLE_USERS_TABLE || 'Users';
const SHIPMENTS_TABLE = process.env.AIRTABLE_SHIPMENTS_TABLE || 'Shipments';
const TRUST_EVENTS_TABLE = process.env.AIRTABLE_TRUST_EVENTS_TABLE || 'Trust Events';
const CARBON_LEDGER_TABLE = process.env.AIRTABLE_CARBON_LEDGER_TABLE || 'Carbon Ledger';

/**
 * Link fields (Shipments → Users): written as record-id ARRAYS.
 * Created automatically by scripts/seed-airtable.js; bases seeded by the
 * older script still have singleLineText fields — planWriteFallback
 * downgrades the write (scalar) or drops unknown fields instead of failing.
 */
const SHIPMENT_LINK_FIELDS = ['Sender ID', 'Carrier ID'];

/**
 * Fallback ladder for writes containing link fields. Returns the next
 * fields payload to try, or null (caller rethrows the original error):
 *   1. 422 cast/INVALID_VALUE → base still has the legacy TEXT field →
 *      retry with the scalar record id.
 *   2. 422 UNKNOWN_FIELD_NAME → the field doesn't exist at all → drop the
 *      link fields (the rest of the payload still writes; run `npm run seed`).
 * Non-422 errors, or payloads without link fields → null.
 */
function planWriteFallback(err, fields, linkFieldNames = []) {
  const status = err && (err.statusCode || (err.response && err.response.statusCode));
  if (status !== 422) return null;
  const linkKeys = linkFieldNames.filter((k) => Object.prototype.hasOwnProperty.call(fields, k));
  if (!linkKeys.length) return null;
  const type = typeof err.error === 'string' ? err.error : (err.error && err.error.type) || '';
  const message = (err && err.message) || (err.error && err.error.message) || '';
  const unknown = type === 'UNKNOWN_FIELD_NAME' || /unknown field/i.test(message);
  if (unknown) {
    const rest = { ...fields };
    for (const k of linkKeys) delete rest[k];
    return Object.keys(rest).length ? rest : null;
  }
  const next = { ...fields };
  let changed = false;
  for (const k of linkKeys) {
    if (Array.isArray(next[k])) {
      next[k] = next[k][0];
      changed = true;
    }
  }
  return changed ? next : null;
}

/** Runs a create/update, applying planWriteFallback up to 4 attempts. */
async function writeWithLinkFallback(run, fields, linkFieldNames) {
  let current = fields;
  for (let attempt = 0; ; attempt++) {
    try {
      return await run(current);
    } catch (err) {
      const next = planWriteFallback(err, current, linkFieldNames);
      if (!next || attempt >= 3) throw err;
      current = next;
    }
  }
}

/**
 * Find or create user by Telegram ID
 */
async function findOrCreateUser({ telegramId, firstName, lastName, username, language }) {
  const records = await base(USERS_TABLE)
    .select({ filterByFormula: `{Telegram ID} = ${telegramId}` })
    .firstPage();

  if (records.length > 0) {
    return mapUser(records[0]);
  }

  // Create new user
  const created = await base(USERS_TABLE).create({
    'Telegram ID': telegramId,
    'First Name': firstName,
    'Last Name': lastName,
    'Username': username,
    'Language': language,
    'KYC Status': 'pending',
    'Trust Score': 50,
    'Trust Tier': 'standard',
    'Created At': new Date().toISOString(),
  });

  return mapUser(created);
}

async function findUserByTelegramId(telegramId) {
  const records = await base(USERS_TABLE)
    .select({ filterByFormula: `{Telegram ID} = ${telegramId}` })
    .firstPage();

  if (records.length === 0) return null;
  return mapUser(records[0]);
}

async function updateUser(telegramId, fields) {
  const user = await findUserByTelegramId(telegramId);
  if (!user) throw new Error('User not found');

  const updateFields = {};
  if (fields.phone) updateFields['Phone'] = fields.phone;
  if (fields.kycStatus) updateFields['KYC Status'] = fields.kycStatus;
  if (fields.stripeCustomerId) updateFields['Stripe Customer ID'] = fields.stripeCustomerId;
  if (fields.stripeConnectAccountId) updateFields['Stripe Connect Account ID'] = fields.stripeConnectAccountId;
  if (fields.trustScore !== undefined) updateFields['Trust Score'] = fields.trustScore;
  if (fields.trustTier) updateFields['Trust Tier'] = fields.trustTier;

  const updated = await base(USERS_TABLE).update(user.id, updateFields);
  return mapUser(updated);
}

/**
 * Apply a trust EVENT to a user (event-sourced). Uses the shared trust
 * service so tier thresholds (31/50/70/90) are consistent everywhere.
 * @returns {{score: number, tier: string, delta: number}}
 */
async function updateTrustScore(userId, eventType) {
  const records = await base(USERS_TABLE).select({ filterByFormula: `RECORD_ID() = "${userId}"` }).firstPage();
  if (records.length === 0) throw new Error('User not found');

  const current = records[0].fields['Trust Score'] || 50;
  const result = trust.applyEvent(current, eventType);

  await base(USERS_TABLE).update(userId, {
    'Trust Score': result.score,
    'Trust Tier': result.tier,
  });

  return result;
}

/**
 * Shipment operations
 */
async function createShipment(data) {
  const fields = {
    // Link field: record-id ARRAY (fallback downgrades to scalar on legacy bases)
    ...(data.senderId ? { 'Sender ID': [data.senderId] } : {}),
    'Sender Telegram ID': data.senderTelegramId,
    'Origin City': data.originCity,
    'Destination City': data.destinationCity,
    'Description': data.description,
    'Parcel Value (EUR)': data.parcelValueEur,
    'Deadline': data.deadline,
    'Total (EUR)': data.totalEur,
    'Base (EUR)': data.baseEur,
    'Fee (EUR)': data.feeEur,
    'Insurance (EUR)': data.insuranceEur,
    'Stripe Payment Intent ID': data.stripePaymentIntentId,
    'Status': data.status,
    'Created At': new Date().toISOString(),
  };

  const record = await writeWithLinkFallback(
    (f) => base(SHIPMENTS_TABLE).create(f),
    fields,
    SHIPMENT_LINK_FIELDS
  );
  return mapShipment(record);
}

async function getShipment(shipmentId) {
  try {
    const record = await base(SHIPMENTS_TABLE).find(shipmentId);
    return mapShipment(record);
  } catch (err) {
    if (err.statusCode === 404) return null;
    throw err;
  }
}

async function updateShipment(shipmentId, fields) {
  const updateFields = {};
  if (fields.carrierId) updateFields['Carrier ID'] = [fields.carrierId]; // link array (legacy fallback below)
  if (fields.carrierTelegramId) updateFields['Carrier Telegram ID'] = fields.carrierTelegramId;
  if (fields.carrierStripeAccountId) updateFields['Carrier Stripe Account ID'] = fields.carrierStripeAccountId;
  if (fields.status) updateFields['Status'] = fields.status;
  if (fields.matchedAt) updateFields['Matched At'] = fields.matchedAt;
  if (fields.pickupQrCode) updateFields['Pickup QR Code'] = [{ url: fields.pickupQrCode }];
  if (fields.deliveryQrCode) updateFields['Delivery QR Code'] = [{ url: fields.deliveryQrCode }];
  if (fields.pickupScannedAt) updateFields['Pickup Scanned At'] = fields.pickupScannedAt;
  if (fields.deliveryScannedAt) updateFields['Delivery Scanned At'] = fields.deliveryScannedAt;
  if (fields.stripeTransferId) updateFields['Stripe Transfer ID'] = fields.stripeTransferId;

  const updated = await writeWithLinkFallback(
    (f) => base(SHIPMENTS_TABLE).update(shipmentId, f),
    updateFields,
    SHIPMENT_LINK_FIELDS
  );
  return mapShipment(updated);
}

async function listShipmentsByUser(telegramId) {
  const senderRecords = await base(SHIPMENTS_TABLE)
    .select({
      filterByFormula: `{Sender Telegram ID} = ${telegramId}`,
      sort: [{ field: 'Created At', direction: 'desc' }],
    })
    .firstPage();

  const carrierRecords = await base(SHIPMENTS_TABLE)
    .select({
      filterByFormula: `{Carrier Telegram ID} = ${telegramId}`,
      sort: [{ field: 'Created At', direction: 'desc' }],
    })
    .firstPage();

  return [...senderRecords, ...carrierRecords].map(mapShipment);
}

async function listPendingShipments() {
  const records = await base(SHIPMENTS_TABLE)
    .select({
      filterByFormula: 'OR({Status} = "requested", {Status} = "paid")',
      sort: [{ field: 'Created At', direction: 'asc' }],
    })
    .firstPage();

  return records.map(mapShipment);
}

/** All shipments (for the carbon dashboard / reporting). */
async function listAllShipments() {
  const records = await base(SHIPMENTS_TABLE)
    .select({ sort: [{ field: 'Created At', direction: 'asc' }] })
    .all();
  return records.map(mapShipment);
}

/**
 * Trust events
 */
async function logTrustEvent({ userId, eventType, eventValue, shipmentId, metadata }) {
  await base(TRUST_EVENTS_TABLE).create({
    'User ID': userId,
    'Event Type': eventType,
    'Event Value': eventValue,
    'Shipment ID': shipmentId,
    'Metadata': JSON.stringify(metadata || {}),
    'Created At': new Date().toISOString(),
  });
}

/**
 * Carbon ledger
 */
async function createCarbonEntry({ shipmentId, originCity, destinationCity, baselineCo2Kg, actualCo2Kg, savedCo2Kg, distanceKm, methodology, factors }) {
  await base(CARBON_LEDGER_TABLE).create({
    'Shipment ID': shipmentId,
    'Origin City': originCity,
    'Destination City': destinationCity,
    'Baseline CO2 (kg)': parseFloat(baselineCo2Kg),
    'Actual CO2 (kg)': parseFloat(actualCo2Kg),
    'Saved CO2 (kg)': parseFloat(savedCo2Kg),
    'Distance (km)': distanceKm,
    'Methodology': methodology,
    'Factors (audit trail)': factors ? JSON.stringify(factors) : null,
    'Verification Status': 'pending',
    'Created At': new Date().toISOString(),
  });
}

/** All carbon ledger entries (for the dashboard / reporting). */
async function listCarbonEntries() {
  const records = await base(CARBON_LEDGER_TABLE)
    .select({ sort: [{ field: 'Created At', direction: 'asc' }] })
    .all();
  return records.map((r) => ({
    id: r.id,
    shipmentId: r.fields['Shipment ID'],
    originCity: r.fields['Origin City'],
    destinationCity: r.fields['Destination City'],
    baselineCo2Kg: r.fields['Baseline CO2 (kg)'],
    actualCo2Kg: r.fields['Actual CO2 (kg)'],
    savedCo2Kg: r.fields['Saved CO2 (kg)'],
    distanceKm: r.fields['Distance (km)'],
    methodology: r.fields['Methodology'],
    verificationStatus: r.fields['Verification Status'],
    createdAt: r.fields['Created At'],
  }));
}

/**
 * Mappers (Airtable record → JS object)
 */
function mapUser(record) {
  const f = record.fields;
  return {
    id: record.id,
    telegramId: f['Telegram ID'],
    firstName: f['First Name'],
    lastName: f['Last Name'],
    username: f['Username'],
    phone: f['Phone'],
    language: f['Language'],
    kycStatus: f['KYC Status'] || 'pending',
    stripeCustomerId: f['Stripe Customer ID'],
    stripeConnectAccountId: f['Stripe Connect Account ID'],
    trustScore: f['Trust Score'] || 50,
    trustTier: f['Trust Tier'] || 'standard',
    createdAt: f['Created At'],
  };
}

function mapShipment(record) {
  const f = record.fields;
  // Link fields come back as record-id ARRAYS; legacy bases store scalar
  // text (the old `?.[0]` returned the FIRST CHARACTER of a string — bug
  // caught by tests/t2-airtable-links.test.cjs).
  const firstId = (v) => (Array.isArray(v) ? v[0] : v);
  return {
    id: record.id,
    senderId: firstId(f['Sender ID']),
    senderTelegramId: f['Sender Telegram ID'],
    carrierId: firstId(f['Carrier ID']),
    carrierTelegramId: f['Carrier Telegram ID'],
    carrierStripeAccountId: f['Carrier Stripe Account ID'],
    originCity: f['Origin City'],
    destinationCity: f['Destination City'],
    description: f['Description'],
    parcelValueEur: f['Parcel Value (EUR)'],
    deadline: f['Deadline'],
    totalEur: f['Total (EUR)'],
    baseEur: f['Base (EUR)'],
    feeEur: f['Fee (EUR)'],
    insuranceEur: f['Insurance (EUR)'],
    stripePaymentIntentId: f['Stripe Payment Intent ID'],
    stripeTransferId: f['Stripe Transfer ID'],
    pickupQrCode: Array.isArray(f['Pickup QR Code']) ? f['Pickup QR Code'][0]?.url : f['Pickup QR Code'],
    deliveryQrCode: Array.isArray(f['Delivery QR Code']) ? f['Delivery QR Code'][0]?.url : f['Delivery QR Code'],
    status: f['Status'],
    matchedAt: f['Matched At'],
    pickupScannedAt: f['Pickup Scanned At'],
    deliveryScannedAt: f['Delivery Scanned At'],
    createdAt: f['Created At'],
  };
}

module.exports = {
  findOrCreateUser,
  findUserByTelegramId,
  updateUser,
  updateTrustScore,
  createShipment,
  getShipment,
  updateShipment,
  listShipmentsByUser,
  listPendingShipments,
  listAllShipments,
  logTrustEvent,
  createCarbonEntry,
  listCarbonEntries,
  // internals exposed for unit tests (batch 1 / task 2)
  __test: {
    mapUser,
    mapShipment,
    planWriteFallback,
    writeWithLinkFallback,
    SHIPMENT_LINK_FIELDS,
  },
};
