/**
 * /new command — Create new shipment request (sender flow)
 *
 * Interactive flow:
 *   1. Ask for origin city
 *   2. Ask for destination city
 *   3. Ask for parcel description
 *   4. Ask for parcel value (in EUR)
 *   5. Ask for deadline
 *   6. Show price breakdown + confirm
 *   7. Create Stripe auth-only charge (escrow)
 *   8. Generate QR codes
 *   9. Save to Airtable
 *  10. Notify ops channel
 */

const { Markup } = require('telegraf');
const { CORRIDORS } = require('../services/finance'); // B8 single source of truth

module.exports = async (ctx) => {
  // Start session for new shipment
  ctx.session.newShipment = { step: 'corridor' };

  const corridorButtons = CORRIDORS.map((c) => [`${c.from} → ${c.to}`]);

  await ctx.reply(
    '📦 *Нова заявка за доставка*\n\nИзбери коридор:',
    {
      parse_mode: 'Markdown',
      ...Markup.keyboard(corridorButtons).resize().oneTime(),
    }
  );
};

// Handle text input during /new flow
module.exports.handleTextInput = async (ctx) => {
  const session = ctx.session.newShipment;
  if (!session) return false;

  const text = ctx.message.text;

  try {
    switch (session.step) {
      case 'corridor': {
        const corridor = CORRIDORS.find((c) => `${c.from} → ${c.to}` === text);
        if (!corridor) {
          await ctx.reply('⚠️ Невалиден коридор. Избери от списъка.');
          return true;
        }
        session.originCity = corridor.from;
        session.destinationCity = corridor.to;
        session.basePriceEur = corridor.basePriceEur;
        session.step = 'description';
        await ctx.reply(
          '📝 Опиши пратката (размер, тегло, съдържание):\nНапример: *Малък пакет, 2 kg, телефон за ремонт*',
          { parse_mode: 'Markdown', ...Markup.removeKeyboard() }
        );
        return true;
      }

      case 'description': {
        if (text.length < 5) {
          await ctx.reply('⚠️ Описанието е твърде кратко. Опиши какво изпращаш.');
          return true;
        }
        session.description = text;
        session.step = 'value';
        await ctx.reply('💰 Каква е стойността на пратката в EUR?\nНапример: *50*');
        return true;
      }

      case 'value': {
        const value = parseFloat(text);
        if (isNaN(value) || value < 1 || value > 500) {
          await ctx.reply('⚠️ Стойността трябва да е между 1 и 500 EUR. Опитай отново.');
          return true;
        }
        session.parcelValueEur = value;
        session.step = 'deadline';
        await ctx.reply(
          '📅 До кога трябва да бъде доставена?\nИзбери опция:',
          Markup.keyboard([
            ['Днес', 'Утре', 'До 3 дни', 'До 7 дни'],
          ]).resize().oneTime()
        );
        return true;
      }

      case 'deadline': {
        const validDeadlines = ['Днес', 'Утре', 'До 3 дни', 'До 7 дни'];
        if (!validDeadlines.includes(text)) {
          await ctx.reply('⚠️ Избери опция от списъка.');
          return true;
        }
        session.deadline = text;

        // Calculate price breakdown
        const base = session.basePriceEur;
        const fee = +(base * 0.15).toFixed(2); // 15% facilitation fee
        const insurance = +(base * 0.05).toFixed(2); // 5% insurance
        const total = +(base + fee + insurance).toFixed(2);

        session.priceBreakdown = { base, fee, insurance, total };

        session.step = 'confirm';
        await ctx.reply(
          `📋 *Потвърди заявката:*\n\n` +
          `📍 *Маршрут:* ${session.originCity} → ${session.destinationCity}\n` +
          `📦 *Пратка:* ${session.description}\n` +
          `💰 *Стойност:* €${session.parcelValueEur}\n` +
          `📅 *Срок:* ${session.deadline}\n\n` +
          `*Ценова разбивка:*\n` +
          `   Базова цена: €${base.toFixed(2)}\n` +
          `   Такса за улеснение (15%): €${fee.toFixed(2)}\n` +
          `   Застраховка (5%): €${insurance.toFixed(2)}\n` +
          `   *ОБЩО: €${total.toFixed(2)}*\n\n` +
          `Парите ще бъдат замразени (auth-only) и освободени при успешно сканиране на QR кода за доставка.`,
          {
            parse_mode: 'Markdown',
            ...Markup.keyboard([['✅ Потвърждавам', '❌ Отказ']]).resize().oneTime(),
          }
        );
        return true;
      }

      case 'confirm': {
        if (text === '❌ Отказ') {
          delete ctx.session.newShipment;
          await ctx.reply('Заявката е отменена.', Markup.removeKeyboard());
          return true;
        }
        if (text !== '✅ Потвърждавам') {
          await ctx.reply('⚠️ Избери „Потвърждавам\" или „Отказ\".');
          return true;
        }

        // Create the shipment
        await ctx.reply('⏳ Създавам заявка и замразявам парите...', Markup.removeKeyboard());

        const shipment = await createShipment(ctx);

        if (shipment) {
          await ctx.reply(
            `✅ *Заявката е създадена!*\n\n` +
            `🆔 ID: *${shipment.id}*\n` +
            `💳 Stripe: Парите са замразени (€${session.priceBreakdown.total})\n` +
            `📍 QR кодове ще бъдат генерирани след намиране на превозвач.\n\n` +
            `Екипът ще намери превозвач в следващите 24 часа. Ще получиш известие тук.`,
            { parse_mode: 'Markdown' }
          );

          // Notify ops channel
          const opsMsg =
            `🚨 *НОВА ЗАЯВКА*\n\n` +
            `ID: ${shipment.id}\n` +
            `Маршрут: ${session.originCity} → ${session.destinationCity}\n` +
            `Пратка: ${session.description}\n` +
            `Стойност: €${session.parcelValueEur}\n` +
            `Срок: ${session.deadline}\n` +
            `Цена: €${session.priceBreakdown.total}\n` +
            `Изпращач: @${ctx.from.username || ctx.from.first_name}\n\n` +
            `Намери превозвач и го насочи към /accept ${shipment.id}`;
          try {
            await ctx.telegram.sendMessage(process.env.OPS_CHANNEL_ID, opsMsg, { parse_mode: 'Markdown' });
          } catch (e) {
            console.error('Failed to notify ops channel:', e.message);
          }
        }

        delete ctx.session.newShipment;
        return true;
      }
    }
  } catch (err) {
    console.error('New shipment flow error:', err);
    await ctx.reply('⚠️ Възникна грешка. Опитай отново с /new');
    delete ctx.session.newShipment;
    return true;
  }

  return false;
};

