/**
 * /evidence <shipment_id> — one-action chargeback evidence packet (B5.4).
 * Builds the full evidence dossier (JSON + Markdown + SHA-256) and sends
 * the Markdown summary. Also available at GET /api/evidence/:shipmentId.
 */

const anomalies = require('../services/anomalies');
const fs = require('fs');

module.exports = async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length === 0) {
    await ctx.reply('Употреба: `/evidence <shipment_id>` — генерира пълен evidence пакет за chargeback.', {
      parse_mode: 'Markdown',
    });
    return;
  }
  try {
    const out = await anomalies.buildEvidencePacket(ctx.airtable, args[0]);
    const packet = JSON.parse(fs.readFileSync(out.jsonPath, 'utf8'));
    const s = packet.shipment;
    const t = packet.financialTimeline;
    await ctx.reply(
      `📦 *Evidence packet готов*\n` +
      `Заявка: ${s.id} (${s.corridor})\n` +
      `Статус: ${s.status} · Stripe: ${packet.stripe.mode}\n` +
      `Транзакции: ${t.length}\n` +
      `SHA-256: \`${out.sha256.slice(0, 16)}…\`\n\n` +
      `Файлове:\n${out.jsonPath}\n${out.mdPath}`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    await ctx.reply(`Грешка: ${err.message}`);
  }
};
