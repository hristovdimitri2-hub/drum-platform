/**
 * /accept command — Carrier accepts a shipment
 * Usage: /accept SHIPMENT_ID
 *
 * Flow:
 *   1. Verify shipment exists and is in "requested" status
 *   2. Verify carrier has verified phone + Trust Score >= 50
 *   3. Update shipment with carrierId, status = "matched"
 *   4. Generate pickup + delivery QR codes
 *   5. Send QR codes to carrier
 *   6. Notify sender
 */

module.exports = async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);

  if (args.length === 0) {
    await ctx.reply(
      '⚠️ Употреба: `/accept <shipment_id>`\n\n' +
      'Пример: `/accept rec1234567890`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const shipmentId = args[0];

  try {
    // 1. Find shipment
    const shipment = await ctx.airtable.getShipment(shipmentId);
    if (!shipment) {
      await ctx.reply('⚠️ Заявката не е намерена.');
      return;
    }

    if (shipment.status !== 'requested') {
      await ctx.reply(`⚠️ Заявката вече е ${shipment.status}. Не може да се приеме.`);
      return;
    }

    // 2. Find/verify carrier
    const carrier = await ctx.airtable.findUserByTelegramId(ctx.from.id);
    if (!carrier || !carrier.phone) {
      await ctx.reply('⚠️ Трябва да verified-неш телефона си първо. Изпрати /start.');
      return;
    }

    if (carrier.trustScore < 50) {
      await ctx.reply(`⚠️ Trust Score е твърде нисък (${carrier.trustScore}). Минимум: 50.`);
      return;
    }

    // 3. Update shipment
    await ctx.airtable.updateShipment(shipmentId, {
      carrierId: carrier.id,
      carrierTelegramId: ctx.from.id,
      carrierStripeAccountId: carrier.stripeConnectAccountId || null,
      status: 'matched',
      matchedAt: new Date().toISOString(),
    });

    // 4. Generate QR codes
    const pickupQrUrl = await ctx.qr.generate(`drum:pickup:${shipmentId}`);
    const deliveryQrUrl = await ctx.qr.generate(`drum:delivery:${shipmentId}`);

    // Save QR URLs
    await ctx.airtable.updateShipment(shipmentId, {
      pickupQrCode: pickupQrUrl,
      deliveryQrCode: deliveryQrUrl,
    });

    // 5. Send QR codes to carrier
    await ctx.reply(
      `✅ *Приета заявка!*\n\n` +
      `🆔 ${shipmentId}\n` +
      `📍 ${shipment.originCity} → ${shipment.destinationCity}\n` +
      `📦 ${shipment.description}\n` +
      `💰 Печалба: €${(shipment.baseEur * 0.8).toFixed(2)} (80% от €${shipment.baseEur})\n\n` +
      `*Pickup QR код:*`,
      { parse_mode: 'Markdown' }
    );

    await ctx.replyWithPhoto(pickupQrUrl);

    await ctx.reply(
      `*Delivery QR код (покажи на получателя):*`,
      { parse_mode: 'Markdown' }
    );
    await ctx.replyWithPhoto(deliveryQrUrl);

    await ctx.reply(
      `📋 *Инструкции:*\n\n` +
      `1. Свържи се с изпращача: @${shipment.senderTelegramId ? '' : 'via ops'}\n` +
      `2. На pickup — сканирай pickup QR с /scan\n` +
      `3. Достави пратката\n` +
      `4. На delivery — получателят сканира delivery QR с /scan\n` +
      `5. Парите ще бъдат освободени автоматично\n\n` +
      `⚠️ Не губи QR кодовете!`,
      { parse_mode: 'Markdown' }
    );

    // 6. Notify sender
    try {
      await ctx.telegram.sendMessage(
        shipment.senderTelegramId,
        `🤝 *Превозвач е намерен!*\n\n` +
        `Заявка: ${shipmentId}\n` +
        `Превозвач ще се свърже с теб за pickup.\n\n` +
        `Пари (€${shipment.totalEur}) са в escrow и ще се освободят при доставка.`,
        { parse_mode: 'Markdown' }
      );
    } catch (e) {
      console.error('Failed to notify sender:', e.message);
    }

    // 7. Log trust event
    await ctx.airtable.logTrustEvent({
      userId: carrier.id,
      eventType: 'shipment_accepted',
      eventValue: 0,
      shipmentId,
      metadata: {},
    });
  } catch (err) {
    console.error('Accept command error:', err);
    await ctx.reply('⚠️ Грешка при приемане. Опитай отново.');
  }
};
