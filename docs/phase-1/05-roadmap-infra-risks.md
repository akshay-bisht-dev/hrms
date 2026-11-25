# 05 — Development Roadmap, Infrastructure & Risk Assessment

## 1. Roadmap (2-week sprints)

> **Scope update:** worldwide scope adds about 3 sprints before MVP (≈ week 34). Details in [06 §7](06-global-architecture.md#7-roadmap-impact); new risks R14–R19 in [06 §8](06-global-architecture.md#8-new-risks).

Assumed team: 1 tech lead, 3 full-stack JS, 1 desktop/Electron, 1 QA automation, 1 designer (part-time), 1 DevOps (part-time). Adjust after the open questions are answered.

| Sprint | Weeks | Scope | Exit criteria (tests that must pass) |
|---|---|---|---|
| 0 | 1–2 | Phase 2 design system & key screen mockups; Prisma-JS spike; Terraform skeleton | Design sign-off; spike report |
| 1 | 3–4 | Monorepo, Vite/React, Express, Prisma/MySQL, Redis/BullMQ, Docker compose, CI (lint, unit, build), health checks, logging, error model, OpenAPI pipeline | `docker compose up` → all health checks green; CI green |
| 2 | 5–6 | Auth (register, verify, login, refresh rotation, reset, MFA), RBAC engine + data scopes | Auth unit/integration; rate-limit tests |
| 3 | 7–8 | Tenancy (context, Prisma extension, composite FKs), company/org, roles UI, audit log | **Cross-tenant test harness live** (gates every later sprint) |
| 4 | 9–10 | Employees, employment history, documents (S3 presigned, ClamAV), hierarchy closure table, bulk import | Import job tests; masking tests |
| 5 | 11–12 | Attendance, shifts, regularization, daily roll-up worker | Calculation unit tests (late/OT/grace) |
| 6 | 13–14 | Leave (policies, ledger, accrual, approvals, holidays) | Accrual/day-count unit tests |
| 7 | 15–16 | Payroll core: components, structures, first native country pack(s), configurable mode, payroll export, run lifecycle, payslips, bank file, immutability triggers | Golden-file payroll tests reviewed by a payroll SME |
| 8 | 17–18 | **Work Status**: locations, policies, WFH requests, sessions (event log, heartbeat, sweeper), breaks, idle, corrections | Session calculation property tests; disconnection scenarios |
| 9 | 19–20 | Tasks, projects, time entries, daily reports, timesheets, manager live board, HR dashboard | E2E: WFH flow without agent |
| 10 | 21–22 | **Desktop agent**: pairing, tokens, tray, policy sync, capture pipeline, exclusions, retention, screenshot review, disputes, access logs, monitoring activation checklist | Security tests (expired tokens, revoked device, unauthorized view) + full E2E with agent |
| 11 | 23–24 | Signing/notarization, auto-update, Super Admin, plans, billing + gateway, usage metering, suspension | Webhook idempotency tests |
| 12 | 25–26 | Reports & analytics, notifications/templates, hardening (k6 load, pen-test fixes), backup/restore drill | k6 targets met; restore drill done |
| — | **27–28** | **MVP launch (pilot tenants)** | Go-live checklist |
| 13 | 29–30 | Recruitment + careers page | |
| 14 | 31–32 | Onboarding | |
| 15 | 33–34 | Performance | |
| 16 | 35–36 | Payroll extended (revisions/arrears, F&F, Form 16 data), integrations, optimization | |

**Why the order differs from the 16-sprint list in the brief:** WFH/Work Status and the desktop agent are the differentiator and the highest-risk area, so they move ahead of Recruitment, Onboarding and Performance (lower risk, well-understood CRUD). The original sprint content is fully preserved; only sequencing changes. If you prefer the original order, it works — it just pushes the riskiest work to the end.

Each sprint follows: objectives → scope → dependencies → DB changes → API design → backend → frontend → desktop (if any) → tests → docs → review → your approval.

## 2. Infrastructure & deployment plan

### 2.1 Environments
| Env | Purpose | Infra |
|---|---|---|
| Local | Development | Docker compose: MySQL 8.4, Redis 7, MinIO (S3-compatible) + Mailpit (email capture), Nginx; apps run with `npm run dev` |
| CI | Tests | GitHub Actions + Testcontainers |
| Staging | Pre-prod, smoke & E2E | Same Terraform as prod, smaller sizes, synthetic data only |
| Production | Customers | One or more **regional cells** (e.g., India, EU, US), each 3 AZs, plus a global control plane — see 06 §3 |

### 2.2 Production topology (AWS)
- **Edge:** Route 53 → CloudFront (+ AWS WAF managed rules, rate rules) → SPA from S3 *or* Nginx container; `/api/*` → ALB. ACM certificates (auto-renewing).
- **Compute:** ECS Fargate services — `api` (min 3 tasks across AZs, CPU-based autoscaling), `worker` (queue-depth autoscaling), `scheduler` (1 task, BullMQ repeatable jobs are leader-safe). Nginx runs as the SPA/reverse-proxy container (also used for self-hosted installs).
- **Data:** RDS MySQL 8.4 Multi-AZ (+ 1 read replica for reports), automated backups 35 days + PITR, snapshot copy to the cell's paired DR region in the same jurisdiction; ElastiCache Redis (queues: Multi-AZ, `noeviction`; cache: separate cluster, `allkeys-lru`); S3 buckets (documents, screenshots, reports, audit-archive with Object Lock), versioning on documents, replication to the paired DR region.
- **Security:** private subnets for compute/data, VPC endpoints for S3/Secrets Manager/KMS/ECR, security groups least-privilege, KMS CMKs per data class, Secrets Manager rotation for DB, IAM task roles scoped per service (worker can delete screenshots; API can only sign GET/PUT for specific prefixes), GuardDuty, Security Hub, CloudTrail.
- **Observability:** CloudWatch logs (pino JSON), metrics + alarms (p95 latency, 5xx rate, queue depth/failed jobs, DB CPU/connections, Redis memory, screenshot upload failures, agent connectivity ratio, S3 storage per tenant), OpenTelemetry traces → AWS X-Ray, uptime checks, PagerDuty/Opsgenie routing.
- **Desktop distribution:** installers and update feeds on a dedicated S3 bucket + CloudFront; signed (Windows Authenticode via Azure Trusted Signing/EV; macOS Developer ID + notarization); `electron-updater` verifies signatures; staged rollout channels (beta → stable).

### 2.3 CI/CD (GitHub Actions)
1. Checkout → 2. `npm ci` (cache) → 3. ESLint + Prettier check + "no-TypeScript" check → 4. `node --check` syntax pass → 5. Unit (Jest) → 6. Integration (Supertest + Testcontainers, includes cross-tenant suite) → 7. Security scans (npm audit, OSV, Semgrep, Gitleaks, Trivy) → 8. Frontend build → 9. API Docker build → 10. Worker build → 11. Desktop builds on `windows-latest` / `macos-latest` with signing (secrets in protected environment) → 12. Deploy staging (Terraform plan/apply + ECS deploy) → 13. Smoke + Playwright E2E on staging → 14. Manual production approval (GitHub environment protection) → 15. Production deploy (rolling, health-check gated, automatic rollback on alarm).

**Migration safety:** expand/contract pattern only (add columns/tables → deploy code → backfill via job → remove old in a later release); `prisma migrate deploy` runs as a one-off ECS task before the service update; destructive migrations need a separate approval label; pre-migration RDS snapshot; every migration has a documented rollback (forward-fix script).

### 2.4 Backup & DR
| Item | Mechanism | Target |
|---|---|---|
| DB | PITR (5-min RPO) + daily snapshot copied cross-region | RPO 5 min, RTO 4 h |
| S3 | Versioning (documents), cross-region replication | — |
| Redis | Queue cluster snapshots; jobs are re-creatable from outbox | — |
| Drills | Quarterly restore test to an isolated account; documented runbook | — |

## 3. Risk assessment

| ID | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | **Legal/privacy exposure from monitoring** (GDPR, works councils, US state notice laws, DPDP Act and others; misuse by tenants) | M | H | Off by default; activation checklist; employee notice & acknowledgment; minimization defaults; separate sensitive permissions; access logs; retention enforcement; customer contract (DPA) and acceptable-use terms; external legal review before GA | CTO + Legal |
| R2 | **Payroll calculation errors** (statutory complexity, frequent rule changes) | M | H | Versioned rule packs, golden-file tests signed off by a payroll SME, variance report, maker-checker, pilot with parallel run vs existing payroll for 2 months | Payroll lead |
| R3 | **[CLOSED in Phase 4: Prisma 7.10.1 + `prisma-client-js` verified to emit plain JavaScript]** Prisma's JavaScript client generation — newer Prisma major versions are moving toward a TypeScript-emitting generator | M | M | Sprint 0 spike; pin the version that supports `prisma-client-js`; generated code is excluded from the "no TS source" rule only if it contains no `.ts` files — otherwise pin; fallback ORM plan (Drizzle/Knex in JS) documented | Tech lead |
| R4 | **Cross-tenant data leak** | L | Critical | Five enforcement layers (§3 of architecture); automated cross-tenant suite gating releases; pen test before launch | Security |
| R5 | Desktop agent blocked by OS (macOS TCC, Windows SmartScreen, EDR/antivirus flags) | M | M | Proper signing/notarization; clear permission onboarding; publish agent behavior doc for IT teams; MDM deployment guide | Desktop lead |
| R6 | Screenshot storage cost growth | M | M | WebP + downscale (~150–300 KB), retention defaults, per-plan storage quotas, usage metering | DevOps |
| R7 | Work-time disputes (disconnections, idle rules) causing employee distrust | M | M | Server-verified rules disclosed in-app, timeline view, self-service correction flow, never silently counting/discounting | Product |
| R8 | Write volume on session events at scale | M | M | Redis presence for heartbeats, checkpoint writes only, monthly partitioning, load tests in Sprint 12 | Tech lead |
| R9 | Scope size vs. timeline (14 modules + agent) | H | H | MVP cut at week 28; later modules post-launch; strict sprint exit criteria | CTO |
| R10 | Payment gateway / GST invoicing compliance | M | M | Use gateway-hosted checkout; GST invoice numbering per FY; accountant review | Finance |
| R11 | Notification redaction and full privacy masking not technically guaranteed | H | M | State limits honestly in policy text; offer active-window mode, blur zones, exclusions; recommend Focus mode | Desktop lead |
| R12 | Linux Wayland cannot support periodic capture | H | L | Document as unsupported for screenshots; session tracking still works | Desktop lead |
| R13 | Key person dependency on statutory knowledge | M | M | Rule-pack authoring tool + documentation; external payroll consultant on retainer | CTO |
