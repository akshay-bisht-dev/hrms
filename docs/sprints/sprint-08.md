# Sprint 8 — Work Status: work from home, sessions, breaks and corrections

Status: **Approved** · Date: 2026-11-28 · Branch: `sprint-08/work-status`

## 1. Objectives
People can record a working day from anywhere using only the web app, with no desktop agent and no monitoring: work-from-home requests and approvals, work sessions with breaks, an honest record of disconnections, automatic closing of abandoned sessions, and corrections that never rewrite history. Managers see live work **status** only.

## 2. Scope
**In:**
- **Work policies:**
  - Versioned: a change creates a new version from a date; sessions pin the version they started with.
  - Targeted at the company, a legal entity, branch, department or one person. The most specific wins, then priority.
  - Settings: WFH allowed / needs approval / monthly limit, allowed hours, heartbeat timeout, resume window and longest break.
  - A default "Standard" policy is created automatically, and the last company-wide policy cannot be retired.
- **Work-from-home requests:**
  - A date range, optionally limited to weekdays (e.g. every Monday and Wednesday).
  - Overlap and monthly-limit checks.
  - Decided by the direct manager or a `wfh.request.approve` holder in scope, never by the requester.
  - Cancel while pending, or after approval until a session uses it.
- **Work sessions:**
  - Start at a work location (an approved request is needed where required), breaks (regular, meal, personal) and end.
  - One running session per person, enforced by a database lock row: concurrent starts produce exactly one session.
  - Starting clocks in and ending clocks out in Attendance. The Attendance page can't clock out under a running session.
- **Heartbeat:**
  - About once a minute while a session runs, sent app-wide (not just one page) and shown in the sidebar ("Work session running · signal on").
  - Stored as an event at most every half-timeout, so the log stays small but a gap can't hide.
- **Engine** (`session-engine.js`, pure):
  - Worked, break, idle, disconnected and removed time are derived from the append-only event log on every read, so totals can always be recalculated.
  - A silent gap longer than the timeout counts as **disconnected, not worked**.
  - A break stays a break even with the tab closed.
- **Sweeper** (worker, every minute, per company):
  - Marks silent sessions disconnected.
  - After the resume window (or 20 hours) it closes the session **at the last heartbeat**, flags it for review and writes the clock-out at that time (`SYSTEM` source).
- **Corrections:**
  - Kinds: missing check-out, disputed disconnection, add time, remove time, mark as break.
  - Requested by the person, decided by the direct manager or a `manage_work_sessions` holder (MFA). An approval **appends** a `CORRECTION_APPLIED` event; the original events are never changed.
- **Team status** (`view_team_work_status`, sensitive, needs MFA):
  - Who is working, on a break, disconnected, finished or not started; today's totals and the last signal.
  - Status only: no screens, applications or activity.
- **Disclosure:** My work says in plain words what is recorded and what is never recorded, before anyone starts.
- **Frontend:** My work, Team status, Work policies (settings), and the WFH and work-correction sections in Approvals.

**Out (later sprints):**
- The desktop agent, idle detection, screenshots and any monitoring. Idle is supported by the engine and the service (`recordIdle`), but has no HTTP route until the agent exists.
- Tasks and timesheets.

## 3. Dependencies
- Attendance (Sprint 5): clock-in/out and days.
- Work locations: managed in Attendance settings.
- The roles and permissions catalogue from Sprint 3: `work.config.manage`, `wfh.request.approve`, `view_team_work_status`, `manage_work_sessions`.

## 4. Database changes (migration `20261129000000_work_status`)
The work tables were already in the Phase 1 schema. This sprint adds:
- `attendance_punches.source`: new value `SYSTEM`.
- `wfh_requests`: `decided_by`, `decided_at` and `decision_note`.
- CHECK constraints:
  - Policy window, timeouts and dates.
  - A company-wide policy has no target, and every other policy has one.
  - WFH date order.
  - Sessions can't end before they start, and totals can't be negative.
  - A correction covers a positive range; a break can't end before it starts.
