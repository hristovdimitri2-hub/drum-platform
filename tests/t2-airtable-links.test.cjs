/**
 * Batch 1 / Task 2 — Airtable link fields WITHOUT the manual step.
 *
 * Proof strategy (no Airtable credentials in this environment — the LIVE
 * API path is NOT claimed to be verified):
 *   1. `--dry-run` (spawned, no network/creds) prints the full plan.
 *   2. Plan builders unit-tested against the old-seed schema fixture.
 *   3. Throttle/429-retry unit-tested with injected sleep.
 *   4. airtable.js read/write logic unit-tested via __test exports.
 */

process.env.AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY || 'keyTESTNOTREAL';
process.env.AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || 'appTESTNOTREAL';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const seed = require('../scripts/seed-airtable.js');
const airtableSvc = require('../src/services/airtable');

const ROOT = path.join(__dirname, '..');

// --- 1. Dry-run (spawned): proves the plan without credentials/network -----
test('T2: seed --dry-run prints the link-field plan (no creds, no network)', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'seed-airtable.js'), '--dry-run'], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  assert.match(out, /DRY-RUN/, 'dry-run marker present');
  assert.match(out, /multipleRecordLinks/, 'link field type printed');
  assert.match(out, /linkedTableId/, 'link target printed');
  // Users must be created BEFORE Shipments (link target exists)
  const iUsers = out.indexOf('POST /tables "Users"');
  const iShipments = out.indexOf('POST /tables "Shipments"');
  assert.ok(iUsers !== -1 && iShipments !== -1, 'both table creations printed');
  assert.ok(iUsers < iShipments, 'Users created before Shipments');
  // legacy upgrade plan: rename → add → backfill
  assert.match(out, /Sender ID \(legacy\)/, 'legacy rename printed');
  assert.match(out, /ADD Sender ID: multipleRecordLinks/, 'link add printed');
  assert.match(out, /BACKFILL/, 'backfill printed');
  // rate limiting is part of the contract
  assert.match(out, /429/);
  assert.match(out, /Rate limiting/);
});

// --- 2. Plan builders (pure, unit-tested) -----------------------------------
test('T2: fresh-base plan creates Shipments with multipleRecordLinks → Users', () => {
  const plan = seed.buildCreatePlan([]);
  assert.equal(plan[0].table, 'Users', 'Users first');
  const ship = plan.find((s) => s.table === 'Shipments');
  assert.ok(ship, 'Shipments in plan');
  const sender = ship.fields.find((f) => f.name === 'Sender ID');
  const carrier = ship.fields.find((f) => f.name === 'Carrier ID');
  assert.equal(sender.type, 'multipleRecordLinks');
  assert.equal(carrier.type, 'multipleRecordLinks');
  assert.match(sender.options.linkedTableId, /Users/);
  assert.match(carrier.options.linkedTableId, /Users/);
  // no text Sender/Carrier remains in a fresh plan
  assert.ok(!ship.fields.some((f) => f.name === 'Sender ID' && f.type === 'singleLineText'));
  // /accept dependency must exist in the fresh schema
  assert.ok(ship.fields.some((f) => f.name === 'Carrier Stripe Account ID' && f.type === 'singleLineText'));
  // v0.2.0 carbon fields (createCarbonEntry writes them)
  const carbon = plan.find((s) => s.table === 'Carbon Ledger');
  assert.ok(carbon.fields.some((f) => f.name === 'Factors (audit trail)'));
  assert.ok(carbon.fields.some((f) => f.name === 'Origin City'));
});

test('T2: create plan skips tables that already exist', () => {
  const plan = seed.buildCreatePlan(['Users']);
  assert.ok(!plan.some((s) => s.table === 'Users'));
  const ship = plan.find((s) => s.table === 'Shipments');
  const sender = ship.fields.find((f) => f.name === 'Sender ID');
  assert.match(sender.options.linkedTableId, /Users/, 'still references Users (resolved at runtime)');
});

