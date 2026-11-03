# DRUM-OCE — Video scenario v2 (ЧЕСТЕН), за пре-запис
> Лимит на EIC: **до 3:00 мин**, до 3 души. Този сценарий замества записания (който съдържа неверни числа).
> Стрелбата/монтажът по твоя начин: запис с телефона → Google Photos → Save video (0,75x) → Zoom Virtual Mic → Trim → субтитри (BG текст на Transkript и EN редакция).
> **Забележка:** максимумът е 3:00 — при 0,75x скорост гледай да останеш под ~2:15 реално време, иначе Trim няма да мине в лимита.

---

## Segment 1 — Hook (0:00–0:10)

**EN:**
You already know carbon credits can be fake. But what if the proof — the photo — could prove itself?

**BG транскрипция (за четене):**
Вие вече знаете, че кредитите за въглерод могат да са фалшиви. Но какво, ако самата снимка може да докаже себе си?

---

## Segment 2 — The problem (0:10–0:30)

**EN:**
Today, evidence for carbon removal projects is a digital photo — the most easily forged file on the internet. Verification is done manually: someone logs into a database, flips a status flag, writes a PDF report — and nobody re-checks it. One study found that more than 90% of the carbon credits on the voluntary market claimed almost no real climate benefit. The buyers get reports. Regulators get dashboards. Nobody gets proof.

**BG:**
Днес доказателството за проектите е една дигитална снимка — най-лесно фалшифицируемият файл в интернета. Проверката става ръчно: някой влезе в базата данни, сложи един статус, напише PDF доклад — и никой не го проверява повторно. Проучване показа, че над 90% от кредитите на доброволния пазар нямат почти никаква реална климатична полза. Купувачите получават доклади, регулаторите — табла. Никой не получава доказателство.

---

## Segment 3 — Meet DRUM (0:30–1:00)

**EN:**
We built DRUM — an open-source evidence layer for peer-to-peer logistics and environmental claims. Point your phone at an event: a tree planted, a shipment received, a ton of biochar stored. DRUM seals the photo cryptographically — hash, timestamp, content-addressed record written before the image itself — binds it to the operational event and the CO2 calculation, with its emission factors, so the number can be re-derived, not just read. An open core means anyone can re-verify every proof, end to end, by themselves.

**BG:**
Ние изградихме DRUM — отворен слой за доказателства за доставки от човек на човек и екологични твърдения. Насочиш ли телефона към събитие — засадено дърво, получена пратка, съхранена тон биовъглен — DRUM криптографски запечатва снимката: хеш, клеймо време, запис, написан преди самия файл, обвързан с оперативното събитие и с изчислението за CO2, за да може числото да се преброи наново, а не просто да се прочете. Отвореният код означава, че всеки може да провери всяко доказателство сам.

---

## Segment 4 — How it works (1:00–1:40)

**EN:**
Capture-time sealing: no metadata, no evidence — every photo gets a sidecar record with timestamp, event ID and content hash, written before the file, with GDPR-compliant 90-day retention. Cross-validation: under the project we add automated checks against satellite and remote-sensing data, so contradictory evidence is flagged automatically instead of during periodic human audits. Automated machine verification — built during the project — at a cost target of only a small fraction of a manual audit cycle costing 10,000 to 50,000 euro: evidence checked 100% instead of statistically sampled.

**BG:**
Запечатване при заснемане: без метаданни — няма доказателство. Всеки файл получава придружаващ запис с време, ID на събитието и хеш на съдържанието, записан преди самия файл, със срок за съхранение от 90 дни по GDPR. Кръстосана проверка: в рамките на проекта добавяме автоматични проверки чрез спътникови данни, така че противоречията да се откриват автоматично, а не на периодични проверки от хора. Автоматизирана машино-проверка — изгражда се по време на проекта — на цена, която е само малка дялова част от ръчен одит за 10 000 до 50 000 евро: проверка на 100% от доказателствата вместо статистическа извадка.

---

## Segment 5 — Honest status + why now (1:40–2:15)

**EN:**
Here is the honest state of things — verifiable numbers only: 142 of 142 automated tests passing in the platform suite; 10 of 10 tests in our published Apache-2.0 package, on a clean clone; a reproducible demo dataset of about a hundred shipments; and zero external users so far — zero production deployments, zero marketing spend. We are not going to dress that up: the grant funds exactly this leap — the first external pilots. Why now: the EU Carbon Removal Certification Regulation is in force, verification becomes mandatory, and the evidence infrastructure simply does not exist yet.

**BG:**
Ето честното състояние — само числа, които можем да докажем: 142 от 142 автоматични теста минават в основния набор; 10 от 10 теста в нашия публикуван пакет Apache-2.0, в чисто клонирано копие; възпроизводимо демо със около сто пратки; и засега нула външни потребители — нула реални деплоя, нула похарчен маркетинг. Няма да ги украсяваме: грантът финансира точно този скок — първите външни пилоти. Защо сега: регламентът за сертифициране на премахване на въглерод е в сила, проверката става задължителна, а инфраструктурата за доказателства още не съществува.

---

## Segment 6 — Close (2:15–2:45)

**EN:**
We made transparency the product: cryptographic, open, standards-aligned — ISO-14064-2, CRCF, Article 6.4. And because the core is open source, it can be deployed air-gapped and inspected by anyone — including regulated defence and government users, where authenticated imagery matters. DRUM, open-source, EU-backed: the default evidence layer for every carbon claim. Don't trust — verify.

**BG:**
Направихме прозрачността продукт: криптографска, отворена, съвместима с ISO-14064-2, CRCF, член 6.4. И защото ядрото е с отворен код, може да се разгърне офлайн и да бъде проверено от всеки — включително от отбранителни и правителствени потребители, където автентифицираната фотография има значение. DRUM, с отворен код, с европейска поддръжка: стандартният слой за доказателства за всяко твърдение за въглерод. Не вярвай — провери.

---

## Какво е махнато спрямо стария запис (и защо)
| Старо (в записа) | Ново | Причина |
|---|---|---|
| „422 automated tests" | **142/142** | реалният брой е 142 |
| „20,339 verification checks, 58 countries, 416 organizations, 458 GitHub developers" | **142/142, 10/10, ~100 демо, 0 потребители** | старите цифри не съществуват в репото |
| „anchored to Bitcoin and EVM L1s" | „under the project we add ..." | блокчейн закотвяне не е правено |
| „Live API, MCP server, dashboard, mobile companion — already in production" | описани като MVP/демо | нищо не е в production |
| „1 live production payment stream (X402/USDC)" | махнато | това е от другия проект (Kristo) |
| „Over 30 years, I've built software" | махнато | непотвърдено |

---
*Човешки отчет: Това е новият сценарий за видеото — същата структура, само че с истинските числа (142 теста, 10 от 10, честно казано — още нула потребители) и без блокчейн и „30 години опит", които не можем да докажем. Старият запис ги съдържа, затова видеото трябва да се снима наново, иначе клипът опровергава документите. Сценарият е кратък — четe се за около 2 минути и 15 секунди, а лимитът е 3.*
