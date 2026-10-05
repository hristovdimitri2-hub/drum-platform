# METHODOLOGY — Open Carbon & Evidence (OCE)

Scope: the carbon math in `src/services/carbon.js` (per-shipment CO2e
savings). This file is written to be checkable line-by-line by an external
auditor or grant reviewer: every number below is either **cited** (source,
file, sheet, row, date) or **explicitly labelled as an assumption**.

## 1. Standard and boundary

- **Standard:** GHG Protocol Corporate Value Chain (Scope 3) Standard,
  **Category 4 — Upstream Transportation and Distribution**.
- **System boundary:** tank-to-wheel CO2e (CO2 + CH4 + N2O) for one parcel
  carried in a private vehicle that is **already making the trip**.
  Well-to-tank (WTT) is excluded (makes the saving conservative).
- **Exclusions:** first/last mile to the meeting point, administrative
  travel, air transport, carbon-credit issuance.

## 2. Baseline (counterfactual) — cited

The counterfactual is a dedicated courier van covering the same parcel over
the same route: **BASELINE = 0.18 kg CO2e/km**.

Exact citation (copy-paste verifiable):

- **Organisation:** Department for Energy Security and Net Zero (DESNZ, UK),
  successor of BEIS; series "UK Government GHG Conversion Factors for
  Company Reporting" (formerly DEFRA/BEIS).
- **Publication:** *Greenhouse gas reporting: conversion factors 2026*,
  **data year 2026**, published **2026-07-31**.
  https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026
- **File/version:** `ghg-conversion-factors-2026-flat-format-revised.xlsx`
  ("flat file for automatic processing, updated July 2026"), sheet
  **"Factors by Category"**, category **Delivery vehicles → Vans**, unit
  **kg CO2e per vehicle-km**, column "GHG Conversion Factor 2026":
  https://assets.publishing.service.gov.uk/media/6a6c9748862aaf18d9c62ac9/ghg-conversion-factors-2026-flat-format-revised.xlsx
- **Methodology report (same publication):**
  https://assets.publishing.service.gov.uk/media/6a2940543b15d05a7ce3202e/2026-GHG-conversion-factors-methodology-report.pdf

Values as extracted from that exact row (verify: open the file → same
sheet):

| Van class | Diesel (kg CO2e/km) | Petrol (kg CO2e/km) |
|---|---|---|
| Class I (≤1.305 t) | **0.15833** | 0.19781 |
| Class II (1.305–1.74 t) | **0.19376** | 0.20453 |
| Class III (1.74–3.5 t) | 0.28046 | 0.33161 |
| Average (≤3.5 t) | 0.25716 | 0.20905 |

**Why exactly 0.18:** DRUM parcels are ≤2 kg, so the counterfactual vehicle
is a small courier van (Class I–II). 0.18 is the **midpoint of the Class I–II
diesel band**: (0.15833 + 0.19376) / 2 = 0.176 ≈ **0.18**. Class III (0.28046)
is excluded as unrepresentative for ≤2 kg parcels. The cited factor is
direct/tank-to-wheel; the Class II WTT component (0.046 kg/km, same
publication, "WTT- vans") is **excluded**, which understates the baseline and
therefore understates the saving (conservative). Verified 2026-10-01.

## 3. Marginal (actual) factor — ASSUMPTION, derivation documented

**MARGINAL = 0.005 kg CO2e/km** (absolute, not a share of the baseline).

- **Stated rationale:** the parcel adds load to a vehicle that is already
  driving the route — no new trip is created (GHG allocation hierarchy:
  avoid → share → allocate).
- **Mass-based physics estimate (shown, not cited):** for a 2 kg parcel in a
  ~1,500 kg van, rolling-resistance delta = Crr (0.01) × 2 kg × 9.81 m/s² ≈
  0.196 N → ≈ 196 J/km; at diesel LHV ≈ 36 MJ/L and ~30% drivetrain
  efficiency → ≈ 1.8 × 10⁻⁵ L/km → × 2.66 kg CO2/L ≈ **5 × 10⁻⁵ kg CO2e/km**.
- **Chosen value:** **0.005 kg CO2e/km ≈ 100 × the mass-only estimate**
  (≈ 2.8% of the baseline). This is a deliberate engineering safety margin
  covering payload effects that mass physics alone does not capture (extra
  stop/low-speed manoeuvres at pickup). Because
  `saved = (baseline − marginal) × km`, a *higher* marginal factor yields a
  *lower* reported saving — the margin errs against ourselves.
- **Label:** **ASSUMPTION — no external published source.** The exact
  factors used are stored per record in the ledger audit trail
  (`factors: { baselineKgPerKm, marginalKgPerKm }`), so any record can be
  re-audited or re-computed under a different marginal value.

## 4. Formula and worked example (real ledger record)

```
saved = (baseline − marginal) × km = (0.18 − 0.005) × km = 0.175 × km

km               = 145          (София → Пловдив corridor, road)
baseline         = 145 × 0.18   = 26.10 kg CO2e   (courier van)
marginal         = 145 × 0.005  = 0.725 kg CO2e   (marginal parcel)
saved            = 26.10 − 0.725 = 25.375 → 25.38 kg CO2e (round 2)
methodology tag  = GHG-Protocol-Scope3-Cat4-v1
factors (audit)  = {"baselineKgPerKm": 0.18, "marginalKgPerKm": 0.005}
```

Historical note: before revision B6.1 the code computed
`actual = baseline × 0.005` (a 0.5% *share*) → 25.97 kg for the same
corridor. That ambiguity was resolved to the absolute factor
(0.005 kg/km); old records are recomputed on re-seed.

## 5. Audit trail and verification path

- Every ledger record stores `distance_km`, the methodology tag, the exact
  factors (JSON), `verification_status` and a timestamp.
- Internal check: data-room reconciliation (B8).
- External (future): TÜV / SGS / Bureau Veritas at >1,000 deliveries;
  VCS (Verra) / Gold Standard not in current scope.

## 6. Known limitations

- Corridor distances come from the reference implementation's Bulgarian
  corridor table (a routing/GPS distance service is a documented TODO).
- The marginal factor is an assumption (§3), stored per record and
  overridable via `CO2_MARGINAL_KG_PER_KM`.
- No production use yet: this package has 10/10 passing tests on a clean
  clone and **0 external users, 0 production verifications** — an
  instrument, not a network.
