# DRUM 3.0 — ONE PAGER

**P2P логистика: празните багажници носят пратки.** По-евтино от куриер,
по-зелено от всичко, с escrow, Trust Score и Carbon Ledger по GHG Protocol.

**Проблем:** куриерът прави специално пътуване (€6+, 1–3 дни); кола с празен
багажник върви по същия маршрут безплатно.

**Решение:** Telegram бот: заявка → escrow (Stripe auth-only) → избор на
превощач от ранг-листа (Strict Agent Model — платформата НИКОГА не
назначава) → pickup QR → delivery QR → capture + split 80/15/5 → Trust
Score → Carbon Ledger.

**Икономика** (генерирана от код, BASE калибровка T=€7.75, клиент €7.98):
превощач €6.20 (80%) · DRUM €1.16 · застраховка €0.39 · Stripe €0.37 ·
**платформа €0.56/доставка (7.2%)**. Ценова стълба: GTM €0.21 (само с B2B
batch) → BASE €0.56 → PREMIUM €1.20. Break-even: 90/мес (lean €3K) ·
29,643/мес (scaled €16.6K).

**ESG:** Carbon Ledger по GHG Protocol Scope 3 Cat. 4 — 25.38 kg CO₂e
спестено на София–Пловдив доставка, audit trail във всеки запис, VCS-ready.

**Статус (честно):** работещ код (90+ теста, CI-ready), демо данни [DEMO],
НЯМА реален traction — това е валидационен пилот.

**Ask:** €31K валидация (90 дни, 1 коридор, 30 реални доставки) →
€150–250K seed → Series A. Full: PITCH.md / FINANCIAL_MODEL.md.
