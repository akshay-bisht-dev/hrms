# 02 — Database Design (implemented and verified)

The schema is no longer only a diagram. It exists as Prisma files and an initial migration, and it was tested against a real MySQL 8.4 server.

| Item | Location |
|---|---|
| Prisma schema (multi-file, 132 models, 89 enums) | `apps/backend/prisma/schema/*.prisma` |
| Prisma config (JavaScript, no TypeScript) | `apps/backend/prisma.config.mjs` |
| Initial migration (132 tables, 196 foreign keys, 16 triggers) | `apps/backend/prisma/migrations/20261125000000_init/migration.sql` |
| Database smoke checks | `apps/backend/prisma/checks/db-smoke.mjs` |

## 1. Verification performed (2026-11-25)

| Check | Result |
|---|---|
| `prisma validate` (Prisma 7.10.1) | Valid |
| `prisma generate` with `prisma-client-js` | Plain JavaScript client generated; no `.ts` output (closes risk R3) |
| `prisma migrate deploy` on MySQL 8.4.13 (fresh database) | All tables and triggers applied |
| Smoke checks through the generated client + `@prisma/adapter-mariadb` | 14 / 14 pass (below) |

Smoke checks:
1. Employee in tenant B cannot reference tenant A's legal entity (composite FK).
2. Task in tenant B cannot be assigned to tenant A's employee (composite FK).
3. `DECIMAL(19,4)` money round-trips exactly (`1234567.8912`).
4. Finalized payroll: line update blocked.
5. Finalized payroll: new line insert blocked.
6. Finalized payroll: employee net-pay update blocked.
7. Finalized payroll: status back to `DRAFT` blocked.
8. Finalized payroll: `FINALIZED → PAID` allowed.
9. Paid run: delete blocked.
10. Audit log: update blocked.
11. Audit log: delete blocked.
12. Second active work session for the same employee blocked.
13. Duplicate session event with the same idempotency key blocked.
14. Session event update blocked.

## 2. Table catalogue

| File | Models | Tables |
|---|---|---|
| `01-platform.prisma` | 18 | `users`, `platform_admins`, `refresh_tokens`, `mfa_factors`, `recovery_codes`, `auth_tokens`, `permissions`, `plans`, `plan_prices`, `country_profiles`, `currencies`, `fx_rates`, `statutory_rule_packs`, `statutory_rule_versions`, `jurisdiction_policies`, `public_holiday_sets`, `feature_flags`, `payment_webhook_events` |
| `02-tenancy.prisma` | 14 | `tenants`, `tenant_memberships`, `roles`, `role_permissions`, `membership_roles`, `break_glass_grants`, `subscriptions`, `invoices`, `usage_snapshots`, `audit_logs`, `outbox_events`, `idempotency_records`, `notifications`, `message_templates` |
| `03-organization.prisma` | 12 | `legal_entities`, `branches`, `departments`, `designations`, `teams`, `team_members`, `work_schedules`, `holiday_calendars`, `holidays`, `company_policies`, `policy_acknowledgements`, `announcements` |
| `04-employee.prisma` | 10 | `employees`, `employment_records`, `employee_hierarchies`, `employee_documents`, `employee_bank_accounts`, `emergency_contacts`, `bulk_import_jobs`, `approval_steps`, `data_subject_requests`, `helpdesk_tickets` |
| `05-attendance.prisma` | 6 | `shifts`, `shift_assignments`, `overtime_rules`, `attendance_punches`, `attendance_days`, `attendance_regularizations` |
| `06-leave.prisma` | 6 | `leave_types`, `leave_policies`, `leave_policy_assignments`, `leave_ledger_entries`, `leave_requests`, `leave_request_days` |
| `07-payroll.prisma` | 14 | `salary_components`, `salary_structures`, `salary_structure_components`, `employee_salaries`, `employee_salary_lines`, `tenant_statutory_settings`, `payroll_periods`, `payroll_runs`, `payroll_run_employees`, `payroll_lines`, `payroll_inputs`, `payslips`, `tax_declarations`, `fnf_settlements` |
| `08-recruitment.prisma` | 7 | `job_requisitions`, `job_postings`, `candidates`, `job_applications`, `interviews`, `interview_feedbacks`, `offers` |
| `09-onboarding.prisma` | 6 | `onboarding_templates`, `onboarding_template_tasks`, `onboarding_cases`, `onboarding_tasks`, `onboarding_documents`, `assets` |
| `10-performance.prisma` | 6 | `performance_cycles`, `goals`, `performance_reviews`, `review_responses`, `feedback_requests`, `development_plans` |
| `11-work-status.prisma` | 33 | `work_locations`, `work_policies`, `wfh_requests`, `work_sessions`, `employee_active_sessions`, `work_session_events`, `work_breaks`, `idle_records`, `work_activity_summaries`, `work_corrections`, `monitoring_activations`, `screenshot_policies`, `monitoring_acknowledgements`, `monitored_devices`, `device_pairing_codes`, `device_sessions`, `screenshot_records`, `screenshot_skips`, `screenshot_access_logs`, `screenshot_disputes`, `privacy_incidents`, `application_categories`, `approved_applications`, `application_usage_records`, `projects`, `project_members`, `tasks`, `task_assignments`, `task_comments`, `task_attachments`, `task_time_entries`, `daily_work_reports`, `timesheet_approvals` |

