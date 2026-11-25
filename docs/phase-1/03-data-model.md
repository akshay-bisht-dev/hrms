# 03 — Database Design & ER Diagrams (MySQL 8.4 + Prisma)

> **Scope update:** global tables (legal entities, country profiles, jurisdiction policies, currencies, FX rates, translations, data-subject requests) are listed in [06 §5](06-global-architecture.md#5-data-model-additions-to-03).

## 1. Conventions

| Topic | Rule |
|---|---|
| Primary keys | UUIDv7 as `CHAR(36)` (`ascii_bin`), generated in app — time-ordered (good index locality), non-enumerable |
| Tenant scope | Every tenant-owned table: `tenant_id CHAR(36) NOT NULL`, `UNIQUE(tenant_id, id)`, composite FKs `(tenant_id, x_id)` |
| Timestamps | `DATETIME(3)` in **UTC**; `created_at`, `updated_at`; business dates (`work_date`, `leave_date`) as `DATE` computed in the tenant/employee timezone |
| Money | `DECIMAL(19,4)` plus `currency CHAR(3)` (ISO 4217); rounding per currency minor units; rates/percentages `DECIMAL(9,6)`; FX `DECIMAL(19,10)`; quantities of days `DECIMAL(6,2)` |
| Soft delete | `deleted_at` on master data (employees, departments, projects, tasks). **Not** on ledgers, events, payroll, audit (append-only) |
| Effective dating | `effective_from DATE NOT NULL`, `effective_to DATE NULL`; no overlaps enforced in service layer inside a transaction with `SELECT … FOR UPDATE` on the parent |
| Versioning | Policies and rule packs: immutable versions (`version INT`), new row per change |
| Immutability | Finalized payroll, audit logs, session events: DB triggers reject `UPDATE/DELETE` (added via custom SQL in Prisma migrations) |
| Enums | Prisma enums → MySQL `ENUM`; tenant-configurable lists are tables |
| Charset | `utf8mb4`, `utf8mb4_0900_ai_ci` |
| Naming | snake_case tables/columns via Prisma `@@map`/`@map`; camelCase in JS |

Things Prisma cannot express (triggers, CHECK constraints, generated columns) live in hand-written SQL inside migration folders and are covered by migration tests.

---

## 2. Domain ER diagrams

### 2.1 Identity, tenancy & RBAC
```mermaid
erDiagram
  users ||--o{ tenant_memberships : has
  tenants ||--o{ tenant_memberships : has
  tenants ||--o{ roles : defines
  roles ||--o{ role_permissions : grants
  permissions ||--o{ role_permissions : in
  tenant_memberships ||--o{ membership_roles : assigned
  roles ||--o{ membership_roles : assigned
  users ||--o{ refresh_tokens : owns
  users ||--o{ mfa_factors : owns
  tenants ||--o{ subscriptions : has
  plans ||--o{ subscriptions : of
  tenants ||--o{ audit_logs : records

  users {

    char36 id PK

    varchar email UK

    varchar password_hash

    bool email_verified

    datetime last_login_at

  }
  tenants {
    char36 id PK
    varchar name
    varchar slug UK
    enum status
    varchar country
    varchar timezone
    char3 currency
  }
  tenant_memberships {
    char36 id PK
    char36 tenant_id FK
    char36 user_id FK
    char36 employee_id FK
    enum status
  }
  roles {
    char36 id PK
    char36 tenant_id FK
    varchar name
    bool is_system
  }
  permissions {
    varchar code PK
    varchar module
    bool is_sensitive
  }
  role_permissions {
    char36 role_id FK
    varchar permission_code FK
    enum scope
  }
  membership_roles {
    char36 membership_id FK
    char36 role_id FK
  }
  refresh_tokens {
    char36 id PK
    char36 user_id FK
    char64 token_hash UK
    char36 family_id
    datetime expires_at
    datetime revoked_at
  }
```

### 2.2 Organization & employees
```mermaid
erDiagram
  tenants ||--o{ branches : has
  tenants ||--o{ departments : has
  departments ||--o{ departments : parent
  tenants ||--o{ designations : has
  tenants ||--o{ teams : has
  employees ||--o{ employment_records : history
  employees ||--o{ employee_documents : has
  employees ||--o{ employee_bank_accounts : has
  employees ||--o{ emergency_contacts : has
  employees ||--o{ employee_hierarchy : ancestor
  employees ||--o{ employee_hierarchy : descendant
  branches ||--o{ holiday_calendars : uses
  holiday_calendars ||--o{ holidays : contains
  work_schedules ||--o{ employment_records : assigned

  employees {

    char36 id PK

    char36 tenant_id

    varchar employee_code

    varchar first_name

    varchar last_name

    varchar work_email

    date date_of_joining

    enum status

    enum work_mode

    datetime deleted_at

  }
  employment_records {
    char36 id PK
    char36 tenant_id
    char36 employee_id
    char36 department_id
    char36 designation_id
    char36 branch_id
    char36 manager_id
    char36 schedule_id
    date effective_from
    date effective_to
  }
  employee_hierarchy {
    char36 tenant_id
    char36 ancestor_id
    char36 descendant_id
    int depth
  }
  employee_bank_accounts {
    char36 id PK
    char36 tenant_id
    char36 employee_id
    varbinary account_no_enc
    varchar ifsc
    date effective_from
  }
```
`employee_hierarchy` is a closure table rebuilt transactionally on manager change; it powers "team" scope queries (`WHERE ancestor_id = :me`).

### 2.3 Attendance, shifts & leave
```mermaid
erDiagram
  shifts ||--o{ shift_assignments : assigned
  employees ||--o{ shift_assignments : has
  employees ||--o{ attendance_punches : punches
  employees ||--o{ attendance_days : daily
  attendance_days ||--o{ attendance_regularizations : corrected_by
  leave_types ||--o{ leave_policies : configured_by
  leave_policies ||--o{ leave_policy_assignments : assigned
  employees ||--o{ leave_ledger : balance
  employees ||--o{ leave_requests : applies
  leave_requests ||--o{ leave_request_days : spans
  leave_requests ||--o{ approval_steps : approvals

  attendance_punches {

    char36 id PK

    char36 tenant_id

    char36 employee_id

    enum type

    datetime server_ts

    char36 work_location_id

    enum source

  }
  attendance_days {
    char36 tenant_id
    char36 employee_id
    date work_date
    enum status
    int worked_minutes
    int late_minutes
    int overtime_minutes
    char36 work_session_ref
  }
  leave_ledger {
    char36 id PK
    char36 tenant_id
    char36 employee_id
    char36 leave_type_id
    decimal days
    enum entry_type
    char36 source_id
    date posted_on
  }
  leave_requests {
    char36 id PK
    char36 tenant_id
    char36 employee_id
    char36 leave_type_id
    date from_date
    date to_date
    decimal total_days
    enum status
  }
```
`approval_steps` is a generic table (`entity_type`, `entity_id`, `step_no`, `approver_id`, `status`) reused by leave, WFH, attendance corrections, timesheets, requisitions and work reports. `UNIQUE(tenant_id, employee_id, work_date)` on `attendance_days`.

### 2.4 Payroll
```mermaid
erDiagram
  statutory_rule_packs ||--o{ statutory_rule_versions : versions
  tenants ||--o{ tenant_statutory_settings : configures
  salary_components ||--o{ salary_structure_components : in
  salary_structures ||--o{ salary_structure_components : has
  employees ||--o{ employee_salaries : effective_dated
  employee_salaries ||--o{ employee_salary_lines : lines
  payroll_periods ||--o{ payroll_runs : has
  payroll_runs ||--o{ payroll_run_employees : includes
  payroll_run_employees ||--o{ payroll_lines : lines
  payroll_run_employees ||--o| payslips : produces
  payroll_runs ||--o{ payroll_inputs : variable_pay
  employees ||--o{ tax_declarations : declares
  employees ||--o{ fnf_settlements : exits

  statutory_rule_versions {

    char36 id PK

    varchar pack_code

    varchar country

    varchar region

    json rules

    date effective_from

    date effective_to

    int version

  }
  employee_salaries {
    char36 id PK
    char36 tenant_id
    char36 employee_id
    char36 structure_id
    decimal annual_ctc
    date effective_from
    date effective_to
  }
  payroll_runs {
    char36 id PK
    char36 tenant_id
    char36 period_id
    enum type
    enum status
    varchar engine_version
    json rule_versions_pinned
    char36 approved_by
    datetime finalized_at
  }
  payroll_lines {
    char36 id PK
    char36 tenant_id
    char36 run_employee_id
    char36 component_id
    decimal amount
    json calc_trace
  }
  payslips {
    char36 id PK
    char36 tenant_id
    char36 run_employee_id
    varchar s3_key
    char64 sha256
  }
```
- `rule_versions_pinned` stores exactly which statutory and tenant rule versions a run used → re-calculation is reproducible.
- `calc_trace` stores the formula inputs and intermediate values for every line (explainability).
- Trigger: once `payroll_runs.status IN ('FINALIZED','PAID')`, child rows reject `UPDATE/DELETE`; the run row allows only `FINALIZED → PAID`.

### 2.5 Recruitment, onboarding & performance (abridged)
```mermaid
erDiagram
  job_requisitions ||--o{ job_postings : publishes
  job_postings ||--o{ applications : receives
  candidates ||--o{ applications : submits
  applications ||--o{ interviews : schedules
  interviews ||--o{ interview_feedback : collects
  applications ||--o| offers : results_in
  offers ||--o| onboarding_cases : starts
  onboarding_templates ||--o{ onboarding_template_tasks : defines
  onboarding_cases ||--o{ onboarding_tasks : has
  onboarding_cases ||--o{ onboarding_documents : collects
  performance_cycles ||--o{ goals : contains
  performance_cycles ||--o{ reviews : contains
  reviews ||--o{ review_responses : answers
  reviews ||--o{ feedback_requests : peer_360
  reviews ||--o| development_plans : produces
```

### 2.6 Work Status, WFH & monitoring (all 22 required tables)
```mermaid
erDiagram
  work_locations ||--o{ work_sessions : at
  work_policies ||--o{ work_sessions : governs
  employees ||--o{ wfh_requests : requests
  employees ||--o{ work_sessions : works
  work_sessions ||--o{ work_session_events : events
  work_sessions ||--o{ work_breaks : breaks
  work_sessions ||--o{ idle_records : idle
  work_sessions ||--o{ work_activity_summaries : summary
  work_sessions ||--o{ screenshot_records : captures
  screenshot_policies ||--o{ screenshot_records : under
  screenshot_records ||--o{ screenshot_access_logs : audited
  employees ||--o{ monitored_devices : owns
  monitored_devices ||--o{ device_sessions : tokens
  monitored_devices ||--o{ screenshot_records : from
  application_categories ||--o{ approved_applications : groups
  approved_applications ||--o{ application_usage_records : used
  work_sessions ||--o{ application_usage_records : during
  projects ||--o{ tasks : has
  tasks ||--o{ task_assignments : assigned
  tasks ||--o{ task_time_entries : time
  work_sessions ||--o{ task_time_entries : within
  employees ||--o{ daily_work_reports : submits
  daily_work_reports ||--o{ timesheet_approvals : rolled_into
  work_sessions ||--o{ work_corrections : corrected_by
  employees ||--o| employee_active_session : lock

  work_policies {

    char36 id PK

    char36 tenant_id

    int version

    enum applies_to

    char36 applies_to_id

    bool wfh_allowed

    bool wfh_requires_approval

    time allowed_start

    time allowed_end

    int heartbeat_timeout_sec

    int idle_threshold_sec

    enum idle_counting

    int max_break_minutes

    bool timesheet_required

    date effective_from

  }
  wfh_requests {
    char36 id PK
    char36 tenant_id
    char36 employee_id
    date from_date
    date to_date
    json recurrence
    char36 work_location_id
    enum status
  }
  work_sessions {
    char36 id PK
    char36 tenant_id
    char36 employee_id
    date work_date
    char36 work_location_id
    char36 policy_id
    int policy_version
    datetime started_at
    datetime ended_at
    enum status
    int worked_sec
    int break_sec
    int idle_sec
    int disconnected_sec
    bool needs_review
  }
  work_session_events {
    char36 id PK
    char36 tenant_id
    char36 session_id
    enum type
    datetime server_ts
    datetime client_ts
    enum source
    char36 device_id
    varchar idempotency_key
    json meta
  }
  employee_active_session {
    char36 tenant_id PK
    char36 employee_id PK
    char36 session_id UK
  }
  screenshot_policies {
    char36 id PK
    char36 tenant_id
    int version
    bool enabled
    int interval_min
    int jitter_sec
    enum capture_mode
    int retention_days
    json excluded_apps
    json blur_zones
    bool employee_can_delete
    text notice_text
    date effective_from
  }
  screenshot_records {
    char36 id PK
    char36 tenant_id
    char36 employee_id
    char36 session_id
    char36 device_id
    char36 policy_id
    datetime captured_at_server
    datetime captured_at_client
    enum status
    varchar s3_key
    varchar thumb_key
    char64 sha256
    int bytes
    datetime retention_until
    datetime deleted_at
  }
  screenshot_access_logs {
    char36 id PK
    char36 tenant_id
    char36 screenshot_id
    char36 actor_user_id
    enum action
    varchar reason
    varchar ip
    datetime at
  }
  monitored_devices {
    char36 id PK
    char36 tenant_id
    char36 employee_id
    enum ownership
    enum os
    varchar agent_version
    char64 fingerprint_hash
    enum status
    datetime last_seen_at
    datetime revoked_at
  }
  device_sessions {
    char36 id PK
    char36 tenant_id
    char36 device_id
    char64 refresh_hash UK
    char36 family_id
    datetime expires_at
    datetime revoked_at
  }
  application_usage_records {
    char36 id PK
    char36 tenant_id
    char36 session_id
    char36 approved_app_id
    char36 category_id
    datetime bucket_start
    int active_sec
  }
  idle_records {
    char36 id PK
    char36 tenant_id
    char36 session_id
    datetime idle_start
    datetime idle_end
    int duration_sec
    enum resolution
  }
  tasks {
    char36 id PK
    char36 tenant_id
    char36 project_id
    varchar title
    enum priority
    enum status
    date due_date
    int estimate_min
    int actual_min
    datetime deleted_at
  }
  task_time_entries {
    char36 id PK
    char36 tenant_id
    char36 task_id
    char36 employee_id
    char36 session_id
    datetime started_at
    datetime ended_at
    int duration_sec
    enum source
  }
  daily_work_reports {
    char36 id PK
    char36 tenant_id
    char36 employee_id
    date work_date
    json summary_snapshot
    text notes
    enum status
    char36 reviewed_by
  }
  timesheet_approvals {
    char36 id PK
    char36 tenant_id
    char36 employee_id
    date week_start
    int total_sec
    enum status
    char36 approver_id
  }
  work_corrections {
    char36 id PK
    char36 tenant_id
    char36 session_id
    enum kind
    datetime from_ts
    datetime to_ts
    text reason
    enum status
    char36 decided_by
  }
```

Additional supporting tables: `monitoring_activations` (activation checklist versions), `monitoring_acknowledgements` (employee × policy version), `screenshot_disputes`, `privacy_incidents`, `task_comments`, `task_attachments`, `project_members`.

---

## 3. Key constraints & indexes (WFH module)

| Table | Constraint / index | Purpose |
|---|---|---|
| `employee_active_session` | PK `(tenant_id, employee_id)` | One active session per employee (row-locked on start/end) |
| `work_sessions` | `IDX (tenant_id, employee_id, work_date)`, `IDX (tenant_id, status, work_date)` | Self view; live dashboard |
| `work_session_events` | `IDX (tenant_id, session_id, server_ts)`, `UNIQUE (tenant_id, device_id, idempotency_key)` | Ordered replay; dedupe retries from agent |
| `screenshot_records` | `IDX (tenant_id, employee_id, captured_at_server)`, `IDX (tenant_id, retention_until, status)` | Timeline; retention sweep |
| `screenshot_access_logs` | `IDX (tenant_id, screenshot_id, at)`, `IDX (tenant_id, actor_user_id, at)` | Audit queries |
| `daily_work_reports` | `UNIQUE (tenant_id, employee_id, work_date)` | One report per day |
| `timesheet_approvals` | `UNIQUE (tenant_id, employee_id, week_start)` | One timesheet per week |
| `application_usage_records` | `UNIQUE (tenant_id, session_id, approved_app_id, bucket_start)` | Idempotent upserts of buckets |
| `monitored_devices` | `UNIQUE (tenant_id, fingerprint_hash)` | Prevent duplicate registration |

## 4. Data volume estimate (design point: 50k employees)

| Table | Rows/day | 1-year rows | Strategy |
|---|---|---|---|
| work_session_events | ~1.2 M | ~300 M | Monthly RANGE partitioning on `server_ts` (raw SQL), archive >13 months to S3 (Parquet) |
| screenshot_records | ~720 k (15k agents, 10 min, 8 h) | metadata only | Tombstones after retention; partition monthly |
| application_usage_records | ~1.4 M (5-min buckets) | | Retention 90 days default, then rolled into `work_activity_summaries` |
| audit_logs | ~500 k | | Partition monthly; export to S3 Object Lock |

Partitioned tables in MySQL cannot have foreign keys; for these, referential integrity is enforced in the service layer and verified by a nightly consistency job (documented exception).

## 5. Retention matrix (defaults; tenant-configurable within limits)

| Data | Default | Min–Max | Deletion |
|---|---|---|---|
| Screenshots (images) | 30 days | 7–90 | Worker + S3 lifecycle tag |
| Screenshot metadata/tombstones | 1 year | — | Partition drop |
| App usage buckets | 90 days | 30–180 | Rolled up then deleted |
| Idle/session events | 13 months | — | Archive then drop partition |
| Payroll, payslips | 8 years (statutory books) | fixed | Legal hold only |
| Candidate data (not hired) | 12 months | 3–24 | Anonymize |
| Exited employee data | per policy (default 8 years for payroll-linked, 3 years for others) | | Anonymize non-statutory fields |
| Exports | 7 days | — | S3 lifecycle |
