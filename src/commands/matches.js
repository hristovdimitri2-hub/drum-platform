/**
 * /matches <shipment_id> — show TOP 5 carrier candidates for a shipment.
 *
 * B3 Matching v1: ranks candidates ONLY. The user (sender/ops) chooses and
 * contacts a carrier; the carrier confirms via /accept.
 * STRICT AGENT MODEL: this command NEVER assigns, books or dispatches —
 * it is an informational ranking (Master Blueprint §2.2).
 */

const matching = require('../services/matching');

module.exports = async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  if (args.length === 0) {
    await ctx.reply('Употреба: `/matches <shipment_id>` — показва ТОП 5 кандидати-превозвачи.',
      { parse_mode: 'Markdown' });
    return;
  }
  const shipmentId = args[0];

  try {
    const shipment = await ctx.airtable.getShipment(shipmentId);
    if (!shipment) {
      await ctx.reply('Заявката не е намерена.');
      return;
    }
    if (shipment.status !== 'requested') {
      await ctx.reply(`Заявката вече е в статус *${shipment.status}* — списъкът е информативен.`, {
        parse_mode: 'Markdown',
      });
    }

    const users = await ctx.airtable.listUsers();
    const carriers = users.filter(
      (u) => u.stripeConnectAccountId || u.trustScore >= 50
    ).filter((u) => String(u.telegramId) !== String(shipment.senderTelegramId));

    const history = new Map();
    for (const s of await ctx.airtable.listAllShipments()) {
      if (!s.carrierId) continue;
      const st = history.get(s.carrierId) || { delivered: 0, assigned: 0 };
      st.assigned += 1;
      if (s.status === 'delivered') st.delivered += 1;
      history.set(s.carrierId, st);
    }

    const top = matching.topCandidates(
      shipment,
      carriers,
      (carrierId) => history.get(carrierId) || {}
    );

    const esc = matching.escalation(shipment);
    const escLine = esc.level === 'ops'
      ? '🚨 *6+ часа без мач — нужна ops намеса!*'
      : esc.level === 'boost'
        ? '⏫ 2+ часа без мач — кандидати са подсилени в ops фийда.'
        : '';

    if (top.length === 0) {
      await ctx.reply(
        `Няма налични кандидати за *${shipment.originCity} → ${shipment.destinationCity}*.${escLine}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    let msg =
      `🎯 *ТОП ${top.length} кандидати* за ${shipment.originCity} → ${shipment.destinationCity}\n` +
      `${escLine}\n` +
      `_Ранглистата е информативна. Изборът е твой — превощачът потвърждава с /accept ${shipmentId}._\n\n`;

    top.forEach((c, i) => {
      msg +=
        `${i + 1}. *${c.firstName || c.username || c.carrierId}* @${c.username || '—'}\n` +
        `   Score: ${c.score}/100 (Trust ${c.trustScore} ${c.trustTier} · коридор ${c.components.route} · история ${c.components.history}%)\n`;
    });

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Matches command error:', err);
    await ctx.reply('Грешка при ранглистата. Опитай отново.');
  }
};
