# Sprint 4 — Employee management

Status: **Approved** · Date: 2026-11-25 · Branch: `sprint-04/employees`

## 1. Objectives
Give every company a reliable record of its people: profiles, job history, reporting lines, documents, bank details and emergency contacts. Everyone sees exactly what their role and position allow, and large teams can be brought in by CSV.

## 2. Scope
**In:**
- Employee profiles with auto-numbered codes and a status lifecycle.
- Effective-dated employment history: transfers, promotions, manager changes.
- A reporting hierarchy (closure table) with loop protection.
- Data scopes (own, team, department, branch, legal entity, company) applied to every read and write.
- Self-service edits; encrypted national IDs with masking and audited reveal; emergency contacts.
- Encrypted bank accounts (last 4 digits only).
- Documents in private S3 with presigned upload/download and worker type-checking.
- CSV import through the worker (row-by-row results, safe re-runs) and CSV export with formula-injection protection.
- Linking a sign-in account to an employee record.
- Frontend: directory, add employee, profile with tabs, import page, My profile, invite-to-sign-in.

**Out:**
- Future-dated job changes (rejected with a clear message for now).
- Malware scanning of documents (FILE-03). The worker step that runs it is in place, but ClamAV itself is not yet.
- People in the org chart view.

## 3. Dependencies
Sprints 1–3. Local S3-compatible storage (SeaweedFS) from Docker Compose. Buckets are created with `npm run storage:init -w apps/backend`.

## 4. Database changes
None (Phase 4 schema). Uses `employees`, `employment_records`, `employee_hierarchies`, `employee_documents`, `employee_bank_accounts`, `emergency_contacts`, `bulk_import_jobs`, and `tenant_memberships.employee_id`.

## 5. API design (`/api/v1/employees`, all in Swagger; 104 routes in total now)
| Route | Access |
|---|---|
| `GET /` (filters: q, status, department, branch, manager, includeExited; cursor pages) · `GET /:id` · `GET /me` | signed in; filtered to `employee.profile.view` scope, always including yourself |
| `POST /` | `employee.profile.create` |
| `PATCH /:id` | `employee.profile.update` in scope, or yourself for preferred name / personal email / phone |
| `GET /:id/national-id` | `employee.sensitive.view` (sensitive → MFA; audited) |
| `GET/POST /:id/employment-records`, `POST /:id/status` | view scope / `employee.profile.update` |
| `GET/POST /:id/emergency-contacts`, `DELETE …/:childId` | view scope; edit by HR or yourself |
| `GET /:id/bank-accounts` · `POST` | yourself or `payroll.bank.view` · `payroll.bank.manage` (both sensitive → MFA) |
| `GET /:id/documents`, `POST …/upload-url`, `POST …/:childId/complete`, `GET …/download-url`, `DELETE` · `POST …/verify` | yourself or `employee.documents.view/manage` · `employee.documents.manage` |
| `GET /export` | `employee.bulk.export` (sensitive) |
| `GET /imports/template`, `POST /imports/upload-url`, `POST /imports`, `GET /imports`, `GET /imports/:id`, `GET /imports/:id/result-url` | `employee.bulk.import` |
| `PUT /tenants/members/:id/employee` | `roles.manage` (links a sign-in to a record) |

## 6. Backend implementation
- `modules/employees/scope.js` turns a permission's scope into a database filter. TEAM uses the closure table and includes the person themselves. Out-of-scope records return 404.
- `hierarchy.js` inserts rows for a new employee, detects loops, and moves a whole sub-team in one transaction when someone's manager changes.
- `employees.service.js`:
  - **create:** defaults come from the legal entity; codes are allocated E00001…; status defaults to PREBOARDING for future joiners and PROBATION when a probation date is given; the first employment record is written at the same time.
  - **job changes:** closes the previous record the day before and updates the snapshot on the employee row.
  - **status lifecycle:** EXITED is final, requires direct reports to be moved first, and suspends the person's sign-in and signs them out.
  - **national IDs:** checked against the country profile, encrypted (AES-GCM, with the employee ID as associated data), and given an HMAC blind index so duplicates are refused.
  - **bank accounts:** account numbers are encrypted; a new account closes the previous one.
  - **documents:** presigned 60-second PUT/GET, attachment downloads, tenant-prefixed keys that never contain the user's file name.
- `imports.js`:
  - parses with `csv-parse`;
  - resolves references by code or name;
  - makes several passes so a manager can appear later in the same file;
  - the same file (by SHA-256) can't be imported twice, and rows whose employee code already exists are skipped, so a retried job never creates duplicates;
  - row-by-row results go to the private reports bucket.
