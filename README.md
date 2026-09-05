# DRUM 3.0 — Concierge MVP

> **Една реална доставка > 10 бизнес плана.**
> P2P логистична платформа: пътуващи с празни багажници пренасят пратки между градовете.

## Какво е това

Работещ Telegram бот + Carbon Ledger дашборд, реализиращ MVP архитектурата:

**Typeform заявка** (по избор) → **Telegram бот** (Node.js + Telegraf) →
**Airtable / Demo Store** (ops база) → **Stripe Connect** (auth-only escrow → capture + split 80/15/5) →
**QR pickup/delivery** → **Trust Score** (0–100, прагове 31/50/70/90) →
**Carbon Ledger** (GHG Protocol Scope 3, Cat. 4) + **ESG дашборд**.

```
┌──────────────────────────────────────────────────────┐
│                   Telegram Bot                       │
│  /start /new /list /accept /scan /status /cancel     │
└──────────────┬───────────────────────────┬───────────┘
               ▼                           ▼
      ┌────────────────┐         ┌──────────────────┐
      │  Store facade  │         │  Stripe Connect  │
      │ Airtable  или  │         │  escrow + split  │
      │  Demo Store    │         │  80 / 15 / 5     │
      └───────┬────────┘         └──────────────────┘
              ▼
   ┌─────────────────────┐     ┌──────────────────────┐
   │ Carbon Ledger +     │     │  Landing + дашборд   │
   │ Trust Score (event- │     │  public/ (ESG        │
   │ sourced)            │     │  позициониране)      │
   └─────────────────────┘     └──────────────────────┘
```

## Бърз старт (демо без външни акаунти)

```bash
npm install
copy .env.example .env   # DEMO_MODE=true е по подразбиране
npm run seed:demo        # ~100 симулирани доставки, маркирани [DEMO]
npm run demo:e2e         # пълна транзакция: escrow → QR → capture → CO2
npm start                # уеб сървър на http://localhost:3000
```

- 🏠 Landing (ESG): http://localhost:3000/
- 🌿 Carbon Ledger дашборд: http://localhost:3000/dashboard/carbon

Без `TELEGRAM_BOT_TOKEN` ботът е спрян и сървърът стартира в dashboard-only режим.
С реален токен (от @BotFather) `npm start` пуска и бота в polling режим.

## Документация

| Файл | Съдържание |
|---|---|
| [SETUP.md](SETUP.md) | Стъпка по стъпка локален setup (демо и реален режим) |
| [DEMO_SCRIPT.md](DEMO_SCRIPT.md) | 10-минутен сценарий за демонстрация пред инвеститор |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Какво е реално vs. mocked; TODO до production |
| [docs/AIRTABLE_SCHEMA.md](docs/AIRTABLE_SCHEMA.md) | Схема на ops базата |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deployment (Railway) |
| [docs/TYPEFORM_FIELDS.md](docs/TYPEFORM_FIELDS.md) | Typeform интеграция |

## Команди на бота

| Command | Description |
|---|---|
| `/start` | Регистрация / начален екран |
| `/new` | Нова заявка за доставка (изпращачи) |
| `/list` | Моите заявки |
| `/accept <ID>` | Приеми заявка (превозвачи — **потребителят избира**) |
| `/scan` | Сканирай QR код (pickup/delivery) |
| `/status` | Моят профил и Trust Score |
| `/cancel` | Отмяна на текущото действие |
| `/help` | Помощ |

## Flow

```
ИЗПРАЩАЧ   /new → коридор → пратка → цена → потвърждава
   ↓        Stripe auth-only (escrow freeze) + заявка в базата + ops нотификация
OPS LEAD   (ръчно) намира превозвач → /accept <ID>
ПРЕВОЗВАЧ  /accept <ID> → matched + pickup/delivery QR
   ↓        /scan drum:pickup:ID → picked_up
   ↓        /scan drum:delivery:ID → capture + split 80/15/5
            Trust Score +5 (и двете страни) · Carbon Ledger запис · delivered ✅
```

## Ценообразуване (split на уловената сума)

| Коридор | База | Такса 15% | Застраховка 5% | Общо | Превозвач (80% от общо) |
|---|---|---|---|---|---|
| София ↔ Пловдив | €10.00 | €1.50 | €0.50 | **€12.00** | €9.60 |
| София ↔ Варна | €15.00 | €2.25 | €0.75 | **€18.00** | €14.40 |

## Trust Score

| Score | Tier | Достъп |
|---|---|---|
| 0–30 | banned | Без заявки |
| 31–49 | limited | Пратки до €20 |
| 50–69 | standard | Пратки до €200 |
| 70–89 | verified | Пратки до €500 |
| 90–100 | premium | Пратки до €1 000, B2B API |

Нов потребител започва на **50 (standard)**. Санкции/бонуси: delivery_success +5,
delivery_failed −15, dispute_raised −10, dispute_resolved +5, kyc_verified +3.

## Принципи (не се нарушават)

1. **Технологична неутралност (Strict Agent Model):** ботът НИКОГА не назначава
   превозвач — показва налични опции, потребителят избира. Правно изискване.
2. **Не изобретявай traction.** Демо данните са маркирани `[DEMO]` / `isDemo: true`
   и дашбордът показва видимо предупреждение.
3. **GDPR:** в демо режим се съхраняват само фиктивни имена и IDs; без телефони.
4. **Stripe само в TEST mode** — кодът отказва да стартира с `sk_live_` ключ.

## Tech Stack

| Component | Tool |
|---|---|
| Bot framework | Telegraf 4 |
| Payments | Stripe Connect (test mode) |
| Database | Airtable (production) / Demo Store (in-memory JSON) |
| QR codes | qrcode (локална генерация) + goqr.me (URL fallback) |
| Server | Express (landing, дашборд, webhooks) |
| Hosting | Railway |

## Лиценз

UNLICENSED — Private, confidential.

## Автор

Димитър Вълканов — Founder & CEO, DRUM
