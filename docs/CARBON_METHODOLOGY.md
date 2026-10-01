# CARBON METHODOLOGY — DRUM 3.0 (v1, GHG Protocol Scope 3 Cat. 4)

> Methodology statement — приложим към всеки запис в Carbon Ledger.
> Каноничният изчислител е `src/services/carbon.js`; факторите са
> конфигурируеми през env (CO2_BASELINE_KG_PER_KM, CO2_MARGINAL_SHARE_FACTOR)
> и ВСЕКИ запис пази точните фактори, използвани при изчислението (audit trail).

## 1. Standard & boundary

- **Standard:** GHG Protocol Corporate Value Chain (Scope 3) Standard,
  **Category 4 — Upstream Transportation and Distribution**.
- **Scope на изчислението:** една пратка, превозвана от частен автомобил,
  който вече извършва пътуването (празен багажник). Tank-to-wheel CO₂e
  (CO₂ + CH₄ + N₂O); WTT е изключен — вж. §2 „Boundary уточнение".
  Не се включват: последваща продажба на carbon credits, електрификация
  сценарии, първи/последен mile до точката на среща.
- **Exclusions:** последните миля (first/last mile до точката на среща),
  административни пътувания, въздушен транспорт.

## 2. Baseline (counterfactual)

Специализирана куриерска доставка на същата пратка по същия маршрут:
**BASELINE_EMISSIONS_KG_PER_KM = 0.18 kg CO₂e/km** (light commercial vehicle,
~50% натоварване).

**Източник (copy-paste проверим):**

- **Организация:** Department for Energy Security and Net Zero (DESNZ, UK) —
  наследник на BEIS; серията „UK Government GHG Conversion Factors for
  Company Reporting" (по-рано DEFRA/BEIS).
- **Публикация:** *Greenhouse gas reporting: conversion factors 2026*,
  **data year 2026**, публикувана **2026-07-31**.
  URL: https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026
- **Файл/версия:** `ghg-conversion-factors-2026-flat-format-revised.xlsx`
  („flat file for automatic processing, updated July 2026"), лист
  **„Factors by Category"**, категория **Delivery vehicles → Vans**, единица
  **kg CO2e per vehicle-km**, колона „GHG Conversion Factor 2026".
  URL: https://assets.publishing.service.gov.uk/media/6a6c9748862aaf18d9c62ac9/ghg-conversion-factors-2026-flat-format-revised.xlsx
- **Methodology report (същата публикация):** https://assets.publishing.service.gov.uk/media/6a2940543b15d05a7ce3202e/2026-GHG-conversion-factors-methodology-report.pdf

**Извлечени стойности от таблицата (verify: отвори файла → същия лист):**

| Клас ван | Diesel (kg CO2e/km) | Petrol (kg CO2e/km) |
|---|---|---|
| Class I (до 1.305 t) | **0.15833** | 0.19781 |
| Class II (1.305–1.74 t) | **0.19376** | 0.20453 |
| Class III (1.74–3.5 t) | 0.28046 | 0.33161 |
| Average (до 3.5 t) | 0.25716 | 0.20905 |

**Защо точно 0.18:** пратките на DRUM са ≤2 kg → контрафактуумът е малък
куриерски ван (Class I–II, 0.158–0.205 kg CO2e/km); **0.18 е центърът на
Class I–II diesel диапазона**: (0.15833 + 0.19376) / 2 = 0.176 ≈ **0.18** —
валиден централен избор при ~50% натоварване (по-тежкият Class III,
0.280, се изключва като нерепрезентативен за ≤2 kg пратки).

**Boundary уточнение:** цитираният фактор е direct/tank-to-wheel — колоната
„kg CO2e" включва CO₂ + CH₄ + N₂O (за Class I diesel: 0.15667 + 0.0000049 +
0.00165 ≈ 0.15833). Well-to-tank (WTT) компонентът за Class II diesel е
0.046 kg/km (същата публикация, „WTT- vans") и е **изключен** от baseline —
това прави спестяването консервативно (базата е подценена). UK факторите
служат като proxy за EU/UK смес; tank-to-wheel стойностите не зависят от
енергийната смес (горивна зависимост), само WTT го прави.

## 3. Actual (DRUM сценарий) — allocation

Маргинален подход (консервативен, съобразен с GHG allocation hierarchy):
пратката не създава ново пътуване — ползва вече извършващо се пътуване.
**MARGINAL_KG_PER_KM = 0.005 kg CO₂e/km** (абсолютен фактор: допълнителното
тегло на един малък пакет в вече движеща се кола).

**Канонична формула (B6.1):**

```
saved = (baseline − marginal) × km = (0.18 − 0.005) × km = 0.175 × km
```

## 3а. Worked example — реален ledger ред (София → Пловдив)

Пълната аритметика на един запис от Carbon Ledger:

```
km               = 145          (коридор София-Пловдив, път)
baseline         = 145 × 0.18   = 26.10 kg CO₂e   (куриерска кола)
marginal         = 145 × 0.005  = 0.725 kg CO₂e   (маргинална пратка)
saved            = 26.10 − 0.725 = 25.375 → 25.38 kg CO₂e (round2)
methodology      = GHG-Protocol-Scope3-Cat4-v1
factors (audit)  = {"baselineKgPerKm": 0.18, "marginalKgPerKm": 0.005}
```

**Историческа бележка:** до B6.1 старият код смяташе `actual = baseline ×
0.005` (0.5% ДЯЛ от baseline) → saved = 25.97 kg за същия коридор. Това беше
двоен смисъл на „share" — коригирано към абсолютния фактор (0.005 kg/km) по
ревизия B6.1. Стари записи (25.97) се преизчисляват при повторен seed.

## 4. Audit trail

Всеки Carbon Ledger запис пази: distance_km, methodology таг
(`GHG-Protocol-Scope3-Cat4-v1`), факторите (JSON), verification_status
(pending/verified/rejected) и timestamp. Export: `scripts/export-carbon.js`
(CSV + JSON, готови за VCS (Verra) / Gold Standard подаване).

## 5. Verification path

1. Вътрешна проверка: data-room проверка (B8 reconciliation).
2. Външна: TÜV / SGS / Bureau Veritas (при >1,000 доставки).
3. VCS (Verra) / Gold Standard регистрация — Year 3+ (извън текущия обхват).

## 6. За бележка (TODO, не блокира): carrier waiver

При VCS/грантово подаване: превозвачът трябва да подпише **waiver**, че не
претендира същите спестявания като лични carbon credits (предпазва от
double-counting между платформените и индивидуалните твърдения). Формулярът
не е изграден — добави се преди първото реално подаване.
