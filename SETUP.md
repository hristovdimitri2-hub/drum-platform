# SETUP — DRUM 3.0 MVP

## Изисквания

- **Node.js ≥ 18** (провери: `node --version`)
- npm (идва с Node)
- интернет за `npm install` (и за QR URL fallback)

## Вариант А — Демо режим (препоръчителен за първо пускане)

Работи БЕЗ Telegram/Stripe/Airtable акаунти. Плащанията са симулирани,
базата е in-memory JSON файл (`data/demo-state.json`), всичко е маркирано `[DEMO]`.

```powershell
cd "C:\Users\<теб>\Desktop\проекти\DRUM\drum-mvp"
npm install
copy .env.example .env    # по подразбиране DEMO_MODE=true
npm run seed:demo         # ~100 симулирани доставки + Carbon Ledger
npm start
```

Отвори:
- http://localhost:3000/ — landing (ESG позициониране)
- http://localhost:3000/dashboard/carbon — Carbon Ledger дашборд

Полезни команди:

| Команда | Ефект |
|---|---|
| `npm run seed:demo` | Пресъздава ~100 демо доставки (изтрива стари демо данни) |
| `npm run seed:demo -- --wipe` | Изтрива демо данните |
| `npm run demo:e2e` | Изпълнява една пълна транзакция (добавя се към демо данните) |

## Вариант Б — Реален режим (Stripe TEST + Airtable + Telegram)

### 1. Telegram бот
1. Отвори [@BotFather](https://t.me/BotFather) → `/newbot` → запази токена.
2. (По избор) създай частен канал за ops, добави бота като админ, вземи channel ID
   (напр. чрез @userinfobot / добавяне на канал в ID бота) → това е `OPS_CHANNEL_ID`.

### 2. Stripe (САМО TEST MODE!)
1. [dashboard.stripe.com](https://dashboard.stripe.com/) → включи **Test mode**.
2. Developers → API keys → копирай `sk_test_...` и `pk_test_...`.
3. Webhook secret (`whsec_...`) — нужен е чак при deployment с реален webhook URL.

### 3. Airtable
1. Създай base → пусни `npm run seed` (създава таблиците Users, Shipments,
   Trust Events, Carbon Ledger) **или** създай таблиците ръчно по
   `docs/AIRTABLE_SCHEMA.md`. Изисква Personal Access Token със
   `schema.bases:write` scope (вж. скрипта).
2. [airtable.com/create/tokens](https://airtable.com/create/tokens) → токен с
   `data.records:read/write` + `schema.bases:read` за твоя base.
3. Вземи Base ID от API документацията на base-а (`app...`).

### 4. .env

```ini
DEMO_MODE=false
TELEGRAM_BOT_TOKEN=123456:ABC...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...        # може празно за локален polling
AIRTABLE_API_KEY=pat...
AIRTABLE_BASE_ID=app...
OPS_CHANNEL_ID=-100...
```

### 5. Стартиране

```bash
npm start
```

Отвори Telegram → намери бота → `/start` → следвай флоу: `/new` (изпращач),
`/accept <ID>` (превощач), `/scan drum:pickup:<ID>` и
`/scan drum:delivery:<ID>`.

⚠️ Ако подадеш `sk_live_` ключ, процесът-refuses да стартира. DRUM MVP е
TEST-mode only.

## Чести проблеми

| Проблем | Решение |
|---|---|
| `Missing required environment variable` | Попълни `.env` или сложи `DEMO_MODE=true` |
| Ботът не отговаря | Провери токена; в демо режим ботът е изключен |
| Airtable грешка 403 | Токенът няма нужните scopes за base-а |
| Порт 3000 е зает | Смени `PORT` в `.env` |
