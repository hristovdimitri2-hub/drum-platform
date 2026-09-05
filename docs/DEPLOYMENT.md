# DRUM MVP — Deployment Guide

Пълно ръководство стъпка по стъпка за deploy на Concierge MVP.

## Предварителни изисквания

- Node.js 18+ ([изтегли](https://nodejs.org/))
- Telegram акаунт
- Stripe акаунт (test mode за начало)
- Airtable акаунт (free tier е достатъчен)
- Railway акаунт (за hosting, $5/месец) ИЛИ локален компютър

## Стъпка 1: Telegram Bot Token

1. Отвори Telegram и намери [@BotFather](https://t.me/BotFather)
2. Изпрати `/newbot`
3. Избери име: `DRUM.bg`
4. Избери username: `drum_bg_bot` (или каквото е свободно)
5. **Запази токена** (изглежда така: `1234567890:ABCdef...`)

## Стъпка 2: Stripe Setup

1. Отиди на [Stripe Dashboard](https://dashboard.stripe.com/)
2. Активирай **Test Mode** (превключвателя горе-дясно)
3. Копирай **Secret Key** (започва с `sk_test_`)
4. Копирай **Publishable Key** (започва с `pk_test_`)
5. За Stripe Connect (превозвачи):
   - Settings → Connect → Activate (поне 1 бизнес детайл)
   - Запиши **Client ID** (ако има)

## Стъпка 3: Airtable Setup

1. Създай [Airtable акаунт](https://airtable.com/signup)
2. Създай нов Base от scratch
3. Създай 4 таблици (виж `docs/AIRTABLE_SCHEMA.md` за пълна schema):
   - **Users**
   - **Shipments**
   - **Trust Events**
   - **Carbon Ledger**
4. Копирай **Base ID** (от URL: `airtable.com/BASE_ID/...`)
5. Генерирай **Personal Access Token** (airtable.com/create/tokens)
   - Scopes: `data.records:read`, `data.records:write`

## Стъпка 4: Локален setup

```bash
# Клонираи или разархивирай проекта
cd drum-mvp

# Инсталирай dependencies
npm install

# Копирай .env.example
cp .env.example .env

# Редактирай .env с реалните стойности
nano .env
```

## Стъпка 5: Тествай локално

```bash
# Стартий бота
npm start

# Трябва да видиш:
# 🤖 DRUM bot started in polling mode
#    Bot username: @drum_bg_bot
```

Отвори Telegram, намери бота, изпрати `/start`.

## Стъпка 6: Deploy на Railway

1. Отиди на [Railway](https://railway.app/)
2. Login с GitHub
3. New Project → Deploy from GitHub repo
4. Качи кода в GitHub repo първо:
   ```bash
   git init
   git add .
   git commit -m "Initial commit — DRUM MVP"
   git remote add origin https://github.com/YOUR_USERNAME/drum-mvp.git
   git push -u origin main
   ```
5. В Railway:
   - Variables → добави всички от `.env`
   - Settings → Generate Domain (за webhook URL)
   - В `.env` задай `TELEGRAM_WEBHOOK_URL=https://your-app.railway.app`
6. Deploy

## Стъпка 7: Stripe Webhook

1. Инсталирай [Stripe CLI](https://stripe.com/docs/stripe-cli)
2. Локално за тест:
   ```bash
   stripe listen --forward-to localhost:3000/webhooks/stripe
   ```
3. Копирай `whsec_...` и го сложи в `.env` като `STRIPE_WEBHOOK_SECRET`
4. В production:
   - Stripe Dashboard → Developers → Webhooks → Add endpoint
   - URL: `https://your-app.railway.app/webhooks/stripe`
   - Events: `payment_intent.succeeded`, `payment_intent.payment_failed`

## Стъпка 8: Ops Channel

1. Създай private Telegram channel
2. Добави бота като администратор
3. Намери channel ID (изпрати съобщение, използвай `@getidsbot`)
4. Сложи ID в `.env` като `OPS_CHANNEL_ID=-1001234567890`

## Трабълшутинг

### Bot не отговаря
- Провери дали `TELEGRAM_BOT_TOKEN` е правилен
- Провери логовете: `npm start` трябва да покаже грешки
- Увери се, че нямаш друг бот стартиран със същия токен

### Stripe грешки
- Увери се, че си в **test mode**
- Test карта: `4242 4242 4242 4242`
- Всяка дата в бъдещето, всеки CVC

### Airtable грешки
- Провери `AIRTABLE_API_KEY` (Personal Access Token, не стар API key)
- Провери `AIRTABLE_BASE_ID` (от URL, не от settings)
- Имената на таблиците трябва да съвпадат точно

### QR кодове не се генерират
- `qrcode` package генерира локално (работи офлайн)
- goqr.me API може да е бавен/недостъпен — използвай `generateLocal()`

## Следващи стъпки (post-MVP)

1. Algorithm matching (месец 4+) — замени ръчното съгласуване
2. Reverse Marketplace (месец 6+) — B2B batch API
3. Carbon Ledger dashboard (месец 6+) — visual ESG данни
4. VCS регистрация (Year 3+) — Carbon Credits sale

## Поддръжка

Въпроси? Пиши в ops канала или открий issue в GitHub repo.
