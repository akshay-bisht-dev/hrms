# Sprint 10 — Desktop agent and screen monitoring

Status: **Awaiting approval** · Date: 2026-11-28 · Branch: `sprint-10/desktop-agent`

## 1. Objectives
A desktop app (Electron 45, JavaScript) that runs work sessions from the computer and, **only where a company switched it on and told its employees**, takes disclosed screenshots. Everything about monitoring is governed, visible to the person, logged, and fails closed.

## 2. Scope
**In:**
- **Governance (off by default):**
  - A versioned **activation checklist**: purpose, lawful basis, scope, notice text and start date, viewer roles, retention (7–90 days), privacy and complaints contacts, review date, the steps each work country requires, and confirmation that the company took its **own legal advice**.
  - A completed checklist can't change; a change is a new version. It can be paused at once for everyone.
- **Jurisdiction registry (fail closed):**
  - Monitoring applies to a person only if their work country's entry allows it and its steps are recorded as done.
  - A country with no entry, or marked unknown or not allowed, stays off.
  - Four **provisional** entries are seeded (India, UK, US, Germany), **marked "not legally reviewed"** everywhere they appear (see §11).
- **Per-person gate.** All of these must hold:
  - the notice start date and the country's minimum notice period have both passed,
  - the person is in scope,
  - an enabled screenshot policy applies,
  - the person **acknowledged this version of the notice**.
- **Screenshot policies:**
  - Versioned and targeted. Interval 5–240 minutes with jitter, capture mode, retention up to the checklist's maximum.
  - A default list of excluded apps (password managers, messaging).
  - Whether people may delete their own screenshots.
  - **Application activity can never be switched on** (refused by validation and by a database CHECK).
- **Devices:**
  - One-time pairing codes: 8 characters, 10 minutes, stored hashed.
  - Device access tokens: 10 minutes, their own audience.
  - Refresh tokens: OS-encrypted on the device; they rotate on every use, and **reusing an old one revokes the whole family**.
  - Administrator approval for new computers (on by default); revocation takes effect on the next call.
  - **People can disconnect their own computers.**
  - Screenshots only on company computers unless the checklist allows personal ones (personal computers still get session tracking).
- **Agent API:** sessions run through the same work-session service as the web app, recorded as coming from the desktop agent and the device. Heartbeat, breaks, idle, end.
- **Screenshot pipeline:**
  - **The server approves every capture**: approved device, monitoring on for the person, current policy version, a session that is running and connected, not faster than the interval.
  - Upload goes straight to private storage through a **60-second** link.
  - The worker verifies size, WebP signature, hash and that the image decodes; it re-encodes without metadata, applies blur (again) and makes a thumbnail. Anything else is rejected and removed.
- **Viewing:**
  - Owners always see their own.
  - Others need `view_team_screenshots` with MFA, the person in their scope, **and** a viewer role named in the checklist. Managers have no access by default.
  - Views go through 60-second links, and **every view, download and deletion is in the access log**, which the person can see ("who looked at it").
  - Downloads need `download_screenshots` and are **watermarked**.
- **Disputes:** the person flags a screenshot and it is **hidden from viewers at once**. Someone else resolves it: restore, delete, or restore and correct time.
- **Privacy incidents:** anyone can report one. Deleting the named screenshot is the default resolution.
- **Retention:** a nightly job deletes images and keeps a metadata tombstone. Disputed images wait for the outcome, and unfinished uploads expire.
- **Desktop app (`apps/agent`):**
  - **Isolation:** sandboxed, context-isolated window with a narrow preload API; IPC only from its own page, with checked payloads.
  - **Restrictions:** strict CSP, no navigation, no pop-ups, all permission prompts denied, single instance, OS sandbox on every process.
  - **Visibility:** tray icon always present with "Monitoring ON — next screenshot ~HH:MM"; OS notifications when monitoring starts or stops; break and end from the tray.
  - **What it reads:** idle comes from system idle time only (**no keyboard or mouse hooks**); lock and suspend stop capture at once.
  - **Exclusions:** checked against the app in front. **If the app in front can't be determined, nothing is captured.**
  - **Capture:** the primary display as WebP of at most 2 MB, with blur applied on the device.
  - **Revocation** wipes credentials and stops everything.
- **Web app:**
  - On My work, a monitoring card: whether it applies and the exact reason why not, the notice to acknowledge, connecting the app, and your computers.
  - **My screenshots:** each day, who looked at each one, disputes, and privacy reports.
  - **Screenshot review** for permitted viewers.
  - **Settings → Monitoring:** countries, the checklist, policies, computers, disputes and incidents.

**Out (later sprints):**
- **Sprint 11:** signing and notarization, auto-update, Electron fuses, packaged installers.
- **Not offered:** the "active window only" mode. Electron can't reliably isolate the focused window, so a policy using it captures nothing.
- **Not offered:** application-activity reports.
- **Not offered:** replaying heartbeats queued offline. Replayed time would not count anyway (Phase 1 §5.6); the server records the gap, and the person can ask for a correction.

