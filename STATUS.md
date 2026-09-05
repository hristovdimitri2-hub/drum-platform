# STATUS — drum-mvp (DRUM 3.0)

> Обнови този файл след всеки завършен модул. При прекъсване — обнови и спри чисто.
> Подновяване: "продължи от STATUS.md".

## Текущ етап

**ПРЕ-ЕТАП L — ЗАВЪРШЕН (L0a-L4). ГЕЙТ L5: СПРЯНО за човешко решение.**

## Готово (валидно, верифицирано)

- v0.2.0 (commit 91c0b3c): одит + ремонт (7 бъга), Carbon Ledger модул +
  дашборд (/dashboard/carbon), demo mode (DEMO_MODE), E2E демо
  (scripts/demo-e2e.js), seed данни (100 доставки, [DEMO]), landing,
  документация (README/SETUP/DEMO_SCRIPT/ARCHITECTURE).
  Тествано: seed:demo, demo:e2e, /health, /dashboard/carbon, / — всички OK.
- ПРЕ-ЕТАП L: локално търсене (195 попадения, двоен шаблон "Друм"+"drum",
  depth>=6, Desktop/Downloads/Documents); GitHub legacy
  `hristovdimitri2-hub/Drum` — PRIVATE (потвърдено), клонирано в
  `_legacy_github_drum`; инвентаризация на версиите 1-6 (документни снимки,
  НЕ кодови итерации); `docs/VERSION_MAP.md` генериран.
- Принципи: Strict Agent Model, Stripe TEST-only guard, [DEMO] маркиране,
  GDPR минимизация.

## Открито по време на L (изисква решение)

- СИГУРНОСТ: `Documents\друм\run_audit.py` съдържа hardcoded OpenRouter API
  ключ (sk-or-v1-...). Файлът НЕ е в каноничното репо (untracked, repo без
  commits). Препоръка: ревокация на ключа от OpenRouter. НЕ е изтрит
  (правило: нищо не се изтрива без разрешение).

## Остава

- **ГЕЙТ L5** — човешко решение (сценарий "а" от брифа изглежда потвърден, с
  уговорката: версиите 1-6 са документни ревизии, не кодови итерации).
- ПРЕ-ЕТАП U: обединение legacy -> _archive_v1-v6, _archive_3_0, _legacy_github_drum.
- ЕТАП 1-4: модули B1-B12 (тестове >=80% coverage, CI yml, финансов модел
  waterfall + break-even + 3 сценария, ESG v2 BG/EN, KPI дашборд, B2B
  прототип, data-room: PITCH/ONE_PAGER/RISK_REGISTER, landing BG/EN).
- ЕТАП 5: GitHub push (drum-platform, private) + финален PDF
  /reports/DRUM_Investor_Readiness_Report_v1.pdf.

## Следваща стъпка

Изчаквай решение по ГЕЙТ L5 (сценарий "а" или "б" от брифа).

## GitHub push статус

PENDING — gh auth: LOGGED IN (hristovdimitri2-hub). Преди push: gitleaks/trufflehog
скан на цялата git история (задължителен по брифа). OpenRouter ключът от
run_audit.py НЕ е в историята на каноничното репо (проверено: drum-mvp има 1 commit).
