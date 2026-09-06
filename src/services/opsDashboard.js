/**
 * B9 — Ops/KPI dashboard renderer, bilingual (BG/EN via ?lang=).
 * Pure function; metrics come from services/kpi.js.
 */

const LABELS = {
  bg: {
    title: '📈 DRUM 3.0 — Ops/KPI дашборд',
    subtitle: 'Kill-switch метрики и операции · само от реалните записи в базата',
    demoBanner: '⚠️ DEMO ДАННИ — симулирани транзакции. НЕ са реален traction.',
    cols: ['Метрика', 'Стойност', 'Kill-switch / бележка'],
    npsNote: 'n/a — анкетен модул не е изграден',
    lostProxy: 'PROXY: изгубени спорове / (доставени + изгубени)',
    generated: 'Генерирано',
  },
  en: {
    title: '📈 DRUM 3.0 — Ops/KPI dashboard',
    subtitle: 'Kill-switch metrics & operations · computed from actual database records',
    demoBanner: '⚠️ DEMO DATA — simulated transactions. NOT real traction.',
    cols: ['Metric', 'Value', 'Kill-switch / note'],
    npsNote: 'n/a — survey module not built yet',
    lostProxy: 'PROXY: lost disputes / (delivered + lost)',
    generated: 'Generated',
  },
};

function renderOpsDashboard({ kpis, lang = 'bg', isDemo = false }) {
  const L = LABELS[lang] || LABELS.bg;
  const fmt = (v, suffix = '') => (v === null || v === undefined ? 'n/a' : v + suffix);
  const rows = [
    ['👥 ' + (lang === 'en' ? 'Total users' : 'Общо потребители'), kpis.totalUsers, '—'],
    ['🔥 ' + (lang === 'en' ? 'Active users (30d)' : 'Активни потребители (30 дни)'), kpis.activeUsers30d, '—'],
    ['📦 ' + (lang === 'en' ? 'Total shipments' : 'Общо заявки'), kpis.totalShipments, '—'],
    ['🆕 ' + (lang === 'en' ? 'Open (requested)' : 'Отворени (requested)'), kpis.requested, '—'],
    ['✅ ' + (lang === 'en' ? 'Delivered' : 'Доставени'), kpis.delivered, '—'],
    ['🤝 ' + (lang === 'en' ? 'Match rate' : 'Match rate'), fmt(kpis.matchRatePct, '%'),
      lang === 'en' ? 'kill switch: <50% at day 60 → pivot' : 'kill switch: <50% на 60-ия ден → пивот'],
    ['⏱ ' + (lang === 'en' ? 'Avg time to match' : 'Средно време до мач'), fmt(kpis.avgTimeToMatchHours, 'h'),
      lang === 'en' ? 'boost at 2h / ops at 6h' : 'boost на 2ч / ops на 6ч'],
    ['🔁 ' + (lang === 'en' ? 'Repeat rate (30d)' : 'Repeat rate (30 дни)'), fmt(kpis.repeatRate30dPct, '%'), 'B2B driver'],
    ['⚖ ' + (lang === 'en' ? 'Dispute rate' : 'Dispute rate'), fmt(kpis.disputeRatePct, '%'), '—'],
    ['📉 ' + (lang === 'en' ? 'Lost parcel rate' : 'Изгубени пратки'), fmt(kpis.lostParcelRatePct, '%'), L.lostProxy],
    ['📊 NPS', kpis.nps === null ? 'n/a' : kpis.nps, L.npsNote],
  ];
  return `<!DOCTYPE html>
<html lang="${lang}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${L.title}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; background: #0d1b12; color: #e8f5ee; }
  .wrap { max-width: 860px; margin: 0 auto; padding: 24px; }
  h1 { color: #34d17b; margin: 0 0 4px; }
  .sub { opacity: .75; margin-bottom: 20px; }
  .banner { background: #7a1f1f; border: 1px solid #c0392b; padding: 10px 14px; border-radius: 8px; margin-bottom: 20px; font-weight: 600; }
  .lang { float: right; }
  .lang a { color: #34d17b; text-decoration: none; margin-left: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; background: #13291c; border-radius: 12px; overflow: hidden; }
  th { text-align: left; background: #1f4630; padding: 10px; }
  td { padding: 9px 10px; border-top: 1px solid #1f4630; }
  td:last-child { opacity: .65; font-size: 12px; }
</style></head><body><div class="wrap">
  <div class="lang"><a href="?lang=bg">BG</a><a href="?lang=en">EN</a></div>
  <h1>${L.title}</h1>
  <div class="sub">${L.subtitle}</div>
  ${isDemo ? '<div class="banner">' + L.demoBanner + '</div>' : ''}
  <table>
    <thead><tr>${L.cols.map((c) => '<th>' + c + '</th>').join('')}</tr></thead>
    <tbody>${rows.map((r) => '<tr><td>' + r[0] + '</td><td><b>' + r[1] + '</b></td><td>' + r[2] + '</td></tr>').join('\n')}</tbody>
  </table>
  <p style="margin-top:16px;opacity:.55;font-size:12px">${L.generated}: ${kpis.generatedAt}</p>
</div></body></html>`;
}

module.exports = { LABELS, renderOpsDashboard };
