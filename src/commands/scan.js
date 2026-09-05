/**
 * /scan command — Scan QR code (pickup or delivery)
 *
 * Two modes:
 *   1. Carrier scans pickup QR → status = "picked_up", notify sender
 *   2. Recipient scans delivery QR → status = "delivered",
 *      Stripe capture + split payout, trust score updates
 *
 * In Telegram bot, "scanning" is simulated by sending the QR content
 * as text: "drum:pickup:SHIPMENT_ID" or "drum:delivery:SHIPMENT_ID"
 *
 * For real QR scanning, the user would open camera in the bot.
 * Telegram supports QR scanning via web app or inline mode.
 * For MVP, we accept manual text input of the QR payload.
 */

module.exports = async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1).join(' ');

  if (!args) {
    await ctx.reply(
      '📷 *Сканиране на QR код*\n\n' +
      'Изпрати съдържанието на QR кода като текст.\n\n' +
      'Формат: `drum:pickup:SHIPMENT_ID` или `drum:delivery:SHIPMENT_ID`\n\n' +
      'Забележка: В production версията, това ще стане чрез камера.',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const payload = args.trim();

  // Parse payload
  const parts = payload.split(':');
  if (parts.length !== 3 || parts[0] !== 'drum') {
    await ctx.reply('⚠️ Невалиден QR код. Формат: `drum:pickup:ID` или `drum:delivery:ID`', {
      parse_mode: 'Markdown',
    });
    return;
  }

  const [_, action, shipmentId] = parts;

  try {
    const shipment = await ctx.airtable.getShipment(shipmentId);
    if (!shipment) {
      await ctx.reply('⚠️ Заявката не е намерена.');
      return;
    }

    if (action === 'pickup') {
      await handlePickupScan(ctx, shipment);
    } else if (action === 'delivery') {
      await handleDeliveryScan(ctx, shipment);
    } else {
      await ctx.reply('⚠️ Невалидно действие в QR кода.');
    }
  } catch (err) {
    console.error('Scan command error:', err);
    await ctx.reply('⚠️ Грешка при сканиране. Опитай отново.');
  }
};

async function handlePickupScan(ctx, shipment) {
  // Verify this is the carrier
  if (String(shipment.carrierTelegramId) !== String(ctx.from.id)) {
    await ctx.reply('⚠️ Само превозвачът може да сканира pickup QR.');
    return;
  }

  if (shipment.status !== 'matched') {
    await ctx.reply(`⚠️ Заявката е в статус ${shipment.status}. Не може pickup.`);
    return;
  }

  // Update shipment
  await ctx.airtable.updateShipment(shipment.id, {
    status: 'picked_up',
    pickupScannedAt: new Date().toISOString(),
  });

  // Notify carrier
  await ctx.reply(
    `✅ *Pickup confirmed!*\n\n` +
    `Заявка: ${shipment.id}\n` +
    `Време: ${new Date().toLocaleString('bg-BG')}\n\n` +
    `Достави пратката и накажи получателя да сканира delivery QR с /scan`,
    { parse_mode: 'Markdown' }
  );

  // Notify sender
  try {
    await ctx.telegram.sendMessage(
      shipment.senderTelegramId,
      `📦 *Пратката е взета!*\n\n` +
      `Заявка: ${shipment.id}\n` +
      `Превозвачът е на път.`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    console.error('Failed to notify sender:', e.message);
  }

  // Notify ops
  try {
    await ctx.telegram.sendMessage(
      process.env.OPS_CHANNEL_ID,
      `📦 Pickup: ${shipment.id} | ${shipment.originCity} → ${shipment.destinationCity} | ${new Date().toISOString()}`
    );
  } catch (e) {
    console.error('Failed to notify ops:', e.message);
  }
}

async function handleDeliveryScan(ctx, shipment) {
  if (shipment.status !== 'picked_up' && shipment.status !== 'in_transit') {
    await ctx.reply(`⚠️ Заявката е в статус ${shipment.status}. Не може delivery.`);
    return;
  }

  // Capture Stripe payment + split payout (80/15/5 of captured total)
  const captureResult = await ctx.stripe.captureAndSplit({
    paymentIntentId: shipment.stripePaymentIntentId,
    carrierConnectAccountId: shipment.carrierStripeAccountId,
    totalEur: shipment.totalEur,
  });

  if (!captureResult.success) {
    await ctx.reply(`⚠️ Грешка при освобождаване на парите: ${captureResult.error}`);
    return;
  }

  // Update shipment
  await ctx.airtable.updateShipment(shipment.id, {
    status: 'delivered',
    deliveryScannedAt: new Date().toISOString(),
    stripeTransferId: captureResult.transferId,
  });

  // Canonical transaction record (B1 schema, split from services/money.js)
  await ctx.airtable.recordTransaction({
    shipmentId: shipment.id,
    type: 'capture',
    amountCents: captureResult.splitCents.totalCents,
    currency: 'eur',
    stripeId: captureResult.captureId,
    splitCarrierCents: captureResult.splitCents.carrierCents,
    splitDrumCents: captureResult.splitCents.drumCents,
    splitInsuranceCents: captureResult.splitCents.insuranceCents,
    isDemo: captureResult.demo === true,
  });

  // Calculate CO2 saved (GHG Protocol Scope 3, Cat. 4 — see services/carbon.js)
  const carbonResult = ctx.carbon.calculateCo2Saved({
    originCity: shipment.originCity,
    destinationCity: shipment.destinationCity,
  });
  const savedCo2 = carbonResult.savedCo2Kg;

  await ctx.airtable.createCarbonEntry({
    shipmentId: shipment.id,
    originCity: shipment.originCity,
    destinationCity: shipment.destinationCity,
    baselineCo2Kg: carbonResult.baselineCo2Kg,
    actualCo2Kg: carbonResult.actualCo2Kg,
    savedCo2Kg: carbonResult.savedCo2Kg,
    distanceKm: carbonResult.distanceKm,
    methodology: carbonResult.methodology,
    factors: carbonResult.factors,
  });

  // Update trust scores (event-sourced; both parties earn delivery_success)
  const senderTrust = await ctx.airtable.updateTrustScore(shipment.senderId, 'delivery_success_sender');
  const carrierTrust = await ctx.airtable.updateTrustScore(shipment.carrierId, 'delivery_success_carrier');

  await ctx.airtable.logTrustEvent({
    userId: shipment.carrierId,
    eventType: 'delivery_success',
    eventValue: carrierTrust.delta,
    shipmentId: shipment.id,
    metadata: { co2_saved: savedCo2.toFixed(2) },
  });

  // Notify
  await ctx.reply(
    `✅ *Доставката е завършена!*\n\n` +
    `Заявка: ${shipment.id}\n` +
    `Време: ${new Date().toLocaleString('bg-BG')}\n` +
    `🌿 CO2 спестено: ${savedCo2.toFixed(2)} kg\n\n` +
    `Парите са освободени. Превозвачът получи €${captureResult.carrierPayoutEur.toFixed(2)}.`,
    { parse_mode: 'Markdown' }
  );

  // Notify sender + carrier
  try {
    await ctx.telegram.sendMessage(
      shipment.senderTelegramId,
      `✅ *Пратката е доставена!*\n\nЗаявка: ${shipment.id}\nБлагодарим, че използва DRUM! 🥁`,
      { parse_mode: 'Markdown' }
    );

    await ctx.telegram.sendMessage(
      shipment.carrierTelegramId,
      `✅ *Доставката е завършена!*\n\n` +
      `Заявка: ${shipment.id}\n` +
      `Печалба: €${captureResult.carrierPayoutEur.toFixed(2)} (в Stripe сметката ти)\n` +
      `Trust Score: ${carrierTrust.delta} (сега ${carrierTrust.score}, ${carrierTrust.tier})\n` +
      `🌿 CO2 спестено: ${savedCo2.toFixed(2)} kg\n\n` +
      `Благодарим! 🥁`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    console.error('Failed to notify parties:', e.message);
  }
}

// Distance estimation now lives in services/carbon.js (CORRIDOR_DISTANCES_KM).
