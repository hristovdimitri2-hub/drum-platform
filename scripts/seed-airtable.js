/**
 * Seed script — creates the Airtable base schema AUTOMATICALLY,
 * including the Shipments → Users LINK fields (the manual step from
 * ARCHITECTURE TODO #2 is gone — batch 1, task 2).
 *
 * Uses the Airtable Metadata API (beta): https://airtable.com/developers/web/api
 * Requires a token with `schema.bases:write` scope (airtable.com/create/tokens).
 *
 * Usage:
 *   node scripts/seed-airtable.js             # live run (needs .env creds)
 *   node scripts/seed-airtable.js --dry-run   # NO network, NO creds: prints
 *                                             # the exact plan (tables, link
 *                                             # fields, legacy upgrade, backfill)
 *
 * Live behaviour:
 *   1. GET  /tables      — what already exists (404 → empty base)
 *   2. POST /tables       — create missing tables; TABLES order creates
 *      Users FIRST so Shipments link fields can reference its id
 *   3. PATCH /tables/{id} — pre-existing base from the OLD seed: rename the
 *      text "Sender ID"/"Carrier ID" → "… (legacy)" (Airtable cannot convert
 *      a field type in place), then ADD multipleRecordLinks fields
 *   4. Backfill           — copy legacy text record-ids into the new link
 *      fields (Data API), batched, per-record fallback on bad values
 *
 * Rate limiting: conservative ≤1 req/s (MIN_INTERVAL_MS) + 429 retries
 * honouring Retry-After (MAX_RETRIES, exponential fallback).
 *
 * Plan builders/throttle are exported for unit tests
 * (tests/t2-airtable-links.test.cjs).
 */

require('dotenv').config();
const axios = require('axios');

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_BASE_ID;

// ---- rate limiting (respects Airtable's real limits) -----------------------
const MIN_INTERVAL_MS = 1100; // ≤ ~0.9 req/s (well under Airtable's ~5 req/s)
const MAX_RETRIES = 4;
const LEGACY_SUFFIX = ' (legacy)';

/** Shipments → Users link fields managed by this script. */
const SHIPMENT_LINK_FIELDS = [
  { name: 'Sender ID', linkedTable: 'Users' },
  { name: 'Carrier ID', linkedTable: 'Users' },
];

/**
 * Convert a field definition for table creation. `linkedTable` markers
 * become real multipleRecordLinks fields; linkedTableIds comes from the id
 * map (filled with real ids as tables get created; placeholders in dry-run).
 */
function tableFieldsForCreation(table, linkedTableIds = {}) {
  return table.fields.map((f) => {
    if (f.linkedTable) {
      return {
        name: f.name,
        type: 'multipleRecordLinks',
        options: {
          linkedTableId: linkedTableIds[f.linkedTable] || `<<${f.linkedTable}'s table id (resolved at runtime)>>`,
        },
      };
    }
    return { ...f };
  });
}

/**
 * PLAN for a fresh base: create every missing table in TABLES order
 * (Users first → its id is available for Shipments' link fields).
 * @param {string[]} existingTableNames
 */
function buildCreatePlan(existingTableNames = []) {
  const steps = [];
  const idMap = {};
  for (const table of tables) {
    if (existingTableNames.includes(table.name)) {
      idMap[table.name] = `<<existing ${table.name} id>>`;
      continue;
    }
    steps.push({
      op: 'create-table',
      table: table.name,
      fields: tableFieldsForCreation(table, idMap),
    });
    idMap[table.name] = `<<id returned for ${table.name}>>`;
  }
  return steps;
}

/**
 * PLAN for a base created by the PREVIOUS seed (text Sender/Carrier):
 * rename the legacy fields, then add link fields, then backfill links.
 * Idempotent: bases that already have the link fields produce NO steps.
 * @param {{name: string, id: string, fields: {id: string, name: string, type: string}[]}[]} existingTables
 */
