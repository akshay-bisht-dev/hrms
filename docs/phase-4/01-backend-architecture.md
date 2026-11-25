# 01 — Backend Architecture (Node.js 24 · Express 5 · Prisma 7 · Redis · BullMQ)

This is the implementation blueprint for `apps/backend`, `apps/worker` and `packages/shared`. Sprint 1 builds the skeleton exactly as described here. The code sketches are the contracts the sprints will implement and test. They are not running code yet.

## 1. Runtime processes

| Process | Entry | Scales by | Notes |
|---|---|---|---|
| API | `apps/backend/src/server.js` | CPU / request rate | Stateless; any instance serves any tenant in its cell |
| Worker | `apps/worker/src/worker.js` | Queue depth per queue | Same code modules as API (imports services from `apps/backend/src/modules`) |
| Scheduler | `apps/worker/src/scheduler.js` | 1 replica | Registers BullMQ repeatable jobs (job schedulers); safe if two run briefly, because schedulers are idempotent by key |

## 2. Source layout

```
apps/backend/
├── prisma/                      # schema, migrations, checks (done in Phase 4)
├── prisma.config.mjs
└── src/
    ├── app.js                   # builds the Express app (no listen) — used by tests
    ├── server.js                # listen, graceful shutdown
    ├── config/
    │   ├── env.js               # Zod-validated environment, frozen object; process exits on invalid config
    │   └── permissions.js       # seeded permission catalog (codes, sensitive flags)
    ├── lib/
    │   ├── db.js                # PrismaClient + MariaDB adapter, tenant extension, platformDb()
    │   ├── context.js           # AsyncLocalStorage request/job context
    │   ├── redis.js             # ioredis clients (cache, queue) with key-prefix helpers
    │   ├── queues.js            # BullMQ queue registry + enqueue helpers
    │   ├── logger.js            # pino with redaction
    │   ├── errors.js            # AppError hierarchy → problem+json
    │   ├── crypto.js            # envelope encryption, blind index, token hashing
    │   ├── storage.js           # S3 presign helpers (key builders take DB records only)
    │   ├── ids.js               # UUIDv7
    │   └── money.js             # Decimal helpers, currency rounding
    ├── middleware/
    │   ├── requestId.js  authenticate.js  resolveTenant.js  authorize.js
    │   ├── validate.js   rateLimit.js     idempotency.js    errorHandler.js
    ├── modules/<module>/        # routes, controller, service, repository, schemas, policy, events, __tests__
    ├── routes/index.js          # mounts /api/v1/* and the route registry
    ├── openapi/                 # registry → OpenAPI 3.1 document, Swagger UI at /api/docs
    └── jobs/                    # job payload schemas shared with the worker
apps/worker/src/
    ├── worker.js                # starts processors per queue
    ├── scheduler.js
    └── processors/<queue>/<job>.js
packages/shared/                 # Zod schemas, enums, permission codes, time & money utils used by frontend + backend
```

## 3. Key contracts (JavaScript sketches)

### 3.1 Context (AsyncLocalStorage)

```js
// src/lib/context.js
import { AsyncLocalStorage } from 'node:async_hooks';

/** @typedef {{ requestId: string, tenantId?: string, userId?: string, membershipId?: string, deviceId?: string, permissions?: Map<string, string> }} Ctx */
const als = new AsyncLocalStorage();

/** @template T @param {Ctx} ctx @param {() => T} fn @returns {T} */
export const runWithContext = (ctx, fn) => als.run(ctx, fn);

/** @returns {Ctx} */
export function ctx() {
  const c = als.getStore();
  if (!c) throw new Error('No request context');
  return c;
}

/** @returns {string} tenant id; throws if absent (fail closed) */
export function requireTenantId() {
  const id = als.getStore()?.tenantId;
  if (!id) throw new Error('Tenant context required');
  return id;
}
```

### 3.2 Tenant-scoped Prisma client

