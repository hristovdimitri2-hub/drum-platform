# DATABASE — adapter интерфейс (B1)

## Състояние

| Backend | Статус | Използване |
|---|---|---|
| **SQLite** (`node:sqlite`, нула deps) | ✅ РЕАЛНО, по подразбиране | `DATA_BACKEND=sqlite` (default) — `data/drum.db` |
| Demo Store (in-memory JSON) | ✅ РЕАЛНО (legacy) | `DATA_BACKEND=demo` |
| Airtable | ✅ РЕАЛНО (production no-code път) | `DATA_BACKEND=airtable` + ключове |
| Postgres | ❌ ДОКУМЕНТИРАН, не имплементиран | виж по-долу |

**Критерий на B1 ✓:** чист clone (`npm install` + `npm start`) работи без
нищо външно — SQLite backend, dashboard-only без Telegram токен,
Stripe в симулация при `DEMO_MODE=true`.

## Adapter контракт (всички backend-ове имплементират това)

```
users:      findOrCreateUser({telegramId, firstName, lastName, username, language})
            findUserByTelegramId(telegramId)
            updateUser(telegramId, {phone?, kycStatus?, stripeCustomerId?,
                        stripeConnectAccountId?, routes?, trustScore?, trustTier?})
            updateTrustScore(userId, eventType, context?)   // B4 правила
shipments:  createShipment(data) · getShipment(id) · updateShipment(id, fields)
            listShipmentsByUser(telegramId) · listPendingShipments()
            listAllShipments()
trust:      logTrustEvent({userId, eventType, eventValue, scoreAfter,
                           tierAfter, shipmentId, metadata})
            listTrustHistory(userId)
carbon:     createCarbonEntry(entry) · listCarbonEntries()
transactions: recordTransaction(tx) · listTransactionsByShipment(shipmentId)
qr:         saveQrCode({shipmentId, kind, payload, image}) ·
            getQrCode(shipmentId, kind) · markQrScanned(shipmentId, kind)
disputes:   createDispute({shipmentId, openedBy, reason}) ·
            updateDisputeStatus(id, status) · listDisputes(filter) ·
            countLostDisputes(userId, days)
seed:       resetSeed(data) · clear()
```

## SQLite схема (7 таблици + counters)

`users` · `shipments` · `transactions` (escrow/capture/transfer/refund със
split 80/15/5 в стотинки) · `qr_codes` (pickup/delivery, payload, scanned_at) ·
`trust_history` (event-sourced: event_type, delta, score_after, tier_after,
metadata) · `disputes` (open/won/lost/resolved) · `carbon_ledger` (baseline/
actual/saved CO₂, methodology, factors audit trail).

Файл: `data/drum.db` (gitignore-нат). Индекси върху sender/carrier telegram_id,
shipment status, trust_history(user, created_at).

## Postgres път (документиран, НЕ имплементиран — честно ❌)

1. `npm install pg` (или `postgres`).
2. Направи `src/services/db/postgres.js`, имплементиращ горния контракт
   (pool + параметризирани заявки; схемата е 1:1 с SQLite DDL, като
   `TEXT PRIMARY KEY` → `TEXT PRIMARY KEY`, `INTEGER` → `BIGINT` за
   telegram_id, `REAL` → `NUMERIC(12,2)` за пари, `AUTOINCREMENT` →
   `GENERATED ALWAYS AS IDENTITY`).
3. Миграции: `migrations/001_init.sql` (същият DDL) + прост ранер
   (`node scripts/migrate.js`) — or node-pg-migrate, ако предпочиташ.
4. Включи в `store.js`: `else if (DATA_BACKEND === 'postgres') require('./db/postgres')`.
5. Env: `DATABASE_URL=postgres://user:pass@host:5432/drum` — НИКОГА в кода.
6. Тестовете от `tests/b1-store.test.mjs` минават и над Postgres adapter-а
   (контрактните тестове са backend-агностични — подави му temp DB).

Причина за неимплементиране: SQLite покрива изцяло MVP/демо фазата;
Postgres има смисъл при реален multi-instance deployment (Етап production).
