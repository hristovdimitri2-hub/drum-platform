# ARCHITECTURE — DRUM 3.0 MVP (както е реално, а не в презентацията)

Дата на одит: 2026-09. Източник: `drum-mvp.zip` (COMPLETE_ARCHIVE 04_Code),
обновен до v0.2.0 с Carbon Ledger модул, demo mode и уеб дашборд.

> **Обновено 2026-11-03/04** след EIC одита (клон `patch/p1-p3-hardening`):
> P1/P2/P3 точките по-долу са приложени в код и тестове. Отворените решения
> (P3.4 лиценз, P3.5 Postgres) са изрично записани в §„Отворени решения“, а не
> оставени да се подразбират.

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
| Webhooks | ✅ работещ | `/webhooks/stripe` с raw body ПРЕДИ JSON parser (поправен бъг). **P0 (03.11.2026): подписът е ЗАДЪЛЖИТЕЛЕН във всички режими** — unsigned се приема само при `DEMO_MODE=true` + изрично `ALLOW_UNSIGNED_WEBHOOKS=true`; иначе 400. Рейт лимит умишлено НЕ се прилага (Stripe retry-ва) — контролите са подпис + idempotency таблица |
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

- **Node ≥ 22.5** (`package.json` → `engines`; CI на 22, разработка/тестове на 24).
  Причината за долната граница: тестовете ползват вградения `node:test` и
  `node --test`, а `zstd`/`fetch` идват от стандартната библиотека.
- Telegraf ^4.16, Stripe ^18 (API `basil`), Express ^4.21, qrcode ^1.5, dotenv ^16,
  Airtable ^0.12, **helmet ^8.3**, **express-rate-limit ^8.7** (P1.7).
- База: SQLite (`DATA_BACKEND=sqlite`, по подразбиране), Airtable
  (`DATA_BACKEND=airtable`, production no-code) или Demo Store
  (`DATA_BACKEND=demo`, legacy in-memory). `DEMO_MODE` е независим от backend-а.

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
4. **✅ (batch 3) камерата работи** — `public/scan.html` (jsQR) → `POST /api/scan`
   → реалният `/scan` command. Остава: опаковане като Telegram WebApp (сега е
   отделна страница, отваряна в браузър).
5. **✅ rate limiting + structured logging (P1.7)** — `src/services/security.js`
   (helmet + login/api/scan лимити + JSON access log). **Остава:** Redis
   session store (сесиите в `bot.js` са in-memory и не се споделят между
   процеси).
6. **P2:** Stripe Connect Express onboarding route + `account.updated` webhook.
7. **P2:** Typeform → webhook → /new (вж. TYPEFORM_FIELDS.md).
8. **P2:** Grid/GPS разстояния (сега: таблица с коридорни км) + документиран
   емисиен фактор от официален източник (EEA/DEFRA) за грантова отчетност.
   **P3.3 (готово):** тихият `DEFAULT_DISTANCE_KM = 200` е премахнат — непознат
   коридор хвърля грешка; fallback може да се включи само изрично чрез
   `CO2_UNKNOWN_CORRIDOR_FALLBACK_KM`. **P3.2 (готово):** маржиналният фактор
   `0.005` е документиран като консервативен инженерен марж, с opt-in
   физически режим (`CO2_MARGINAL_MODE=physics`), който изисква реалните си
   входове и отказва да си измисли константа.
9. **✅ тестове (P2.1)** — не jest, а вграденият `node:test`
   (`npm test` = `node --test tests/*.test.cjs`), + `scripts/coverage-gate.js`
   и `npm run coverage`. Демо E2E скриптът остава като smoke тест в CI, но вече
   не е единственият.

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
  `GET /api/evidence/<ID>`) → JSON + Markdown + SHA-256 checksum.
  **P3.1 — репродуцируемостта вече е вярна:** хешът се смята върху
  канонично съдържание, от което са изключени летливите полета
  `checksum`, `generatedAt`, `carbonLedger.calculatedAt` и
  `carbonLedger.createdAt` (`anomalies.CHECKSUM_VOLATILE_PATHS`). Преди това
  `generatedAt` влизаше в хеша, тоест два пакета от едни и същи данни даваха
  РАЗЛИЧНИ хешове — твърдението тук беше невярно. Всяка промяна по същество
  (суми, split, текст на спор, sha256 на снимка) хеша го променя.
  Съдържа: shipment, Stripe режим, финансова времева линия от transactions
  (split в стотинки), спорове, Carbon Ledger запис.
