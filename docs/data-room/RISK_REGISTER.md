# RISK REGISTER — DRUM 3.0

> Мониторинг: метриките идват от `/dashboard/ops` (B9) — автоматично
> изчислявани от реалните записи. Kill switches са ПУБЛИЧНИ — това е
> дисциплина, не слабост.

| # | Риск | Вероятност | Удар | Kill switch / смекчаване | KPI (B9) |
|---|---|---|---|---|---|
| 1 | Липса на density (upply → няма мачове) | Висока | Фатален | Един коридор първи; B2B batch гарантира обем; плътност преди разширяване | Match rate (kill: <50% на 60-ия ден) · avg time to match |
| 2 | Supply недостиг (превощачите не стигат) | Висока | Висок | Premium коридори (€1.20/доставка retained); dual mode +€1.50 | Match rate · active carriers |
| 3 | Спорове/изгубени пратки | Средна | Висок | Escrow + 24ч proof прозорец + Trust санкции (−15/−50); застрахователен пул 5% | Dispute rate · lost parcel rate (proxy) |
| 4 | Регулаторен (превощач = работник) | Ниска-Средна | Фатален | **Strict Agent Model** (никакво назначаване — Uber Spain C-434/15); Trust tiers само ограничават | — (архитектурна гаранция) |
| 5 | Payment/chargeback | Ниска | Среден | Escrow auth-only; evidence пакет с SHA-256 за едно действие; Stripe TEST-only guard | Transactions в ledger |
| 6 | Burn > приходи (runway) | Средна | Висок | Lean burn €3K/мес → break-even 5,358/мес; kill switch на 90 дни | EBITDA от FINANCIAL_MODEL; реални доставки |
| 7 | Репутационен (фалшив traction / зелени webpack) | Ниска | Висок (при засечен) | Всички демо данни [DEMO]; carbon изключен от base прихода; carrier waiver преди VCS | — (процедурна дисциплина) |

## Kill switch таблица (публична)

| Срок | Trigger | Действие |
|---|---|---|
| Ден 14 | Stripe KYC не одобрен | смяна на PSP (план Б) |
| Ден 30 | <5/10 B2B интервюта | пивот към B2B-първо |
| Ден 60 | Match rate <50% | ръчно набиране на supply |
| Ден 90 | <30 реални доставки или NPS <30 | СТОП + post-mortem |
| По всяко време | Регулаторно предупреждение | Allianz emergency план |

## NPS

Анкетен модул не е изграден — NPS е **n/a** до инсталиране на survey
 flow (след първите 30 реални доставки). Не се представят измислени NPS числа.
