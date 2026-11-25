# Phase 1 — Requirements, Architecture & Plan (for approval)

| # | Deliverable | Location |
|---|---|---|
| 1 | Complete requirements | [01 §1–4](01-requirements-and-workflows.md) |
| 2 | Business workflows | [01 §5](01-requirements-and-workflows.md#5-key-business-workflows) |
| 3 | JavaScript technology stack | [02 §1](02-architecture.md#1-javascript-only-technology-stack) |
| 4 | System architecture | [02 §2](02-architecture.md#2-system-architecture-modular-monolith) |
| 5 | Database ER diagrams | [03](03-data-model.md) |
| 6 | Multi-tenant design | [02 §3](02-architecture.md#3-multi-tenant-design) |
| 7 | WFH & monitoring architecture | [02 §4](02-architecture.md#4-wfh--monitoring-architecture) |
| 8 | Electron desktop architecture | [02 §5](02-architecture.md#5-electron-desktop-agent-architecture) |
| 9 | Security & privacy architecture | [02 §6](02-architecture.md#6-security--privacy-architecture) |
| 10 | UI/UX sitemap | [04 §3](04-api-and-ux.md#3-uiux-sitemap) |
| 11 | API specification | [04 §1–2](04-api-and-ux.md) |
| 12 | Development roadmap | [05 §1](05-roadmap-infra-risks.md#1-roadmap-2-week-sprints) |
| 13 | Infrastructure & deployment plan | [05 §2](05-roadmap-infra-risks.md#2-infrastructure--deployment-plan) |
| 14 | Risk assessment | [05 §3](05-roadmap-infra-risks.md#3-risk-assessment) and [06 §8](06-global-architecture.md#8-new-risks) |
| + | **Worldwide architecture** (residency cells, payroll packs, jurisdiction-aware monitoring, i18n, global billing) | [06](06-global-architecture.md) |

## Key architectural decisions

1. **Shared-schema multi-tenancy** with tenant ID enforced in five layers, including composite foreign keys in MySQL.
2. **Work time is event-sourced.** It is computed only from server-received events. Disconnected periods are never counted automatically.
3. **Monitoring is off by default.** It can only be switched on after an in-app activation checklist and versioned employee notices. Screenshots are captured only during a server-confirmed active session, with a visible tray indicator.
4. **Payroll rules are versioned configuration.** Each run pins the rule versions it used. Finalized records are frozen by DB triggers.
5. **MySQL 8.4 LTS** instead of 8.0, because 8.0 reached end-of-life in April 2026.
6. **Worldwide scope** (answered): tenants live in one **regional cell** for data residency. Payroll uses a **country-pluggable engine** with three coverage levels: Native, Configurable, and Export. Monitoring permissions are **jurisdiction-aware** and fail closed for unknown jurisdictions. i18n and RTL are built in from Sprint 1, and billing is multi-currency (Stripe globally, Razorpay for India).
7. **The sprint order puts WFH and the desktop agent before Recruitment, Onboarding and Performance**, with an MVP launch around week 28. Nothing is dropped.

## Approval record

**Phase 1 approved on 2026-11-25.** The owner left questions 1a–8 below unanswered, so work continues on these **working defaults**. Any of them can be changed later. A change after the relevant sprint has started will be re-planned.

| Q | Working default |
|---|---|
| 1a | Native payroll at launch: **India** and **United Kingdom**. All other countries start in Configurable or Export mode. US native payroll comes later, because of state and local taxes. |
| 1b | Cells: **India (`ap-south-1`)** at MVP. **EU (`eu-central-1`)** and **US (`us-east-1`)** added before general availability. |
| 1c | **English** at launch. RTL is built in and checked with a pseudo-locale plus an Arabic test locale, but no RTL language ships at launch. |
| 2 | Per active employee per month, with Monitoring as a paid add-on. Prices in USD, EUR, GBP and INR. |
| 3 | Screenshots on **company-managed devices only**. BYOD gets session tracking without screenshots. |
| 4 | MVP pilot cut as proposed (about week 34). Recruitment, Onboarding and Performance come after launch. |
| 5 | No dedicated databases at launch. |
| 6 | External payroll experts (India, UK) and privacy counsel still need to be engaged. This is flagged as a **blocker before Sprint 7 and Sprint 10**. |
| 7 | Team of about 7, as assumed in 05 §1. |
| 8 | Amazon SES for email. Basic in-house resume parsing behind a pluggable adapter. |

## Open questions (decisions only you can make)

1. ~~Launch markets~~ **Answered: worldwide.** Follow-ups:
   - 1a. **Native payroll countries at launch:** which 1–3 countries get full statutory payroll first? All other countries start in Configurable or Export mode.
   - 1b. **First data regions:** which regional cells at launch (suggested: India, EU, US)?
   - 1c. **Launch languages:** English plus which others? Is any RTL language needed at launch?
2. **Pricing:** per employee per month, with Monitoring as a paid add-on? Which price currencies? (Gateway is now proposed as Stripe globally and Razorpay for India.)
3. **Monitoring scope in v1:** screenshots on company-managed devices only, with BYOD limited to session tracking (my recommendation)? Or do you need BYOD screenshots at launch?
4. **MVP cut:** is launching to pilot tenants with Core HR + Attendance + Leave + Payroll + Work Status + Agent + Billing (about week 28) acceptable, with Recruitment, Onboarding and Performance after launch? Or must all 14 modules ship before the first customer?
5. **Dedicated databases:** does any customer need its own database, beyond the regional cells?
6. **Domain-expert access:** do you have payroll experts for each native-payroll country, and privacy/employment counsel for your main markets, to review rule packs, the jurisdiction registry and monitoring notices? Both are on the critical path.
7. **Team and timeline:** what is the real team size and target date? The roadmap assumes about 7 people.
8. **Third-party services:** is Amazon SES for email acceptable? Should resume parsing be in-house (basic) or use a paid parser API?
