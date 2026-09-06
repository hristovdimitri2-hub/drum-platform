# STATUS — drum-mvp (DRUM 3.0)

> Обнови този файл след всеки завършен модул. При прекъсване — обнови и спри чисто.
> Подновяване: "продължи от STATUS.md".

## Текущ етап

**ЕТАП 4 — ЗАВЪРШЕН (R1-R3, CI, B7, B10, B11). Следва: ЕТАП 5 (push + PDF).**

## Готово (валидно, верифицирано)

- ЕТАП 1-3 (вж. git log): B1/B4/B3, B5/B8, B8.1, B8.2, B6/B9/B2 — всички
  с тестове и комити.
- ЕТАП 4:
  - R1: carbon канон saved = (baseline - marginal) x km = 0.175 x km
    (25.97 -> 25.38 за Сф-Пд; старият "share" смисъл документиран в
    CARBON_METHODOLOGY.md §3а); self-verifying ledger тест; worked example;
    carrier waiver TODO бележка.
  - R2: b2 тест етикетиран — EUR 12 е произволна тестова цена, не канон.
  - CI: .github/workflows/ci.yml (npm ci -> lint -> test -> coverage ->
    gate -> demo:e2e -> build-financials); eslint flat config, чист;
    c8 coverage + GATE >=80% на money/trust/carbon/matching
    (100% / 96.8% / 99.21% / 100%).
  - B7: src/services/b2b.js — batch plan (caps 5/стандартна кола, 10/ван),
    broadcast съобщение, dual mode +1.50/-1.50, batch economics през
    money.js (retained EUR 0.43/пратка при GTM x10 vs 0.21 on-demand = 2.06x);
    симулация 50 заявки (детерминирана, seed=7): batch 100% match / ~84ч
    срещу on-demand 40% / 3ч -> docs/data-room/B7_SIMULATION.md;
    секция "B2B batch economics" във FINANCIAL_MODEL.md.
  - B10: landing BG/EN (public/index.html, езиков toggle) — икономическата
    таблица от B8.2 (GTM 0.21 / BASE 0.56 / PREMIUM 1.20 retained + ladder),
    Trust протокол, линкове към Carbon + Ops дашборди, [DEMO] етикети.
  - B11: docs/data-room/: PITCH.md (12 слайда, пълен текст BG, числa само
    от B8, [[PLACEHOLDER]] екип + traction), ONE_PAGER.md, RISK_REGISTER.md
    (7 риска + kill switches + KPI мониторинг от B9).
- Тестове: 99/99 зелени (node --test). Lint: чист (eslint flat).
  Coverage gate: money 100% / trust 96.8% / carbon 99.21% / matching 100%.
- Принципи: Strict Agent Model (тестван), Stripe TEST-only guard,
  [DEMO] маркиране, GDPR минимизация.

## Сигурност (напомняне)

- OpenRouter ключ (Documents\друм\run_audit.py) — ревокация PENDING от
  потребителя (4-то напомняне). Desktop secrets файлове — преглед PENDING.
- НЕ са в каноничното репо (проверявано при всеки commit).

## Остава (ЕТАП 5)

1. gitleaks/trufflehog скан на цялата история (локално, преди push).
2. gh repo create hristovdimitri2-hub/drum-platform (private) + push
   (пълната история).
3. Старото "Drum" repo: README-насочване към drum-platform.
4. CI ще се изпълни при push — реалният статус отива в PDF.
5. ФИНАЛЕН PDF: reports/DRUM_Investor_Readiness_Report_v1.pdf
   (от REPORT.md чрез pandoc/еквивалент; командата описана в README) —
   титулна (commit, CI статус), executive summary, модули B1-B12
   (РЕАЛНО vs MOCKED), пълен бъг списък, тестове/coverage, скрийншоти
   (Carbon BG/EN, landing, Ops/KPI, demo:e2e изход), финанси (waterfall),
   демо данни, TODO до production, приложение (локално пускане).
   СИГУРНОСТ: нито един ключ/токен/път с потребител/лични данни.

## GitHub push статус

PENDING — gh auth LOGGED IN (hristovdimitri2-hub). gitleaks/trufflehog
скан преди push. Локална история: 17 commits, без секрети.
