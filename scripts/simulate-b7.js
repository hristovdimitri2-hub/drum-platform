/**
 * B7 simulation — 50 requests: batch vs on-demand.
 * Deterministic (seeded). ASSUMPTIONS are labeled in output:
 *   on-demand supply availability 40%, avg time to match 3h when available;
 *   batch: 100% match at the weekly window, avg wait 3.5 days (window at day 7).
 * Result: printed + written to docs/data-room/B7_SIMULATION.md
 */

const b2b = require('../src/services/b2b');
const fs = require('fs');
const path = require('path');

let seed = 7;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}

const N = 50;
const ON_DEMAND_SUPPLY_RATE = 0.4; // ASSUMPTION: free carrier right now, 40% of requests
const ON_DEMAND_TIME_H = 3;        // ASSUMPTION: when available, matched in ~3h
const BATCH_WINDOW_DAYS = 7;       // weekly batch
const TICKET_CENTS = 437;          // GTM_ENTRY ticket
const req = (id) => ({ id, userPaysCents: TICKET_CENTS });

const requests = Array.from({ length: N }, (_, i) => req('req-' + String(i + 1).padStart(2, '0')));

// --- on-demand ---
let odMatched = 0, odTimeSum = 0;
for (const _ of requests) {
  if (rand() < ON_DEMAND_SUPPLY_RATE) { odMatched += 1; odTimeSum += ON_DEMAND_TIME_H; }
}
const odRate = Math.round((odMatched / N) * 1000) / 10;
const odTime = odMatched ? Math.round((odTimeSum / odMatched) * 10) / 10 : null;

// --- batch ---
const plan = b2b.planBatches(requests);          // standard car cap 5
const batchRate = 100;
const batchTime = Math.round(((BATCH_WINDOW_DAYS * 24) / 2) * 10) / 10; // avg wait ~3.5 days

// --- batch economics at GTM ---
const econ10 = b2b.batchEconomics(10, TICKET_CENTS);
const econ1 = b2b.batchEconomics(1, TICKET_CENTS);

const lines = [
  '# B7 SIMULATION — 50 заявки, София → Пловдив (детерминирана, seed=7)',
  '',
  '> ASSUMPTIONS (маркирани): on-demand supply наличност 40%, time-to-match 3ч',
  '> при наличност; batch: седмичен прозорец (7 дни), cap 5/кола. Симулацията е',
  '> ПРОТОТИП — илюстрира механиката, не е пазарно проучване.',
  '',
  '| Метрика | On-demand | B2B batch (седмичен) |',
  '|---|---|---|',
  '| Match rate | ' + odRate + '% | ' + batchRate + '% |',
  '| Avg time to match | ' + odTime + ' ч | ~' + batchTime + ' ч (изчакване до прозореца) |',
  '| Batch-ове | — | ' + plan.batches.length + ' (по 5 пратки/кола) |',
  '',
  '## B2B batch economics при GTM цена (T = €4.37, каноничен money модул)',
  '',
  '| Парметър | On-demand (1 пратка) | Batch (10 пратки) |',
  '|---|---|---|',
  '| Stripe фикс. такса | €0.25 | €0.25 (ВЕДНЪЖ на batch) |',
  '| Stripe общо | EUR ' + (econ1.stripeFeeBatchCents / 100).toFixed(2) + ' | EUR ' + (econ10.stripeFeeBatchCents / 100).toFixed(2) + ' |',
  '| Спестено от фикса | — | EUR ' + (econ10.stripeFixedSavingsCents / 100).toFixed(2) + ' |',
  '| **Retained/пратка** | **EUR ' + econ1.effectiveRetainedPerParcelEur + '** | **EUR ' + econ10.effectiveRetainedPerParcelEur + '** |',
  '| Кратност | 1× | ' + (Math.round((econ10.effectiveRetainedPerParcelCents / econ1.effectiveRetainedPerParcelCents) * 100) / 100) + '× |',
  '',
  '**Извод:** при GTM_ENTRY цена (€4.50 client-pays) on-demand retained е EUR ' +
  econ1.effectiveRetainedPerParcelEur + '/доставка — фиксираната Stripe такса я смачква. ' +
  'В B2B batch (10 пратки, една транзакция) retained се удвоява до EUR ' +
  econ10.effectiveRetainedPerParcelEur + '/доставка. GTM-ENTRY е възможен САМО с batch.',
];

const outDir = path.join(__dirname, '..', 'docs', 'data-room');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'B7_SIMULATION.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