```js
// src/lib/db.js
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { env } from '../config/env.js';
import { requireTenantId } from './context.js';

// Connection-string form verified with Prisma 7.10.1 against MySQL 8.4 (prisma/checks/db-smoke.mjs).
// Pool size is set on the URL, e.g. mysql://…/hrms?connectionLimit=20
const base = new PrismaClient({ adapter: new PrismaMariaDb(env.DATABASE_URL) });

/** Models that are NOT tenant-owned (allowlist; a schema test fails if a new model lacks tenantId and isn't listed). */
const GLOBAL_MODELS = new Set(['User', 'PlatformAdmin', 'RefreshToken', 'MfaFactor', 'RecoveryCode', 'AuthToken',
  'Permission', 'Plan', 'PlanPrice', 'CountryProfile', 'Currency', 'FxRate', 'StatutoryRulePack',
  'StatutoryRuleVersion', 'JurisdictionPolicy', 'PublicHolidaySet', 'FeatureFlag', 'PaymentWebhookEvent',
  'Tenant', 'AuditLog', 'OutboxEvent', 'MessageTemplate']);

const WHERE_OPS = new Set(['findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy',
  'updateMany', 'deleteMany', 'update', 'delete', 'upsert', 'findUnique', 'findUniqueOrThrow']);

const tenantDb = base.$extends({
  name: 'tenant-scope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (GLOBAL_MODELS.has(model)) return query(args);
        const tenantId = requireTenantId();
        if (operation === 'create') {
          if (args.data.tenantId && args.data.tenantId !== tenantId) throw new Error('Cross-tenant write');
          args.data = { ...args.data, tenantId };
        } else if (operation === 'createMany') {
          args.data = [].concat(args.data).map((d) => {
            if (d.tenantId && d.tenantId !== tenantId) throw new Error('Cross-tenant write');
            return { ...d, tenantId };
          });
        }
        if (WHERE_OPS.has(operation)) {
          // update/delete/findUnique by `id` alone are allowed by Prisma because Prisma treats unique
          // filters with extra conditions as valid (extendedWhereUnique is GA); tenantId is added to every where.
          args.where = { ...args.where, tenantId };
          if (operation === 'upsert') args.create = { ...args.create, tenantId };
        }
        return query(args);
      },
    },
  },
});

/** Tenant-scoped client — the only client repositories may import. */
export const db = () => tenantDb;
/** Unscoped client — Platform module and migrations only; every call is audited by the caller. */
export const platformDb = () => base;
export { Prisma };
```

`include` / `select` of related rows needs no extra filter, because composite foreign keys guarantee that a child row belongs to the same tenant as its parent. Nested writes (e.g., `create` with nested `connect`) are covered by the composite foreign keys too: a nested record from another tenant fails at the database. Tests ST-01 to ST-03 verify both layers.

### 3.3 Authorization middleware

```js
// src/middleware/authorize.js
import { ForbiddenError } from '../lib/errors.js';
import { ctx } from '../lib/context.js';

/**
 * Declares the permission a route needs. The resolved scope is attached for the service to apply.
 * @param {string} permission e.g. 'leave.request.approve'
 */
export function authorize(permission) {
  const mw = (req, _res, next) => {
    const scope = ctx().permissions?.get(permission); // 'OWN' | 'TEAM' | ... | undefined
    if (!scope) return next(new ForbiddenError(permission));
    req.scope = scope;
    next();
  };
  mw.permission = permission; // read by the route registry: routes without authorize() fail startup
  return mw;
}
```

Object-level checks live in each module's `*.policy.js`, for example `assertCanViewScreenshot(actor, screenshot)`, which checks the hierarchy scope with the closure table. A failed object check returns **404**, never 403, so existence doesn't leak.

### 3.4 Errors

```js
// src/lib/errors.js
export class AppError extends Error {
  /** @param {number} status @param {string} code @param {string} title @param {object} [extra] */
  constructor(status, code, title, extra = {}) { super(title); Object.assign(this, { status, code, title, ...extra }); }
}
export class ValidationError extends AppError { constructor(errors) { super(422, 'validation_failed', 'Some fields are invalid', { errors }); } }
export class NotFoundError extends AppError { constructor() { super(404, 'not_found', 'Not found'); } }
export class ForbiddenError extends AppError { constructor(permission) { super(403, 'forbidden', 'You do not have access', { permission }); } }
export class ConflictError extends AppError { constructor(code, title) { super(409, code, title); } }
// errorHandler maps: AppError → its status; Prisma P2002 → 409 duplicate; P2003 → 422/404;
// MySQL SIGNAL 'IMMUTABLE:' → 409 'immutable_record'; anything else → 500 with requestId only.
```

### 3.5 Transactional outbox

```js
// in a service
await db().$transaction(async (tx) => {
  const req = await tx.leaveRequest.update({ where: { id }, data: { status: 'APPROVED' } });
  await tx.leaveLedgerEntry.createMany({ data: ledgerDebits(req) });
  await tx.outboxEvent.create({ data: { tenantId: req.tenantId, topic: 'leave.approved', payload: { requestId: id } } });
});
// apps/worker relay (every 1 s): SELECT ... WHERE published_at IS NULL ORDER BY id LIMIT 500 FOR UPDATE SKIP LOCKED
// → queue.add(topic, payload, { jobId: `outbox:${row.id}` }) → mark published_at. jobId makes delivery idempotent.
```

## 4. Work-session engine (core logic)

A pure function, unit- and property-tested, shared by the API (live totals) and the worker (daily reports):

```js
// src/modules/work-session/compute-totals.js
/**
 * @param {Array<{type: string, serverTs: Date}>} events ordered by serverTs
 * @param {{ heartbeatTimeoutSec: number, idleCounting: 'NOT_COUNTED'|'COUNTED'|'COUNTED_UNTIL_THRESHOLD', idleThresholdSec: number }} policy
 * @param {Date} now upper bound for an open session
 * @returns {{ workedSec: number, breakSec: number, idleSec: number, disconnectedSec: number, state: string }}
 */
export function computeSessionTotals(events, policy, now) { /* state machine over events; Sprint 8 */ }
```

