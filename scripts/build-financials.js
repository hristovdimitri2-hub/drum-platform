/**
 * B8 — build /docs/data-room/ financial model from CODE (single source).
 * Run: node scripts/build-financials.js
 *
 * Outputs:
 *   docs/data-room/FINANCIAL_MODEL.md
 *   docs/data-room/FINANCIAL_MODEL.csv
 *
 * Watermark: every value is auto-generated from src/services/finance.js,
 * floored to the cent ("до €0.00"), reconciled to zero remainder.
 * An INDEPENDENT arithmetic check runs before writing (two paths must
 * agree exactly) — the script refuses to write if any check fails.
 */

const fs = require('fs');
const path = require('path');
const fin = require('../src/services/finance');

const eur = (cents) => (cents / 100).toFixed(2);
const OUT_DIR = path.join(__dirname, '..', 'docs', 'data-room');

/* ---------------------- Independent arithmetic check ---------------------- */

function runChecks() {
  const problems = [];
  // 1. per-delivery reconciliation for a wide range
  for (let g = 1; g <= 5000; g++) {
    const w = fin.waterfallPerDelivery(g);
    if (w.reconciliationRemainderCents !== 0) {
      problems.push(`waterfall ${g}: remainder ${w.reconciliationRemainderCents}`);
    }
  }
  // 2. scenario rows: identity gross = carrier + insurance + feeGross
  //    and feeGross = vat + stripe + retained; ebitda = retained*n - fixed
  for (const name of Object.keys(fin.SCENARIOS)) {
    for (const row of fin.yearlyPnl(name)) {
      if (row.carrierCents + row.insuranceCents + row.drumFeeGrossCents !== row.grossCents) {
        problems.push(`${name} ${row.year}: gross identity broken`);
      }
      if (row.vatCents + row.stripeFeeCents + row.platformRetainedCents !== row.drumFeeGrossCents) {
        problems.push(`${name} ${row.year}: fee identity broken`);
      }
      const recomputedEbitda =
        row.grossCents - row.carrierCents - row.insuranceCents -
        row.vatCents - row.stripeFeeCents - row.fixedCents;
      if (recomputedEbitda !== row.ebitdaCents) {
        problems.push(`${name} ${row.year}: independent ebitda path mismatch`);
      }
    }
  }
  // 3. break-even sanity: at break-even volume, monthly retained >= fixed
  const be = fin.breakEvenDeliveriesPerMonth();
  const w = fin.waterfallPerDelivery();
  if (be * w.platformRetainedCents < fin.fixedMonthlyCents()) {
    problems.push('break-even too low');
  }
  if ((be - 1) * w.platformRetainedCents >= fin.fixedMonthlyCents()) {
    problems.push('break-even too high');
  }
  return problems;
}

/* ------------------------------ Generators -------------------------------- */

function euro(c) { return (c / 100).toFixed(2); }