- `verify-document.js` (worker) checks the real file type from its bytes with `file-type`, enforces the size limit, and deletes mismatched files.
- `lib/storage.js` is the S3 client, presigning and the key builders.
- The worker runs `files` and `imports` queue processors inside each job's tenant context.

## 7. Frontend implementation
- **Employees directory:** search, department and status filters, "show people who left", pages, export, import and add buttons according to permission.
- **Add employee** form.
- **Employee profile** tabs: Profile (self-service limits explained, masked ID with reveal, sign-in status and *Invite to sign in*), Job & history (timeline, record a change, change status), Emergency contacts, Documents (upload straight to storage, live "checking → ready", download, verify, delete), and Bank (masked).
- **Import page:** template, upload, live status, row-by-row result download. The directory refreshes automatically when an import finishes.
- **My profile** link.

Screenshots: [`sprint-04/s4-directory.png`](sprint-04/s4-directory.png), [`sprint-04/s4-profile-job.png`](sprint-04/s4-profile-job.png).

## 8. Desktop agent
Not in this sprint.

## 9. Tests (results copied from runs on 2026-11-25)
| Suite | Result |
|---|---|
| Unit — shared 27, backend 63 (incl. CSV formula guard, download headers, object keys), worker 10, frontend 14 | **114 passed** |
| Integration — employees (20, real MySQL + Redis + S3): defaults and codes; status defaults; duplicates; national ID format, encryption, masking, reveal and uniqueness; Team Leader / Employee / Department Manager / unlinked scopes; self-service limits; promotion history; manager change moves the sub-team and loops are refused; notice → exit signs the person out; contacts; encrypted bank accounts; document upload → type check → attachment download → verify → delete; a fake PDF is rejected and deleted; import with forward-referenced managers, per-row errors, duplicate-file refusal and idempotent re-run; export formula guard and scope; invitation linking | passed |
| Integration — generated cross-tenant suite: now also covers all 31 new employee/import routes → 404 to another company, nothing leaked in lists, A's data unchanged | passed |
| Integration — auth 29, company 11, members 11, worker queue 1 | passed (76 integration in total) |
| End-to-end (Playwright, real worker + email + S3) — new journey: add employee → promotion → document upload checked by the worker and verified → CSV import → invite to sign in → employee accepts, edits own phone, sees own document, sees only themselves. Plus the 3 earlier journeys. Run twice in a row. | 4 passed, both runs |
| Lint, no-TypeScript, syntax, format, build, `npm audit --audit-level=high` | pass |

## 10. Documentation
README (bucket setup, database URL troubleshooting), `.env.example` (storage settings), CI (SeaweedFS for integration tests), Swagger, this record.

## 11. Review
**Problems found and fixed during the sprint**
1. **MySQL first login after a restart:** MySQL 8's default login method needs TLS or `allowPublicKeyRetrieval=true` for the first connection after a restart. Without it, every query failed with "pool failed to retrieve a connection". Local, Docker and CI URLs now include the option. Production must connect to RDS over TLS (documented).
2. **Ambient AWS credentials:** credentials already present in a shell were being sent to local storage. Local S3 now uses explicit `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`, so a developer's real AWS keys are never used, and local test files never reach a real AWS account.
3. **S3 checksum parameters:** the AWS SDK's default checksum parameters break presigned URLs on S3-compatible storage. They're turned off for local endpoints only.
4. **BullMQ job IDs:** BullMQ rejects job IDs containing ":", which made every document and import request fail with a 500. Fixed, and the test fakes now enforce the same rule. I confirmed the import test fails again if the old ID comes back.
5. **Snapshot column bug:** a job change wrote `scheduleId` to the employee row, which has no such column; the schedule lives only on employment records. Fixed.
6. **Missing invitation link:** inviting someone "for" an employee didn't link the account. An earlier edit had silently not applied; fixed and covered by a test.
7. **UX fixes:** the directory now refreshes after an import finishes; the "Saved." message no longer vanishes; badges and dates no longer wrap.

**Deviations**
| Plan | Now | Reason |
|---|---|---|
| FILE-03 ClamAV scan | File type checked from the bytes, plus size checks and mismatch deletion; ClamAV not yet | ClamAV slots into `verify-document.js`; planned with the AWS setup |
| Future-dated job changes | Refused for now | Needs a daily "apply due changes" job; planned with Attendance (Sprint 5), which needs the same scheduler |
| Import without employee codes | Codes are required in CSV imports | Makes re-runs idempotent (no duplicate people) |

**Known limits**
- The org chart still shows departments and teams only, not people.
- Export is capped at 50,000 rows per file.
- The first CI run on GitHub found the web image build missing the shared package; fixed in `frontend.Dockerfile` before merge.

## 12. Approval
Approved by the owner on 2026-11-25; merged to `main` through a pull request after CI passed.