- Existing guards still apply: `work_session_events` is append-only (trigger), and the `employee_active_sessions` primary key is the one-session lock.

## 5. API design (`/api/v1/work`, 21 operations; 238 documented in total)
- `GET /me/status`
- `POST /sessions`
- `POST /sessions/current/heartbeat`
- `POST /sessions/current/break/start`
- `POST /sessions/current/break/end`
- `POST /sessions/current/end`
- `GET /sessions`
- `GET /sessions/{id}`
- `GET /corrections`
- `POST /corrections`
- `POST /corrections/{id}/decision`
- `POST /corrections/{id}/cancel`
- `GET /wfh-requests`
- `POST /wfh-requests`
- `POST /wfh-requests/{id}/decision`
- `POST /wfh-requests/{id}/cancel`
- `GET /team`
- `GET /policies`
- `POST /policies`
- `POST /policies/{id}/versions`
- `POST /policies/{id}/retire`

All are in Swagger.

## 6. Backend implementation
- `modules/work/session-engine.js`: the pure timeline. Steps:
  1. Phases from break and idle events.
  2. Disconnections from gaps between presence signals, including the last heartbeat even when it wasn't stored.
  3. Approved corrections painted on top, in approval order.

  Idle modes: not counted, counted, or counted up to the threshold.
- `modules/work/work.service.js`: policies, sessions, heartbeat, sweeper, corrections, WFH and team status.
  - Approver checks follow the attendance pattern.
  - Sensitive permissions checked inside the service also need an MFA-verified session, as on routes.
- `attendance.service.js`: `recordWorkPunch()` (idempotent clock-in/out for sessions); clock-out is refused while a session runs.
- The worker's `work-session-sweep` job fans out per company each minute (job ids are deduplicated per minute).

## 7. Frontend implementation
- `useWorkSession` (in the app shell):
  - Owns the heartbeat.
  - Re-sends when the tab becomes visible again.
  - Shows the real state when a session was closed elsewhere.
- **My work:**
  - Session card with a live total, break and end controls, and a timeline bar (with a text equivalent for screen readers).
  - The disclosure, today's sessions with "Ask for a correction", WFH requests with a weekday pattern, and my corrections.
- **Team status:** counts, a filter, and a 30-second refresh.
- **Work policies:** list, create, new version, retire.
- **Approvals:** WFH requests and work-session corrections.
- All text is in `en.json`, and a check confirms every key used exists.

## 8. Desktop agent
Not in this sprint. The record is designed for it: event sources, idle events and device fields already exist.

## 9. Tests (results copied from runs on 2026-11-28)
| Suite | Result |
|---|---|
| Unit: shared 28, payroll 15, **backend 125** (incl. **15 session-engine tests**, see below), worker 14 (sweeper fan-out), frontend 29 (time-zone conversion incl. DST, durations) | **211 passed** |
| Integration: work (18, real MySQL + Redis), see below | passed |
| Integration: cross-tenant suite, now covering all 7 work `:id` routes, 5 work lists and a policy create targeting another company's employee. Tenant A is taken through a session, a correction and a WFH request. Docs-coverage covers all work routes. | passed (**148** backend integration tests) |
| Database invariants (`db-smoke`, fresh database) | **36/36** pass (10 new) |
| End-to-end, see below | **8 passed**, 3 consecutive full runs |
| Docker: backend and worker images build, and the work service loads inside the worker image | pass |
| Lint, no-TypeScript, syntax, format, build | pass |
| `npm audit --audit-level=high` | pass (the same 18 moderate, dev-only Jest advisories) |

**Session-engine unit tests** cover these scenarios:
- A mid-session gap.
- A break with the tab closed.
- A browser closed with the session still open.
- Idle in all three modes.
- Each correction kind.
- An automatic close.

