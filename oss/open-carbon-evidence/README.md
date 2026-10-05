# Open Carbon & Evidence (OCE)

Standalone, dependency-free package extracted from **DRUM 3.0** containing the
two public-safe layers that are useful on their own:

1. **Carbon math** — `src/services/carbon.js`
   CO2 savings per delivery under **GHG Protocol Scope 3, Category 4**
   (Upstream Transportation and Distribution):
   `saved = (baseline − marginal) × km`, canon `0.175 × km`
   (baseline `0.18 kg CO2e/km`, absolute marginal `0.005 kg CO2e/km`),
   configurable via `CO2_BASELINE_KG_PER_KM` / `CO2_MARGINAL_KG_PER_KM`
   (absolute kg/km), with an audit trail (`factors`) on every result.
2. **Photo-evidence layer** — `src/services/photoProof.js` + `src/services/evidencePaths.js`
   Content-addressed storage: every photo is written with a sidecar metadata
   JSON (`sha256`, `timestamp`, `shipmentId`, `chatId` — *no metadata → no
   evidence*), plus `listProofPhotos`, `extractShipmentId` and a GDPR
   retention cleanup (`EVIDENCE_RETENTION_DAYS`, default 90 — GDPR Art. 5(1)(e)).

**Zero runtime dependencies** (Node built-ins only). Node ≥ 18.

## Status & provenance (honest)

- **What this is:** a standalone extract of two working components from
  **DRUM 3.0** — a private P2P logistics platform still in development.
  Everything outside this list stays in the private platform: matching,
  trust scoring, payments (Stripe escrow/split), batch.
- **Provenance:** extracted from **DRUM 3.0** — a private P2P logistics
  platform. Parent-suite test counts are deliberately NOT recorded here
  (numbers age — take them from runner output only). Only this package
  is public.
- **Status:** 10/10 tests on a clean clone · **0 external users** ·
  **0 production deployments / 0 production verifications** · not
  published to npm (`private: true`). An **instrument, not a network**.
- **License:** Apache-2.0 (see [LICENSE](LICENSE)).
- **Full methodology** (boundary, emission-factor citation with exact
  spreadsheet row, marginal-factor derivation, worked example):
  [METHODOLOGY.md](METHODOLOGY.md).

## Usage

```js
const carbon = require('./src/services/carbon');
const { calculateCo2Saved, summarize } = carbon;

const trip = calculateCo2Saved({ originCity: 'София', destinationCity: 'Пловдив' });
// { distanceKm: 145, baselineCo2Kg: 26.1, actualCo2Kg: 0.73,
//   savedCo2Kg: 25.38, methodology: 'GHG-Protocol-Scope3-Cat4-v1',
//   factors: { baselineKgPerKm: 0.18, marginalKgPerKm: 0.005 } }

const photoProof = require('./src/services/photoProof');
const saved = photoProof.saveProofPhoto({
  shipmentId: 'shp-000001', chatId: 42, buffer: jpegBuffer,
});
// { sha256, filePath, metaPath, meta: { sha256, timestamp, shipmentId, chatId, ... } }
photoProof.cleanupExpiredEvidence(); // GDPR retention sweep (default 90 days)
```

Storage root: `data/evidence/` relative to the package (override with
`EVIDENCE_DIR=<abs path>`). The directory is created on demand; keep it out
of version control.

## Emission-factor citation (DESNZ 2026)

Baseline `0.18 kg CO2e/km` is the **midpoint of the UK Government
(DESNZ) light-commercial-van band**:

- **DESNZ (UK)**, *Greenhouse gas reporting: conversion factors 2026*
  (published 2026-07-31), sheet *Factors by Category*, category
  **Delivery vehicles → Vans**, unit *kg CO2e per vehicle-km*:
  **Class I (≤1.305 t) diesel = 0.15833**, **Class II (1.305–1.74 t)
  diesel = 0.19376** → midpoint (0.15833 + 0.19376)/2 = **0.176 ≈ 0.18**.
- Publication: https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026
- File: `ghg-conversion-factors-2026-flat-format-revised.xlsx` →
  https://assets.publishing.service.gov.uk/media/6a6c9748862aaf18d9c62ac9/ghg-conversion-factors-2026-flat-format-revised.xlsx

Class III vans (1.74–3.5 t, 0.28046) are excluded as unrepresentative for
≤2 kg parcels. The factor is direct/tank-to-wheel (CO2+CH4+N2O); WTT is
excluded (conservative). Verified 2026-10-01.

## Tests

```bash
npm test     # node --test tests/ — no network, no credentials
```

## Limitations (what is deliberately OUT of this package)

- **No database layer** — DRUM's ledger stores (SQLite/Airtable adapters),
  dispute/transaction records and dashboards stay in the main application.
- **No payments** — Stripe escrow/capture/split logic (`money.js`) is not
  part of this package.
- **No VCS export pipeline** — the CSV/JSON grant export
  (`scripts/export-carbon.js`) depends on the app's store and stays there.
- Corridor distances are the app's Bulgarian corridor table (a full
  routing/GPS distance service is a documented TODO in DRUM).
- Not published to npm (`private: true`). The source repository **is
  public** since 2026-10-01:
  https://github.com/hristovdimitri2-hub/open-carbon-evidence
  (Apache-2.0). Zero external users and zero production verifications at
  time of writing — see Status above.

## How GenAI is used in this project

This package was extracted from a private research codebase by an AI coding
agent (Cline) under direct human supervision:

- **Generated by the agent:** the package skeleton (`LICENSE`, `package.json`,
  `README.md`), the test suites adapted from the parent project, and the
  DESNZ 2026 emission-factor citation below (checked against the official
  GOV.UK publication: Class I 0.15833 / Class II 0.19376 → 0.18 midpoint).
- **Verified by running:** `npm test` → 10/10 for this package, plus
  the parent project's suite (runner output only — no number recorded;
  numbers age, so this README does not repeat them).
- **Human responsibility:** the methodology (GHG Protocol Scope 3,
  Category 4, marginal allocation) and every release/approval decision
  remain with the project owner; the AI agent does not certify these
  numbers for regulatory or grant usage.
- No credentials, secrets or third-party private code were included in
  this repository; the extraction was reviewed file-by-file before push.

## License

Apache-2.0 — see [LICENSE](LICENSE).
