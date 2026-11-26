# Sprint 6 — Leave management

Status: **Approved** · Date: 2026-11-25 · Branch: `sprint-06/leave`

## 1. Objectives
Every company defines its own leave types and rules: nothing is hardcoded, and rules change over time without rewriting history. Balances are a ledger, so every day earned, taken, adjusted or expired is a row, and the balance is their sum. People apply, managers (and HR where required) approve, and approved leave shows up in attendance automatically.

## 2. Scope
**In:**
- **Leave types** (LEV-01): paid or unpaid, negative balance allowed or not, and a supporting document required after N days. A one-click **starter pack** (annual, sick, unpaid) with numbers clearly marked for review against local law.
- **Policies** (LEV-01): effective-dated and **versioned**. Rules are stored as validated JSON:
  - accrual (monthly, all at the start of the year, or none), proration for joiners, the leave-year start month;
  - carry-forward limit, maximum balance, half days;
  - counting weekends and holidays, the sandwich rule;
  - notice, maximum consecutive days, minimum tenure;
  - one or two approval levels.
- **Assignments** to the company, a legal entity, branch, department or one person. The most specific one wins.
- **Ledger** (LEV-02): opening balance, accrual, adjustment, consumption, reversal and expiry entries. The database blocks edits and deletes, so a mistake is fixed with another entry. Quantities are handled as integer hundredths, never floats.
- **Requests** (LEV-03):
  - a live preview of the day count, balance and policy problems;
  - day counting from the employee's real plan (shift, schedule, legal-entity weekend, branch holidays), with half days;
  - overlap checks and supporting documents (from the employee's own documents, MEDICAL category);
  - a manager → HR chain where the same person can never approve both steps;
  - rejection with a reason;
  - cancellation, which reverses the debit for approved leave.
- **Attendance integration:** approved full-day leave marks the day ON_LEAVE. Half-day leave measures the worked half against half the planned time, with no late or early flags. Cancelling restores the normal calculation.
- **Accruals:** a worker job every 6 hours; a run is also queued immediately when policies are loaded or assigned. Year-end carry-forward expiry. Idempotent per period key. HR can re-run any month.
- "Who's away" calendar, balance and ledger views for HR, a leave report with a formula-safe CSV, and leave requests added to the shared Approvals inbox.

**Out:**
- Encashment (LEV-04, priority L). The ENCASHMENT entry type is reserved; payroll integration comes with Payroll (Sprint 7–8).
- Hour-based leave. The schema supports `unit = HOUR`; the API accepts days only.
- Expiry of carried-forward days after N months. The year-end cap is implemented; a separate expiry date for carried days isn't.
- Email notifications for approvals (in-app inbox only, as in Sprint 5).
- Country statutory templates (GLB-06) beyond the generic starter pack. These belong with the country packs.

## 3. Dependencies
Sprints 1–5 (the attendance plan resolution is reused for day counting). The worker and `npm run scheduler -w apps/worker` must be running for automatic accruals.

## 4. Database changes
Migration `20261127000000_leave`:
- `leave_requests.document_id`: a composite FK to `employee_documents`. That table gains `UNIQUE(tenant_id, id)`; the tenant-model snapshot was updated as a reviewed change.
- `leave_requests.decided_at`.
- **Triggers:** `leave_ledger_entries` can't be updated or deleted.
- `CHECK` constraints: request quantities ≥ 0 and `to_date ≥ from_date`; each request day is more than 0 and at most 1.
- The existing `UNIQUE(tenant, employee, type, entry_type, period_key)` makes accruals and expiry idempotent; `OPENING` as a period key allows one opening balance per type.
- `db-smoke`: 5 new checks (24 total, all passing).

## 5. API design (`/api/v1/leaves`, 28 operations; 170 documented in total)
| Route | Access |
|---|---|
| `GET /balances/me`, `POST /requests/preview`, `POST /requests` | signed in, linked to an employee record |
| `GET /balances/:id`, `GET /ledger/:id` | yourself, or `leave.request.view` scope |
| `GET /requests?view=mine\|approvals\|team`, `GET /requests/:id` | own / deciders / `leave.request.view` scope |
| `POST /requests/:id/decision` | step 1: direct manager or `leave.request.approve` in scope; step 2: `leave.request.approve` in scope and **not** the step 1 approver; never your own |
| `POST /requests/:id/cancel` | yourself (pending, or approved and not started), or `leave.request.approve` in scope |
| `GET /calendar?from&to&departmentId` | `leave.request.view` scope (yourself always) |
| `POST /adjustments` | `leave.balance.adjust` in scope |
| CRUD `/types` (read: signed in) · CRUD `/policies` · `POST /policies/:id/versions` · `GET/POST/DELETE /policy-assignments` · `POST /starter-pack` · `POST /accruals/run` | `leave.config.manage` |
| `GET /reports/summary?from&to&format=json\|csv` | `leave.request.view` scope |

## 6. Backend implementation
- `packages/shared/src/quantity.js`: `toCenti` / `fromCenti` / `formatDays`. All leave arithmetic uses integer hundredths of a day.
- `packages/shared/src/schemas/leave.js`: types, `LeavePolicyRules`, requests, decisions, adjustments, and the starter pack.
- `modules/leave/engine.js` (pure, unit-tested):
  - `countLeaveDays` (half days, weekends, holidays, sandwich);
  - `leaveYearOf` (including April–March years);
  - `monthlyShare`, where the twelve monthly shares always add up exactly (20 days → 1.66 / 1.67 / 1.67 …);
  - `accrualsDue` (monthly for anyone employed on the 15th; upfront prorated to half days for joiners);
  - `yearEndExpiry`, `capCredit`, `validateRequest`.
- `leave.service.js`:
  - **Policy resolution** by assignment specificity, then the latest start.
  - **Balances** are sums from the ledger. "Available" also subtracts pending requests.
  - **Approval:** the last approval re-checks the balance, posts the CONSUMPTION entry (paid types) and recalculates attendance for past days.
  - **Policy versions** end the old version the day before and copy its assignments.
  - **Accruals:** for each employee and type, post year-end expiry using the rules in force on the last day of the year, then this month's credit, capped at the maximum balance.
- `employees/scope.js` `anyOf()`: see review item 1.
- Attendance engine: a `leaveCenti` input gives ON_LEAVE and ON_LEAVE_HALF.
- Worker: `leave-accrual` (fan-out every 6 hours) and `leave-accrual-tenant` jobs on the `work-sessions` queue.

## 7. Frontend implementation
- **My leave:** balance cards (available, balance, waiting, used this year). The apply form has half-day options that appear only when the policy allows them, a debounced live preview with policy problems, a document upload when required, and a note when two approvals are needed. My requests shows approval steps, decision notes and cancel.
- **Approvals:** a new "Leave requests" section with type, dates, half days, the day count, step X of Y, the reason, and whether a document is attached.
- **Who's away:** month and department filter for everyone in scope.
- **Leave report:** taken and balance per type, with CSV.
- **Settings → Leave:** types and the starter pack; policies with a full rules form and "New rules from a date"; assignments with target pickers; balances (person picker, opening balance or adjustment form, ledger with running balance); accruals (run any month).

Screenshots from the E2E run: [`s6-my-leave.png`](sprint-06/s6-my-leave.png), [`s6-apply.png`](sprint-06/s6-apply.png), [`s6-approvals.png`](sprint-06/s6-approvals.png), [`s6-policies.png`](sprint-06/s6-policies.png).

## 8. Desktop agent
Not in this sprint.

## 9. Tests (results copied from runs on 2026-11-25)
| Suite | Result |
|---|---|
| Unit: shared 27, backend 110 (incl. **16 leave engine tests**: exact quantities, half days, holidays, sandwich, leave years, monthly shares, upfront proration, carry-forward, caps, validation; **2 new attendance tests** for full- and half-day leave), worker 13 (accrual fan-out), frontend 24 (balances, live preview, policy problems, no-policy state) | **174 passed** |
| Integration: leave (18, real MySQL + Redis) covers the starter pack and immediate accrual queueing; config permissions; 11 monthly runs = exactly 18.33 days, re-runs post nothing; a person-specific policy beating the company one; preview skipping the weekend and holiday; pending reducing availability; overlap and balance refusals; manager approval and ledger debit; documents (own only); a two-level chain where the same person can't approve twice; reject with a reason; cancel and reverse; past leave → attendance ON_LEAVE → HR cancels → ABSENT; opening balance once; adjustments; DB blocks ledger edits and deletes; a policy version with year-end expiry (−15, keeping 5) and a new accrual (+2); scopes; calendar; CSV formula guard | passed |
| Integration: generated cross-tenant suite, now covering 15 more `:id` routes, 7 leave lists, 2 cross-tenant creates and a cross-tenant adjustment. The docs-coverage test also covers all new routes. | passed (114 backend integration tests + worker queue) |
| Database invariants (`db-smoke`) | 24/24 pass |
| End-to-end (Playwright, real worker): HR loads the starter types and posts an opening balance in the UI → the employee previews and applies for 3 days → the manager approves from Approvals and sees it in Who's away → the employee's available balance drops by exactly 3 → HR's ledger shows "Leave taken −3". Plus the 5 earlier journeys. Run twice in a row. | 6 passed, both runs |
| Lint, no-TypeScript, syntax, format, build, `npm audit --audit-level=high` | pass |

## 10. Documentation
README (leave in the worker schedule list), Swagger, this record.

## 11. Review
**Problems found and fixed during the sprint**
1. **Empty approval inboxes for company-wide approvers (also affected Sprint 5):** Prisma treats `OR: [{}]` as matching **nothing**. Approvers whose scope is the whole company (HR, Company Admin) therefore saw only their direct reports in the attendance corrections and overtime inboxes, and nothing in the new leave inbox. Deciding still worked, because single-record checks use `AND`. A new `anyOf()` helper treats an empty filter as "everyone". Tests now check HR's inboxes. I confirmed the attendance tests fail without the fix and pass with it.
2. **Accruals waited up to 6 hours** after a company loaded its leave types, so new balances showed 0. Loading the starter pack or assigning a policy now queues this month's accrual immediately (covered by a test).
3. **Stale ledger for HR:** picking a person again showed the ledger as it was before approvals. It now always refreshes.
4. **Document upload helper** didn't return the new document's ID. It does now, so leave requests can attach it.

**Deviations**
| Plan | Now | Reason |
|---|---|---|
| Gender eligibility (LEV-01) | Not implemented; eligibility is tenure-based, and special leave (e.g. parental) is given by assigning a policy to the person | Gender is optional, free-text and legally sensitive in many countries (GLB-04); gender-based rules would wrongly exclude people |
| TEAM as an assignment target | Not offered | Employee records have no team field yet (teams are organisational only) |
| Encashment (LEV-04, L) | Deferred to Payroll | The payout has to flow into a payroll run |
| Accrual "nightly" | Every 6 hours, plus an immediate run after setup | Idempotent per period, so frequent runs are safe and new companies see balances at once |

**Known limits**
- Monthly accrual credits the current month only. A policy introduced mid-year doesn't back-credit earlier months; HR posts opening balances or re-runs earlier months under Accruals.
- Carried-forward days don't expire separately after N months. Only the year-end cap applies.
- Requests are capped at 93 days. Day counting asks the attendance plan once per day, which is fine at that size.
- `npm audit` still reports the 18 moderate, dev-only Jest advisories from Sprint 5.

**Demo steps**
1. Settings → Leave → Load starter types. On the Balances tab, give someone an opening balance.
2. As the employee: My leave → Apply for leave. Watch the preview count working days and skip the weekend and holiday.
3. As their manager: Approvals → approve. Who's away shows it.
4. As the employee: the balance drops by exactly the requested days. Cancel it before it starts, and the days come back.
5. Policies → New rules from a date: the old version keeps applying before that date.

## 12. Approval

Approved by the owner on 2026-11-26; merged to `main` through a pull request after CI passed.
