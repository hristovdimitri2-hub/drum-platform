/**
 * B8.1 tests — price as a scenario axis (3 calibrations), VAT-on-top canon,
 * break-even ladder, scenarios with visible derivation.
 */

const test = require('node:test');
const assert = require('node:assert');
const fin = require('../src/services/finance');

test('B8.1: 3 calibrations with documented tickets', () => {
  assert.deepEqual(
    fin.TICKET_CALEBRATIONS.map((c) => [c.key, c.ticketCents, c.userPaysEur]),
    [
      ['GTM_ENTRY', 437, 4.5],
      ['BASE', 775, 8.0],
      ['PREMIUM', 1380, 13.8],
    ]
  );
});

test('B8.1: GTM_ENTRY (T=4.37) - fixed Stripe fee crushes margin to 0.21', () => {
  const w = fin.waterfall(437);
  assert.equal(w.carrierCents, 350);            // ~3.50 per delivery (80%)
  assert.equal(w.drumFeeCents, 66);
  assert.equal(w.insuranceCents, 21);
  assert.equal(w.stripeFeeCents, 32);           // 7 + 25 (FIXED fee dominates)
  assert.equal(w.vatCents, 13);                 // 20% on top of 66
  assert.equal(w.platformRetainedCents, 21);    // 66 - 13 - 32
  assert.equal(w.netMarginPct, 4.8);
  assert.equal(w.reconciliationRemainderCents, 0);
});

test('B8.1: BASE (T=7.75) - data-room canon: retained 0.56/delivery', () => {
  const w = fin.waterfall(775);
  assert.equal(w.carrierCents, 620);
  assert.equal(w.drumFeeCents, 116);
  assert.equal(w.insuranceCents, 39);
  assert.equal(w.stripeFeeCents, 37);
  assert.equal(w.vatCents, 23);
  assert.equal(w.platformRetainedCents, 56);
  assert.equal(w.netMarginPct, 7.22);
  assert.equal(w.reconciliationRemainderCents, 0);
});

test('B8.1: PREMIUM (T=13.80) - retained 1.20 (was 1.27 with old VAT path)', () => {
  const w = fin.waterfall(1380);
  assert.equal(w.carrierCents, 1104);
  assert.equal(w.drumFeeCents, 207);
  assert.equal(w.vatCents, 41);                 // ON TOP: 20% x 207 = 41.4 -> 41 (not 34)
  assert.equal(w.stripeFeeCents, 46);
  assert.equal(w.platformRetainedCents, 120);
  assert.equal(w.netMarginPct, 8.69);
  assert.equal(w.reconciliationRemainderCents, 0);
});

test('B8.1: reconciliation is 0.00 for all calibrations, 1..5000 cents', () => {
  const tickets = fin.TICKET_CALEBRATIONS.map((c) => c.ticketCents);
  for (let t = 1; t <= 5000; t++) {
    const w = fin.waterfall(t);
    assert.equal(w.reconciliationRemainderCents, 0, 'ticket ' + t + ' does not reconcile');
  }
  assert.equal(tickets.length, 3);
});

test('B8.1: carrier is NEVER touched by VAT or Stripe', () => {
  for (const c of fin.TICKET_CALEBRATIONS) {
    const w = fin.waterfall(c.ticketCents);
    assert.equal(w.carrierCents, Math.round(c.ticketCents * 0.8));
  }
});

/* ------------------- Break-even ladder (B8.1) ----------------------------- */

test('B8.1: break-even ladder - 4 burn levels for every calibration', () => {
  const ladderBase = fin.breakEvenLadder(775);
  assert.deepEqual(
    ladderBase.map((l) => l.breakEvenDeliveries),
    [90, 5358, 17858, 29643]
  );
  const ladderGtm = fin.breakEvenLadder(437);
  assert.deepEqual(
    ladderGtm.map((l) => l.breakEvenDeliveries),
    [239, 14286, 47620, 79048]
  );
  const ladderPrem = fin.breakEvenLadder(1380);
  assert.deepEqual(
    ladderPrem.map((l) => l.breakEvenDeliveries),
    [42, 2500, 8334, 13834]
  );
  assert.ok(/Infra/.test(ladderBase[0].label));
  assert.ok(/Y1 burn/.test(ladderBase[3].label));
});

/* --------------- Scenarios on BASE with visible derivation ---------------- */

test('B8.1: scenarios run on BASE ticket with derivation columns', () => {
  const rows = fin.yearlyPnl('base');
  assert.equal(rows.length, 3);
  const y1 = rows[0];
  assert.equal(y1.calibration, 'BASE');
  assert.equal(y1.ticketEur, 7.75);
  assert.equal(y1.deliveries, 6000);
  assert.equal(y1.retainedPerDeliveryCents, 56);
  assert.equal(y1.fixedPerDeliveryCents, 3320);            // 19,920,000c/6000 (Y1 burn)
  // hand-computed: 6000 x 56 - 19,920,000 Y1 burn = -19,584,000 cents (honest loss)
  assert.equal(y1.ebitdaCents, -19584000);
  assert.equal(y1.ebitdaMarginPct, -421.17);
  assert.equal(y1.ebitdaCents, y1.platformRetainedCents - y1.fixedCents);
  assert.equal(y1.drumFeeCents, y1.vatCents + y1.stripeFeeCents + y1.platformRetainedCents);
});

test('B8.1: scenarios ordered pessimistic < base < optimistic', () => {
  const p = fin.yearlyPnl('pessimistic');
  const b = fin.yearlyPnl('base');
  const o = fin.yearlyPnl('optimistic');
  for (let i = 0; i < 3; i++) {
    assert.ok(p[i].ebitdaCents < b[i].ebitdaCents);
    assert.ok(b[i].ebitdaCents < o[i].ebitdaCents);
    assert.equal(b[i].retainedPerDeliveryCents, 56);
  }
});

test('B8.1: same calibration for every row - no mixed tickets', () => {
  for (const name of Object.keys(fin.SCENARIOS)) {
    for (const r of fin.yearlyPnl(name)) {
      assert.equal(r.calibration, 'BASE');
      assert.equal(r.retainedPerDeliveryCents, 56);
    }
  }
});

test('B8.1: demo pricing table (new.js) comes from finance.CORRIDORS', () => {
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'commands', 'new.js'), 'utf8');
  assert.ok(src.indexOf("require('../services/finance')") !== -1);
});