## 3. Dependencies
- Work sessions (Sprint 8).
- Roles: `manage_monitoring_policy`, `view_team_screenshots`, `download_screenshots`, `audit.log.view` — held only by Company Admin by default.
- Private S3 storage (Sprint 4).

## 4. Database changes
- **Migration `20261201000000_monitoring`:** CHECK constraints:
  - screenshot interval 5–240 minutes, jitter 0–50%, retention 1–90 days, **no activity tracking**;
  - a company policy has no target;
  - policy date order;
  - activation retention 7–90 days, and a completion time required unless the checklist is a draft;
  - screenshot size up to 2 MB, and deletion state consistent with the deletion date;
  - pairing-code attempts.
- The screenshot access log is append-only (trigger, since Sprint 1).
- Seed: the provisional jurisdiction registry. Entries are created once and never edited; a change is a new version.

## 5. API design (42 new operations; 312 documented in total)
**`/api/v1/monitoring`**
- `/me`: whether monitoring applies to you; acknowledge the notice.
- `/jurisdictions`: what each country allows.
- `/activations`: list, draft, change, complete, pause, resume.
- `/policies`: list, create, versions.

**`/api/v1/devices`**
- `/pairing-codes`
- `/register` and `/token/refresh`: public, rate-limited.
- `/me`: your computers, and disconnect.
- Admin: list, approve, revoke.

**`/api/v1/agent`** (device token only)
- `/me` and acknowledge.
- Sessions: start, heartbeat, break, idle, end.
- Screenshots: slots, confirm, skips.

**`/api/v1/screenshots`**
- List.
- `/{id}/view-url`, download, delete, disputes.
- Dispute and incident resolution.
- Access logs.

## 6. Backend implementation
- `modules/monitoring/`:
  - `governance.service.js`: `monitoringFor()` is the single gate used by the web app, the agent and capture.
  - `devices.service.js`, including the `deviceAccess()` route guard.
  - `screenshots.service.js`
  - `monitoring.routes.js`
- Worker: `screenshots` queue (verify each upload; daily retention fanned out per company).
- Work service: events and clock-ins from the agent carry `DESKTOP_AGENT` and the device; the request context now records IP and user agent for access logs.
- The cross-tenant suite skips device routes (they take a device token) and covers them in a dedicated test.

## 7. Frontend implementation
- `MonitoringCard` on My work.
- `ScreenshotPages`: My screenshots and Screenshot review. Thumbnails are loaded through fresh 60-second links, and each load is logged.
- `MonitoringSettingsPage`.
- Navigation: Screenshot review (`view_team_screenshots`) and Settings → Monitoring (`manage_monitoring_policy`).

## 8. Desktop agent
`apps/agent`:
- `src/main/main.js`: the Electron main process.
- `src/main/core/`: testable logic.
  - `policy.js`: allowlist, preconditions, jitter.
  - `api.js`: tokens, refresh, revocation, HTTPS-only.
  - `controller.js`
- `src/main/platform.js`: capture, the app in front, device facts, encrypted token store.
- `src/preload/preload.cjs`
- `src/renderer/`: status window, built with DOM nodes only (`innerHTML` is banned by lint).

Run with `npm start -w apps/agent` (README). Linux needs `xdotool`.

## 9. Tests (results copied from runs on 2026-11-28)
| Suite | Result |
|---|---|
| Unit: shared 30, payroll 15, backend 130, worker 17 (screenshot processing and retention fan-out), **agent 11**, frontend 29 | **232 passed** |
| Integration: monitoring (20, real MySQL, Redis and S3), see below | passed |
| Integration: cross-tenant suite, now covering every monitoring, device and screenshot `:id` route and 9 lists, plus a dedicated test that a device of company B can't confirm, skip or acknowledge against company A | passed (**183** backend integration tests) |
| Database invariants (`db-smoke`, fresh database) | **45/45** pass (4 new) |
| End-to-end: **with the real desktop app** (Electron driven by Playwright under Xvfb), see below; plus the 8 earlier journeys | **9 passed**, 3 consecutive full runs |
| Docker: backend and worker images build; the image library and the screenshot service load and encode inside the worker image | pass |
| Lint, format, no-TypeScript, syntax, frontend build | pass |

**Agent unit tests (11)** check that capture happens only after the server issues a slot. They also check that nothing is captured when:
- the server says no,
- the person is on a break,
- the app in front is excluded or unknown,
- the screen is locked,
- the computer is idle.

They also cover:
- skips carry a reason only;
- idle comes from system idle time;
- revocation stops everything;
- a break cancels the pending capture first;
- only allowlisted policy fields survive (no commands or URLs from the server).