function buildUpgradePlan(existingTables = []) {
  const steps = [];
  const shipments = existingTables.find((t) => t.name === 'Shipments');
  if (!shipments) return steps;
  const users = existingTables.find((t) => t.name === 'Users');
  const usersId = users ? users.id : '<<Users table id>>';

  const renames = [];
  const adds = [];
  for (const def of SHIPMENT_LINK_FIELDS) {
    const current = shipments.fields.find((f) => f.name === def.name);
    if (current && current.type === 'multipleRecordLinks') continue; // already migrated
    if (current) {
      renames.push({
        op: 'patch-table',
        tableId: shipments.id,
        body: { fields: [{ id: current.id, name: current.name + LEGACY_SUFFIX, type: current.type }] },
      });
    }
    adds.push({
      op: 'patch-table',
      tableId: shipments.id,
      body: { fields: [{ name: def.name, type: 'multipleRecordLinks', options: { linkedTableId: usersId } }] },
    });
  }
  // Renames FIRST — Airtable forbids duplicate field names in one table.
  steps.push(...renames, ...adds);
  if (adds.length) {
    steps.push({
      op: 'backfill-links',
      tableId: shipments.id,
      pairs: SHIPMENT_LINK_FIELDS.map((d) => ({ legacyName: d.name + LEGACY_SUFFIX, linkName: d.name })),
    });
  }
  return steps;
}

/**
 * Throttled API caller with 429 retries (rate limiting for seeding).
 * @param {{minIntervalMs?: number, sleep?: (ms:number)=>Promise<void>}} [opts]
 */
