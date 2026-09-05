/**
 * B8 tests — financial model: cent-exact waterfall, break-even, scenarios.
 * "До €0.00" watermark: floor rounding + zero-reconciliation remainder.
 */

const test = require('node:test');
const assert = require('node:assert');
const fin = require('../src/services/finance');

test('B8: avg gross from corridor mix — 1380 cents (€13.80)', () => {
  assert.equal(fin.avgGrossCents(), 1380); // 1200*0.7 + 1800*0.3
});

test('B8: waterfall — hand-computed for €13.80', () => {
  const w = fin.waterfallPerDelivery();
  assert.equal(w.grossCents, 1380);
  assert.equal(w.carrierCents, 1104);            // 80%
  assert.equal(w.drumFeeGrossCents, 207);        // 15%
  assert.equal(w.insuranceCents, 69);            // 5%
  assert.equal(w.stripeFeeCents, 46);            // 1.5% of 1380 (21) + 25
  const vat = fin.money.vatOnDrumFee(207);
  assert.equal(vat.netCents, 173); assert.equal(vat.vatCents, 34);
  assert.equal(w.platformRetainedCents, 207 - 34 - 46); // 127
  assert.equal(w.netMarginPct, 9.2);             // floor(127/1380*10000)/100
  assert.equal(w.reconciliationRemainderCents, 0); // до €0.00
});

test('B8: reconciliation remainder is ZERO for gross 1..2000 cents', () => {
  for (let g = 1; g <= 2000; g++) {
    const w = fin.waterfallPerDelivery(g);
    assert.equal(w.reconciliationRemainderCents, 0, `gross ${g} does not reconcile`);
  }
});

test('B8: carrier is NEVER touched by VAT', () => {
  const w = fin.waterfallPerDelivery();
  // carrier share is exactly 80% of gross, independent of VAT lines
  assert.equal(w.carrierCents, Math.round(w.grossCents * 0.8));
});

test('B8: floorToCent — watermark rounds DOWN to the cent', () => {
  assert.equal(fin.floorToCent(12.349), 12.34);
  assert.equal(fin.floorToCent(12.345), 12.34);
  assert.equal(fin.floorToCent(0.999), 0.99);
});

test('B8: break-even — fixed 5000/mo ÷ 127 retained = 40 deliveries', () => {
  assert.equal(fin.fixedMonthlyCents(), 5000);
  assert.equal(fin.breakEvenDeliveriesPerMonth(), 40);
});

test('B8: yearly P&L — base scenario, independent arithmetic check', () => {
  const rows = fin.yearlyPnl('base');
  assert.equal(rows.length, 3);
  const y1 = rows[0];
  assert.equal(y1.deliveries, 6000);              // 500/mo
  // independent recomputation from parts (not from yearlyPnl internals):
  // retained per delivery = gross - carrier - insurance - stripe - VAT
  const w = fin.waterfallPerDelivery();
  const expectedEbitda =
    y1.deliveries * (w.grossCents - w.carrierCents - w.insuranceCents -
      w.stripeFeeCents - w.vatCents) - y1.fixedCents;
  assert.equal(y1.ebitdaCents, expectedEbitda);
  // per-row identities (cent-exact, €0.00 remainder):
  //   gross = carrier + insurance + feeGross
  //   feeGross = VAT + stripeFee + platformRetained
  assert.equal(
    y1.carrierCents + y1.insuranceCents + y1.drumFeeGrossCents,
    y1.grossCents,
  );
  assert.equal(
    y1.vatCents + y1.stripeFeeCents + y1.platformRetainedCents,
    y1.drumFeeGrossCents,
  );
  // ebitda margin floors below ~10% (conservative watermark)
  assert.ok(y1.ebitdaMarginPct >= 0 && y1.ebitdaMarginPct < 12);
});

test('B8: three scenarios are ordered pessimistic < base < optimistic', () => {
  const p = fin.yearlyPnl('pessimistic');
  const b = fin.yearlyPnl('base');
  const o = fin.yearlyPnl('optimistic');
  for (let i = 0; i < 3; i++) {
    assert.ok(p[i].deliveries < b[i].deliveries);
    assert.ok(b[i].deliveries < o[i].deliveries);
    assert.ok(p[i].ebitdaCents < b[i].ebitdaCents);
    assert.ok(b[i].ebitdaCents < o[i].ebitdaCents);
  }
});

test('B8: demo pricing uses the same corridor table (single source)', () => {
  const newJs = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src', 'commands', 'new.js'), 'utf8');
  assert.ok(/require\('\.\.\/services\/finance'\)/.test(newJs), 'new.js imports finance');
  assert.ok(!/basePriceEur:\s*\d+/.test(newJs.split('require')[0]), 'no hardcoded prices in new.js header');
});
