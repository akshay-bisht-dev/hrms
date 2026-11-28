# Sprint 9 — Tasks, daily reports, timesheets, manager board and HR dashboard

Status: **Approved** · Date: 2026-11-28 · Branch: `sprint-09/tasks-timesheets`

## 1. Objectives
Turn a work session into a full remote working day: the work people do (projects and tasks with time), what they report each day, and the weekly timesheet their manager approves. Managers get one board for status, tasks and approvals; HR gets company-wide remote-work figures. All of it works with the web app only, without the desktop agent.

## 2. Scope
**In:**
- **Projects:** code, client, status, billing flag, owner and members. `project.manage` creates projects; the owner or a `project.manage` holder changes them.
- **Tasks:**
  - Priority, due date, estimate, subtasks and comments.
  - People assign tasks to themselves; giving work to others needs to be their manager or `task.assign` in scope.
  - Visible to the people assigned, the creator, project members and owner, and the assignees' managers.
- **Task status rules** (`task-engine.js`, pure):
  - Assignees move their own work forward.
  - The creator or a manager cancels, reopens and approves.
  - Tasks that need approval go through review, and nobody approves their own work.
- **Task time:**
  - A timer that runs only during a work session and never on a break. Starting another task, a break, ending the session and an automatic close all stop it, and one timer runs per person.
  - Time entered by hand for the last 14 days.
- **Daily work report:**
  - Built automatically from the day's sessions and task time.
  - The person adds notes and submits, and the figures are frozen at submission.
  - The manager (or `approve_work_reports` with MFA) approves, rejects or asks for changes.
- **Weekly timesheet:**
  - Per day and per task, with time "not on a task" shown separately, frozen at submission.
  - Decided by the manager (or `approve_timesheets` with MFA).
  - A submitted or approved timesheet **locks the week**: task time and work-session corrections are refused until the approver sends it back.
- **Manager board:** Team status, now with each person's current task and open and overdue tasks, plus "Waiting for you" counts. It needs `view_team_work_status` with MFA.
- **HR remote-work dashboard** (`reports.view`):
  - Headcount, who is working now, average day, share of remote and disconnected time, sessions closed automatically, a daily table, and pending decisions.
  - **Aggregates only**, never names.
- **Fix found this sprint (affected Sprints 4–7):** editing a shift, overtime rule, leave type, work schedule or payroll component reset fields the user didn't send. See review item 1.

**Out:**
- Task attachments. They need the document scanning path; they come with the notification and file work in Sprint 12.
- Notifications.
- Billable-hours reports.

## 3. Dependencies
- Work sessions (Sprint 8).
- Employees and the reporting line (Sprint 4).
- The roles catalogue (Sprint 3): `project.manage`, `task.assign`, `approve_work_reports`, `approve_timesheets`, `reports.view`.

## 4. Database changes (migration `20261130000000_tasks_timesheets`)
The tables were in the Phase 1 schema. This sprint adds:
- An index for running timers.
- CHECK constraints:
  - Project dates.
  - Task progress 0–100, and minutes not negative.
  - Time entries can't end before they start, and durations can't be negative.
  - Timesheet totals not negative.
- Still enforced: one timesheet per person and week (unique), and composite tenant foreign keys.

## 5. API design (32 new operations; 270 documented in total)
- `/api/v1/projects`: list, create, change, members.
- `/api/v1/tasks`:
  - List (`view=mine|created|team`), create, get, change, delete, assignees, status, comments.
  - Timer: `/{id}/timer/start`, `/timer`, `/timer/stop`.
  - Time entries: list, add by hand, remove.
- `/api/v1/work-reports`:
  - Mine: `/me/{date}` (get and save), `/me/{date}/submit`.
  - For reviewers: list, get, decision.
- `/api/v1/timesheets`:
  - Mine: `/me?week=`, `/me/{weekStart}/submit`.
  - For reviewers: list, get, decision.
- `/api/v1/dashboards`: `/team-board`, `/remote-work`.

## 6. Backend implementation
- `modules/tasks/`:
  - `task-engine.js`: status rules.
  - `tasks.service.js`
  - `timers.js`: stopping timers, shared with the work-session service.
- `modules/timesheets/`:
  - `timesheets.service.js`: daily reports and timesheets built from sessions and task time.
  - `lock.js`: the week lock, also checked by work-session corrections.
- `modules/dashboards/dashboards.service.js`
- **Work sessions:** ending, an automatic close and starting a break now stop the task timer; corrections respect the timesheet lock.
- **Shared schemas:** `patchOf()` builds PATCH schemas without defaults, now used everywhere.

## 7. Frontend implementation
- **Tasks:**
  - Tabs: My tasks, Set by me, My team, Projects.
  - Create a task; each row has a timer button.
  - Task detail with only the status changes you may make, and comments.
- **My work:** a task-timer card, hidden during a break.
- **Daily report:** move between days; totals, sessions, tasks and completed work; notes; save and submit.
- **Timesheet:** move between weeks; totals; a task × day grid; submit, with a note about the lock.
- **Team status:** now also shows the current task, open and overdue tasks, and "Waiting for you".
- **Remote work:** the HR dashboard.
- **Approvals:** daily reports and timesheets, with approve or ask for changes (a note is required to send something back).
- Inboxes and task details always reload when opened.

