# CARBON METHODOLOGY — DRUM 3.0 (v1, GHG Protocol Scope 3 Cat. 4)

> Methodology statement — приложим към всеки запис в Carbon Ledger.
> Каноничният изчислител е `src/services/carbon.js`; факторите са
> конфигурируеми през env (CO2_BASELINE_KG_PER_KM, CO2_MARGINAL_SHARE_FACTOR)
> и ВСЕКИ запис пази точните фактори, използвани при изчислението (audit trail).

## 1. Standard & boundary

- **Standard:** GHG Protocol Corporate Value Chain (Scope 3) Standard,
  **Category 4 — Upstream Transportation and Distribution**.
- **Scope на изчислението:** една пратка, превозвана от частен автомобил,
  който вече извършва пътуването (празен багажник). Well-to-wheel CO₂e.
  Не се включват: последваща продажба на carbon credits, електрификация
  сценарии, първи/последен mile до точката на среща.
- **Exclusions:** последните миля (first/last mile до точката на среща),
  административни пътувания, въздушен транспорт.

## 2. Baseline (counterfactual)

Специализирана куриерска доставка на същата пратка по същия маршрут:
**BASELINE_EMISSIONS_KG_PER_KM = 0.18 kg CO₂e/km** (light commercial vehicle,
~50% натоварване, EU енергийна смес). Ориентир: EEA/DEFRA LV диапазон
0.15–0.25 — източникът се доказва при грантово приложение (TODO: цитирай
конкретна публикация и година при VCS подаване).

## 3. Actual (DRUM сценарий) — allocation

Маргинален подход ( консервативен, съобразен с GHG allocation hierarchy):
пратката не създава ново пътуване — ползва вече извършващо се пътуване.
**MARGINAL_SHARE_FACTOR = 0.005** (0.5% от baseline е attributable на
един малък пакет в вече движеща се кола).

```
saved = baseline − actual = km × 0.18 − km × 0.18 × 0.005
София→Пловдив (145 km): 26.10 − 0.13 = 25.97 kg CO₂e спестено
```

## 4. Audit trail

Всеки Carbon Ledger запис пази: distance_km, methodology таг
(`GHG-Protocol-Scope3-Cat4-v1`), факторите (JSON), verification_status
(pending/verified/rejected) и timestamp. Export: `scripts/export-carbon.js`
(CSV + JSON, готови за VCS (Verra) / Gold Standard подаване).

## 5. Verification path

1. Вътрешна проверка: строу directors/data-room проверка (B8 reconciliation).
2. Външна: TÜV / SGS / Bureau Veritas (при >1,000 доставки).
3. VCS (Verra) / Gold Standard регистрация — Year 3+ (извън текущия обхват).