All 23 Work Status tables required by the brief are present, plus 10 supporting tables (active-session lock, monitoring governance, pairing codes, skips, disputes, privacy incidents, project members, task comments and attachments).

## 3. Conventions as implemented

| Topic | Implementation |
|---|---|
| IDs | `CHAR(36)` UUIDv7 generated in the application (`uuid` v7) |
| Tenant scope | `tenant_id` on every tenant-owned table, `UNIQUE(tenant_id, id)`, composite FKs `(tenant_id, x_id) → parent(tenant_id, id)` |
| FK actions | `ON DELETE RESTRICT` by default; `CASCADE` only for pure child rows (role permissions, request days, breaks, comments, etc.); `ON UPDATE RESTRICT` everywhere (IDs never change) |
| Names | camelCase in JavaScript, snake_case in MySQL via `@map` / `@@map` |
| Money | `DECIMAL(19,4)` + `CHAR(3)` currency; rates `DECIMAL(9,6)`; FX `DECIMAL(19,10)`; leave quantities `DECIMAL(8,2)` |
| Time | `DATETIME(3)` in UTC; business dates as `DATE` |
| Encrypted fields | `VARBINARY(512)` (`*_enc`), with a separate `CHAR(64)` blind index where uniqueness is needed (`national_id_index`) |
| Actor references | `created_by`, `approved_by`, `decided_by` and similar are plain IDs **without** FKs. They are historical facts, they point at users (who may be removed) or at employees in another role, and the audit log is the authoritative record |
| Immutability | 16 triggers (append-only logs, finalized payroll, payslips) in the init migration; errors start with `IMMUTABLE:` so the API maps them to HTTP 409 |
| Polymorphic approvals | `approval_steps(entity_type, entity_id)` without an FK; integrity checked by each module's service and a nightly consistency job |

## 4. Decisions and changes compared with Phase 1

1. **Prisma 7.10.1, pinned.** Uses `prisma-client-js` (JavaScript output), `prisma.config.mjs`, and the `@prisma/adapter-mariadb` driver adapter, which Prisma 7 needs for MySQL. Prisma 8 is a release candidate today and will be evaluated after it is stable.
2. **`work_session_events` keeps its foreign key for now.** MySQL partitioned tables can't have FKs, so the event and audit tables will be partitioned only when volume needs it (expected above ~100 M rows). That change needs an expand/contract migration and is noted in the scalability plan. `audit_logs` already has no FKs.
3. **Current employment snapshot on `employees`** (`department_id`, `designation_id`, `branch_id`, `manager_id`). These are kept in the same transaction as `employment_records` for fast directory and scope queries. History stays in `employment_records`.
4. **Idempotency for leave accruals** comes from `UNIQUE(tenant_id, employee_id, leave_type_id, entry_type, period_key)`. A rerun of the same monthly accrual is a no-op.
5. **`application_usage_records.approved_app_id` is required.** Unclassified usage is recorded against a per-tenant system app called "Other", so buckets stay unique and no window titles or URLs are stored.

## 5. How to change the schema (from Sprint 1)

1. Edit `prisma/schema/*.prisma`.
2. Run `npx prisma migrate dev --name <change>` locally (MySQL in Docker).
3. Add hand-written SQL (triggers, CHECKs) to the generated `migration.sql` if needed.
4. CI applies all migrations to an empty database and runs the database checks.
5. Production uses expand/contract only (Phase 1, 05 §2.3).
