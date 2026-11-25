# Phase 4 — Backend, Database & Scalability (for approval)

| # | Deliverable | Location |
|---|---|---|
| 1 | Backend architecture: processes, layout, tenant-scoped Prisma client, authorization, errors, outbox, work-session engine, queues, caching, config, API docs | [01-backend-architecture.md](01-backend-architecture.md) |
| 2 | **Complete MySQL schema as Prisma files plus the initial migration, verified on MySQL 8.4** | [02-database-design.md](02-database-design.md), `apps/backend/prisma/` |
| 3 | Scalability & capacity plan: workload model, k6 targets, sizing, DB scaling path, health checks | [03-scalability-plan.md](03-scalability-plan.md) |

The API specification is in Phase 1 ([04-api-and-ux.md](../phase-1/04-api-and-ux.md)). From Sprint 1 the OpenAPI document is generated from the Zod schemas.

## Verified in this phase
- Prisma 7.10.1 with `prisma-client-js` generates **plain JavaScript**, so risk R3 is closed.
- The schema validates: 132 models and 89 enums.
- The init migration applies to MySQL 8.4.13: 132 tables, 196 foreign keys, 16 immutability triggers.
- 14 database smoke checks pass through the generated client: tenant isolation by composite foreign keys, exact decimals, frozen payroll, append-only logs, one active session per employee, and idempotent session events.

## Decisions to confirm
1. Pin **Prisma 7.10.1** (Prisma 8 is still a release candidate).
2. **Actor columns** (`approved_by`, `created_by` and similar) have no foreign keys; the audit log is the authoritative record.
3. **Event and audit tables** get monthly partitioning only when volume needs it (about 100 M rows). Event tables keep their foreign keys until then.
4. Starting AWS size per cell as in 03 §3.