async function createShipment(ctx) {
  const session = ctx.session.newShipment;
  const user = await ctx.airtable.findUserByTelegramId(ctx.from.id);

  if (!user || !user.phone) {
    await ctx.reply('⚠️ Трябва да verified-неш телефона си първо. Изпрати /start и сподели контакта си.');
    return null;
  }

  // 1. Create Stripe PaymentIntent (auth-only = manual capture)
  const totalCents = Math.round(session.priceBreakdown.total * 100);
  const paymentIntent = await ctx.stripe.createEscrowCharge({
    amount: totalCents,
    customerId: user.stripeCustomerId,
    description: `DRUM ${session.originCity} → ${session.destinationCity}`,
    metadata: {
      sender_telegram_id: String(ctx.from.id),
      origin: session.originCity,
      destination: session.destinationCity,
      parcel_value: String(session.parcelValueEur),
    },
  });

  if (!paymentIntent.success) {
    await ctx.reply(`⚠️ Грешка при плащане: ${paymentIntent.error}\nОпитай отново с /new`);
    return null;
  }

  // 2. Create shipment in Airtable
  const shipment = await ctx.airtable.createShipment({
    senderId: user.id,
    senderTelegramId: ctx.from.id,
    originCity: session.originCity,
    destinationCity: session.destinationCity,
    description: session.description,
    parcelValueEur: session.parcelValueEur,
    deadline: session.deadline,
    totalEur: session.priceBreakdown.total,
    baseEur: session.priceBreakdown.base,
    feeEur: session.priceBreakdown.fee,
    insuranceEur: session.priceBreakdown.insurance,
    stripePaymentIntentId: paymentIntent.paymentIntentId,
    status: 'requested',
  });

  // 3. Log trust event
  await ctx.airtable.logTrustEvent({
    userId: user.id,
    eventType: 'shipment_created',
    eventValue: 0,
    shipmentId: shipment.id,
    metadata: { amount: session.priceBreakdown.total },
  });

  return shipment;
}
