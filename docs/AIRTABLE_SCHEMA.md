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

```
Baseline CO2 = Distance (km) × 0.18 kg CO2/km   [courier scenario]
Actual CO2   = Distance (km) × 0.18 × 0.005      [marginal capacity, ~0.5%]
Saved CO2    = Baseline - Actual
```

Example: София → Пловдив (150 km), 2 kg пратка
- Baseline: 150 × 0.18 = 27.00 kg CO2
- Actual: 150 × 0.18 × 0.005 = 0.135 kg CO2
- Saved: 27.00 - 0.135 = **26.865 kg CO2**

---

## Setup инструкции

1. Създай нов Airtable base
2. Създай 4 таблици с горните полета
3. Field types трябва да са точно както е описано (особено Number vs Single line text)
4. Link fields: свържи `Shipments.Sender ID` → `Users`, `Shipments.Carrier ID` → `Users`
5. Trust Events: `User ID` → `Users`, `Shipment ID` → `Shipments`
6. Carbon Ledger: `Shipment ID` → `Shipments`

## Quick setup script

За автоматично създаване на таблиците, използвай:

```bash
npm run seed
```

Този скрипт ще създаде нужните полета автоматично (изисква Airtable Metadata API).
