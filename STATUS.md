# STATUS — drum-mvp (DRUM 3.0)

> Обнови този файл след всеки завършен модул. При прекъсване — обнови и спри чисто.
> Подновяване: "продължи от STATUS.md".

## Текущ етап

**ЕТАП 1 — започва (ПРЕ-ЕТАП L и U: ЗАВЪРШЕНИ, сценарий А потвърден).**

## Готово (валидно, верифицирано)

- v0.2.0 (commit 91c0b3c): одит + ремонт (7 бъга), Carbon Ledger модул +
  дашборд (/dashboard/carbon), demo mode, E2E демо, seed (100 доставки, [DEMO]),
  landing, документация. Тествано: seed:demo / demo:e2e / /health / dashboard — OK.
- ПРЕ-ЕТАП L (commit 622b62f): локално търсене (195 попадения, двоен шаблон,
  depth>=6); GitHub legacy `hristovdimitri2-hub/Drum` PRIVATE — клониран;
  версиите 1-6 = документни ревизии, НЕ код; docs/VERSION_MAP.md.
- ПРЕ-ЕТАП U (този commit): едиен локален ред:
    Desktop\проекти\DRUM\{drum-mvp, _archive_v1-v6 (00-08), _archive_3_0
    (+ unique), _legacy_github_drum, CLEANUP_LIST.md}
  - 8те "Друм" папки -> _archive_v1-v6\00..07 (преместени)
  - DRUM_3_0_COMPLETE_ARCHIVE -> _archive_3_0\ (копие; оригинал в списъка за почистване)
  - unique материали копирани в _archive_3_0\unique\ (Financial_Model_SYNCED,
    Investor_Deck .pptx/.pdf, Concept_v1, README_ARCHIVE2)
  - U6 инвентаризация: Excel = 6 листа (Assumptions/Unit Economics/P&L/
    Sensitivity/ESG/Competitors); Deck = 12 слайда BG, остарял ask
    (€400K @ €2.4M) — НЕ влиза в data-room
  - U7/U8: CLEANUP_LIST.md (68+ .lnk, 6 .zip, дубликати, секция СЕКУРНОСТ)
- Принципи: Strict Agent Model, Stripe TEST-only guard, [DEMO] маркиране, GDPR.

## Сигурност (напомняне към потребителя)

- Ревокирай OpenRouter ключа от `Documents\друм\run_audit.py` (sk-or-v1-...).
- Прегледай `Desktop\cdp_api_key_secret (2).txt` и
  `Desktop\проекти\nohumans_tokens_PRIVATE.txt`.
- Нищо от тях не е в каноничното репо (проверено) и няма да влезе в PDF.
- Детайли: CLEANUP_LIST.md, секция 4.

## Остава

- ЕТАП 1: [модули по брифа]
- ЕТАП 2: B8 финансов модел (waterfall до €0.00 с ДДС, 3 сценария, break-even,
  cross-subsidy) -> CSV + MD в /docs/data-room/, независима аритметична проверка;
  кръстосано сравнение с Financial_Model_SYNCED -> FINANCIAL_NOTES.md
- ЕТАП 3: B6 Carbon Ledger v2 (VCS-ready export, дашборд BG/EN), B9 Ops/KPI
  дашборд (kill-switch метрики), B2 бот mock adapter за headless демо
- ЕТАП 4: тестове >=80% coverage + lint; CI .github/workflows/ci.yml;
  B11 data-room (PITCH.md/ONE_PAGER.md/RISK_REGISTER.md); B10 landing BG/EN;
  B7 B2B Reverse Marketplace прототип (симулация 50 заявки)
- ЕТАП 5: gitleaks/trufflehog -> gh repo create drum-platform (private) -> push
  -> CI статус -> финален PDF /reports/DRUM_Investor_Readiness_Report_v1.pdf

## Следваща стъпка

ЕТАП 1 (модулите от брифа); след всеки модул — commit.

## GitHub push статус

PENDING — gh auth LOGGED IN (hristovdimitri2-hub). Задължителен gitleaks/
trufflehog скан преди push. drum-mvp историята е чиста (2 commits, без секрети).