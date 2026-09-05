/**
 * /list command — List user's shipments
 */

module.exports = async (ctx) => {
  try {
    const shipments = await ctx.airtable.listShipmentsByUser(ctx.from.id);

    if (shipments.length === 0) {
      await ctx.reply(
        '📭 Нямаш заявки все още.\n\nСъздай нова с /new'
      );
      return;
    }

    let msg = '📋 *Твоите заявки:*\n\n';
    for (const s of shipments.slice(0, 10)) {
      const statusEmoji = {
        requested: '⏳',
        matched: '🤝',
        picked_up: '🚗',
        in_transit: '📍',
        delivered: '✅',
        cancelled: '❌',
        disputed: '⚠️',
      }[s.status] || '❓';

      msg +=
        `${statusEmoji} *${s.id}*\n` +
        `   ${s.originCity} → ${s.destinationCity}\n` +
        `   📦 ${s.description?.substring(0, 40) || 'N/A'}\n` +
        `   💰 €${s.totalEur} | 📅 ${s.deadline}\n` +
        `   Статус: _${s.status}_\n\n`;
    }

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('List command error:', err);
    await ctx.reply('⚠️ Грешка при извличане на заявките. Опитай отново.');
  }
};
