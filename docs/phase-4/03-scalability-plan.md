# 03 — Scalability & Capacity Plan

## 1. Workload model (per regional cell, design point from Phase 1 NFRs)

| Driver | Assumption | Derived load |
|---|---|---|
| Employees | 50,000 across 500 tenants | — |
| Peak concurrency | 30% active in the peak hour | 15,000 users |
| Web API traffic | ~1 request / 10 s per active user (navigation, polling) | ~1,500 req/s peak |
| Heartbeats | 15,000 sessions, 1 per 60 s | ~250 req/s |
| Screenshot slots + confirms | 15,000 agents, 1 per 10 min, 2 calls each | ~50 req/s API; ~25 uploads/s direct to S3 |
| Activity buckets | 1 per 5 min per agent | ~50 req/s |
| Payroll | 5,000-employee run | < 5 min in worker |
| Session event writes | checkpoint every 5 min + state changes | ~80 rows/s |

## 2. Capacity targets (verified with k6 before each release)

| Scenario (k6) | Target |
|---|---|
| `api-mixed` 1,500 req/s, 70% reads | p95 < 300 ms reads, < 500 ms writes, error rate < 0.1% |
| `heartbeat` 300 req/s sustained 30 min | p95 < 50 ms, no DB connection saturation |
| `session-start-storm` 5,000 starts in 5 min (09:00 peak) | p95 < 500 ms, zero duplicate active sessions |
| `screenshot-slots` 60 req/s + 30 uploads/s to MinIO/S3 | p95 < 200 ms for slots, processing lag < 60 s |
| `attendance-punch` 3,000 punches/min | p95 < 400 ms |
| `bulk-import` 10,000-row employee file | completes < 3 min, API p95 unchanged |
| `payroll-run` 5,000 employees | < 5 min, API p95 unchanged |
| `report-generate` 20 concurrent large exports | completes < 2 min each, API p95 unchanged |
| `queue-backlog` 100k notification jobs | drains < 10 min, no Redis memory alarms |

## 3. Starting size per cell (production)

| Component | Start | Scale trigger |
|---|---|---|
| API (ECS Fargate) | 3 tasks × 1 vCPU / 2 GB | CPU > 60% or p95 > 300 ms → add tasks (max 20) |
| Worker | 2 tasks × 1 vCPU / 2 GB | Waiting jobs > 1,000 or oldest job > 60 s |
| Scheduler | 1 task × 0.25 vCPU | — |
| RDS MySQL 8.4 | `db.r7g.xlarge` Multi-AZ + 1 read replica | CPU > 60%, connections > 70%, replica lag > 5 s |
| Redis (queues) | `cache.r7g.large` Multi-AZ, `noeviction` | Memory > 60% |
| Redis (cache) | `cache.r7g.large`, `allkeys-lru` | Evictions > 1%/min |
| S3 | — | Request-rate partitioning comes from the tenant/employee key prefix |

The connection budget is about 20 per API task and 10 per worker task through the adapter pool. At 20 API tasks + 10 workers that is about 500 connections, within the instance limit. RDS Proxy is added if task counts grow past that.

## 4. Database scaling path

1. **Indexes first:** every query path has a composite index that starts with `tenant_id` (in the schema). Slow-query log is on (>200 ms) in staging and production, and query plans are reviewed for new endpoints in code review.
2. **Read replica** for reports, dashboards and exports (repositories take a `{ readOnly: true }` option, and the replica is chosen only where up-to-the-second data isn't required).
3. **Partitioning** (when tables pass about 100 M rows): monthly RANGE partitions on `work_session_events.server_ts`, `audit_logs.created_at`, `screenshot_access_logs.at`, `application_usage_records.bucket_start`. This needs an expand/contract migration that drops the FKs on those tables, with integrity checked by the nightly consistency job. Old partitions are archived to S3 (Parquet) and dropped.
4. **Cell split:** when one cell nears its limits, new tenants go to a new cell in the same region (tenant directory routing). A single large tenant can get a dedicated cell.

## 5. Application patterns that keep scaling cheap

- Cursor pagination everywhere (max 200); no `OFFSET` on large tables.
- Heartbeats write to Redis; the DB gets checkpoints only.
- Screenshots go straight to S3 by presigned upload; the API handles metadata only.
- Long work (payroll, imports, reports, PDFs) runs in workers; the API returns `202` with a job resource.
- Hot read paths (permissions, effective policies, hierarchy) are cached with explicit invalidation.
- All jobs are idempotent with deterministic IDs, so retries and duplicate deliveries are safe.
- No critical state lives in process memory. Sessions, rate limits, presence, locks and job state are in Redis or MySQL, so any task can be killed at any time.

## 6. Health, observability and graceful shutdown

| Endpoint / signal | Behavior |
|---|---|
| `GET /health/live` | Process is up (no dependency checks) |
| `GET /health/ready` | DB `SELECT 1`, Redis `PING`, under 1 s; the ALB takes the task out of service when it fails |
| `SIGTERM` | Stop accepting connections, finish in-flight requests (max 25 s), close the DB pool and Redis. Workers stop taking new jobs and finish the current one |
| Metrics | Request rate/latency/errors per route class, DB pool usage, queue depth/age/failures per queue, screenshot pipeline lag, active sessions, agent connectivity ratio |
| Logs | JSON (pino) with request ID, tenant ID and route; sampled debug logs off in production |
| Traces | OpenTelemetry (HTTP, Prisma, ioredis, BullMQ) → X-Ray |
