/**
 * P2 — the Airtable backend, exercised end-to-end against a fake Airtable API.
 *
 * Why
 * ---
 * P2.2 asked for a CI job that runs with DATA_BACKEND=airtable (mock). The
 * adapter had only ever been unit-tested on its pure mappers
 * (t2-airtable-links.test.cjs); the actual HTTP read/write paths were never
 * executed, and the adapter turned out to be missing 12 methods the application
 * calls without a guard.
 *
 * How
 * ---
 * `airtable@0.12` reads `process.env.AIRTABLE_ENDPOINT_URL` (see
 * node_modules/airtable/lib/airtable.js:48), so a loopback HTTP server can
 * stand in for api.airtable.com. No network, no credentials.
 *
 * Also asserts the NEW load-time interface gate in services/store.js: an
 * incomplete production backend must fail the boot instead of throwing in the
 * middle of a payment.
 */

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { URL } = require('node:url');

/** Minimal in-memory Airtable: enough for the calls the adapter makes. */
function createFakeAirtable() {
  const tables = new Map();
  const rowsFor = (name) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };
  let seq = 0;
  const newId = () => 'rec' + String(++seq).padStart(14, '0');

  function matches(record, formula) {
    if (!formula) return true;
    const f = String(formula).trim();
    if (f.startsWith('OR(') && f.endsWith(')')) {
      // OR({Status} = "requested", {Status} = "paid")
      const inner = f.slice(3, -1);
      const parts = inner.split(/,\s*(?=\{)/);
      return parts.some((p) => matches(record, p));
    }
    let m = /^RECORD_ID\(\)\s*=\s*"([^"]*)"$/.exec(f);
    if (m) return record.id === m[1];
    m = /^\{([^}]+)\}\s*=\s*(.*)$/.exec(f);
    if (m) {
      const want = m[2].trim().replace(/^['"]|['"]$/g, '');
      return String(record.fields[m[1]]) === want;
    }
    throw new Error('fake-airtable: unsupported formula: ' + f);
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const parts = url.pathname.split('/').filter(Boolean); // v0 / baseId / table / [recordId]
    const table = decodeURIComponent(parts[2] || '');
    const recordId = parts[3];
    const rows = rowsFor(table);
    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return send(400, { error: { type: 'INVALID_REQUEST' } });
      }

      if (req.method === 'GET' && recordId) {
        const found = rows.find((r) => r.id === recordId);
        return found ? send(200, found) : send(404, { error: { type: 'NOT_FOUND' } });
      }

      if (req.method === 'GET') {
        let out = rows.filter((r) => matches(r, url.searchParams.get('filterByFormula')));
        const field = url.searchParams.get('sort[0][field]');
        const dir = url.searchParams.get('sort[0][direction]') || 'asc';
        if (field) {
          out = [...out].sort(
            (a, b) =>
              String(a.fields[field] || '').localeCompare(String(b.fields[field] || '')) *
              (dir === 'desc' ? -1 : 1)
          );
        }
        const max = Number(url.searchParams.get('maxRecords')) || out.length;
        return send(200, { records: out.slice(0, max) });
      }

      // airtable@0.12 sends `create(fields)` as POST {fields} and
      // `update(id, fields)` as PATCH /{id} {fields} — single objects, not
      // `{records: [...]}`. Its `create`/`update` helpers read the record from
      // the TOP-LEVEL id/fields, so the reply carries both shapes.
      const wrap = (rec) => ({
        records: [rec],
        id: rec.id,
        fields: rec.fields,
        createdTime: rec.createdTime,
      });

      if (req.method === 'POST') {
        const payloads = body.records ? body.records.map((r) => r.fields || {}) : [body.fields || body];
        const created = payloads.map((fields) => {
          const rec = { id: newId(), fields: { ...fields }, createdTime: new Date().toISOString() };
          rows.push(rec);
          return rec;
        });
        return send(200, created.length === 1 ? wrap(created[0]) : { records: created });
      }

      if (req.method === 'PATCH') {
        const payloads = body.records
          ? body.records.map((r) => ({ id: r.id, fields: r.fields || {} }))
          : [{ id: recordId, fields: body.fields || body }];
        const updated = payloads
          .map(({ id, fields }) => {
            const rec = rows.find((x) => x.id === id);
            if (!rec) return null;
            Object.assign(rec.fields, fields);
            return rec;
          })
          .filter(Boolean);
        if (!updated.length) return send(404, { error: { type: 'NOT_FOUND' } });
        return send(200, updated.length === 1 ? wrap(updated[0]) : { records: updated });
      }

      return send(405, { error: { type: 'METHOD_NOT_ALLOWED' } });
    });
  });

  return { server, tables, rowsFor };
}

