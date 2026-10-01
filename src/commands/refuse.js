/**
 * /refuse <shipment_id> — anomaly 3: recipient declines the signature.
 * Opens the 24h proof window (services/anomalies.openDeliveryRefusal) and
 * tells the user how to attach a REAL photo (next message) — the photo
 * handler (commands/photo.js) records it with full metadata.
 */

const anomalies = require('../services/anomalies');

module.exports = async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  if (!args[0]) {
    await ctx.reply(
      'Употреба: `/refuse <shipment_id>` — получи 24ч прозорец за фото-доказателство.',
      { parse_mode: 'Markdown' }
    );
    return;
  }
  const shipmentId = args[0].trim();

  try {
    const shipment = await ctx.airtable.getShipment(shipmentId);
    if (!shipment) {
      await ctx.reply('⚠️ Заявката не е намерена.');
      return;
    }

    const opened = await anomalies.openDeliveryRefusal(ctx.airtable, {
      shipmentId,
      openedBy: 'recipient',
    });

    // next photo from this chat documents THIS refusal (caption still works)
    if (ctx.session) ctx.session.activeRefusalShipmentId = shipmentId;

    await ctx.reply(
      `🚫 *Отказ за подпис — аномалия 3*\n` +
      `Заявка: ${shipmentId} (${shipment.originCity} → ${shipment.destinationCity})\n` +
      `Прозорец за доказателство: 24ч, до \`${opened.proofDeadline}\`\n\n` +
      `📷 Изпрати СНИМКА като доказателство — с *caption*, съдържащ \`${shipmentId}\`, ` +
      `или просто като следващо съобщение в този чат.\n` +
      `_Без метаданни (sha256 + timestamp + ID + chat) няма доказателство._`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Refuse command error:', err.message);
    await ctx.reply('⚠️ Грешка при отказ. Опитай отново: /refuse <ID>');
  }
};
