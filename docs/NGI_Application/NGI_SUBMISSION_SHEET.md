# 📋 ЛИСТ ЗА ПОПЪЛВАНЕ НА ФОРМАТА — https://nlnet.nl/propose/
### NGI OIS Restack · кандидат Dimitri Hristov · Individual · Bulgaria · дедлайн 2026-11-03 12:00 CET
### Версия: v5 (142 теста, верифицирано 01.10.2026) · номерата са точни (генерирани от v5)

**Как се ползва:** полетата са в реда на формата. За всяко: ⬛ = копирай блока дословно (от реда след „КОПИРАЙ" до края на блока), ☐ = отметка/избор с мишката. Символите са преброени — ако формата показва различен брой, спри се и ми кажи.

---

## 0. Fund (избор с мишката)
- [ ] Избери: **Restack Fund**

## 1. Proposal title — 108 знака
КОПИРАЙ:
```
Open Carbon & Evidence: a self-auditing CO₂ ledger and photo-proof evidence layer for peer-to-peer logistics
```

## 2. Project website(s) / repositories — 145 знака
КОПИРАЙ:
```
Public package (this proposal): https://github.com/hristovdimitri2-hub/open-carbon-evidence
Developer profile: https://github.com/hristovdimitri2
```

## 3. Summarise the proposed project and its expected results — 980 / 1000 знака
КОПИРАЙ:
```
Spare-capacity marketplaces need trusted CO2 accounting and tamper-evident delivery proof — today only as closed SaaS or methodology without executable, auditable code. Open Carbon & Evidence (OCE) turns two working components — a per-shipment carbon ledger and a photo-proof evidence layer — into a small, Apache-2.0 commons any marketplace or local-first app can embed.

The work is R&D: (1) make the ledger reproducible by snapshotting emission factors (DESNZ 2026, GHG Protocol Scope 3 Cat. 4) per calculation, so past figures stay byte-identically re-auditable; (2) define evidence primitives (SHA-256 photo chains, GDPR retention, a one-action dispute packet) as an open format; (3) validate in a live reference implementation (142 tests).

Deliverables: the package, an open specification of the ledger and evidence formats, a re-audit tool and documentation — all under recognised open licences, a vendor-neutral, privacy-by-design building block for European sovereignty.
```

## 4. Proposed effort: money, budget breakdown, tasks, rate, expenses — 1668 / 4000 знака
КОПИРАЙ:
```
Request: EUR 30 000. Duration: 6 months (Nov 2026 - May 2027). Rate used: EUR 50/hour (80 h/month), a frugal rate at an EU cost base.

Budget breakdown:
- Core development, documentation, maintenance: 6 months x EUR 4 000 = EUR 24 000
- Community and standards events (FOSDEM 2027, local FOSS meetups): EUR 1 500
- Infrastructure (documentation hosting, domain, tooling): EUR 600
- External security review of the released package (eligible activity: security audits): EUR 3 900
Total: EUR 30 000. No contingency claimed.

Tasks and effort (~480 hours total):
M1, months 1-1.5 (~120 h): extract the FOSS package (carbon ledger + evidence layer) from the reference implementation with clean interface segregation; keep the full test suite and byte-identical end-to-end demo green.
M2, month 2 (~80 h): re-audit engine — factor snapshots (version, source, boundary) per calculation, deterministic recalculation, CLI re-audit of historical shipments.
M3, month 3 (~80 h): evidence primitives — SHA-256 photo chain with metadata, GDPR retention windows (Art. 5(1)(e)), dispute packet as a documented open format.
M4, month 4 (~80 h): packaging, API/SDK and contributor documentation, accessible examples; integrate the external security review and fix its findings.
M5, month 5 (~60 h): community release and engagement — announcement, feedback rounds, interoperability notes to existing efforts.
M6, month 6 (~60 h): project management, sustainability plan, final open-access write-up (methodology and results).

Expenses: exactly as the four budget lines above; all costs are eligible activities (FOSS development, documentation, security audit, infrastructure, events).
```

## 5. Compare with other relevant efforts; what is new? — 2364 / 4000 знака
КОПИРАЙ:
```
Three families exist:

1. Methodology without executable code: the GHG Protocol Scope 3 Calculation Guidance and PCAF standards define how to account for transport emissions but publish no executable, auditable per-shipment ledger. Our work implements them directly (Scope 3 Category 4) and snapshots the exact factor tables used (UK DESNZ/DEFRA 2026 conversion factors) so every figure stays re-auditable after the tables are revised.

2. Closed enterprise SaaS: Persefoni, Watershed and similar platforms do corporate-level accounting behind paywalls. None exposes per-parcel, per-delivery proof that a buyer or auditor can independently verify, and none ships an open evidence format.

3. Open LCA tools (openLCA, Brightway): serious scientific inventory analysis at product/company level, but not built for continuous per-shipment accounting inside marketplaces, and without proof-of-delivery primitives.

What is new here: (a) factor-snapshot reproducibility — historical CO2 results recomputable byte-identically as factor tables evolve; (b) tamper-evident photo evidence with GDPR-compatible retention as a reusable module; (c) counterfactual allocation for spare-capacity matching (what would have been emitted anyway) as an explicit, configurable methodology rather than a vendor black box.

Have we considered contributing to the others? Yes. The snapshot format and re-audit CLI are deliberately small and documented so they can be adopted upstream: we will offer them to open LCA packaging efforts, publish our methodology notes as open access, and invite existing open standards for delivery/logistics data to reuse the evidence specification.

Strategic positioning: OCE is digital infrastructure, not a product. It follows the open-standard, sovereignty and privacy-by-design principles of the Open Internet Stack: the specification is vendor-neutral, data and proofs stay with the parties involved, and the reference implementation is only one of many possible consumers.

Specific upstream engagement: we will submit the factor-snapshot and re-audit format to the GHG Protocol consultation process and to the UK DESNZ/DEFRA factor maintainers; map the evidence specification onto GS1 EPCIS delivery events and W3C Verifiable Credentials so any third party can verify a proof independently; and offer the re-audit CLI to open LCA packaging efforts.
```

## 6. What technical challenges do you expect during the project? — 1493 / 4000 знака
КОПИРАЙ:
```
1. Decoupling without breaking the audit trail: the components live inside a working reference implementation whose database also holds payments and disputes. Extracting a standalone package means redrawing the boundary so the FOSS part never touches financial records, while preserving end-to-end traceability of what was calculated from which inputs.

2. Reproducibility vs evolving factors: emission factor tables are republished yearly (e.g. DESNZ 2026). Re-audit requires storing the factor snapshot and boundary used per calculation and guaranteeing deterministic recalculation across runtimes.

3. Privacy vs immutable evidence: photo proofs must be tamper-evident, yet GDPR erasure and retention limits apply. Design direction: hash chains with explicit retention windows — verifiable existence without keeping personal data forever.

4. Proof without paid infrastructure: field capture must work offline and cheaply; the QR payload must be authenticatable without a central paid service. Direction: signed payloads with public-key distribution through the existing channel of the reference implementation.

5. Regressions during restructuring: a 142-test suite, coverage gates and a byte-identical end-to-end demo are the safety net; keeping CI green while moving module boundaries is the main schedule risk.

6. Allocation edge cases: shared rides, partial capacity, mixed transport modes — counterfactual baselines must stay explicit and configurable rather than silently corrected.
```

## 7. Ecosystem: dependencies, engagement, main users — 1312 / 2000 знака
КОПИРАЙ:
```
Dependencies: GHG Protocol methodology and UK DESNZ/DEFRA conversion factor tables (open government data, snapshotted per release); the Node.js/SQLite stack of the reference implementation; jsQR for offline decoding in the capture page.

Main users: (1) developers of peer-to-peer, local-first and collaborative marketplaces who need CO2 accounting and delivery proof without adopting a vendor platform; (2) small logistics operators and auditors who must reproduce reported figures; (3) civil-society actors wanting verifiable emissions receipts.

Engagement: release early with documentation; announce in FOSS climate and local-first communities; present at FOSDEM; invite review of the evidence specification from marketplace and payments practitioners. The reference implementation stays an active consumer, so the package is exercised under production-like conditions and feedback flows back through public issues.

Survival after the project: the package needs no running service — code, specification and documentation live in the repository under open licences, so anyone can fork and keep it alive. Maintenance is light (dependency updates, yearly factor-table snapshots), governance starts with a single maintainer and opens as contributors appear, and continued use does not depend on further funding.
```

## 8. Background: what makes you the right person? — 1739 / 2000 знака
КОПИРАЙ:
```
I conceived and drove the reference implementation end-to-end on my own, working with AI coding assistants (fully declared in the AI disclosure): architecture, matching, payment flows, carbon methodology and evidence handling, with a 142-test CI suite, coverage gates and honest limitation reports. I worked through the methodological details myself — implementing GHG Protocol Scope 3 Category 4 against official DESNZ 2026 conversion factors, deciding the tank-to-wheel boundary, and defining counterfactual allocation for spare-capacity rides.

My professional background is 30 years of international industrial and energy work — from welder to mechanical and solar-field supervisor on concentrated solar power plants in Spain, France and South Africa, managing teams of up to 80 people, ASME-coded pipework and NDT inspection programs (2017-2023). I hold a Higher Technician diploma in mineral extraction techniques (1990) and work in Bulgarian, Spanish and Russian.

In parallel, I actively build software myself: I direct AI coding assistants daily ("vibe coding") and have published my own applications, chat bots and payment systems built on the HTTP 402 protocol on GitHub. The idea for this platform is also mine: I saw that a huge movement of vehicles and goods already happens every day and goes unused, and turned that single observation into the platform concept. I brought it to a working, tested implementation by directing AI tools and verifying every output with the automated test suite rather than by trust.

There is no team or institution behind this proposal: the system, its methodology and this application are my own work. I live in Bulgaria, an EU member state, and the work is performed and managed from the EU.
```

## 9. Did (or does) the project have other funding sources? — 232 / 1000 знака
КОПИРАЙ:
```
None to date. The project has been entirely self-funded from my own personal budget. No grants, investments or institutional funding have been received or requested for this work so far, and no commitments exist to any other funder.
```

## 10. AI disclosure
- [ ] Въпросът „Did you use generative AI in writing this proposal?" → избери: **Yes**
- [ ] „Which model did you use? / What did you use it for?" — 1262 / 8000 знака
КОПИРАЙ:
```
Models used: GLM 5.3 (long-context project advisor), a VS Code coding agent ("Cline", configured by me) for repository research and verification, and an AI chat client (Chatbox, model mimo-v2.6-flash) for drafting and language editing.

Used for: researching the call's official pages (ngi.eu, nlnet.nl guide, eligibility, GenAI policy), drafting and revising the answers in this proposal, and verifying every factual claim (test counts, deadlines, factor citations) against the actual repository and official sources before submission. English is not my first language; AI was used as a translator and copy-editor, while the project's positioning, numbers and decisions are mine.

I did not use AI to generate technical claims I cannot explain: the methodology choices (GHG Protocol Scope 3 Cat. 4, tank-to-wheel boundary, factor snapshotting) and the limitations stated above are my decisions, taken from the project's own history. The full prompt provenance log (models, dates, prompts and unedited outputs) is attached to this proposal as required by the GenAI policy — one raw export per source: Chatbox (drafting and editing of this proposal), the coding agent (all repository work, with its own batch log), and GLM 5.3 (project history and document work).
```

## 11. Attachments
- [ ] Качи САМО provenance log файловете (1–2 файла, до 50 MB): Chatbox експорт + Cline BATCH_LOG + GLM диалога. Нищо друго.

## 12. Contact information (попълни с мишката/текст)
| Поле | Стойност |
|---|---|
| Your name (or pseudonym) | Dimitri Hristov |
| Email address | hristovdimitri2@gmail.com |
| OpenPGP key | (празно) |
| Phone number | +359 896 20 30 25 |
| Type of applicant | Individual |
| Name of organisation | (празно) |
| Country | Bulgaria |

---

## ☐ Контролен списък преди бутона Submit
- [ ] Fund = Restack Fund
- [ ] Репото open-carbon-evidence е публично + Apache-2.0 + README секция „How GenAI is used"
- [ ] Провенанс логовете са качени (поле 11)
- [ ] Всички числа = 142 теста (не 139/130), 0.18 kg/km, DESNZ 2026
- [ ] Изпратено до 01.11 (не в последната минута)
- [ ] Скриншот/потвърждение за изпратеното е запазен

*Генерирано от DRUM_NGI_RESTACK_APPLICATION_v5.md · 01.10.2026*
