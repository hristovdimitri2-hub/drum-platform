/**
 * /start command — Welcome + user registration
 *
 * Registers user in Airtable if new, returns welcome message.
 */

const { Markup } = require('telegraf');

module.exports = async (ctx) => {
  const telegramUser = ctx.from;
  const welcomeText = `
🥁 *Добре дошли в DRUM 3.0*

DRUM е платформа за по-евтини доставки между градовете, използвайки свободен капацитет в коли, които вече пътуват.

*Как работи:*
📦 _Ако си изпращач_ — използвай /new за нова заявка
🚗 _Ако си превозвач_ — използвай /accept за да приемеш заявка

*Команди:*
/new — Нова заявка за доставка
/list — Моите заявки
/accept — Приеми заявка (превозвачи)
/scan — Сканирай QR код (pickup/delivery)
/status — Моят профил и Trust Score
/help — Помощ

*Коридори:*
София ↔ Пловдив (други — скоро)

Регистрирам те... ⏳
`;

  try {
    // Register or update user in Airtable
    const user = await ctx.airtable.findOrCreateUser({
      telegramId: telegramUser.id,
      firstName: telegramUser.first_name,
      lastName: telegramUser.last_name,
      username: telegramUser.username,
      language: telegramUser.language_code || 'bg',
    });

    await ctx.reply(welcomeText, { parse_mode: 'Markdown' });

    // Ask for phone number (for KYC)
    const keyboard = Markup.keyboard([
      [{ text: '📞 Сподели телефон', request_contact: true }],
      ['⏭️ Пропусни за сега'],
    ]).resize().oneTime();

    await ctx.reply(
      `Здравей, ${telegramUser.first_name}! 👋\n\nЗа да използваш DRUM, трябва да verified-нем телефона ти. Можеш да го споделиш сега или по-късно.`,
      keyboard
    );
  } catch (err) {
    console.error('Start command error:', err);
    await ctx.reply('⚠️ Възникна грешка при регистрацията. Опитай отново с /start');
  }
};

// Handle contact sharing
module.exports.contactHandler = async (ctx) => {
  const phone = ctx.message.contact.phone_number;
  const telegramId = ctx.from.id;

  try {
    await ctx.airtable.updateUser(telegramId, { phone, kycStatus: 'phone_verified' });
    await ctx.reply(
      `✅ Телефонът е verified: ${phone}\n\nСега си Standard Tier (Trust Score: 50).\nМожеш да създаваш заявки с /new`,
      Markup.removeKeyboard()
    );
  } catch (err) {
    console.error('Contact handler error:', err);
    await ctx.reply('⚠️ Грешка при запазване на телефона. Опитай отново.');
  }
};

// Handle skip
module.exports.skipHandler = async (ctx) => {
  await ctx.reply(
    'Без проблем! Можеш да споделиш телефона си по-късно с /verify.\n\nЗабележка: За да създаваш заявки, нужен е verified телефон.',
    Markup.removeKeyboard()
  );
};
