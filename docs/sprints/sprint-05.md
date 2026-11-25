# Sprint 5 — Attendance, shifts, overtime and corrections

Status: **Complete, awaiting owner approval** · Date: 2026-11-25 · Branch: `sprint-05/attendance`

## 1. Objectives
People clock in and out on the web and can see exactly what is recorded about them. Each day is worked out the same way everywhere: present, half day, absent, late, early leave, overtime, weekends and holidays, in the employee's own time zone. Mistakes are fixed through corrections that a manager approves, and the original clock events are never changed. HR configures shifts, overtime rules and thresholds per legal entity, and reports on the result.

## 2. Scope
**In:**
- Clock-in/out (ATT-01) with an optional work location. Capturing the IP address or location is **off by default**; when a company turns either on, it is shown on the clock-in screen before anyone clocks in.
- Shifts with grace periods and unpaid breaks, including night shifts. Effective-dated shift assignments.
- Schedules from Sprint 3 are used when no shift is assigned. Weekends come from the legal entity; public holidays come from the branch's holiday calendar.
- A daily calculation engine (ATT-02): present, half day and absent thresholds, late arrival and early leave after grace, break deduction, missing clock-out, WFH days, and daily and weekly overtime with no double counting.
- Overtime approval by the direct manager, or by anyone holding `attendance.regularization.approve` in scope.
- Correction requests (ATT-03): ask, approve, reject (a reason is required) or cancel. Approval adds `CORRECTION` punches; the originals stay stored.
- Attendance policy per legal entity, with a company default.
- Worker jobs: a roll-up every 30 minutes, recalculation on request, and applying **future-dated job changes** (deferred from Sprint 4).
- Team day view, one employee's month, an approvals inbox, and a summary report with a formula-safe CSV (ATT-04).
- Frontend: My attendance, Team attendance, Approvals, Reports and Attendance settings. The Job tab now shows scheduled changes with a cancel button.

**Out:**
- Leave (ON_LEAVE days) arrives in Sprint 6.
- WFH requests: locations marked "needs approval" can't be chosen yet (Work Status, Sprint 9).
- The desktop agent and mobile punches (Sprints 10+).
- Biometric adapters (ATT-04 F).
- Email notifications for approvals. The inbox is in-app for now.

## 3. Dependencies
Sprints 1–4. The worker and scheduler must be running for roll-ups and scheduled job changes: `npm run dev:worker` and `npm run scheduler -w apps/worker`.

## 4. Database changes
Migration `20261126000000_attendance`:
- `attendance_punches.work_date`: the day a punch belongs to. An OUT inherits its IN's date, so a night shift stays on one day. Added as nullable, backfilled, then made required. Indexed.
- `attendance_days`: `expected_minutes`, `overtime_status` (NONE/PENDING/APPROVED/REJECTED), `overtime_decided_by/at`, `flags`.
- `overtime_rules.rest_day_all_overtime`.
- New `attendance_policies` table: one row per legal entity plus an optional company default. Composite tenant FKs, with `CHECK` constraints so the half-day threshold can't exceed the present threshold.
- **Triggers:** punches can't be updated (corrections add rows instead); a locked day can't change until it is explicitly unlocked.
- `db-smoke` now checks all of the above (18 invariants, all passing).

## 5. API design (`/api/v1/attendance`, 30 operations; 142 documented in total)
| Route | Access |
|---|---|
| `GET /me/status`, `POST /punches`, `GET /me?from&to` | signed in, linked to an employee record |
| `GET /days?date&status&departmentId` (counts + paging) | `attendance.view`, filtered to its scope |
| `GET /days/:id`, `GET /employees/:id/days?from&to` | signed in; 404 outside `attendance.view` scope (yourself always) |
| `GET/POST /regularizations`, `GET /regularizations/:id`, `POST …/:id/decision`, `POST …/:id/cancel` | ask: yourself · decide: the direct manager or `attendance.regularization.approve` in scope, **never yourself** · cancel: your own pending request |
| `GET /overtime`, `POST /days/:id/overtime-decision` | same approval rule |
| CRUD `/shifts` · CRUD `/overtime-rules` · `GET/POST/DELETE /shift-assignments` · `PUT /policy` · `POST /recalculate` | `attendance.manage` (shift list and `GET /policy`: signed in) |
| `GET /reports/summary?from&to&departmentId&format=json\|csv` | `attendance.view` scope |
| CRUD `/companies/work-locations` | read: signed in · write: `company.org.manage` |
| `DELETE /employees/:id/employment-records/:childId` | `employee.profile.update`; only a change that hasn't taken effect yet |