test('T2: upgrade plan for an old-seed base: renames BEFORE adds, then backfill', () => {
  const steps = seed.buildUpgradePlan(seed.LEGACY_FIXTURE.tables);
  assert.deepEqual(steps.map((s) => s.op), ['patch-table', 'patch-table', 'patch-table', 'patch-table', 'backfill-links']);

  const renameSender = steps.find((s) => s.body.fields[0].name === 'Sender ID (legacy)');
  assert.ok(renameSender, 'legacy field renamed (types cannot be converted in place)');
  assert.equal(renameSender.body.fields[0].id, 'fldSenderLEG');
  assert.equal(renameSender.body.fields[0].type, 'singleLineText');

  const addSender = steps.find((s) => s.body.fields[0].name === 'Sender ID');
  assert.equal(addSender.body.fields[0].type, 'multipleRecordLinks');
  assert.equal(addSender.body.fields[0].options.linkedTableId, 'tblUsersLEGACY', 'links to the Users table id');

  // ordering: both renames must precede both adds (duplicate names forbidden)
  const patchSteps = steps.filter((s) => s.op === 'patch-table');
  const lastRenameIdx = patchSteps.reduce((acc, s, i) => (s.body.fields[0].id ? i : acc), -1);
  const addIdx = patchSteps.findIndex((s) => !s.body.fields[0].id);
  assert.ok(lastRenameIdx >= 0 && addIdx >= 0 && lastRenameIdx < addIdx, 'renames before adds');

  const backfill = steps[steps.length - 1];
  assert.equal(backfill.op, 'backfill-links');
  assert.deepEqual(backfill.pairs, [
    { legacyName: 'Sender ID (legacy)', linkName: 'Sender ID' },
    { legacyName: 'Carrier ID (legacy)', linkName: 'Carrier ID' },
  ]);
});

test('T2: upgrade plan is idempotent (migrated base → no steps; no Shipments → no steps)', () => {
  const migrated = [
    { id: 'tblU', name: 'Users', fields: [] },
    {
      id: 'tblS',
      name: 'Shipments',
      fields: [
        { id: 'a', name: 'Sender ID', type: 'multipleRecordLinks' },
        { id: 'b', name: 'Carrier ID', type: 'multipleRecordLinks' },
      ],
    },
  ];
  assert.equal(seed.buildUpgradePlan(migrated).length, 0);
  assert.equal(seed.buildUpgradePlan([{ id: 'tblU', name: 'Users', fields: [] }]).length, 0);
  assert.equal(seed.buildUpgradePlan([]).length, 0);
});

// --- 3. Rate limiting / 429 retries (injected sleep — no real waiting) -----
test('T2: throttle enforces the min interval between calls', async () => {
  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); };
  const call = seed.makeCall({ minIntervalMs: 200, sleep });
  await call(async () => 1);
  await call(async () => 2);
  await call(async () => 3);
  const rateSleeps = sleeps.filter((ms) => ms > 0 && ms <= 200);
  assert.ok(rateSleeps.length >= 2, `expected ≥2 throttle sleeps, got ${JSON.stringify(sleeps)}`);
});

test('T2: 429 honours Retry-After then succeeds; non-429 and exhaustion rethrow', async () => {
  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); };

  const call = seed.makeCall({ minIntervalMs: 0, sleep });
  let n = 0;
  const out = await call(async () => {
    n++;
    if (n === 1) {
      const e = new Error('rate limited');
      e.response = { status: 429, headers: { 'retry-after': '2' } };
      throw e;
    }
    return 'ok';
  });
  assert.equal(out, 'ok');
  assert.ok(sleeps.includes(2000), `Retry-After honoured: ${JSON.stringify(sleeps)}`);

  const call2 = seed.makeCall({ minIntervalMs: 0, sleep });
  await assert.rejects(
    () => call2(async () => { const e = new Error('boom'); e.statusCode = 500; throw e; }),
    /boom/,
    'non-429 errors are not retried'
  );

  const call3 = seed.makeCall({ minIntervalMs: 0, sleep });
  let calls = 0;
  await assert.rejects(() => call3(async () => {
    calls++;
    const e = new Error('always 429');
    e.response = { status: 429, headers: {} };
    throw e;
  }));
  assert.equal(calls, seed.MAX_RETRIES + 1, 'gives up after max retries');
});

