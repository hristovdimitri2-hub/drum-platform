/**
 * /status command — Show user's profile and trust score
 */

module.exports = async (ctx) => {
  try {
    const user = await ctx.airtable.findUserByTelegramId(ctx.from.id);

    if (!user) {
      await ctx.reply('⚠️ Не си регистриран. Изпрати /start');
      return;
    }

    const tierEmoji = {
      banned: '🚫',
      limited: '🟡',
      standard: '🟢',
      verified: '🔵',
      premium: '🟣',
    }[user.trustTier] || '🟢';

    const kycEmoji = {
      pending: '⏳',
      phone_verified: '📞',
      id_verified: '✅',
      rejected: '❌',
    }[user.kycStatus] || '⏳';

    let stats = '';
    if (user.stats) {
      stats =
        `\n*Статистика:*\n` +
        `   Доставки като изпращач: ${user.stats.asSender || 0}\n` +
        `   Доставки като превозвач: ${user.stats.asCarrier || 0}\n` +
        `   Общо CO2 спестено: ${user.stats.co2Saved || 0} kg\n`;
    }

    await ctx.reply(
      `👤 *Профил*\n\n` +
      `Име: ${user.firstName || 'N/A'} ${user.lastName || ''}\n` +
      `Telegram: @${user.username || ctx.from.username || 'N/A'}\n` +
      `Телефон: ${user.phone || 'не е verified'} ${user.phone ? kycEmoji : ''}\n\n` +
      `*Trust Score:* ${user.trustScore}/100 ${tierEmoji}\n` +
      `*Tier:* ${user.trustTier}\n` +
      stats,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Status command error:', err);
    await ctx.reply('⚠️ Грешка при извличане на профила. Опитай отново.');
  }
};
