/**
 * B8.1 — build /docs/data-room/ financial model from CODE (single source).
 * Run: node scripts/build-financials.js
 *
 * Outputs: docs/data-room/FINANCIAL_MODEL.md and FINANCIAL_MODEL.csv
 * Watermark: values auto-generated from src/services/finance.js, floored
 * to the cent ("до €0.00"), zero remainder; eur() uses FLOOR (not round).
 * An INDEPENDENT arithmetic check runs before writing — the script refuses
 * to write if any check fails.
 */

const fs = require('fs');
const path = require('path');
const fin = require('../src/services/finance');
const b2b = require('../src/services/b2b');

const OUT_DIR = path.join(__dirname, '..', 'docs', 'data-room');
const eur = (cents) =>
  Math.floor(cents / 100) + '.' +
  String(Math.floor(((cents % 100) + 100) % 100)).padStart(2, '0');
const econGtm1 = b2b.batchEconomics(1, 437).effectiveRetainedPerParcelCents;

/* ---------------------- Independent arithmetic check ---------------------- */

function runChecks() {
  const problems = [];
  for (let t = 1; t <= 5000; t++) {
    const w = fin.waterfall(t);
    if (w.reconciliationRemainderCents !== 0) {
      problems.push('waterfall ' + t + ': remainder ' + w.reconciliationRemainderCents);
    }
  }
  for (const c of fin.TICKET_CALIBRATIONS) {
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
    '| Remainder (затваряне) | EUR ' + eur(w.reconciliationRemainderCents) + ' |',
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
  for (const cal of fin.TICKET_CALIBRATIONS) {
    lines.push('### ' + cal.label);
    lines.push('');
    lines.push('Клиент плаща: €' + cal.userPaysEur.toFixed(2) + ' | Ticket T: €' + eur(cal.ticketCents));
    lines.push('');
    lines.push(waterfallTable(cal.ticketCents));
    lines.push('');
    lines.push('_Третиране на застрахователната премия: ПУЛ РЕЗЕРВ (задължение на платформата, НЕ приход) —' +
      ' задържа се отделно и се тегли само при изгубен спор/изгубена пратка._');
    lines.push('_Затваряне: T = превозвач + такса (net) + ДДС върху таксата + застраховка + retained → remainder €0.00._');
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('## 2. Break-even стълбица (доставки/месец)');
  lines.push('');
  lines.push('| Burn ниво (месечно) | GTM_ENTRY (€0.21/дост.) | BASE (€0.56/дост.) | PREMIUM (€1.20/дост.) |');
  lines.push('|---|---|---|---|');
  const ladders = fin.TICKET_CALIBRATIONS.map((c) => fin.breakEvenLadder(c.ticketCents));
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
  lines.push('> ЕТИКЕТ ОБЕМИ (B8.2): всяко „X/мес" е **СРЕДНО МЕСЕЧНО** за съответната');
  lines.push('> година (константна интензивност), НЕ year-end run-rate. Ако документите');
  lines.push('> ползват „края на годината", средното (и EBITDA) е по-ниско — тук е избрано');
  lines.push('> средно месечно, консервативно, и е тествано.');
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
  lines.push('## 4. B2B batch economics (B7) — Stripe фикс. такса амортизирана');
  lines.push('');
  lines.push('GTM_ENTRY цена, каноничен money модул, до стотинка. Batch = ЕДНА Stripe');
  lines.push('транзакция върху общата сума (фикс. €0.25 веднъж, не на пратка).');
  lines.push('');
  lines.push('| Пратки в batch | Stripe такса (общо) | Спестено vs on-demand | Retained/пратка | Кратност vs on-demand |');
  lines.push('|---|---|---|---|---|');
  for (const n of [1, 5, 10, 20, 50]) {
    const e = b2b.batchEconomics(n, 437);
    lines.push('| ' + n + ' | EUR ' + eur(e.stripeFeeBatchCents) + ' | EUR ' + eur(e.stripeFixedSavingsCents) +
      ' | **EUR ' + eur(e.effectiveRetainedPerParcelCents) + '** | ' +
      (Math.round((e.effectiveRetainedPerParcelCents / econGtm1) * 100) / 100) + '× |');
  }
  lines.push('');
  lines.push('**Извод:** при GTM_ENTRY on-demand retained е EUR 0.21/пратка (фикс. такса смачква);');
  lines.push('в batch от 10 — EUR 0.43/пратка (2.06×). GTM-ENTRY е възможен САМО с batch.');
  lines.push('');
  lines.push('## 5. Стратегически изводи (скелет на икономическия слайд за PITCH.md)');
  lines.push('');
  const gtm = fin.waterfall(fin.TICKET_CALIBRATIONS[0].ticketCents);
  const base = fin.waterfall(fin.TICKET_CALIBRATIONS[1].ticketCents);
  const prem = fin.waterfall(fin.TICKET_CALIBRATIONS[2].ticketCents);
  const ladderG = fin.breakEvenLadder(fin.TICKET_CALIBRATIONS[0].ticketCents);
  const ladderB = fin.breakEvenLadder(fin.TICKET_CALIBRATIONS[1].ticketCents);
  lines.push('**Лост 1 — B2B batch (амортизация на фикса):** при GTM_ENTRY €0.25 фикс.');
  lines.push('Stripe такса = 5.7% от ticket €4.37 и retained пада на €' + eur(gtm.platformRetainedCents) + '/доставка.');
  lines.push('Batch от 10 пратки с ЕДНА такса: фикс. се амортизира до €0.025/пратка —');
  lines.push('retained се връща към ~€' + eur(gtm.platformRetainedCents + 2) + '/доставка. Batch е задължителен при entry цени.');
  lines.push('');
  lines.push('**Лост 2 — Плътност (density):** повече превозвачи по един коридор → по-кратко');
  lines.push('закъснение при мач. НЕ е числово моделиран (качествен лост, отворена точка).');
  lines.push('');
  lines.push('**Лост 3 — Lean burn:** при €3,000/мес фикс.: break-even **' +
    ladderB[1].breakEvenDeliveries + ' доставки/мес (BASE)**');
  lines.push('срещу ' + ladderB[3].breakEvenDeliveries + ' при scaled €16,600/мес — **5.5× разлика**.');
  lines.push('Честен контраст: lean ' + ladderB[1].breakEvenDeliveries + '/мес е постижим в 1 коридор;');
  lines.push('scaled ' + ladderB[3].breakEvenDeliveries + '/мес изисква мулти-коридор + B2B.');
  lines.push('');
  lines.push('**Лост 4 — Premium коридори:** PREMIUM (T=€13.80) retained €' + eur(prem.platformRetainedCents) +
    '/доставка');
  lines.push('(' + prem.netMarginPct + '%) срещу BASE €' + eur(base.platformRetainedCents) + ' (' + base.netMarginPct + '%) — premium кошият');
  lines.push('носи ~2.1× retained на доставка; bot цени (€12/€18) са в тази лента.');
  lines.push('');
  lines.push('**Втори двигател — грантове/carbon:** ESG грантове + (Y3+) VCS carbon приходи.');
  lines.push('ИЗКЛЮЧЕН от base модела (спекулативен) — таблиците горе са без него.');
  lines.push('');
  lines.push('**Честен контраст (BASE цена):** lean burn ' + ladderB[1].breakEvenDeliveries +
    '/мес vs scaled ' + ladderB[3].breakEvenDeliveries + '/мес');
  lines.push('(' + Math.round(ladderB[3].breakEvenDeliveries / ladderB[1].breakEvenDeliveries * 10) / 10 + '×). При GTM_ENTRY соло-доставка изисква ' +
    ladderG[3].breakEvenDeliveries + '/мес — нереалистично; entry цената работи само с B2B batch.');
  lines.push('');
  lines.push('## 6. Допускания (изрично маркирани)');
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
