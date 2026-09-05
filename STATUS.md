# STATUS — drum-mvp (DRUM 3.0)

> Обнови този файл след всеки завършен модул. При прекъсване — обнови и спри чисто.
> Подновяване: "продължи от STATUS.md".

## Текущ етап

**ЕТАП 1 — ЗАВЪРШЕН (B1, B4, B3). Следваща: ЕТАП 2 (B5, B8).**

## Готово (валидно, верифицирано)

- v0.2.0 (91c0b3c): одит + ремонт (7 бъга), Carbon Ledger, demo mode, E2E
  демо, seed (100 доставки [DEMO]), landing, документация.
- ПРЕ-ЕТАП L (622b62f) + U (0432f5e): инвентаризация 1-6 (документни ревизии,
  не код), VERSION_MAP, обединен локален ред, CLEANUP_LIST, U6 инвентаризации.
- B1 (c22dd55): data adapter интерфейс + SQLite по подразбиране (node:sqlite,
  7 таблици + counters, индекси); store facade (sqlite/demo/airtable);
  Postgres път документиран в docs/DATABASE.md (НЕ имплементиран — честно).
  Критерий ✓: чист clone работи без външни услуги (health/dashboard/landing 200).
- B4 (2d40d76): пълната Trust Score таблица от Бизнес план Стъпка 2.2 в
  services/trust.js v2: +5 носач (1/ден, cap +100), +3 изпращач (1/ден,
  cap +60), -15 неуспех, -50 загубен спор + БАН при 2 за 90 дни, +10 KYC,
  +5 телефон, +10 реферал (referrer 80+, макс 5), -10 изоставен реферал,
  +2 реципрочен рейтинг (мин. 3 доставки), -5 лош рейтинг, -1/мес неактивност
  (floor 30), -25 off-platform; тирове: <31 banned / 31-49 limited (<=EUR 20,
  1/седмица) / 50-69 standard (<=EUR 200, 10/месец) / 70-89 verified
  (<=EUR 500, премиум коридори) / 90-100 premium (<=EUR 1000, B2B API).
- B3 (този commit): Matching v1 (0.4 Trust + 0.3 route + 0.2 history +
  0.1 price), ТОП 5 с детерминирани tie-break-ове; escalation 2ч boost /
  6ч ops; нова команда /matches (само ранглиста). STRICT AGENT MODEL:
  НИКАКВО auto-assign — защитено и с тест (забранени имена + неизменяемост).
- Тестове: 42/42 ЗЕЛЕНИ (node --test): 6 B1 контрактни + 26 B4 +
  10 B3 matching. Смоук: health/demo, /dashboard/carbon 200, / 200.

## Сигурност (напомняне към потребителя)

- Ревокирай OpenRouter ключа в Documents\друм\run_audit.py (sk-or-v1-...).
- Прегледай Desktop\cdp_api_key_secret (2).txt и
  Desktop\проекти\nohumans_tokens_PRIVATE.txt.
- Нищо от тях не е в каноничното репо; няма да влезе в PDF.

## Остава

- ЕТАП 2: B5 (Stripe флоу + аномалии 1-4), B8 (финансов модел: waterfall до
  EUR 0.00 с ДДС, 3 сценария, break-even, cross-subsidy такса) -> CSV + MD в
  /docs/data-room/, независима аритметична проверка; кръстосано сравнение с
  Financial_Model_SYNCED.xlsx -> FINANCIAL_NOTES.md
- ЕТАП 3: B6 (Carbon v2: VCS-ready export, дашборд BG/EN), B9 (Ops/KPI
  дашборд: kill-switch метрики), B2 (бот пълни флоу-ове + mock adapter)
- ЕТАП 4: тестове >=80% coverage + lint + CI (.github/workflows/ci.yml),
  B11 data-room (PITCH/ONE_PAGER/RISK_REGISTER), B10 landing BG/EN,
  B7 B2B batch прототип (симулация 50 заявки)
- ЕТАП 5: gitleaks/trufflehog -> gh repo create drum-platform (private) ->
  push -> CI статус -> PDF /reports/DRUM_Investor_Readiness_Report_v1.pdf

## GitHub push статус

PENDING — gh auth LOGGED IN (hristovdimitri2-hub). Задължителен gitleaks/
trufflehog скан преди push. Локална история: 6 commits, без секрети.