## 8. Desktop agent
Not in this sprint (Sprint 10).

## 9. Tests (results copied from runs on 2026-11-28)
| Suite | Result |
|---|---|
| Unit: shared 30 (incl. a guard that **no Patch schema adds fields the caller didn't send**), payroll 15, backend 130 (incl. 5 task-status tests), worker 14, frontend 29 | **218 passed** |
| Integration: tasks (14, real MySQL + Redis), see below | passed |
| Integration: cross-tenant suite, now covering every project, task, report and timesheet `:id` route, 10 more lists and 3 cross-tenant creates. B's owner now has an employee record, so every lookup is really exercised. | passed (**162** backend integration tests) |
| Database invariants (`db-smoke`, fresh database) | **41/41** pass (5 new) |
| End-to-end, see below | **8 passed**, 3 consecutive full runs |
| Lint, no-TypeScript, syntax, format, build | pass |

**Tasks integration tests (14)** cover:
- Projects and who may change them.
- Who may assign work.
- Visibility.
- The full review flow with self-approval refused.
- Timer rules:
  - A timer needs a running session.
  - Switching tasks stops the other timer.
  - A break or ending the session stops the timer.
  - A timer can't start during a break.
- Time entered by hand: future and old dates refused; time entries from the timer can't be deleted.
- Deleting a task that has recorded time is refused.
- Daily report: build, notes, submit, lock, review, changes requested, resubmit, approve.
- Timesheet: submit; the lock refuses task time and corrections; changes requested unlocks the week; approval locks it again.
- Board: MFA required.
- HR dashboard: no names in the response.
- Regressions: renaming a shift or a project keeps the other fields.

**End-to-end journey**, a remote day without the agent, now end to end:
1. Ravi asks to work from home and Maya approves.
2. Maya sets him a task that needs approval.
3. Ravi works from home and times the task. A break stops the timer and he restarts it after.
4. He sends the task for review, then submits his daily report and his timesheet.
5. Maya approves the report and the timesheet and marks the task done.
6. HR sees the board (no open tasks) and the Remote work dashboard, with no names on it.

## 10. Documentation
README (status), Swagger, this record, screenshots in `docs/sprints/sprint-09/`.

## 11. Review
**Problems found and fixed during the sprint**
1. **Editing could silently reset fields (since Sprint 4).**
   - Zod 4's `.partial()` keeps `.default()` values, so a PATCH that left out a field with a default reset that field.
   - Affected: shifts (grace minutes), overtime rules (`requiresApproval`), leave types (paid, negative balance), work schedules (grace), **payroll components** (`isActive`, `taxable`, rounding, display order), and this sprint's projects and tasks.
   - The web forms usually send every field, which is why it didn't show in the UI tests; API callers and partial edits were affected.
   - All PATCH schemas now use `patchOf()`. A unit test checks every Patch schema, and integration tests check renaming a shift and a project.
   - **Data already in the database is not changed**: the bug only affected later edits, not stored records. We can't tell from the data whether an earlier edit reset a value, so I recommend HR glance over their shifts, leave types and payroll components.
2. **A real but very short week couldn't be submitted** ("no work recorded") because every total rounded to zero minutes. The rule is now "no sessions and no task time".
3. **Inboxes could show an old list for up to 10 seconds** after coming back to them (the app's cache). Approval inboxes and task details now always reload when opened.
4. **A test command masked a formatting failure** (its exit code was hidden by a pipe), so one commit had an unformatted test file. It was fixed in the next commit. CI checks formatting on its own, so this could not have reached `main`.

**Deviations**
| Plan | Now | Reason |
|---|---|---|
| Task attachments (`/tasks/:id/attachments/upload-url`) | Not included | They need the scanned-upload path; planned with files and notifications in Sprint 12 |
| "Daily report auto-generated" by a nightly job | Generated live whenever opened, frozen when submitted | Always current; no stale drafts, nothing to schedule |
| Manager board as a new page | Built into Team status (same route) | One page for the manager instead of two near-copies |

**Known limits**
- A timesheet's "worked" is session time; task time is shown beside it, and the difference shows as "not on a task". There is no billable-hours report yet.
- People who are on a project but not assigned to a task can see it but can't time it.
- Notifications for reviews arrive with the notification centre.

**Demo steps**
1. Tasks → Projects (as HR): create a project and add members. Tasks → New task: assign it to a team member, with "Someone must approve the result".
2. As the employee: My work → Start work → Task timer → Start timer. Take a break (the timer stops), come back and end the session.
3. Tasks → open the task → Send for review. Daily report → notes → Submit report. Timesheet → Submit timesheet.
4. As the manager: Approvals → Daily work reports and Timesheets → Approve. Tasks → My team → Mark done.
5. As HR with two-step verification: Work → Team status and Remote work.

## 12. Approval
Approved by the owner on 2026-11-28; merged to `main` through a pull request after CI passed.
