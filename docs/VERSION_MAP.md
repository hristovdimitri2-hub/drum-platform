# VERSION MAP — Еволюция на DRUM (версии 1→6 → канонично репо)

> Генерирано: ПРЕ-ЕТАП L (read-only инвентаризация). Четимо за нетехнически читател.
> Източници: локален диск (Desktop, Downloads, Documents, depth ≥ 6, шаблони "Друм"+"drum"),
> GitHub legacy репо `hristovdimitri2-hub/Drum` (PRIVATE, клонирано в `_legacy_github_drum`).
>
> **ОБНОВЕНО след ПРЕ-ЕТАП U:** legacy материалите са консолидирани — виж
> "Локален ред след U" в долната част. Compendium и DRUM_Concept_v1 са архивирани
> (уникални, еволюционни етапи).


## Какво открихме накратко

"Друм 1–6" **не са кодови версии** — те са папки-снимки на *документационни ревизии*
(бизнес план, финансов модел, master план), всяка с .lnk преки пътища към номерирани
файлове в Downloads. Единственият код в цялата история е **drum-mvp** (BOT в
"Друм-Финален проект"). Всички версии сочат към **концепция 3.0** — няма по-нова
концепция в 4/5/6.

## Хронология

| # | Версия | Дата (файлове) | Съдържание | Статус |
|---|---|---|---|---|
| 0 | `DRUM_Concept_v1` | 2026-06-16 | Първата концепция (txt/docx, 37 KB), `DRUM_Concept_Summary.xlsx` | по-старо — зародиш |
| 1 | `Друм-първоначален план` | 2026-07-01/02 | Първи Business Plan + Social Impact Plan + Action Plan 2025 + Financial Model v1 | по-старо (документи) |
| 2 | `Друм-1 обновление` | 2026-07-02 | Business Plan (1) + Financial Model (1) + Hybrid Master Plan (1) | по-старо (документи) |
| 3 | `Друм-2 обновление` | 2026-07-02 | същите, ревизия (2) | дубликат на 1 (по-нова редакция) |
| 4 | `Друм-3 обножление` | 2026-07-02 | ревизия (3)/(4) | дубликат |
| 5 | `Друм-4 обовление` | 2026-07-02 | ревизия (4)/(5) + **първи MASTER_BLUEPRINT** | по-старо от 3.0 архив |
| 6 | `Друм 5 обнов` | 2026-07-03 ~00:20 | ревизия (5)/(6) + MASTER_BLUEPRINT (1) + първи Feature Triage | по-старо от 3.0 архив |
| 7 | `Друм 6 обновление` | 2026-07-03 | ревизия (6)/(7) + Final Business Plan + MASTER_BLUEPRINT (2) | по-старо от 3.0 архив |
| 8 | `Друм-Финален проект` | 2026-07-09/10 | Plan (7)/(8) + **Financial_Model_SYNCED** + **Investor Deck** + **Investor Outreach** + **BOT (drum-mvp код)** | ← източник на каноничния код |
| 9 | `DRUM_3_0_COMPLETE_ARCHIVE` | 2026-08-08 | Консолидиран архив: 01_Business_Plans, 02_Investor_Materials, 03_Engineering, **04_Code (drum-mvp.zip)**, 05_Compendium | каноничен източник на v0.1.0 |
| 10 | GitHub `hristovdimitri2-hub/Drum` | създаден 2026-08-16 | САМО каталог от .lnk преки пътища (31 KB) — без реални файлове | legacy, само насочване |
| 11 | `drum-mvp` v0.2.0 | 2026-09-05 | Работещ код: бот + Carbon Ledger + demo mode + E2E + seed + документация | **КАНОНИЧНО репо** |

## Решения по инвентаризацията

- **Уникално**: `drum-mvp` (код), `Financial_Model_SYNCED`, `Investor_Deck`,
  `DRUM_3_0_COMPLETE_COMPENDIUM.pdf`, `DRUM_Concept_v1` (зародишът).
- **Дубликати**: всички документи съществуват едновременно в Downloads,
  в локалните "Друм" папки (като .lnk), в 3_0 архива и в GitHub legacy репото.
- **По-нова концепция от 3.0?** НЕ. Нито една от версиите 1–6 не съдържа
  концепция или функция, която не е в 3.0 Master Blueprint / Feature Triage.
- **Код, който тръгва?** Само drum-mvp (верифицирано: seed + E2E + сървър OK).
  Версии 1–6 нямат код.

## Забележка за сигурност (важно)

`C:\Users\AlienWare\Documents\друм\run_audit.py` съдържа **hardcoded OpenRouter
API ключ** (sk-or-v1-...). Файлът е untracked в git repo без commits, но ключът
трябва да се смени/ревокира от OpenRouter преди каквото и да е споделяне.
Не е включен в каноничното репо и няма да влезе в PDF.

