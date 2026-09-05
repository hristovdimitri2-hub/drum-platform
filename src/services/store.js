/**
 * Store facade — selects the data layer
 *
 *   DEMO_MODE=true  -> services/demo-store.js (in-memory, marked [DEMO])
 *   otherwise       -> services/airtable.js   (real Airtable base)
 *
 * Both implementations expose the identical interface, so commands
 * never need to know which one is active.
 */

const isDemoMode = String(process.env.DEMO_MODE || '').toLowerCase() === 'true';

module.exports = isDemoMode
  ? require('./demo-store')
  : require('./airtable');

module.exports.isDemoMode = isDemoMode;