// --- 4. airtable.js link read/write logic (pure parts via __test) -----------
test('T2: mapShipment reads link ARRAYS and legacy TEXT (carrierStripeAccountId intact)', () => {
  const { mapShipment } = airtableSvc.__test;
  const linked = mapShipment({
    id: 'recS1',
    fields: {
      'Sender ID': ['recU1'],
      'Carrier ID': ['recC1'],
      'Carrier Stripe Account ID': 'acct_test_123',
      Status: 'matched',
    },
  });
  assert.equal(linked.senderId, 'recU1');
  assert.equal(linked.carrierId, 'recC1');
  assert.equal(linked.carrierStripeAccountId, 'acct_test_123', '/accept mapping intact');

  const legacy = mapShipment({
    id: 'recS2',
    fields: { 'Sender ID': 'recU2', 'Carrier ID': 'recC2', Status: 'requested' },
  });
  assert.equal(legacy.senderId, 'recU2');
  assert.equal(legacy.carrierId, 'recC2');
});

test('T2: planWriteFallback — 422 cast → scalar; unknown field → drop; else rethrow', () => {
  const { planWriteFallback, SHIPMENT_LINK_FIELDS } = airtableSvc.__test;
  const fields = { 'Sender ID': ['recU1'], 'Carrier ID': ['recC1'], Status: 'matched' };

  // string-typed error (as the airtable npm package reports)
  const cast = Object.assign(new Error('expected value'), { statusCode: 422, error: 'INVALID_VALUE_AFTER_CAST' });
  assert.deepEqual(planWriteFallback(cast, fields, SHIPMENT_LINK_FIELDS),
    { 'Sender ID': 'recU1', 'Carrier ID': 'recC1', Status: 'matched' });

  // object-typed variant
  const cast2 = Object.assign(new Error('bad'), { statusCode: 422, error: { type: 'INVALID_VALUE' } });
  assert.equal(planWriteFallback(cast2, { 'Sender ID': ['recX'] }, SHIPMENT_LINK_FIELDS)['Sender ID'], 'recX');

  // unknown field → link keys dropped, rest kept
  const unknown = Object.assign(new Error('Unknown field name'), { statusCode: 422, error: 'UNKNOWN_FIELD_NAME' });
  const rest = planWriteFallback(unknown, fields, SHIPMENT_LINK_FIELDS);
  assert.ok(!('Sender ID' in rest) && !('Carrier ID' in rest));
  assert.equal(rest.Status, 'matched');

  // non-422 → null (rethrow original); payload without links → null;
  // already-scalar → null (no infinite loop)
  const fatal = Object.assign(new Error('server'), { statusCode: 500 });
  assert.equal(planWriteFallback(fatal, fields, SHIPMENT_LINK_FIELDS), null);
  assert.equal(planWriteFallback(cast, { Status: 'x' }, SHIPMENT_LINK_FIELDS), null);
  assert.equal(planWriteFallback(cast, { 'Sender ID': 'recU1' }, SHIPMENT_LINK_FIELDS), null);
});

test('T2: writeWithLinkFallback applies the ladder end-to-end', async () => {
  const { writeWithLinkFallback, SHIPMENT_LINK_FIELDS } = airtableSvc.__test;

  // legacy base: array rejected once → scalar retry succeeds
  let attempts = 0;
  const ok = await writeWithLinkFallback(async (f) => {
    attempts++;
    if (attempts === 1) throw Object.assign(new Error('cast'), { statusCode: 422, error: 'INVALID_VALUE_AFTER_CAST' });
    assert.equal(f['Sender ID'], 'recU1', 'scalar on retry');
    return 'written';
  }, { 'Sender ID': ['recU1'], Status: 'matched' }, SHIPMENT_LINK_FIELDS);
  assert.equal(ok, 'written');
  assert.equal(attempts, 2);

  // misconfigured base: unknown field twice → payload without link fields
  const unknown = () => Object.assign(new Error('Unknown field name'), { statusCode: 422, error: 'UNKNOWN_FIELD_NAME' });
  let payload2 = null;
  const ok2 = await writeWithLinkFallback(async (f) => {
    if (!('Sender ID' in f)) { payload2 = f; return 'written2'; }
    throw unknown();
  }, { 'Sender ID': ['recU1'], 'Carrier ID': ['recC1'], Status: 'matched' }, SHIPMENT_LINK_FIELDS);
  assert.equal(ok2, 'written2');
  assert.deepEqual(payload2, { Status: 'matched' });

  // non-retryable error propagates on the first attempt
  await assert.rejects(
    () => writeWithLinkFallback(async () => { throw Object.assign(new Error('nope'), { statusCode: 500 }); },
      { 'Sender ID': ['x'] }, SHIPMENT_LINK_FIELDS),
    /nope/
  );
});
