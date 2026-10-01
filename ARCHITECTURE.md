# ARCHITECTURE — DRUM 3.0 MVP (както е реално, а не в презентацията)

Дата на одит: 2026-09. Източник: `drum-mvp.zip` (COMPLETE_ARCHIVE 04_Code),
обновен до v0.2.0 с Carbon Ledger модул, demo mode и уеб дашборд.

## Компонент — реален статус

| Компонент | Статус | Имплементация |
|---|---|---|
| Telegram бот (Telegraf) | ✅ работещ | `src/bot.js`, `src/commands/*` — /start /new /list /accept /scan /status /cancel /help; contact handler; text wizard |
| Ops channel нотификации | ✅ работещ | нова заявка, pickup, delivery → `OPS_CHANNEL_ID` |
| Typeform интеграция | 🟡 схема | `docs/TYPEFORM_FIELDS.md` — полетата са дефинирани, няма web-hook приемник в кода (MVP: /new wizard в бота) |
| Airtable схема | ✅ дефинирана + код | `docs/AIRTABLE_SCHEMA.md` + `scripts/seed-airtable.js` (автоматично: таблици + **Shipments link полета** + legacy upgrade + backfill; `npm run seed:dry` преглед) + `src/services/airtable.js` (link запис с legacy fallback) |
| Demo Store | ✅ работещ | `src/services/demo-store.js` — същия интерфейс, in-memory + `data/demo-state.json`, всичко маркирано `isDemo: true` |
| Stripe Connect escrow | ✅ работещ (TEST) | `src/services/stripe.js` — PaymentIntent `capture_method: manual`; **guard: отказва sk_live ключове** |
| Stripe capture + split | ✅ работещ (TEST) | capture на цялата сума, split 80/15/5 от уловеното; transfer през Connect; в DEMO_MODE — симулирани PI/tr/ch ID-та |
| Stripe Connect Express onboarding | 🟡 частично | `createCarrierConnectAccount` е готов; няма UI onboarding route в Express (URL-ите са placeholders) |
| Клиентско плащане (Stripe TEST) | ✅ работещ (TEST) | `POST /api/checkout/:shipmentId` → `public/pay.html` (Stripe Elements; реисползва escrow PI — без дублиран auth). DEMO_MODE — симулирани `pi_demo_*`, нулеви мрежови извиквания; guard отказва `sk_live` **преди** всеки изовик |
| QR pickup/delivery | ✅ работещ | локална генерация (`qrcode`) + URL fallback (goqr.me); „сканиране" = текст на payload-а в чата (`drum:pickup:ID`) **или камера** (batch 3): `/scan.html` (jsQR CDN) → `POST /api/scan` → реалния /scan command; демо QR PNG: `npm run demo:camera` |
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

1. **✅ ЧАСТИЧНО (batch 1):** клиентско плащане е изградено — `POST /api/checkout/:shipmentId` + `public/pay.html` (Stripe Elements, реисползва съществуващия escrow PI; DEMO — симулирано; sk_live guard). Остава: реални Stripe TEST ключове + карта тест срещу живия TEST акаунт.
2. **✅ (batch 1):** Airtable link полета (Shipments.Sender/Carrier → Users) — `npm run seed` ги създава автоматично (нови бази) и мигрира стари (rename „… (legacy)" → link полето → backfill); `npm run seed:dry` е credential-free преглед. Бази без полета: airtable.js прави fallback (scalar/премахване), без счупване на записа.
3. **P1:** превръщане на Trust Events + Carbon Ledger ID полета в link полета (сега са текстови).
4. **P1:** QR сканиране с камера (Telegram WebApp) вместо текстов payload.
5. **P1:** Redis session + rate limiting; логване в structured logger.
6. **P2:** Stripe Connect Express onboarding route + `account.updated` webhook.
7. **P2:** Typeform → webhook → /new (вж. TYPEFORM_FIELDS.md).
8. **P2:** Grid/GPS разстояния (сега: таблица с коридорни км) + документиран емисиен фактор от официален източник (EEA/DEFRA) за грантова отчетност.
9. **P3:** автотестове (jest) върху services — демо E2E скриптът е временният smoke test.

## Приложено в Етап 2 (B5/B8)

- **Money module** (`src/services/money.js`): ЕДИН каноничен изчислител за
  split 80/15/5 (remainder → застраховката, гаранция €0.00), VAT върху
  таксата (gross→net+VAT). Stripe, transactions, finance.js и тестовете
  всички го ползват — нула дублирана математика.
- **Аномалия 3 — реално фото (batch 2):** `/refuse <ID>` отваря 24ч
  прозорец; следващото photo съобщение (caption с ID или session от /refuse)
  се записва в `data/evidence/<shipmentId>/` с пълни метаданни (sha256,
  timestamp, shipmentId, chatId — без тях няма доказателство) и се закача
  към отказа. DEMO (без камера): placeholder запис с `demoPlaceholder: true`.
  Evidence пакетът маркира `photoProof.source = REAL | DEMO_PLACEHOLDER | NONE`.
- **Evidence storage + GDPR (batch 3):** всички пътища са централизирани в
  `src/services/evidencePaths.js` — снимки/метаданни/пакети/proof-records са в
  `drum-mvp/data/evidence/` (вътре в repo-то, gitignore-нат; без `..` бягства).
  Retention: `EVIDENCE_RETENTION_DAYS` = 90 дни (GDPR чл. 5(1)(e)) чрез
  `npm run evidence:cleanup`. Миграция на стари записи извън repo-то —
  `docs/GDPR_EVIDENCE.md` §3 (ръчна, нищо не се трие автоматично).
- **Evidence пакет** (B5.4): една команда (`/evidence <ID>` или
  `GET /api/evidence/<ID>`) → JSON + Markdown + SHA-256 checksum,
  репродуцируем (same content → same hash). Съдържа: shipment, Stripe
  режим, финансова времева линия от transactions (split в стотинки),
  спорове, Carbon Ledger запис.
- **Финансов модел** (B8): `src/services/finance.js` = single source of
  truth (коридорите в /new идват от там). Генератор:
  `node scripts/build-financials.js` → `docs/data-room/FINANCIAL_MODEL.md/.csv`
  с watermark и независима аритметична проверка (refuses to write при
  грешка). Сравнение с Financial_Model_SYNCED.xlsx:
  `docs/data-room/FINANCIAL_NOTES.md` (6 разминавания документирани).
