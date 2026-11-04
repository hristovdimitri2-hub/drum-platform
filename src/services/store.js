/**
 * Store facade — selects the data layer (B1)
 *
 *   DATA_BACKEND=sqlite    -> services/db/sqlite.js (DEFAULT, self-contained)
 *   DATA_BACKEND=airtable  -> services/airtable.js   (production no-code DB)
 *   DATA_BACKEND=demo      -> services/demo-store.js (legacy in-memory)
 *
 * DEMO_MODE is INDEPENDENT of the backend: it only switches Stripe to
 * simulated rails and marks records is_demo=1. SQLite remains the default
 * data layer in every mode.
 *
 * All backends implement the same adapter interface (docs/DATABASE.md).
 *
 * P2 — interface gate: a backend that is missing a method the application
 * calls WITHOUT a guard used to fail in the middle of a payment flow (the
 * Stripe webhook calls `isWebhookProcessed` before marking an event handled,
 * and `scan.js` calls `recordTransaction` after a real capture). That is now a
 * boot-time error instead of a runtime one.
 */

const { logger } = require('./security');

const DATA_BACKEND = String(process.env.DATA_BACKEND || 'sqlite').toLowerCase();
const IS_DEMO = String(process.env.DEMO_MODE || '').toLowerCase() === 'true';

let backend;
if (DATA_BACKEND === 'airtable') backend = require('./airtable');
else if (DATA_BACKEND === 'demo') backend = require('./demo-store');
else backend = require('./db/sqlite');

/**
 * Methods the application calls unconditionally (no `backend.x ? … : …`
 * guard). Keep this list in sync with the call sites in src/commands/* and
 * src/services/* — a missing entry turns a boot error back into a mid-payment
 * TypeError.
 */
const REQUIRED_BACKEND_METHODS = [
  // identity / trust
  'findOrCreateUser',
  'findUserByTelegramId',
  'updateUser',
  'updateTrustScore',
  // shipments
  'createShipment',
  'getShipment',
  'updateShipment',
  'listShipmentsByUser',
  'listPendingShipments',
  'listAllShipments',
  'logTrustEvent',
  // carbon ledger
  'createCarbonEntry',
  'listCarbonEntries',
  // payments / escrow / QR
  'recordTransaction',
  'listTransactionsByShipment',
  'saveQrCode',
  'getQrCode',
  'markQrScanned',
  // anomalies / disputes
  'createDispute',
  'getDispute',
  'listDisputes',
  'updateDisputeStatus',
  'countLostDisputes',
  // webhook idempotency (anomaly 2 — replay protection)
  'isWebhookProcessed',
  'markWebhookProcessed',
];

function missingBackendMethods(b) {
  return REQUIRED_BACKEND_METHODS.filter((m) => typeof b[m] !== 'function');
}

const missingMethods = missingBackendMethods(backend);
if (missingMethods.length) {
  const message =
    `DATA_BACKEND=${DATA_BACKEND} is missing ${missingMethods.length} required method(s): ` +
    `${missingMethods.join(', ')}. This backend cannot serve the payment, QR or anomaly ` +
    `flows — use DATA_BACKEND=sqlite, or set ALLOW_INCOMPLETE_BACKEND=true to boot ` +
    `anyway (unsafe: those flows will throw at runtime).`;
  logger.error('store.backend.incomplete', { backend: DATA_BACKEND, missing: missingMethods });

  // `airtable` is the documented production no-code backend, so an incomplete
  // adapter there is a misconfiguration that must stop the boot. `demo-store`
  // is explicitly the legacy in-memory option used for UI demos, so it gets a
  // loud warning rather than a hard failure.
  if (DATA_BACKEND === 'airtable' && String(process.env.ALLOW_INCOMPLETE_BACKEND || '').toLowerCase() !== 'true') {
    throw new Error(message);
  }
  console.warn('⚠️  ' + message);
}

module.exports = Object.assign({}, backend, {
  isDemoMode: IS_DEMO,
  backend: DATA_BACKEND === 'demo' ? 'demo' : backend.backend || DATA_BACKEND,
  // Exposed so tests and `scripts/` can assert parity without booting the app.
  REQUIRED_BACKEND_METHODS,
  missingBackendMethods,
});