## Факти за източниците

- Локално търсене (двоен шаблон, depth ≥ 6): **195 попадения** (15 папки, 180 файла:
  68 .lnk, 48 pdf, 41 docx, 15 xlsx, 6 zip, 1 txt, 1 pptx).
- GitHub legacy: `hristovdimitri2-hub/Drum` — PRIVATE ✅, main, 31 KB, създаден
  2026-08-16, съдържа 8 версии папки само с .lnk файлове.
- `Documents\друм`: git repo без commits; 1 untracked файл (run_audit.py, 2026-07-03).

---

## Локален ред след ПРЕ-ЕТАП U (сценарий А, потвърден)

```
Desktop\проекти\DRUM\
├── drum-mvp\             <- КАНОНИЧНО репо (код + документация + STATUS.md)
├── _archive_v1-v6\       <- версия 0-7 (документни ревизии + Concept_v1 копия)
│   ├── 00_първоначален_план
│   ├── 01_обновление_1 ... 06_обновление_6
│   ├── 07_финален_проект  (вкл. BOT — източникът на drum-mvp)
│   └── 08_concept_v1      (DRUM_Concept_v1.docx/.txt — копия)
├── _archive_3_0\
│   ├── DRUM_3_0_COMPLETE_ARCHIVE\   (консолидираният 3.0 архив, преместен)
│   └── unique\                      (уникални материали — копия:
│       Financial_Model_SYNCED.xlsx, Investor_Deck .pptx/.pdf,
│       DRUM_Concept_v1, README_ARCHIVE2)
├── _legacy_github_drum\  <- клон на hristovdimitri2-hub/Drum (само .lnk каталог)
└── CLEANUP_LIST.md       <- списък за изтриване ОТ ПОТРЕБИТЕЛЯ (U8)
```

## Инвентаризация на уникалните материали (U6)

### DRUM_3_0_Financial_Model_SYNCED.xlsx (28 KB, 6 листа)
1. **Assumptions** — пазарни параметри (активни потребители, ~2 доставки/активен/
   месец, средна стойност на доставка), take rates (facilitation/insurance),
   Stripe % + фикс такса, lost parcel rate, dispute rate, repeat rate 30/90 дни;
   разходни параметри. Източници: PiggyBee/Roadie/Nimber historical data.
2. **Unit Economics** — разбивка на икономиката на една средна доставка (живи формули).
3. **P&L Forecast** — 3-годишна прогноза.
4. **Sensitivity** — сценарен анализ.
5. **ESG Metrics** — месечен CO2 детайл (kg/доставка, тон/месец, €/тон, carbon
   revenue, 15% към превозвача); GHG Protocol Scope 3 Cat. 4; VCS (Verra)/Gold
   Standard; аудит TV/SGS/Bureau Veritas.
6. **Competitor & Graveyard Matrix** — PiggyBee, Gophr, Roadie, Nimber, Grabr + DRUM.

→ ИСТОРИЧЕСКИ РЕФЕРЕНС. Каноничният финансов модел е B8 (кода). При B8:
кръстосано сравнение на допусканията -> разминаванията в
`/docs/data-room/FINANCIAL_NOTES.md`.

### Investor Deck (12 слайда, BG)
1. seed €400K @ €2.4M pre-money (Юли 2026); 2. Проблемът (1.2 млн коли/ден,
   €6+ Econt, €820M неефективност); 3. Решението (Telegram флоу); 4. Dual-Entity
   хибрид (търговски + социален двигател); 5. Пазар (BG·RS·TR·RO·GR); 6. Traction
   (MVP за 8 седмици); 7. Конкурентно предимство (гробище на P2P — 5+DRUM);
   8. Финанси — "реалистични маржове (5% Year 1-2 -> 8.8% Year 3+)"; 9. Екип
   (solo founder, търси CTO); 10. Ask €400K @ €2.4M, 18-мес. runway -> Series A
   (Q1 2028); 11. Kill Switches; 12. End ("1 доставка > 10 плана").

→ НЕ влиза в data-room: остаряла икономика (ask €400K @ €2.4M срещу
каноничната стълбичка €31K валидация -> €150-250K seed; маржове за
пресмятане от B8). PITCH.md (B11) е каноничният разказ — числа САМО от B8.
### Compendium + Concept_v1
- `DRUM_3_0_COMPLETE_COMPENDIUM.pdf` (2.3 MB) — в _archive_3_0 (в архива).
- `DRUM_Concept_v1.docx/.txt` (16.06.2026) — копия в `_archive_v1-v6\08_concept_v1\`.
Отбелязани в тази карта като еволюционни етапи 0 и 9.
