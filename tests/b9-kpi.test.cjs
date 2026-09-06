/**
 * B9 tests — Ops/KPI metrics (kill-switch set) over synthetic + store data.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drum-b9-'));
process.env.SQLITE_PATH = path.join(tmp, 'test.db');
process.env.DATA_BACKEND = 'sqlite';

const kpi = require('../src/services/kpi');
const store = require('../src/services/store');

const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

test('B9: match rate + avg time to match (synthetic)', () => {
  const shipments = [
    { status: 'delivered', carrierId: 'c1', createdAt: iso(NOW - 3 * 3600000), matchedAt: iso(NOW - 2 * 3600000), deliveryScannedAt: iso(NOW - 3600000), senderId: 's1' },
    { status: 'delivered', carrierId: 'c1', createdAt: iso(NOW - 2 * 3600000), matchedAt: iso(NOW - 3600000), deliveryScannedAt: iso(NOW - 1800000), senderId: 's1' },
    { status: 'requested', createdAt: iso(NOW - 3600000) },
  ];
  const k = kpi.computeKpis({ shipments, nowMs: NOW });
  assert.equal(k.matchRatePct, 66.7);            // 2 of 3
  assert.equal(k.avgTimeToMatchHours, 1);        // both matched in 1h
  assert.equal(k.delivered, 2);
  assert.equal(k.requested, 1);
});

test('B9: repeat rate 30d — 1 sender with 2 deliveries → 100%', () => {
  const shipments = [
    { status: 'delivered', senderId: 's1', deliveryScannedAt: iso(NOW - 5 * 86400000) },
    { status: 'delivered', senderId: 's1', deliveryScannedAt: iso(NOW - 2 * 86400000) },
  ];
  const k = kpi.computeKpis({ shipments, nowMs: NOW });
  assert.equal(k.repeatRate30dPct, 100);
});

test('B9: repeat rate — single delivery sender → 0%', () => {
  const shipments = [
    { status: 'delivered', senderId: 's1', deliveryScannedAt: iso(NOW - 2 * 86400000) },
  ];
  const k = kpi.computeKpis({ shipments, nowMs: NOW });
  assert.equal(k.repeatRate30dPct, 0);
});

test('B9: dispute rate + lost parcel proxy', () => {
  const shipments = [{ status: 'delivered', senderId: 's1' }, { status: 'delivered', senderId: 's1' }];
  const disputes = [
    { status: 'lost', shipmentId: 'x' },
    { status: 'resolved', shipmentId: 'x' },
  ];
  const k = kpi.computeKpis({ shipments, disputes, nowMs: NOW });
  assert.equal(k.disputeRatePct, 100);           // 2 disputes / 2 shipments
  assert.equal(k.lostParcelRatePct, 33.3);       // 1 lost / (2 delivered + 1 lost)
});

test('B9: honest gaps — NPS is null with note', () => {
  const k = kpi.computeKpis({ shipments: [], nowMs: NOW });
  assert.equal(k.nps, null);
  assert.match(k.npsNote, /survey/);
  assert.equal(k.matchRatePct, null);            // no data → n/a, not fake 0
});

test('B9: active users (30d) counts sender+carrier of recent shipments', async () => {
  const a = await store.findOrCreateUser({ telegramId: 910001, firstName: 'A' });
  const b = await store.findOrCreateUser({ telegramId: 910002, firstName: 'B' });
  const s = await store.createShipment({
    senderId: a.id, senderTelegramId: a.telegramId,
    originCity: 'София', destinationCity: 'Пловдив', status: 'requested',
  });
  await store.updateShipment(s.id, {
    carrierId: b.id, carrierTelegramId: b.telegramId,
    status: 'matched', matchedAt: iso(NOW - 3600000),
  });
  const k = kpi.computeKpis({
    users: await store.listUsers(),
    shipments: await store.listAllShipments(),
    nowMs: NOW,
  });
  assert.equal(k.activeUsers30d, 2);
});