- **Финансов модел** (B8): `src/services/finance.js` = single source of
  truth (коридорите в /new идват от там). Генератор:
  `node scripts/build-financials.js` → `docs/data-room/FINANCIAL_MODEL.md/.csv`
  с watermark и независима аритметична проверка (refuses to write при
  грешка). Сравнение с Financial_Model_SYNCED.xlsx:
  `docs/data-room/FINANCIAL_NOTES.md` (6 разминавания документирани).

---

## P1/P2/P3 одит — какво е приложено (2026-11-03/04)

| # | Точка | Статус | Доказателство |
|---|---|---|---|
| P1.5 | Двете страни на паричния модел се разминаваха (`ticketEur` / мъртъв VAT код) | ✅ | `stripe.js captureAndSplit` вече няма мъртвия `ticketEur` параметър; VAT идва от `money.vatOnDrumFee(drumCents)` (същият helper като `finance.js`/`b2b.js`) вместо структурната нула `total − sum(split)`. `/new` вече показва каноничния split от `money.js` вместо собствена `base*0.15` сметка → `tests/p1-wizard-pricing.test.cjs` |
| P1.6 | README trust таблицата не съвпадаше с `trust.js` | ✅ | README пренаписана от `RULES`; `tests/p1-readme-trust-parity.test.cjs` парсва markdown таблицата и пада при всяко разминаване в двете посоки |
| P1.7 | Липсваха helmet / rate limiting / structured logging | ✅ | `src/services/security.js` (+ `helmet ^8.3`, `express-rate-limit ^8.7`), закачени в `bot.js`; `tests/p2-security.test.cjs` (12 случая) |
| P2.1 | Coverage gate само върху 4 модула; нула тестове на HTTP слоя | ✅ | `bot.js` вече изнася `app` и слуша само при `require.main === module` → `tests/p2-routes.test.cjs` (14 случая); `scripts/coverage-gate.js` разширен |
| P2.2 | Нямаше CI job с `DATA_BACKEND=airtable` | ✅ | Нов job `airtable-backend` в `.github/workflows/ci.yml`; `tests/p2-airtable-contract.test.cjs` вдига фалшив Airtable API на loopback (airtable@0.12 чете `AIRTABLE_ENDPOINT_URL`) и пуска РЕАЛНИЯ адаптер — 15 случая |
| P2.3 | `money.js` env процентите не се валидираха | ✅ | `parsePercent` / `validateRates` (≥0, ≤100, сума = 100), валидация при зареждане; `tests/p2-money-config.test.cjs` |
| P2.4 | `normalizeEventType` връщаше `null` | ✅ | Връща винаги низ; `dispute_raised`/`dispute_resolved` са явни no-op (`NOOP_EVENTS`) вместо „unknown event: null“; clamp тестове в `tests/p2-trust-noop.test.cjs` |
| P2.5 | Silent `catch {}` блокове + `_tmp-*.js` | ✅ | 5-те блока в `anomalies.js`/`photoProof.js` вече логват (с код/причина, ENOENT е доказано бенайн); `_tmp-*.js` изтрити; `tests/p2-no-silent-catch.test.cjs` сканира `src/` |
| P2.6 | 127-файлов phantom CRLF diff | ✅ | `.gitattributes` (`* text=auto eol=lf`); нужен е еднократен `git add --renormalize .` |
| P2.7 | Остарял ARCHITECTURE.md | ✅ | Този раздел + поправените Node версия, статус на камерата, webhook и TODO точки |
| P3.1 | Хешът на evidence пакета не беше репродуцируем | ✅ | `CHECKSUM_VOLATILE_PATHS` + `evidenceChecksum()`; `tests/p3-hardening.test.cjs` |
| P3.2 | Маржинален фактор `0.005` | ✅ | Документиран като консервативен инженерен марж; opt-in `CO2_MARGINAL_MODE=physics`, който ИЗИСКВА входовете си и отказва да измисли константа |
| P3.3 | Тих `DEFAULT_DISTANCE_KM = 200` | ✅ | Премахнат; `resolveDistance` връща `distanceSource` (`explicit`/`corridor`/`env-fallback`) или хвърля |
| P3.4 | Лиценз на главното репо | ⏸ **решение на собственика** | Виж §„Отворени решения“ |
| P3.5 | Postgres път | ⏸ **планирано** | Виж §„Отворени решения“ |

