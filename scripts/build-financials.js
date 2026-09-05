/**
 * B8.1 — build /docs/data-room/ financial model from CODE (single source).
 * Run: node scripts/build-financials.js
 *
 * Outputs: docs/data-room/FINANCIAL_MODEL.md and FINANCIAL_MODEL.csv
 * Watermark: values auto-generated from src/services/finance.js, floored
 * to the cent ("до €0.00"), zero remainder; euro() uses FLOOR (not round).
 * An INDEPENDENT arithmetic check runs before writing — the script refuses
 * to write if any check fails.
 */

const fs = require('fs');
const path = require('path');
const fin = require('../src/services/finance');

const OUT_DIR = path.join(__dirname, '..', 'docs', 'data-room');
const eur = (cents) =>
  Math.floor(cents / 100) + '.' +
  String(Math.floor(((cents % 100) + 100) % 100)).padStart(2, '0');

/* ---------------------- Independent arithmetic check ---------------------- */

function runChecks() {
  const problems = [];
  for (let t = 1; t <= 5000; t++) {
    const w = fin.waterfall(t);
    if (w.reconciliationRemainderCents !== 0) {
      problems.push('waterfall ' + t + ': remainder ' + w.reconciliationRemainderCents);
    }
  }
  for (const c of fin.TICKET_CALEBRATIONS) {
    const w = fin.waterfall(c.ticketCents);
    if (w.carrierCents !== Math.round(c.ticketCents * 0.8)) {
      problems.push(c.key + ': carrier share broken');
    }
  }
  for (const name of Object.keys(fin.SCENARIOS)) {
    for (const row of fin.yearlyPnl(name)) {
      if (row.carrierCents + row.insuranceCents + row.drumFeeCents !== row.grossCents) {
        problems.push(name + ' ' + row.year + ': gross identity broken');
      }
      if (row.vatCents + row.stripeFeeCents + row.platformRetainedCents !== row.drumFeeCents) {
        problems.push(name + ' ' + row.year + ': fee identity broken');
      }
      const viaParts =
        row.grossCents - row.carrierCents - row.insuranceCents -
        row.vatCents - row.stripeFeeCents - row.fixedCents;
      if (viaParts !== row.ebitdaCents) {
        problems.push(name + ' ' + row.year + ': independent ebitda path mismatch');
      }
    }
  }
  return problems;
}

/* ------------------------------ Generators -------------------------------- */

function waterfallTable(ticketCents) {
  const w = fin.waterfall(ticketCents);
  return [
    '| Ред | Стойност |',
    '|---|---|',
    '| Ticket T (captured, клиент плаща) | EUR ' + eur(w.ticketCents) + ' |',
    '| Превозвач (80%) | EUR ' + eur(w.carrierCents) + ' |',
    '| DRUM такса (15%) | EUR ' + eur(w.drumFeeCents) + ' |',
    '| — ДДС 20% ОТГОРЕ на таксата | EUR ' + eur(w.vatCents) + ' |',
    '| Застрахователен пул (5%) | EUR ' + eur(w.insuranceCents) + ' |',
    '| Stripe (1.5% + EUR 0.25, база = captured) | EUR ' + eur(w.stripeFeeCents) + ' |',
    '| Cross-subsidy пул (15% такса + 5% застр.) | EUR ' + eur(w.socialPoolCents) + ' |',
    '| **Платформа задържа (ex-VAT, ex-Stripe)** | **EUR ' + eur(w.platformRetainedCents) + '** |',
    '| Net margin | ' + w.netMarginPct + '% |',
    '| Remainder | EUR ' + eur(w.reconciliationRemainderCents) + ' |',
  ].join('\n');
}

