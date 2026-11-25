# Sprint 3 — Multi-tenancy & company setup

Status: **Complete, awaiting owner approval** · Date: 2026-11-25

## 1. Objectives
A company can describe itself and its structure, bring people in with the right roles, and manage access safely. Every tenant-scoped route is proven to be isolated from other companies by a generated test suite.

## 2. Scope
**In:**
- Company profile.
- Legal entities, branches, departments (a tree, with cycle protection), designations, teams, work schedules, holiday calendars with holidays, and an org chart.
- Members: invite by email (new or existing users), accept, change roles, suspend, reactivate, remove, force sign-out, cancel invitation.
- Roles: list, permission catalog, custom roles, a permission matrix with scopes, delete.
- Company switching.
- The generated cross-tenant suite (Phase 3, ST-01/ST-02).
- Frontend Settings area: Company, Organization, Members, Roles, the accept-invitation page, and a company switcher.

**Out:** employees and the people in the org chart (Sprint 4), plus importing public holiday sets (data source still to be chosen).

## 3. Dependencies
Sprints 1–2. No schema changes were needed.

## 4. Database changes
None (Phase 4 schema). Org units are **hard-deleted**, guarded by RESTRICT foreign keys: a unit still in use returns `409 in_use`. Soft delete stays reserved for people records (Sprint 4), where history matters.

## 5. API design (all in Swagger)
| Area | Routes | Access |
|---|---|---|
| Company | `GET/PATCH /companies/current` | read: signed in · write: `company.profile.manage` |
| Org units | `GET/POST /companies/{legal-entities,branches,departments,designations,teams,work-schedules,holiday-calendars}` and `GET/PATCH/DELETE …/{id}` (list: `?limit&cursor&q`) | read: signed in · write: `company.org.manage` (legal entities: `company.profile.manage`) |
| Holidays | `GET/POST /companies/holiday-calendars/{calendarId}/holidays`, `DELETE …/{id}` | as above; date must fall in the calendar year |
| Org chart | `GET /companies/org-chart` | signed in |
| Members | `GET /tenants/members`, `POST /tenants/invitations`, `DELETE /tenants/invitations/{id}` | `members.invite` |
| Member admin | `PUT /tenants/members/{id}/roles`, `POST …/{id}/suspend`, `POST …/{id}/reactivate`, `POST …/{id}/sign-out`, `DELETE /tenants/members/{id}` | `roles.manage` (sensitive → MFA session) |
| Roles | `GET /tenants/roles`, `GET /tenants/permissions` · `POST /tenants/roles`, `PATCH/DELETE /tenants/roles/{id}` | `members.invite` · `roles.manage` |
| Auth additions | `GET /auth/memberships`, `POST /auth/switch-tenant` · `POST /auth/invite-info`, `POST /auth/accept-invite` | signed in · public (rate-limited) |

76 routes are declared in total. The API refuses to start if any route lacks an access declaration.

## 6. Backend implementation
- `lib/crud.js` provides list (cursor pagination and search), get, create, update and delete for a tenant model, with audit records, `409 duplicate` and `409 in_use`, and OpenAPI entries.
- `modules/company/` has the profile, org units, holidays and org chart, plus department cycle detection.
- `modules/members/` holds the invitation, role, status and sign-out flows, with these guard rails:
  - nobody changes their own roles or status, or edits a role they hold;
  - only `roles.manage` on an MFA-verified session can grant roles with sensitive permissions;
  - the last active Company Admin can't be demoted, suspended or removed;
  - the Company Admin role is locked, and built-in roles can't be deleted;
  - every Company Admin is emailed when sensitive access is granted;
  - permission changes take effect on the member's next request (the access cache is invalidated).
- Invitations are signed, 7-day tokens. Accepting one moves the membership out of INVITED, so a token works once. It also confirms the email address. New people set their name and password at that point; existing users just sign in afterwards.
- Switching company starts a new session for the target company and ends the current one. MFA state carries over.
- The route registry now reports full mount paths, which the generated suite needs.

## 7. Frontend implementation
- `ResourceSection`, a config-driven table with an inline add/edit form, search, two-step delete, and loading, empty and error states. It powers the six org resources and legal entities.
- Company page (profile and legal entities).
- Organization page with tabs (branches, departments, designations, teams, work schedules, holidays).
- Members page (invite with a role picker that flags sensitive roles, role editor, and suspend / sign-out / remove / cancel with an extra confirmation click).
- Roles page (cards, plus a permission matrix grouped by module with a scope selector per permission).
- Accept-invitation page.
- A company switcher in the sidebar, and Settings links shown according to permissions.

Screenshots: [`sprint-03/s3-organization.png`](sprint-03/s3-organization.png), [`sprint-03/s3-members.png`](sprint-03/s3-members.png), [`sprint-03/s3-roles.png`](sprint-03/s3-roles.png).

## 8. Desktop agent
Not in this sprint.

## 9. Tests (results copied from runs on 2026-11-25)
| Suite | Result |
|---|---|
| Unit — shared (21), backend (53), worker (10), frontend (14) | 98 passed |
| Integration — company & org (11) | passed |
| Integration — members, invitations, roles, switching (11) | passed |
| **Integration — generated cross-tenant suite** (4): every `/:id` route from the live registry, called by another company's MFA-verified admin with this company's IDs → all **404**. Lists never contain the other company's IDs. Records can't point at another company's rows (422). Data is unchanged afterwards. Unmapped new routes fail the suite. | passed |
| Integration — auth (29, from Sprint 2) + worker queue (1) | passed |
| **Mutation check:** tenant scoping on reads switched off on purpose | cross-tenant suite failed (4/4), as it should; code restored |
| End-to-end (Playwright, real email): the owner builds departments (incl. a sub-department and a duplicate-code error) and a branch in the UI, invites an employee, and the employee accepts from the email, signs in, and sees the org read-only with no admin pages. The 2 auth journeys from Sprint 2 also pass. | 3 passed |
| Lint, no-TypeScript, syntax, format, frontend build | pass |

## 10. Documentation
Swagger (all new routes), this record. The README needs no setup changes.

## 11. Review
**Issues found during the sprint**
1. **Route paths:** the route registry reported paths without their mount prefix. Fixed, because the generated suite builds real URLs from it.
2. **Zod 4 and partial schemas:** Zod 4 rejects `.partial()` on refined schemas. The work-schedule schema is now a base shape plus a shared check.
3. **Test-only bugs:** mixed-case test emails (the API correctly lowercases them), a wrong audit expectation, and ambiguous E2E selectors. These were fixed in the tests, not the app.

**What the mutation test showed:** composite foreign keys stop cross-tenant *writes*, but reads are protected only by the tenant-scoping Prisma extension. The generated suite now guards both.

**Known limits**
- People in the org chart, department heads and team leads arrive with employees in Sprint 4. The columns exist; the UI doesn't set them yet.
- Holiday calendars are entered manually. Importing public holidays per country needs a chosen data source.
- Work schedules are edited as "days + one start/end time" in the UI. The API already supports a different time per day.
- The E2E suite still runs locally only. A CI job with the full stack will be added once the GitHub repository exists.
- **The workspace is still not in a git repository.**

## 12. Approval
Pending.
