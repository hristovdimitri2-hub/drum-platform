/**
 * B6 — Carbon Ledger dashboard renderer, bilingual (BG/EN, ?lang=en|bg).
 * Pure function — no express dependency; testable.
 */

const LABELS = {
  bg: {
    title: '🌿 DRUM 3.0 — Carbon Ledger',
    subtitle: 'CO₂ спестяване на доставка · GHG Protocol Scope 3, Category 4 (Upstream Transportation)',
    demoBanner: '⚠️ DEMO ДАННИ — симулирани транзакции за демонстрация. НЕ са реален traction.',
    cards: ['Доставки в ledger', 'CO₂ спестено', 'Км споделен превоз', 'Завършени доставки'],
    cols: ['Shipment', 'Коридор', 'km', 'Baseline kg CO₂', 'Actual kg CO₂', 'Спестено kg CO₂', 'Методология', 'Дата'],
    empty: 'Няма записи още — стартирай npm run demo:e2e',
    footer:
      'Baseline: {baseline} kg CO₂e/km (специализирана куриерска кола) · Marginal share: {marginal} ' +
      '(пратка в вече пътуващ автомобил с празен багажник). Всеки запис съдържа факторите, ' +
      'използвани при изчислението (audit trail).',
  },
  en: {
    title: '🌿 DRUM 3.0 — Carbon Ledger',
    subtitle: 'CO₂ saved per delivery · GHG Protocol Scope 3, Category 4 (Upstream Transportation)',
    demoBanner: '⚠️ DEMO DATA — simulated transactions for demonstration. NOT real traction.',
    cards: ['Deliveries in ledger', 'CO₂ saved', 'Shared-ride km', 'Completed deliveries'],
    cols: ['Shipment', 'Corridor', 'km', 'Baseline kg CO₂', 'Actual kg CO₂', 'Saved kg CO₂', 'Methodology', 'Date'],
    empty: 'No entries yet — run npm run demo:e2e',
    footer:
      'Baseline: {baseline} kg CO₂e/km (dedicated courier van) · Marginal share: {marginal} ' +
      '(a parcel in an already-travelling car with an empty trunk). Every entry stores the exact ' +
      'factors used (audit trail).',
  },
};

function renderCarbonDashboard({ entries = [], summary, delivered = 0, lang = 'bg', isDemo = false, factors }) {
  const L = LABELS[lang] || LABELS.bg;
  const rows = entries
    .slice(-50)
    .reverse()
    .map(
      (e) => `<tr>
          <td>${e.shipmentId || '—'}</td>
          <td>${e.originCity || '—'} → ${e.destinationCity || '—'}</td>
          <td>${e.distanceKm ?? '—'}</td>
          <td>${(e.baselineCo2Kg ?? 0).toFixed(2)}</td>
          <td>${(e.actualCo2Kg ?? 0).toFixed(2)}</td>
          <td><b>${(e.savedCo2Kg ?? 0).toFixed(2)}</b></td>
          <td>${e.methodology || '—'}</td>
          <td>${(e.createdAt || '').replace('T', ' ').slice(0, 16)}</td>
        </tr>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="${lang}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${L.title}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; background: #0d1b12; color: #e8f5ee; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 24px; }
  h1 { color: #34d17b; margin: 0 0 4px; }
  .sub { opacity: .75; margin-bottom: 20px; }
  .banner { background: #7a1f1f; border: 1px solid #c0392b; padding: 10px 14px; border-radius: 8px; margin-bottom: 20px; font-weight: 600; }
  .lang { float: right; }
  .lang a { color: #34d17b; text-decoration: none; margin-left: 8px; }
  .cards { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 24px; }
  .card { background: #13291c; border: 1px solid #1f4630; border-radius: 12px; padding: 16px 20px; min-width: 160px; }
  .card .v { font-size: 26px; font-weight: 700; color: #34d17b; }
  .card .l { font-size: 12px; opacity: .7; text-transform: uppercase; letter-spacing: .05em; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; background: #13291c; border-radius: 12px; overflow: hidden; }
  th { text-align: left; background: #1f4630; padding: 10px; }
  td { padding: 8px 10px; border-top: 1px solid #1f4630; }
  .foot { margin-top: 20px; font-size: 12px; opacity: .6; }
</style></head><body><div class="wrap">
  <div class="lang"><a href="?lang=bg">BG</a><a href="?lang=en">EN</a></div>
  <h1>${L.title}</h1>
  <div class="sub">${L.subtitle}</div>
  ${isDemo ? '<div class="banner">' + L.demoBanner + '</div>' : ''}
  <div class="cards">
    <div class="card"><div class="v">${summary.shipments}</div><div class="l">${L.cards[0]}</div></div>
    <div class="card"><div class="v">${summary.savedCo2Kg.toLocaleString('bg-BG')} kg</div><div class="l">${L.cards[1]}</div></div>
    <div class="card"><div class="v">${summary.distanceKm.toLocaleString('bg-BG')} km</div><div class="l">${L.cards[2]}</div></div>
    <div class="card"><div class="v">${delivered}</div><div class="l">${L.cards[3]}</div></div>
  </div>
  <table>
    <thead><tr>${L.cols.map((c) => '<th>' + c + '</th>').join('')}</tr></thead>
    <tbody>${rows || '<tr><td colspan="8">' + L.empty + '</td></tr>'}</tbody>
  </table>
  <p class="foot">${L.footer
    .replace('{baseline}', String(factors.baselineKgPerKm))
    .replace('{marginal}', String(factors.marginalKgPerKm))}</p>
</div></body></html>`;
}

module.exports = { LABELS, renderCarbonDashboard };