function buildMarkdown() {
  const w = fin.waterfallPerDelivery();
  const be = fin.breakEvenDeliveriesPerMonth();
  const lines = [];
  lines.push('# DRUM 3.0 — Financial Model (auto-generated)');
  lines.push('');
  lines.push('> ⚠️ WATERMARK: Този документ е ГЕНЕРИРАН ОТ КОД (`scripts/build-financials.js`');
  lines.push('> от `src/services/finance.js`). НЕ РЕДАКТИРАЙ РЪЧНО. Всички стойности са');
  lines.push('> закръглени НИЗХОДЯЩО до стотинка ("до €0.00") и всеки ред се балансира');
  lines.push('> точно до €0.00 остатък (проверено с тест + независима проверка).');
  lines.push('> Дата: ' + new Date().toISOString());
  lines.push('');
  lines.push('## 1. Waterfall на една доставка (смес от коридори 70/30)');
  lines.push('');
  lines.push('| Ред | Стойност |');
  lines.push('|---|---|');
  lines.push('| Брутно (клиент плаща) | EUR ' + euro(w.grossCents) + ' |');
  lines.push('| Превозвач (80%) | EUR ' + euro(w.carrierCents) + ' |');
  lines.push('| DRUM такса (15%, с ДДС) | EUR ' + euro(w.drumFeeGrossCents) + ' |');
  lines.push('| — ДДС 20% от таксата | EUR ' + euro(w.vatCents) + ' |');
  lines.push('| Застрахователен пул (5%) | EUR ' + euro(w.insuranceCents) + ' |');
  lines.push('| Stripe (1.5% + EUR 0.25) | EUR ' + euro(w.stripeFeeCents) + ' |');
  lines.push('| Cross-subsidy пул (15% от такса + 5% от застраховка) | EUR ' + euro(w.socialPoolCents) + ' |');
  lines.push('| **Платформа задържа (ex-VAT, ex-Stripe)** | **EUR ' + euro(w.platformRetainedCents) + '** |');
  lines.push('| Net margin | ' + w.netMarginPct + '% |');
  lines.push('| Remainder | EUR ' + euro(w.reconciliationRemainderCents) + ' |');
  lines.push('');
  lines.push('## 2. Break-even');
  lines.push('');
  lines.push('Фиксирани месечни разходи: ' + fin.FIXED_MONTHLY.map((f) => f.label + ' EUR ' + euro(f.eurCents)).join('; '));
  lines.push('');
  lines.push('**Break-even = ' + be + ' доставки/месец** (при EUR ' + euro(w.platformRetainedCents) + ' задържани/доставка).');
  lines.push('');
  lines.push('## 3. Сценарии (годишен P&L, EUR)');
  for (const name of Object.keys(fin.SCENARIOS)) {
    lines.push('');
    lines.push('### ' + name);
    lines.push('');
    lines.push('| Година | Доставки | Брутно | Превозвач | DRUM такса | ДДС | Застраховка | Stripe | Social пул | Платформа | Фиксирани | EBITDA | Марж |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of fin.yearlyPnl(name)) {
      lines.push('| ' + r.year + ' | ' + r.deliveries +
        ' | ' + euro(r.grossCents) + ' | ' + euro(r.carrierCents) +
        ' | ' + euro(r.drumFeeGrossCents) + ' | ' + euro(r.vatCents) +
        ' | ' + euro(r.insuranceCents) + ' | ' + euro(r.stripeFeeCents) +
        ' | ' + euro(r.socialPoolCents) + ' | ' + euro(r.platformRetainedCents) +
        ' | ' + euro(r.fixedCents) + ' | **' + euro(r.ebitdaCents) + '** | ' + r.ebitdaMarginPct + '% |');
    }
  }
  lines.push('');
  lines.push('## 4. Допускания (изрично маркирани)');
  lines.push('- Коридорен микс: 70% София-Пловдив, 30% София-Варна.');
  lines.push('- Stripe: 1.5% + EUR 0.25 на транзакция (ASSUMPTION; Excel моделът ползва 1.4% — виж FINANCIAL_NOTES.md).');
  lines.push('- Фиксирани месечни: ' + euro(fin.fixedMonthlyCents()) + ' (solo founder, органичен растеж).');
  lines.push('- Въглеродният приход е ИЗКЛЮЧЕН от base модела (спекулативен).');
  return lines.join('\n');
}

function buildCsv() {
  const rows = ['scenario,year,deliveries,gross_eur,carrier_eur,drum_fee_gross_eur,vat_eur,insurance_eur,stripe_eur,social_pool_eur,platform_retained_eur,fixed_eur,ebitda_eur,ebitda_margin_pct'];
  for (const name of Object.keys(fin.SCENARIOS)) {
    for (const r of fin.yearlyPnl(name)) {
      rows.push([
        name, r.year, r.deliveries,
        euro(r.grossCents), euro(r.carrierCents), euro(r.drumFeeGrossCents),
        euro(r.vatCents), euro(r.insuranceCents), euro(r.stripeFeeCents),
        euro(r.socialPoolCents), euro(r.platformRetainedCents),
        euro(r.fixedCents), euro(r.ebitdaCents), r.ebitdaMarginPct,
      ].join(','));
    }
  }
  return rows.join('\n');
}

function main() {
  const problems = runChecks();
  if (problems.length) {
    console.error('ARITHMETIC CHECK FAILED:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('Independent arithmetic check: OK');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const md = buildMarkdown();
  const csv = buildCsv();
  fs.writeFileSync(path.join(OUT_DIR, 'FINANCIAL_MODEL.md'), md);
  fs.writeFileSync(path.join(OUT_DIR, 'FINANCIAL_MODEL.csv'), csv);
  console.log('Wrote docs/data-room/FINANCIAL_MODEL.md and FINANCIAL_MODEL.csv');
}

main();