Rules (from Phase 1, 01 §5.5): only server timestamps count; a gap larger than `heartbeatTimeoutSec` becomes `DISCONNECTED` from the last heartbeat; idle follows the policy; corrections are separate events (`CORRECTION_APPLIED`) and never rewrite earlier events. Invariant: `worked + break + idle + disconnected = end − start`.

**Session start** (one transaction):
1. `SELECT … FROM employee_active_sessions WHERE tenant_id=? AND employee_id=? FOR UPDATE`.
2. If a row exists → return the existing session (409 with its ID), or attach the new device to it.
3. Resolve the effective policy (cached), check eligibility (WFH approval, allowed hours, acknowledgment).
4. Insert `work_sessions`, `employee_active_sessions`, `work_session_events(START)`, outbox `session.started`.

**Heartbeat** (hot path, no DB write in the common case): verify token → `SET t:{tid}:presence:{empId}` with TTL → every 5 minutes, or on a state change, write a checkpoint event. A p95 under 20 ms is the target.

## 5. Queues and jobs

| Queue | Concurrency / worker | Retry | Idempotency key |
|---|---|---|---|
| `outbox` relay | 1 loop per worker, `SKIP LOCKED` | n/a | outbox row ID |
| `payroll` | 2 | 3 × exponential, then DLQ + alert | `payroll:{runId}:{step}` |
| `imports` | 2 | 2 | `import:{jobId}` |
| `screenshots` | 20 | 5 | `shot:{screenshotId}:{step}` |
| `retention` | 2 | 5 | `ret:{tenantId}:{date}:{category}` |
| `reports` | 4 | 3 | `report:{runId}` |
| `notifications` | 20 | 5 | `notif:{eventId}:{channel}` |
| `work-sessions` (stale sweeper, auto-close, daily report build, attendance roll-up) | 4 | 3 | `ws:{kind}:{tenantId}:{date|sessionId}` |
| `billing` | 2 | 5 | `bill:{tenantId}:{period}` |

Each processor validates its payload with the Zod schema in `src/jobs/`, runs inside `runWithContext({ tenantId })`, and is safe to run twice.

## 6. Caching

| Key (prefix `t:{tid}:`) | Content | TTL | Invalidation |
|---|---|---|---|
| `mem:{userId}` | Membership + effective permissions/scopes | 60 s | On role or membership change (delete key) |
| `policy:work:{employeeId}` | Effective work policy version | 5 min | On policy publish |
| `policy:shot:{employeeId}` | Effective screenshot policy + activation status | 5 min | On publish / activation change |
| `hier:{managerId}` | Descendant IDs for team scope | 5 min | On manager change |
| `presence:{employeeId}` | Live state + last heartbeat | heartbeat timeout | Natural expiry |
| `rl:*` | Rate-limit counters | window | Natural expiry |

Payroll amounts, screenshots and documents are never cached in Redis.

## 7. Configuration (`.env.example` keys, validated at startup)

`NODE_ENV, PORT, CELL_REGION, PUBLIC_API_URL, FRONTEND_URL, DATABASE_URL, DB_POOL_SIZE, REDIS_URL, REDIS_QUEUE_URL, JWT_ACCESS_PRIVATE_KEY, JWT_ACCESS_PUBLIC_KEYS, JWT_REFRESH_PEPPER, CSRF_SECRET, KMS_KEY_ID_PII, KMS_KEY_ID_SCREENSHOTS, BLIND_INDEX_KEY, AWS_REGION, S3_BUCKET_DOCUMENTS, S3_BUCKET_SCREENSHOTS, S3_BUCKET_REPORTS, S3_ENDPOINT (MinIO locally), EMAIL_PROVIDER, EMAIL_FROM, SES_REGION, SCREENSHOT_RETENTION_DAYS (default 30), SCREENSHOT_MIN_INTERVAL_MIN (5), DEVICE_ACCESS_TOKEN_TTL_SEC (600), DEVICE_REFRESH_TOKEN_TTL_DAYS (30), PAIRING_CODE_TTL_SEC (600), HEARTBEAT_TIMEOUT_SEC_DEFAULT (180), STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, CAPTCHA_SECRET, LOG_LEVEL`.

In production, secrets come from Secrets Manager. Locally they come from `.env` (git-ignored). Startup fails with a clear message when a variable is missing or malformed.

## 8. API documentation

Each module registers its routes with Zod request and response schemas in `src/openapi/registry.js`. `GET /api/docs/openapi.json` is generated at startup, and `GET /api/docs` serves Swagger UI. Swagger UI is turned off in production unless `ENABLE_API_DOCS=true`. CI fails if a route lacks a registry entry.
