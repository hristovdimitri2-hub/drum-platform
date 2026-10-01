# GDPR & Evidence Storage — DRUM 3.0 (batch 3 / T2)

> Кратко: **всички evidence данни живеят в `drum-mvp/data/evidence/`**
> (вътре в repo-то, gitignore-нат); **retention 90 дни** за реални снимки;
> основание за съхранение/лимит: **GDPR чл. 5(1)(e)**.

## 1. Къде какво живее (единство на пътищата)

Централна константа: `src/services/evidencePaths.js` (единоствен източник;
няма `..` пътища, които бягат от repo-то):

| Артефакт | Път (default) | Env override |
|---|---|---|
| Реални снимки + метаданни | `data/evidence/<shipmentId>/<ts>_<sha8>.jpg` + `.json` | `EVIDENCE_DIR=<abs path>` |
| Evidence пакети (JSON + MD, `/evidence`) | `data/evidence/<shipmentId>/evidence_*.json/.md` | същият `EVIDENCE_DIR` |
| Записи на откази (anomaly 3, `[DEMO]` placeholder) | `data/evidence/proofs/<disputeId>.json` | същият `EVIDENCE_DIR` |
| Снимки в локалното хранилище на SQLite (`drum.db`) | `data/drum.db` | `SQLITE_PATH` |

`data/` е в `.gitignore` → **нито една снимка, метаданно или пакет не влиза
в git и не се разпространява с репото.**

## 2. Retention — GDPR чл. 5(1)(e) („ограничение в съхранението")

- **Константа:** `EVIDENCE_RETENTION_DAYS` (default **90 дни**; env override).
- **Използва се от:** `photoProof.cleanupExpiredEvidence()` → изтрива всичко
  под evidence root-а по-старо от прага и премахва празните директории.
- **Стъпка (ръчна, ops):** `npm run evidence:cleanup` (скрипт:
  `scripts/cleanup-evidence.js`) — печата премахнати файлове/байтове/cutoff.
- Основание: снимките са доказателство по конкретен случай (24ч прозорец +
  спорове); след приключване на спора няма основание за безсрочно съхранение —
  90 дни покриват типичния chargeback прозорец (Stripe: до ~120 дни за карти —
  ако legal поиска по-дълъг, завишава се само през `EVIDENCE_RETENTION_DAYS`).
- Метаданните (sha256, timestamp, shipmentId, chatId) се третират еднакво със
  снимката — същият retention (няма „премахната снимка, останало метаданно").

## 3. Миграция на СТАРИ записи (извън repo-то) — ръчно, без изтривания

Преди batch 3 два пътища сочеха ИЗВЪН repo-то (`DRUM/data/proofs/` и
`DRUM/reports/evidence/`). Те НЕ са изтрити. Когато (и ако) са нужни:

```powershell
# от папката DRUM/ (едно ниво над drum-mvp):
Copy-Item data\proofs\* drum-mvp\data\evidence\proofs\ -Force     # ако има записи там
# reports/evidence пакети (бяха записвани извън repo-то в по-стари версии):
Copy-Item reports\evidence\* drum-mvp\data\evidence\_legacy\ -Force
```

След копирането старите папки могат да се изтрият **само след преглед** —
вж. `CLEANUP_LIST.md` (правило: изтривания само по списък от основателя).

## 4. Повече за самите доказателства

- Флоу „без метаданни → няма доказателство": `src/services/photoProof.js`.
- `[DEMO]` placeholder vs REAL: `src/services/anomalies.js` (attach + пакет).
- Тестове: `tests/t3-photo-proof.test.cjs` (sha256, cleanup, path hygiene).