## Отворени решения

### P3.4 — Лиценз на главното репо (**не е решено от агента; изисква решение на собственика**)

`package.json` казва `"license": "UNLICENSED"` и `"private": true`, тоест
**всички права са запазени**. Това противоречи на open-core разказа: публичният
пакет `oss/open-carbon-evidence` е Apache-2.0 и е представян като OSS принос,
докато основното репо (платформата) е изцяло затворено. Това не е технически
проблем, а правно/позиционно решение и **не се променя от код**:

1. **Затворено (сегашното):** нищо не се променя; open-core разказът трябва да
   се формулира като „Open Core: OSS доказателствен компонент + затворена
   платформа“, а не като „open-source платформа“.
2. **Apache-2.0 / MIT за платформата:** максимално съответствие с разказа, но
   дава на всеки право да хоства конкурентна инстанция.
3. **AGPL-3.0:** съответства на open-source разказа и блокира затворен SaaS
   fork — най-често срещаният компромис за инфраструктурен слой.
4. **Двулицензионен (AGPL + търговски):** стандартът за open-core.

Не е избран вариант съзнателно: изборът има търговски и правни последици.
Докато не бъде решен, `UNLICENSED` остава и документацията трябва да говори за
„open core“, не за „open source платформа“.

### P3.5 — Postgres (планирано)

Сега: SQLite (`DATA_BACKEND=sqlite`, файл на диска) + **in-memory** сесии в
`bot.js`. Нито едното не се хоризонтално скалира: втори процес вижда различно
състояние и собствени сесии. Пътят:

1. Сесии → Redis (`connect-redis` или собствен store) — блокер за повече от
   един инстанс.
2. SQLite → Postgres чрез `pg`; **вече има adapter интерфейс** (`docs/DATABASE.md`,
   `src/services/db/sqlite.js` е референтната имплементация), така че се добавя
   `src/services/db/postgres.js` без промени в командите.
3. `store.js` вече налага interface gate при зареждане
   (`REQUIRED_BACKEND_METHODS`) — нов backend, който не ги имплементира, спира
   процеса на стартиране вместо да гръмне по средата на плащане.

## Известни ограничения (честно)

- **`script-src 'unsafe-inline'` в CSP.** `public/index.html`, `scan.html` и
  `pay.html` съдържат inline `<script>` блокове и `onclick=` атрибути, затова
  CSP-то трябва да ги разрешава. Изнасянето им във външни `.js` файлове е
  следващата стъпка, която позволява директивата да се махне.
- **Airtable backend-ът е НЕПЪЛЕН.** Липсват 12 метода, които приложението
  вика без guard: `recordTransaction`, `listTransactionsByShipment`,
  `saveQrCode`, `getQrCode`, `markQrScanned`, `createDispute`, `getDispute`,
  `listDisputes`, `updateDisputeStatus`, `countLostDisputes`,
  `isWebhookProcessed`, `markWebhookProcessed`. `store.js` **отказва да
  стартира** с `DATA_BACKEND=airtable` (освен при изрично
  `ALLOW_INCOMPLETE_BACKEND=true`), защото иначе webhook-ът и capture-ът
  гърмят по средата на плащане. Пълен списък и тест:
  `tests/p2-airtable-contract.test.cjs`. **За production с Airtable трябва
  първо да се добавят тези 12 метода** (нужни са таблици Transactions, QR,
  Disputes, Webhook Events).
- **Тестовете, които стартират подпроцес** (`spawnSync`) падат в тази
  sandbox-среда с `EPERM`; на CI минават. Същото е потвърдено и на
  немодифицирано копие — не е регресия.
- **`npm audit`** отчита уязвимости в транзитивни dev зависимости; не е
  адресирано в този кръг.