Ranges are capped at 93 days (62 for recalculation).

## 6. Backend implementation
- `lib/time.js`: time-zone helpers built on `Intl`, with no new dependency. They handle DST gaps (moving forward) and overlaps (taking the earlier instant) correctly for zones on both sides of UTC.
- `modules/attendance/engine.js`: **pure** calculation code, unit-tested, with no database access. The API and the worker produce identical results.
  - **Plan resolution:** shift assignment → schedule on the employment record → the legal entity's weekend days. A holiday overrides all three.
  - **Effective punches:** the latest correction IN and OUT replace what is outside them.
  - **Pairing:** IN with the next OUT; a repeated action is ignored.
  - **Day close:** the planned end (or local midnight) plus 4 hours.
  - **Break deduction:** only once more than half the planned time was worked.
  - **Overtime:** the larger of daily and weekly excess.
  - **Status:** WFH when most worked time was at a home or remote location.
- `attendance.service.js`:
  - **Punches:** server time; an open session older than 20 hours counts as abandoned; an IN after midnight that falls inside yesterday's night shift belongs to yesterday.
  - **Day upsert:** retried once on a race; locked days are skipped.
  - **Overtime decisions:** a decision is kept only while the minutes stay the same. If a recalculation changes them, the day goes back to PENDING.
  - **Corrections:** create an `approval_steps` row routed to the direct manager. Approval recalculates the rest of that week, because weekly overtime depends on earlier days.
- `employees.service.js`: future-dated job changes are stored as scheduled records. `applyDueChanges()` applies them in each employee's time zone, re-checks the manager for loops, and audits a skip if the change is no longer valid. Only one scheduled change per person at a time.
- Worker: a `work-sessions` processor. Fan-out jobs per live company are deduplicated per hour (no `:` in job IDs). Each tenant's job runs in that tenant's context. The scheduler registers `attendance-rollup` (30 min) and `employment-apply-due` (hourly).

## 7. Frontend implementation
- **My attendance:**
  - The clock card shows the plan, a live worked-time counter, a location picker, and the capture notice (for example "your company records the time and your IP address. Nothing else is collected."). The browser asks for location only when the company turned it on, and clocking in never depends on it.
  - A month table with status badges, "Corrected" and "No clock-out" flags, and a Fix button on each day.
  - A correction form with a night-shift option, and your own requests with cancel.
- **Team attendance:** a date picker, status filter chips with counts, and times in each employee's own time zone. It links to one person's month with every clock event.
- **Approvals:** corrections show what was recorded next to what was asked for. Overtime has approve and reject; reject stays disabled until a note is written.
- **Reports:** a period and department filter, a totals table and a CSV download.
- **Settings → Attendance:** shifts, bulk shift assignment, overtime rules, the policy (company or legal entity), work locations and recalculation.

Screenshots from the E2E run: [`s5-my-attendance.png`](sprint-05/s5-my-attendance.png), [`s5-approvals.png`](sprint-05/s5-approvals.png), [`s5-policy.png`](sprint-05/s5-policy.png), [`s5-report.png`](sprint-05/s5-report.png).

## 8. Desktop agent
Not in this sprint. `PunchSource.DESKTOP_AGENT` is reserved for Sprint 10.

