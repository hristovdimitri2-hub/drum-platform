# Airtable Schema

Пълна схема на 4-те таблици в Airtable базата.

> ⚠️ Обновено в v0.2.0 — нови полета:
> - `Shipments.Carrier Stripe Account ID` (single line text)
> - `Carbon Ledger.Origin City`, `Carbon Ledger.Destination City` (single line text)
> - `Carbon Ledger.Factors (audit trail)` (single line text — JSON с факторите на изчислението)
> - `Shipments.Description` — в демо данните започва с `[DEMO]`

## 1. Users

| Field Name | Type | Options | Default |
|---|---|---|---|
| Telegram ID | Number | Integer, unique | — |
| First Name | Single line text | — | — |
| Last Name | Single line text | — | — |
| Username | Single line text | — | — |
| Phone | Phone number | — | — |
| Language | Single line text | — | "bg" |
| KYC Status | Single select | `pending`, `phone_verified`, `id_verified`, `rejected` | `pending` |
| Stripe Customer ID | Single line text | — | — |
| Stripe Connect Account ID | Single line text | — | — |
| Trust Score | Number | Integer 0-100 | 50 |
| Trust Tier | Single select | `banned`, `limited`, `standard`, `verified`, `premium` | `standard` |
| Created At | Date | ISO format | auto |

### Trust Tier thresholds

| Score | Tier | Достъп |
|---|---|---|
| 0-30 | banned | Само изход |
| 31-49 | limited | Пратки до €20 |
| 50-69 | standard | Пратки до €200 |
| 70-89 | verified | Пратки до €500 |
| 90-100 | premium | Пратки до €1 000, B2B API |

---

## 2. Shipments

| Field Name | Type | Options |
|---|---|---|
| Sender ID | Link to Users | — |
| Sender Telegram ID | Number | Integer |
| Carrier ID | Link to Users | — |
| Carrier Telegram ID | Number | Integer |
| Carrier Stripe Account ID | Single line text | — (записва се при `/accept`) |
| Origin City | Single line text | — |
| Destination City | Single line text | — |
| Description | Long text | — |
| Parcel Value (EUR) | Number | Decimal, 2 places |
| Deadline | Single select | `Днес`, `Утре`, `До 3 дни`, `До 7 дни` |
| Total (EUR) | Number | Decimal, 2 places |
| Base (EUR) | Number | Decimal, 2 places |
| Fee (EUR) | Number | Decimal, 2 places |
| Insurance (EUR) | Number | Decimal, 2 places |
| Stripe Payment Intent ID | Single line text | — |
| Stripe Transfer ID | Single line text | — |
| Pickup QR Code | Attachment | Image |
| Delivery QR Code | Attachment | Image |
| Status | Single select | `requested`, `matched`, `picked_up`, `in_transit`, `delivered`, `cancelled`, `disputed` |
| Matched At | Date | ISO format |
| Pickup Scanned At | Date | ISO format |
| Delivery Scanned At | Date | ISO format |
| Created At | Date | ISO format |

### Status flow

```
requested → matched → picked_up → delivered
   ↓           ↓         ↓
cancelled  cancelled  disputed → (resolved → delivered OR cancelled)
```

---

## 3. Trust Events

Event-sourced log of all trust-related actions (following ebay/reputation-system pattern).

| Field Name | Type | Options |
|---|---|---|
| User ID | Link to Users | — |
| Event Type | Single select | `shipment_created`, `shipment_accepted`, `delivery_success`, `delivery_failed`, `dispute_raised`, `dispute_resolved`, `kyc_verified`, `rating_given` |
| Event Value | Number | Integer (+/- points) |
| Shipment ID | Link to Shipments | — |
| Metadata | Long text | JSON string |
| Created At | Date | ISO format |

### Event values

| Event | Value | Note |
|---|---|---|
| shipment_created | 0 | Neutral |
| shipment_accepted | 0 | Neutral |
| delivery_success | +5 | Cap: +100 от deliveries |
| delivery_failed | -15 | Ако fault на потребителя |
| dispute_raised | 0 | Pending resolution |
| dispute_resolved | -50 (fault) / 0 (no fault) | — |
| kyc_verified | +10 | Еднократно |
| rating_given | -5 to +2 | Спрямо rating 1-5 |

---

## 4. Carbon Ledger

GHG Protocol Scope 3 Category 4 — Upstream Transportation and Distribution.

| Field Name | Type | Options |
|---|---|---|
| Shipment ID | Link to Shipments | — |
| Baseline CO2 (kg) | Number | Decimal, 2 places |
| Actual CO2 (kg) | Number | Decimal, 2 places |
| Saved CO2 (kg) | Number | Decimal, 2 places |
| Distance (km) | Number | Integer |
| Methodology | Single line text | `GHG-Protocol-Scope3-Cat4-v1` |
| Verification Status | Single select | `pending`, `verified`, `rejected` |
| Created At | Date | ISO format |

### Methodology

> ⚠️ Каноничната методология е в `docs/CARBON_METHODOLOGY.md` (R1 корекция).
> Marginal е **абсолютен 0.005 kg CO2/km**, не дял от baseline:

```
Baseline CO2 = Distance (km) × 0.18 kg CO2/km    [courier scenario]
Actual CO2   = Distance (km) × 0.005 kg CO2/km   [marginal capacity — absolute]
Saved CO2    = Baseline - Actual = Distance × 0.175
```

Example: София → Пловдив (145 km), 2 kg пратка
- Baseline: 145 × 0.18 = 26.10 kg CO2
- Actual: 145 × 0.005 = 0.725 kg CO2
- Saved: 26.10 − 0.725 = **25.38 kg CO2**

---

## Setup инструкции

1. Създай нов Airtable base + token с `schema.bases:write` scope
2. Пусни seed скрипта (създава всичките 4 таблици):
   ```bash
   npm run seed        # live (изисква .env ключове)
   npm run seed:dry    # преглед на плана БЕЗ ключове/мрежа
   ```
3. Field types трябва да са точно както е описано (особено Number vs Single line text)
4. **Link полета — автоматично:** `Shipments.Sender ID` и `Shipments.Carrier ID`
   се създават като `multipleRecordLinks → Users` директно при създаване на
   таблицата (seed-ът първо създава `Users`, после реисползва неговия id).
   Стари бази (создадени с текстови Sender/Carrier): seed-ът ги мигрира сам —
   rename на старото поле → `… (legacy)`, добавяне на link полето, backfill на
   съществуващите редове. Записите през `src/services/airtable.js` пишат
   record-id масиви с fallback към legacy текст (без счупване на стара база).
5. Trust Events `User ID`/`Shipment ID` и Carbon Ledger `Shipment ID` —
   все още текстови (ръчни като link полета; ARCHITECTURE TODO #3, P1).

## Quick setup script

За автоматично създаване на таблиците + link полетата:

```bash
npm run seed        # изисква Airtable Metadata API token
npm run seed:dry    # credential-free: печата целия план (таблици, link
                    # полета, legacy upgrade, backfill, rate-limit политика)
```