They also check these properties over 500 random sessions each:
- Segments cover the session exactly once.
- Totals are never negative and never longer than the session.
- More heartbeats never mean less work.
- Corrections are idempotent.

**Work integration tests (18)** cover:
- Disclosure and status.
- The full session with wrong-order actions refused.
- Three simultaneous starts giving one session.
- The event log refusing update and delete.
- WFH: approval, a used approval that can't be cancelled, and the monthly limit with a weekday pattern.
- Policy versioning, the last company policy, and allowed hours.
- **On a controlled clock:**
  - A 10-minute silent gap is disconnected, then a heartbeat reconnects (15 min worked, 10 disconnected).
  - An abandoned session is closed at its last heartbeat with a `SYSTEM` clock-out at that time.
  - A missing check-out is approved by the manager: 35 min, and the log only grew.
  - A disputed disconnection is approved: it counts as work.
- Team status needs the permission and MFA, and is status only.
- Session visibility.

**End-to-end journey** (Playwright, real worker and email), a WFH day without the agent:
1. Ravi sees the disclosure; Home is locked until approved.
2. He sends a request, and Maya approves it in Approvals.
3. Ravi starts at Home: the sidebar signal shows, he takes a meal break, goes back to work, visits Attendance (clocked in) and ends the session.
4. The approval can no longer be cancelled.
5. HR (MFA) sees him as finished in Team status and the policy in force.

The 7 earlier journeys also pass.

## 10. Documentation
README (status and the work module), Swagger, this record.

## 11. Review
**Problems found and fixed during the sprint**
1. **A minute of work became "disconnected" after a correction.** Closed sessions stopped passing the last heartbeat to the engine. Heartbeats are thinned before storage, so when a missing-check-out correction moved the end, the stretch between the last *stored* heartbeat and the real last one looked like a gap. The last heartbeat is now always used. Caught by the controlled-clock integration test (34 min instead of 35).
2. **The last company policy couldn't be detected after a same-day change.** The retire guard counted the previous version, which ends today, as still in force. It now requires another company policy in force *after* this one ends.
3. **WFH decisions were stored inside the recurrence JSON.** They now have real columns (`decided_by`, `decided_at`, `decision_note`).
4. **The heartbeat only on My work would have marked people disconnected while they used other pages.** It now runs in the app shell, and the disclosure says "this app is open in your browser" to match exactly.
5. **UI:** "Working since" was shown during a break (now "Session started at"). "Cancel request" was offered on an approval already used by a session; the API now says `inUse`, so the button is hidden.

**Deviations**
| Plan | Now | Reason |
|---|---|---|
| Idle endpoint | Engine and service support idle; no HTTP route | The web app must not guess idleness. The desktop agent will report it |
| A missing-check-out correction also fixes attendance | Corrects the work session; the attendance day is fixed with an attendance regularization | Attendance corrections replace a day's punches and have their own approval and payroll-lock rules; merging the two flows needs a design decision |
| Notifications for WFH and corrections | Not sent | Notification templates for approvals arrive with the notification centre |

**Known limits**
- Team status lists up to 500 people per request and computes live totals for running sessions on each refresh. Fine for SMEs; a cache comes with scale testing (Sprint 15).
- Browsers slow timers in background tabs; the heartbeat is sent again as soon as the tab is visible, and the timeout (at least 2 minutes) allows for it.
- Allowed hours are checked at start only; a session may run past the end of the window.

**Demo steps**
1. Settings → Attendance → Work locations: add "Home" (type WFH). Settings → Work policies: see "Standard".
2. As an employee: My work → read "What is recorded" → Work from home → send a request.
3. As the manager: Approvals → Work-from-home requests → Approve.
4. As the employee: choose Home → Start work → Start break → Back to work → End work.
5. As HR with two-step verification: Work → Team status.

## 12. Approval
Approved by the owner on 2026-11-28; merged to `main` through a pull request after CI passed.