function buildMarkdown() {
  const lines = [];
  lines.push('# DRUM 3.0 — Financial Model (auto-generated, B8.1)');
  lines.push('');
  lines.push('> WATERMARK: Генериран ОТ КОД (scripts/build-financials.js от src/services/finance.js).');
  lines.push('> НЕ РЕДАКТИРАЙ РЪЧНО. Всички стойности са закръглени НИЗХОДЯЩО до стотинка ("до €0.00")');
  lines.push('> и всеки waterfall се балансира точно до €0.00 остатък (тест + независима проверка).');
  lines.push('> Дата: ' + new Date().toISOString());
  lines.push('');
  lines.push('## 1. Цена като сценарна ос — 3 калибрации');
  lines.push('');
  for (const cal of fin.TICKET_CALEBRATIONS) {
    lines.push('### ' + cal.label);
    lines.push('');
    lines.push('Клиент плаща: €' + cal.userPaysEur.toFixed(2) + ' | Ticket T: €' + eur(cal.ticketCents));
    lines.push('');
    lines.push(waterfallTable(cal.ticketCents));
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('## 2. Break-even стълбица (доставки/месец)');
  lines.push('');
  lines.push('| Burn ниво (месечно) | GTM_ENTRY (€0.21/дост.) | BASE (€0.56/дост.) | PREMIUM (€1.20/дост.) |');
  lines.push('|---|---|---|---|');
  const ladders = fin.TICKET_CALEBRATIONS.map((c) => fin.breakEvenLadder(c.ticketCents));
  for (let i = 0; i < fin.FIXED_MONTHLY.length; i++) {
    lines.push('| ' + fin.FIXED_MONTHLY[i].label + ' (€' + eur(fin.FIXED_MONTHLY[i].eurCents) + '/мес) | ' +
      ladders.map((l) => l[i].breakEvenDeliveries).join(' | ') + ' |');
  }
  lines.push('');
  lines.push('**Стратегически извод (GTM_ENTRY):** €0.25 фикс. Stripe такса = 5.7% от ticket €4.37;');
  lines.push('платформата задържа само €0.21/доставка. B2B batch амортизира фикс. таксата');
  lines.push('(една Stripe такса върху седмичен batch, не на пратка) — вж. B7 прототипа.');
  lines.push('Supply напрежение: 80% дял на превозвача при GTM_ENTRY = ~€3.50/път.');
  lines.push('');
  lines.push('## 3. Сценарии (годишен P&L) — BASE калибровка (T = €7.75)');
  lines.push('');
  lines.push('Деривация на всеки ред: EBITDA = доставки × €0.56 retained − фикс (Y1 burn €16,600/мес).');
  for (const name of Object.keys(fin.SCENARIOS)) {
    lines.push('');
    lines.push('### ' + name);
    lines.push('');
    lines.push('| Година | Доставки | Ticket | Retained/дост. | Fixed/дост. | Брутно | Превозвач | DRUM такса | ДДС | Застрах. | Stripe | Social | Платформа | Фикс. | EBITDA | Марж |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of fin.yearlyPnl(name)) {
      lines.push('| ' + r.year + ' | ' + r.deliveries +
        ' | ' + r.ticketEur.toFixed(2) + ' | ' + eur(r.retainedPerDeliveryCents) +
        ' | ' + eur(r.fixedPerDeliveryCents) + ' | ' + eur(r.grossCents) +
        ' | ' + eur(r.carrierCents) + ' | ' + eur(r.drumFeeCents) +
        ' | ' + eur(r.vatCents) + ' | ' + eur(r.insuranceCents) +
        ' | ' + eur(r.stripeFeeCents) + ' | ' + eur(r.socialPoolCents) +
        ' | ' + eur(r.platformRetainedCents) + ' | ' + eur(r.fixedCents) +
        ' | **' + eur(r.ebitdaCents) + '** | ' + r.ebitdaMarginPct + '% |');
    }
  }
  lines.push('');
  lines.push('## 4. Допускания (изрично маркирани)');
  lines.push('- Stripe канон (B8.1): 1.5% + €0.25, база = captured сума (вкл. ДДС). Споделена константа в money.js.');
  lines.push('- ДДС канон (B8.1): 20% ОТГОРЕ на DRUM таксата (tax-exclusive), погълнат от платформата.');
  lines.push('- Обемно-зависими разходи: моделирани като фикс. Y1 burn €16,600/мес; ops/support/disputes не са отделни редове (отворена точка).');
  lines.push('- Carbon приход: ИЗКЛЮЧЕН от base модела.');
  lines.push('- Коридорен микс 70/30 (Пловдив/Варна) — документиран параметър (v0.2.0 premium кош).');
  lines.push('- Bot коридорните цени (€12/€18) остават в PREMIUM калибровката; BASE €8.00 е data-room канон.');
  return lines.join('\n');
}

function buildCsv() {
  const rows = ['scenario,calibration,year,deliveries,ticket_eur,retained_per_delivery_cents,fixed_per_delivery_eur,gross_eur,carrier_eur,drum_fee_eur,vat_eur,insurance_eur,stripe_eur,social_pool_eur,platform_retained_eur,fixed_eur,ebitda_eur,ebitda_margin_pct'];
  for (const name of Object.keys(fin.SCENARIOS)) {
    for (const r of fin.yearlyPnl(name)) {
      rows.push([
        name, r.calibration, r.year, r.deliveries,
        r.ticketEur.toFixed(2), r.retainedPerDeliveryCents, eur(r.fixedPerDeliveryCents),
        eur(r.grossCents), eur(r.carrierCents), eur(r.drumFeeCents),
        eur(r.vatCents), eur(r.insuranceCents), eur(r.stripeFeeCents),
        eur(r.socialPoolCents), eur(r.platformRetainedCents),
        eur(r.fixedCents), eur(r.ebitdaCents), r.ebitdaMarginPct,
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
  fs.writeFileSync(path.join(OUT_DIR, 'FINANCIAL_MODEL.md'), buildMarkdown());
  fs.writeFileSync(path.join(OUT_DIR, 'FINANCIAL_MODEL.csv'), buildCsv());
  console.log('Wrote docs/data-room/FINANCIAL_MODEL.md and FINANCIAL_MODEL.csv');
}

main();
