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
 */

const DATA_BACKEND = String(process.env.DATA_BACKEND || 'sqlite').toLowerCase();
const IS_DEMO = String(process.env.DEMO_MODE || '').toLowerCase() === 'true';

let backend;
if (DATA_BACKEND === 'airtable') backend = require('./airtable');
else if (DATA_BACKEND === 'demo') backend = require('./demo-store');
else backend = require('./db/sqlite');

module.exports = Object.assign({}, backend, {
  isDemoMode: IS_DEMO,
  backend: DATA_BACKEND === 'demo' ? 'demo' : backend.backend || DATA_BACKEND,
});