let fake;
let adapter;

test.before(async () => {
  fake = createFakeAirtable();
  await new Promise((resolve) => fake.server.listen(0, '127.0.0.1', resolve));

  // MUST be set before `airtable` is first required — its default endpoint is
  // read from the environment at module load.
  process.env.AIRTABLE_ENDPOINT_URL = `http://127.0.0.1:${fake.server.address().port}`;
  process.env.AIRTABLE_API_KEY = 'key_mock';
  process.env.AIRTABLE_BASE_ID = 'appMock';
  process.env.DATA_BACKEND = 'airtable';

  adapter = require('../src/services/airtable');
});

test.after(async () => {
  if (fake) await new Promise((resolve) => fake.server.close(resolve));
});

// --------------------------------------------------------------------------

test('P2 airtable: findOrCreateUser creates, then finds the same user', async () => {
  const created = await adapter.findOrCreateUser({
    telegramId: 777001,
    firstName: 'Иван',
    lastName: 'Петров',
    username: 'ivan_p2',
    language: 'bg',
  });
  assert.ok(created.id, 'must return a record id');
  assert.equal(created.telegramId, 777001);
  assert.equal(created.firstName, 'Иван');
  assert.equal(created.trustScore, 50, 'new users start at 50');
  assert.equal(created.trustTier, 'standard');
  assert.equal(created.kycStatus, 'pending');

  const again = await adapter.findOrCreateUser({
    telegramId: 777001,
    firstName: 'Duplicate',
  });
  assert.equal(again.id, created.id, 'the second call must NOT create a duplicate');
  assert.equal(fake.rowsFor('Users').length, 1);
});

test('P2 airtable: findUserByTelegramId returns null for an unknown id', async () => {
  assert.equal(await adapter.findUserByTelegramId(999999), null);
});

test('P2 airtable: updateUser maps camelCase fields onto Airtable columns', async () => {
  const user = await adapter.findUserByTelegramId(777001);
  const updated = await adapter.updateUser(777001, {
    phone: '+359888000111',
    kycStatus: 'verified',
    stripeCustomerId: 'cus_mock',
    trustScore: 60,
    trustTier: 'standard',
  });
  assert.equal(updated.id, user.id);
  assert.equal(updated.phone, '+359888000111');
  assert.equal(updated.kycStatus, 'verified');
  assert.equal(updated.stripeCustomerId, 'cus_mock');
  assert.equal(updated.trustScore, 60);
});

test('P2 airtable: updateUser throws for an unknown user instead of writing', async () => {
  await assert.rejects(() => adapter.updateUser(424242, { trustScore: 10 }), /User not found/);
});

test('P2 airtable: createShipment → getShipment round-trips the money fields', async () => {
  const created = await adapter.createShipment({
    senderTelegramId: 777001,
    originCity: 'София',
    destinationCity: 'Пловдив',
    description: 'Малък пакет',
    parcelValueEur: 50,
    deadline: 'Днес',
    totalEur: 12,
    baseEur: 10,
    feeEur: 1.8,
    insuranceEur: 0.6,
  });
  assert.ok(created.id);
  assert.equal(created.totalEur, 12);
  assert.equal(created.feeEur, 1.8);
  assert.equal(created.insuranceEur, 0.6);

  const fetched = await adapter.getShipment(created.id);
  assert.equal(fetched.id, created.id);
  assert.equal(fetched.destinationCity, 'Пловдив');
  assert.equal(fetched.totalEur, 12);
});

test('P2 airtable: getShipment returns null (not a throw) for a missing record', async () => {
  assert.equal(await adapter.getShipment('recDoesNotExist'), null);
});

test('P2 airtable: updateShipment advances the status', async () => {
  const [shipment] = fake.rowsFor('Shipments').map((r) => r);
  const mapped = { id: shipment.id };
  const updated = await adapter.updateShipment(mapped.id, {
    status: 'matched',
    carrierTelegramId: 777002,
    matchedAt: new Date().toISOString(),
  });
  assert.equal(updated.status, 'matched');
  assert.equal(updated.carrierTelegramId, 777002);
});