**Monitoring integration tests (20)** cover:
- Monitoring off by default.
- Checklist completion refused until country steps and the legal-advice confirmation are done.
- The UAE staying off (fail closed); India waiting for its notice period.
- Policy limits, including activity tracking refused.
- Acknowledgement; pause stops everyone at once.
- Pairing with a single-use code; new computers pending.
- Device and web tokens not interchangeable.
- Refresh rotation and **reuse revoking the family**; re-pairing.
- Capture refused while pending or without a session.
- An agent session recorded as `DESKTOP_AGENT`.
- An outdated policy refused; upload, verification and metadata stripped; too-soon refused.
- A wrong file type rejected and removed; a revoked device refused at once.
- Owner, manager and outsider visibility; views logged.
- Downloads: permission required, watermarked.
- Disputes hide the screenshot; self-resolution refused.
- Deletion only as policy allows, logged; the access log can't be deleted.
- Incidents.
- Retention tombstones.
- Ending the session stops capture.

**End-to-end journey with the real desktop app:**
1. HR completes the checklist in the web app (refused once without the legal-advice confirmation) and creates a 5-minute policy.
2. The employee reads and acknowledges the notice and gets a pairing code.
3. The desktop app pairs and waits for approval; HR approves the computer.
4. The employee starts work in the app: monitoring turns ON and a **real screenshot is captured, uploaded, verified and processed by the worker**.
5. A break turns monitoring OFF; ending the session leaves it off.
6. HR views the screenshot in Screenshot review.
7. The employee sees it, sees that **someone else** looked at it, and disputes it.

## 10. Documentation
README (the desktop app, the E2E display requirement, troubleshooting), Swagger, this record, screenshots in `docs/sprints/sprint-10/`.

## 11. Review
**Decisions you should know about**
1. **The jurisdiction rules are provisional and not legally reviewed.** India, UK, US and Germany are seeded with conservative steps, notice periods and retention limits, and every screen marks them "Provisional". Other countries stay off. The company must also confirm its own legal advice before activation. **Before selling monitoring, a lawyer must review the registry** (the same position as the India payroll pack).
2. Monitoring is **off by default at every level**. Managers get no screenshot access unless the checklist names a role they hold *and* they have the permission with MFA *and* the person is in their scope.

**Problems found and fixed during the sprint**
1. **Zod 4 enum records require every key**, so recording only one country's two steps was rejected. It now uses a partial record (caught by an integration test).
2. **A rejected upload broke a database rule** (INVALID with a deletion date). Rejected uploads now stay INVALID without one, and only real deletions are DELETED.
3. **The checklist page lost track of its own draft** after a refused "Complete", then failed with "open draft exists". It now asks the server for the current draft each time (caught by the E2E test).
4. **After revocation the agent still reported monitoring ON** from its last server answer. It now forgets everything on revocation (caught by an agent unit test).
5. **The agent ignored clicks made while an action was running.** Buttons now show as disabled instead (caught by the E2E test).
6. **The agent showed the web app's disclosure** ("open in your browser") and didn't mention idle reporting. It now has its own accurate list.
7. **Fixed test IDs collided across runs** of the integration suite; they are generated now.
8. **The first Electron version chosen (39.8.10) had two high-severity advisories:** popup windows not inheriting sandbox restrictions, and a path traversal in its installer's unzip library. `npm audit` caught them before merge. The app now uses **Electron 45.3.2** (released over two weeks ago), and the whole suite, including the real-app journey, was re-run on it.

**Deviations**
| Plan | Now | Reason |
|---|---|---|
| Presigned **POST** with a 2 MB limit | Presigned PUT, size enforced by the worker (over 2 MB is rejected and deleted) | The storage helper uses PUT; the result for the person is the same |
| "Active window only" capture | Not captured at all when chosen | Electron can't reliably isolate the focused window; never falling back to full screen is the safe choice |
| Offline queue (72 h) | Not replayed | Replayed heartbeats would not count; the server records the gap and corrections cover it |
| Electron fuses, signing, auto-update | Sprint 11 | Part of packaging and signing |

**Known limits**
- **Production CSP:** the web app's `img-src` must include the screenshots bucket host so images can show (to set in Sprint 11 deployment, when the host is known). Development has no CSP.
- **Linux:** screenshots need X11 and `xdotool`; Wayland is not supported. macOS needs Screen Recording and Accessibility permission.
- **Multiple monitors:** only the primary display is captured.
- **`npm audit`:** the same 18 moderate dev-only advisories as before; **none high** (`--audit-level=high` passes).

**Demo steps**
1. As HR: Settings → Monitoring → Checklist; fill it in, tick your country's steps and the legal-advice confirmation; Complete. Then Screenshot policies → New policy.
2. As an employee: My work → read the notice → "I have read and understood" → Connect the desktop app.
3. Run the desktop app (`npm start -w apps/agent`), enter the code. As HR: Monitoring → Computers → Approve.
4. In the app: Start work. The tray says "Monitoring ON". Take a break, and it turns OFF.
5. As HR: Work → Screenshot review. As the employee: My screenshots → who looked at it → Dispute.

## 12. Approval
Waiting for the owner's approval.