function makeCall(opts = {}) {
  const minIntervalMs = opts.minIntervalMs !== undefined ? opts.minIntervalMs : MIN_INTERVAL_MS;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  let last = 0;
  return async function call(fn) {
    for (let attempt = 0; ; attempt++) {
      const wait = Math.max(0, minIntervalMs - (Date.now() - last));
      if (wait > 0) await sleep(wait);
      last = Date.now();
      try {
        return await fn();
      } catch (err) {
        const status = err && err.response ? err.response.status : err.status;
        const headers = err && err.response ? err.response.headers : null;
        const retryAfter = headers && headers['retry-after'];
        if (status !== 429 || attempt >= MAX_RETRIES) throw err;
        const backoff = retryAfter ? Number(retryAfter) * 1000 : 2000 * (attempt + 1);
        console.warn(`  ⏳ 429 rate limited — retry in ${backoff} ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(backoff);
      }
    }
  };
}

const tables = [
  {
    name: 'Users',
    description: 'Потребители — изпращачи и превозвачи',
    fields: [
      { name: 'Telegram ID', type: 'number', options: { precision: 0 } },
      { name: 'First Name', type: 'singleLineText' },
      { name: 'Last Name', type: 'singleLineText' },
      { name: 'Username', type: 'singleLineText' },
      { name: 'Phone', type: 'phoneNumber' },
      { name: 'Language', type: 'singleLineText' },
      {
        name: 'KYC Status',
        type: 'singleSelect',
        options: {
          choices: [
            { name: 'pending' },
            { name: 'phone_verified' },
            { name: 'id_verified' },
            { name: 'rejected' },
          ],
        },
      },
      { name: 'Stripe Customer ID', type: 'singleLineText' },
      { name: 'Stripe Connect Account ID', type: 'singleLineText' },
      { name: 'Trust Score', type: 'number', options: { precision: 0 } },
      {
        name: 'Trust Tier',
        type: 'singleSelect',
        options: {
          choices: [
            { name: 'banned' },
            { name: 'limited' },
            { name: 'standard' },
            { name: 'verified' },
            { name: 'premium' },
          ],
        },
      },
      { name: 'Created At', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' } },
    ],
  },
  {
    name: 'Shipments',
    description: 'Заявки за доставки',
    fields: [
      { name: 'Sender ID', linkedTable: 'Users' }, // → multipleRecordLinks (automated)
      { name: 'Sender Telegram ID', type: 'number', options: { precision: 0 } },
      { name: 'Carrier ID', linkedTable: 'Users' }, // → multipleRecordLinks (automated)
      { name: 'Carrier Telegram ID', type: 'number', options: { precision: 0 } },
      { name: 'Carrier Stripe Account ID', type: 'singleLineText' }, // v0.2.0 — needed by /accept
      { name: 'Origin City', type: 'singleLineText' },
      { name: 'Destination City', type: 'singleLineText' },
      { name: 'Description', type: 'multilineText' },
      { name: 'Parcel Value (EUR)', type: 'number', options: { precision: 2 } },
      {
        name: 'Deadline',
        type: 'singleSelect',
        options: {
          choices: [
            { name: 'Днес' },
            { name: 'Утре' },
            { name: 'До 3 дни' },
            { name: 'До 7 дни' },
          ],
        },
      },
      { name: 'Total (EUR)', type: 'number', options: { precision: 2 } },
      { name: 'Base (EUR)', type: 'number', options: { precision: 2 } },
      { name: 'Fee (EUR)', type: 'number', options: { precision: 2 } },
      { name: 'Insurance (EUR)', type: 'number', options: { precision: 2 } },
      { name: 'Stripe Payment Intent ID', type: 'singleLineText' },
      { name: 'Stripe Transfer ID', type: 'singleLineText' },
      { name: 'Pickup QR Code', type: 'multipleAttachments' },
      { name: 'Delivery QR Code', type: 'multipleAttachments' },
      {
        name: 'Status',
        type: 'singleSelect',
        options: {
          choices: [
            { name: 'requested' },
            { name: 'paid' },
            { name: 'matched' },
            { name: 'picked_up' },
            { name: 'in_transit' },
            { name: 'delivered' },
            { name: 'cancelled' },
            { name: 'disputed' },
          ],
        },
      },
      { name: 'Matched At', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' } },
      { name: 'Pickup Scanned At', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' } },
      { name: 'Delivery Scanned At', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' } },
      { name: 'Created At', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' } },
    ],
  },
  {
    name: 'Trust Events',
    description: 'Event-sourced trust log (ebay/reputation-system pattern)',
    fields: [
      { name: 'User ID', type: 'singleLineText' },
      {
        name: 'Event Type',
        type: 'singleSelect',
        options: {
          choices: [
            { name: 'shipment_created' },
            { name: 'shipment_accepted' },
            { name: 'delivery_success' },
            { name: 'delivery_failed' },
            { name: 'dispute_raised' },
            { name: 'dispute_resolved' },
            { name: 'kyc_verified' },
            { name: 'rating_given' },
          ],
        },
      },
      { name: 'Event Value', type: 'number', options: { precision: 0 } },
      { name: 'Shipment ID', type: 'singleLineText' },
      { name: 'Metadata', type: 'multilineText' },
      { name: 'Created At', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' } },
    ],
  },
  {
    name: 'Carbon Ledger',
    description: 'GHG Protocol Scope 3 Cat 4 — CO2 спестявания',
    fields: [
      { name: 'Shipment ID', type: 'singleLineText' },
      { name: 'Origin City', type: 'singleLineText' }, // v0.2.0
      { name: 'Destination City', type: 'singleLineText' }, // v0.2.0
      { name: 'Baseline CO2 (kg)', type: 'number', options: { precision: 2 } },
      { name: 'Actual CO2 (kg)', type: 'number', options: { precision: 2 } },
      { name: 'Saved CO2 (kg)', type: 'number', options: { precision: 2 } },
      { name: 'Distance (km)', type: 'number', options: { precision: 0 } },
      { name: 'Methodology', type: 'singleLineText' },
      { name: 'Factors (audit trail)', type: 'singleLineText' }, // v0.2.0 — JSON с факторите
      {
        name: 'Verification Status',
        type: 'singleSelect',
        options: {
          choices: [
            { name: 'pending' },
            { name: 'verified' },
            { name: 'rejected' },
          ],
        },
      },
      { name: 'Created At', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'utc' } },
    ],
  },
];

// ---- Dry-run fixture: schema produced by the OLD seed (text link fields) ----
const LEGACY_FIXTURE = {
  tables: [
    { id: 'tblUsersLEGACY', name: 'Users', fields: [{ id: 'fldTelegramLEG', name: 'Telegram ID', type: 'number' }] },
    {
      id: 'tblShipmentsLEGACY',
      name: 'Shipments',
      fields: [
        { id: 'fldSenderLEG', name: 'Sender ID', type: 'singleLineText' },
        { id: 'fldCarrierLEG', name: 'Carrier ID', type: 'singleLineText' },
        { id: 'fldStatusLEG', name: 'Status', type: 'singleSelect' },
      ],
    },
  ],
};

function printStep(i, step) {
  if (step.op === 'create-table') {
    console.log(`  ${i}. POST /tables "${step.table}"`);
    for (const f of step.fields) {
      if (f.type === 'multipleRecordLinks') console.log(`       - ${f.name}: multipleRecordLinks → linkedTableId=${f.options.linkedTableId}`);
      else console.log(`       - ${f.name}: ${f.type}`);
    }
  } else if (step.op === 'patch-table') {
    const f = step.body.fields[0];
    if (f.id) console.log(`  ${i}. PATCH /tables/${step.tableId} — rename field → "${f.name}" (id ${f.id})`);
    else if (f.type === 'multipleRecordLinks') console.log(`  ${i}. PATCH /tables/${step.tableId} — ADD ${f.name}: multipleRecordLinks → linkedTableId=${f.options.linkedTableId}`);
    else console.log(`  ${i}. PATCH /tables/${step.tableId} — ${f.name}: ${f.type}`);
  } else if (step.op === 'backfill-links') {
    console.log(`  ${i}. BACKFILL — copy legacy text record-ids into link fields:`);
    for (const p of step.pairs) console.log(`       ${p.legacyName} → ${p.linkName} (Data API, batched)`);
  }
}

function printDryRun() {
  console.log('🌱 DRUM Airtable seed — DRY-RUN (no network, no credentials)\n');
  console.log('PLAN A — fresh base (table creation; link fields included):');
  buildCreatePlan([]).forEach((s, i) => printStep(i + 1, s));
  console.log('\nPLAN B — base created by the PREVIOUS seed (text Sender/Carrier fields):');
  buildUpgradePlan(LEGACY_FIXTURE.tables).forEach((s, i) => printStep(i + 1, s));
  console.log(`\nRate limiting: min interval ${MIN_INTERVAL_MS} ms (≤ ~0.9 req/s); ` +
    `429 → up to ${MAX_RETRIES} retries honouring Retry-After (exponential fallback).`);
  console.log('Link population: src/services/airtable.js writes record-id arrays with');
  console.log('a legacy-text fallback; PLAN B backfill converts existing rows.');
  console.log('\n✅ Dry-run complete — run without --dry-run for the live version.');
}

/** GET /tables (404 → empty base). */
async function listTables(meta, call) {
  try {
    const res = await call(() => meta.get('/tables'));
    return (res.data && res.data.tables) || [];
  } catch (err) {
    if (err.response && err.response.status === 404) return [];
    throw err;
  }
}

/**
 * Backfill link fields from legacy text values (Data API).
 * Records whose legacy value isn't a record id are skipped and reported.
 */
async function backfillLinks(call, dataApi, step) {
  let offset = null;
  let updated = 0;
  let examined = 0;
  const failures = [];
  do {
    const params = { pageSize: 100 };
    if (offset) params.offset = offset;
    const res = await call(() => dataApi.get(`/${step.tableId}`, { params }));
    const batch = [];
    for (const rec of res.data.records) {
      examined++;
      const fields = {};
      for (const pair of step.pairs) {
        const legacy = rec.fields[pair.legacyName];
        const current = rec.fields[pair.linkName];
        if (legacy && !current && /^rec/.test(String(legacy))) fields[pair.linkName] = [String(legacy)];
      }
      if (Object.keys(fields).length) batch.push({ id: rec.id, fields });
    }
    for (let i = 0; i < batch.length; i += 10) {
      const chunk = batch.slice(i, i + 10);
      try {
        await call(() => dataApi.patch(`/${step.tableId}`, { records: chunk }));
        updated += chunk.length;
      } catch (err) {
        // Per-record fallback: one bad legacy value must not drop the rest.
        void err;
        for (const rec of chunk) {
          try {
            await call(() => dataApi.patch(`/${step.tableId}`, { records: [rec] }));
            updated++;
          } catch (err2) {
            const msg = err2.response && err2.response.data && err2.response.data.error
              ? err2.response.data.error.message : err2.message;
            failures.push(`${rec.id}: ${msg}`);
          }
        }
      }
    }
    offset = res.data.offset;
  } while (offset);
  return { updated, examined, failures };
}

async function runLive() {
  const meta = axios.create({
    baseURL: `https://api.airtable.com/v0/meta/bases/${BASE_ID}`,
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
  });
  const dataApi = axios.create({
    baseURL: `https://api.airtable.com/v0/${BASE_ID}`,
    headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' },
  });
  const call = makeCall();

  console.log('🌱 Seeding Airtable base...\n');
  const existing = await listTables(meta, call);
  const existingNames = existing.map((t) => t.name);

  // 1) Create missing tables — Users first so link fields can reference it.
  const idMap = {};
  for (const table of tables) {
    if (existingNames.includes(table.name)) {
      idMap[table.name] = existing.find((t) => t.name === table.name).id;
      console.log(`  ⚠️  Table ${table.name} already exists — skipping creation`);
      continue;
    }
    try {
      const res = await call(() => meta.post('/tables', {
        name: table.name,
        description: table.description,
        fields: tableFieldsForCreation(table, idMap),
      }));
      idMap[table.name] = res.data.id;
      console.log(`  ✅ Created: ${table.name} (${res.data.id})`);
    } catch (err) {
      const msg = err.response ? JSON.stringify(err.response.data) : err.message;
      if (/already exists/i.test(msg)) {
        console.log(`  ⚠️  Table ${table.name} already exists — skipping`);
      } else {
        console.error(`  ❌ Error creating ${table.name}:`, msg);
        throw err;
      }
    }
  }

  // 2) Upgrade a base seeded by the OLD script (text → link) + backfill links.
  const upgradeSteps = buildUpgradePlan(existing);
  if (upgradeSteps.length) console.log('\n  Upgrading link fields (legacy base detected):');
  for (const step of upgradeSteps) {
    if (step.op === 'patch-table') {
      await call(() => meta.patch(`/tables/${step.tableId}`, step.body));
      const f = step.body.fields[0];
      console.log(`  ✅ ${f.id ? `Renamed → "${f.name}"` : `Added ${f.name} (${f.type})`}`);
    } else if (step.op === 'backfill-links') {
      const result = await backfillLinks(call, dataApi, step);
      console.log(`  ✅ Backfill: ${result.updated}/${result.examined} records linked`);
      for (const fl of result.failures) console.warn(`     ⚠️ skipped ${fl}`);
    }
  }

  console.log('\n✅ Seed complete!');
  console.log('   Shipments.Sender/Carrier са link полета към Users — без ръчни стъпки.');
}

async function main() {
  const dryRun = process.argv.includes('--dry-run') ||
    String(process.env.DRY_RUN || '').toLowerCase() === 'true';
  if (dryRun) return printDryRun();
  if (!AIRTABLE_API_KEY || !BASE_ID) {
    console.error('❌ Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID in .env');
    console.error('   (Credential-free preview: node scripts/seed-airtable.js --dry-run)');
    process.exit(1);
  }
  await runLive();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err.response ? JSON.stringify(err.response.data) : err.message);
    process.exit(1);
  });
}

module.exports = {
  TABLES: tables,
  SHIPMENT_LINK_FIELDS,
  LEGACY_SUFFIX,
  LEGACY_FIXTURE,
  MIN_INTERVAL_MS,
  MAX_RETRIES,
  tableFieldsForCreation,
  buildCreatePlan,
  buildUpgradePlan,
  makeCall,
  backfillLinks,
  printDryRun,
};