test('P2 airtable: listPendingShipments filters to requested/paid', async () => {
  await adapter.createShipment({
    senderTelegramId: 777001,
    originCity: 'София',
    destinationCity: 'Варна',
    description: 'Документи',
    totalEur: 18,
    baseEur: 15,
    feeEur: 2.7,
    insuranceEur: 0.9,
    status: 'requested',
  });
  const pending = await adapter.listPendingShipments();
  assert.ok(pending.length >= 1);
  for (const s of pending) {
    assert.ok(['requested', 'paid'].includes(s.status), `unexpected status ${s.status}`);
  }
});

test('P2 airtable: listAllShipments and listShipmentsByUser read the same table', async () => {
  const all = await adapter.listAllShipments();
  assert.equal(all.length, fake.rowsFor('Shipments').length);

  const byUser = await adapter.listShipmentsByUser(777001);
  assert.ok(byUser.length >= 1);
});

test('P2 airtable: logTrustEvent writes to the Trust Events table', async () => {
  await adapter.logTrustEvent({
    userId: 'recUserMock',
    eventType: 'kyc_verified',
    eventValue: 10,
    shipmentId: null,
    metadata: { source: 'p2-test' },
  });
  assert.equal(fake.rowsFor('Trust Events').length, 1);
});

test('P2 airtable: carbon entries round-trip', async () => {
  await adapter.createCarbonEntry({
    shipmentId: 'recShipMock',
    originCity: 'София',
    destinationCity: 'Пловдив',
    baselineCo2Kg: 24.5,
    actualCo2Kg: 3.1,
    savingsKg: 21.4,
    savingsPct: 87.3,
  });
  const entries = await adapter.listCarbonEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].baselineCo2Kg, 24.5);
});

// --------------------------------------------------------------------------
// Interface gate (services/store.js)
// --------------------------------------------------------------------------

const REQUIRED = [
  'findOrCreateUser', 'findUserByTelegramId', 'updateUser', 'updateTrustScore',
  'createShipment', 'getShipment', 'updateShipment', 'listShipmentsByUser',
  'listPendingShipments', 'listAllShipments', 'logTrustEvent',
  'createCarbonEntry', 'listCarbonEntries',
  'recordTransaction', 'listTransactionsByShipment',
  'saveQrCode', 'getQrCode', 'markQrScanned',
  'createDispute', 'getDispute', 'listDisputes', 'updateDisputeStatus', 'countLostDisputes',
  'isWebhookProcessed', 'markWebhookProcessed',
];

test('P2 airtable: the sqlite backend satisfies the whole required interface', () => {
  const sqlite = require('../src/services/db/sqlite');
  const missing = REQUIRED.filter((m) => typeof sqlite[m] !== 'function');
  assert.deepEqual(missing, [], `sqlite must implement everything; missing: ${missing.join(', ')}`);
});

test('P2 airtable: the adapter gap is exactly the documented 12 methods', () => {
  const missing = REQUIRED.filter((m) => typeof adapter[m] !== 'function');
  assert.deepEqual(missing, [
    'recordTransaction',
    'listTransactionsByShipment',
    'saveQrCode',
    'getQrCode',
    'markQrScanned',
    'createDispute',
    'getDispute',
    'listDisputes',
    'updateDisputeStatus',
    'countLostDisputes',
    'isWebhookProcessed',
    'markWebhookProcessed',
  ], 'the Airtable gap changed — update docs/ARCHITECTURE.md and this allowlist together');
});

test('P2 airtable: store.js refuses to boot an incomplete airtable backend', () => {
  delete process.env.ALLOW_INCOMPLETE_BACKEND;
  assert.throws(
    () => require('../src/services/store'),
    /DATA_BACKEND=airtable is missing 12 required method/
  );
});

test('P2 airtable: ALLOW_INCOMPLETE_BACKEND=true downgrades the gate to a warning', () => {
  process.env.ALLOW_INCOMPLETE_BACKEND = 'true';
  const store = require('../src/services/store');
  assert.equal(store.backend, 'airtable');
  assert.equal(typeof store.findOrCreateUser, 'function');
  assert.equal(store.missingBackendMethods(store).length, 12);
  delete process.env.ALLOW_INCOMPLETE_BACKEND;
});
