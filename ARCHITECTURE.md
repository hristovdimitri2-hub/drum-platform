# ARCHITECTURE — DRUM 3.0 MVP (както е реално, а не в презентацията)

Дата на одит: 2026-09. Източник: `drum-mvp.zip` (COMPLETE_ARCHIVE 04_Code),
обновен до v0.2.0 с Carbon Ledger модул, demo mode и уеб дашборд.

## Компонент — реален статус

| Компонент | Статус | Имплементация |
|---|---|---|
| Telegram бот (Telegraf) | ✅ работещ | `src/bot.js`, `src/commands/*` — /start /new /list /accept /scan /status /cancel /help; contact handler; text wizard |
| Ops channel нотификации | ✅ работещ | нова заявка, pickup, delivery → `OPS_CHANNEL_ID` |
| Typeform интеграция | 🟡 схема | `docs/TYPEFORM_FIELDS.md` — полетата са дефинирани, няма web-hook приемник в кода (MVP: /new wizard в бота) |
| Airtable схема | ✅ дефинирана + код | `docs/AIRTABLE_SCHEMA.md` + `scripts/seed-airtable.js` (създава таблици; link полетата — ръчно) + `src/services/airtable.js` |
| Demo Store | ✅ работещ | `src/services/demo-store.js` — същия интерфейс, in-memory + `data/demo-state.json`, всичко маркирано `isDemo: true` |
| Stripe Connect escrow | ✅ работещ (TEST) | `src/services/stripe.js` — PaymentIntent `capture_method: manual`; **guard: отказва sk_live ключове** |
| Stripe capture + split | ✅ работещ (TEST) | capture на цялата сума, split 80/15/5 от уловеното; transfer през Connect; в DEMO_MODE — симулирани PI/tr/ch ID-та |
| Stripe Connect Express onboarding | 🟡 частично | `createCarrierConnectAccount` е готов; няма UI onboarding route в Express (URL-ите са placeholders) |
| QR pickup/delivery | ✅ работещ | локална генерация (`qrcode`) + URL fallback (goqr.me); „сканиране" = текст на payload-а в чата (`drum:pickup:ID`) |
| Trust Score | ✅ работещ | `src/services/trust.js` — 0–100, прагове 31/50/70/90, event-sourced санкции; консистентен в Airtable И Demo Store |
| Carbon Ledger | ✅ работещ | `src/services/carbon.js` — калкулатор (GHG Protocol Scope 3 Cat. 4, configurable фактори) + запис с audit trail (`factors`) + дашборд |
| Carbon дашборд | ✅ работещ | `GET /dashboard/carbon` в `src/bot.js` — агрегати + последните 50 записа + DEMO банер |
| Landing (ESG) | ✅ работещ | `public/index.html` — статичен, сервизиран от Express |
| Webhooks | ✅ работещ | `/webhooks/stripe` с raw body ПРЕДИ JSON parser (поправен бъг); demo режим приема unsigned |
| Seed демо данни | ✅ работещ | `scripts/seed-demo.js` — 40 фиктивни потребителя, ~100 доставки (80% delivered), Trust Events, Carbon записи; детерминирани (seed=42) |
| E2E демо | ✅ работещ | `scripts/demo-e2e.js` — пълната транзакция headless през реалните services |
|Алгоритъм matching | ❌ не съществува | по дизайн — ops lead ръчно (Strict Agent Model) |
| Reverse Marketplace / B2B | ❌ | roadmap месец 6+ |
| Trust Relay multi-hop / cross-border | ❌ | roadmap година 2+ |
| VCS / carbon credits sale | ❌ | година 3+ |

## Поправени бъгове (v0.1.0 → v0.2.0)

1. `telegraf/session` (премахнат модул в v4) → собствен session middleware.
2. `express` липсваше в package.json → добавен.
3. `/new` wizard беше мъртъв (`handleTextInput` не беше закачен) → закачен чрез `bot.on('text')`.
4. Stripe webhook: `express.json()` преди `express.raw()` чупеше signature verify → редът е обърнат.
5. `carrierStripeAccountId` не се map-ваше от Airtable → добавено поле + mapping + запис при /accept.
6. Split логика: беше 80% от базата при total=base×1.2 → сега 80/15/5 от **уловената сума** (документираната архитектура).
7. Trust праг `<30` → `<31` (0–30 banned), изнесено в споделен `trust.js`.

## Стек и версии

- Node ≥ 18 (тестван на 24), Telegraf ^4.16, Stripe ^18 (API `basil`), Airtable ^0.12,
  Express ^4.21, qrcode ^1.5, dotenv ^16.
- База: Airtable (production) ИЛИ Demo Store (`DEMO_MODE=true`).

## DEMO_MODE — какво точно е mock-нато

| Реален | Demo |
|---|---|
| Stripe PaymentIntent (мрежа) | симулирано `pi_demo_*`, статус `requires_capture` |
| Stripe capture + transfer | симулирани `ch_demo_*` / `tr_demo_*`, правилна 80/15/5 математика |
| Airtable CRUD | in-memory + JSON файл, `isDemo: true` навсякъде |
| Телефони (KYC) | не се съхраняват (GDPR минимизация) |
| Telegram (бот) | изключен без токен; уеб дашбордът работи |

## TODO до production (приоритизирано)

1. **P0:** реални Stripe TEST ключове + свързване на Stripe Elements/Checkout за client_secret (escrow в момента се създава server-side, но клиентско плащане минава през Typeform/ manual MVP).
2. **P0:** Airtable link полета (Shipments.Sender/Carrier → Users) — ръчна стъпка след `npm run seed`.
3. **P1:** превръщане на Trust Events + Carbon Ledger ID полета в link полета (сега са текстови).
4. **P1:** QR сканиране с камера (Telegram WebApp) вместо текстов payload.
5. **P1:** Redis session + rate limiting; логване в structured logger.
6. **P2:** Stripe Connect Express onboarding route + `account.updated` webhook.
7. **P2:** Typeform → webhook → /new (вж. TYPEFORM_FIELDS.md).
8. **P2:** Grid/GPS разстояния (сега: таблица с коридорни км) + документиран емисиен фактор от официален източник (EEA/DEFRA) за грантова отчетност.
9. **P3:** автотестове (jest) върху services — демо E2E скриптът е временният smoke test.