## 9. Tests (results copied from runs on 2026-11-25)
| Suite | Result |
|---|---|
| Unit: shared 27, backend 92 (incl. **29 engine tests**: grace, late, early, half day, break deduction, night shift, DST in New York and Berlin, daily/weekly overtime, rest days, holidays, corrections, WFH), worker 13 (fan-out, tenant context, payload checks), frontend 20 (capture notice, clock-in, field errors, formatting) | **152 passed** |
| Integration: attendance (19, real MySQL + Redis) covers clock-in/out; IP and location captured only when enabled; locations that need approval or are inactive are refused; punches can't be edited; a fixed week (late + overtime, holiday, absent, half day, Sunday work); idempotent roll-up; overtime routed to the manager, never to the person themselves or an outsider; locked days; correction validation, approval, rejection and cancellation; scopes; settings permissions; night shifts and overlapping assignments; policy checks; queued recalculation; report totals and CSV | passed |
| Integration: employees, new test: scheduled change → not yet applied → applied once on the date → idempotent → cancel reopens the previous record | passed |
| Integration: generated cross-tenant suite, now covering 12 more `:id` routes. New test: **every registered route is in the API docs** | passed (96 backend integration tests + worker queue) |
| Database invariants (`db-smoke`), 5 new checks | 18/18 pass |
| End-to-end (Playwright, real worker, email and S3), new journey: HR turns on MFA, sets up a shift, assignment, location and policy in the UI → employee sees the capture notice, clocks in and out, asks for a correction → manager approves with a note → employee sees "Corrected" with 8h / 8h → HR report and CSV download. Plus the 4 earlier journeys. Run twice in a row. | 5 passed, both runs |
| Lint, no-TypeScript, syntax, format, build, `npm audit --audit-level=high` | pass |

## 10. Documentation
README (worker schedules, attendance troubleshooting), `.env.example` (`WORKER_WORK_SESSIONS_CONCURRENCY`), Swagger (now complete, see review item 3), this record.

## 11. Review
**Problems found and fixed during the sprint**
1. **Scope filter overwritten (security):** the attendance code spread `employeeScope()` into a `where` that also named an `id`. For OWN scope the scope is `{ id: <me> }`, so a person asking for someone else's days got **their own** data back instead of a 404, and the same pattern could have widened the shift-assignment and approval checks. The integration tests caught it. Every site now uses `AND: [{ id }, scope]`, as the employees module already did.
2. **Weekend assumption:** an early test assumed Saturday and Sunday. Indian legal entities default to Sunday only, and the engine correctly used the legal entity's setting, so the test was fixed to match.
3. **Swagger missing routes (from Sprint 3):** the OpenAPI document was built before the routers were created, so every route registered inside a router factory (all company settings, the shift and overtime CRUD) was missing from the docs. Routers are now built first. A new test compares the live route registry against the document; it fails without the fix and passes with it.
4. **Directly managed people couldn't reach Approvals** if their role lacked team scope. The Approvals link is now shown to everyone; the list is empty when nothing is waiting.
5. **Form defaults:** new work locations would have been created inactive, and new overtime rules without approval, because the form helper started every checkbox unticked. `ResourceSection` now supports per-field defaults.
6. **Wording:** the capture notice uses the locale's list format, and approvals say "nothing recorded" instead of empty dashes.

**Deviations**
| Plan | Now | Reason |
|---|---|---|
| Roll-up "nightly" (Phase 1 §2) | Every 30 minutes, last 2 days + today per employee time zone | Companies span time zones; a single nightly run would close days at the wrong local time |
| Separate correction decision columns | `approval_steps` holds approver, decision and note | It was designed as the generic approval table and will be reused by leave and WFH |
| Weekly working-time breach flags (GLB-07) | Counted as weekly overtime; no separate "breach" flag yet | The rule data is the same; a statutory limits view comes with country packs |

**Known limits**
- Rows for days without any clock events are created by the roll-up job. Until it runs (every 30 minutes), a past day can show "Not recorded" in team views.
- Changing shifts or rules doesn't recalculate past days by itself. HR uses **Recalculate** (up to 62 days); locked days are never changed.
- `npm audit` reports 18 **moderate** advisories, all in Jest's development-only dependency chain (glob/minimatch). The suggested fix downgrades Jest, so it isn't applied. Nothing high or critical; production images don't include Jest.
- Location capture stores the browser's reported position as given. No geofencing yet.

**Demo steps**
1. Settings → Attendance → Shifts: add "General" 09:00–18:00. Shift assignments: assign it to two people.
2. Policy: optionally tick "Record the IP address". The clock-in screen immediately says so.
3. As the employee: My attendance → Clock in / Clock out. Use Request a correction for a past day.
4. As their manager: Approvals → approve with a note. The employee's day shows "Corrected".
5. Reports: pick a period, then Download CSV.

## 12. Approval
Pending.
