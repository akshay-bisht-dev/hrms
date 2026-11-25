# Sprint 1 — Foundation

Status: **Complete, awaiting owner approval** · Date: 2026-11-25

## 1. Objectives
Stand up the JavaScript monorepo and every runtime piece that later sprints build on: API, worker, scheduler, frontend, database migrations and seed, local Docker stack, production images and CI. Nothing user-facing beyond a live system-status page.

## 2. Scope
**In:** npm-workspaces monorepo · Express 5 API skeleton (config validation, logging, request context, problem+json errors, security headers, CORS, health checks, OpenAPI + Swagger UI) · tenant-scoped Prisma client · BullMQ worker + scheduler · React/Vite/Tailwind frontend with design tokens, i18n, routing and a system-status page · seed data · Docker Compose (MySQL, Redis, S3-compatible storage, Mailpit, and the app containers) · Dockerfiles + Nginx · GitHub Actions CI · README with setup and troubleshooting.

**Out (later sprints):** authentication and RBAC (Sprint 2), tenant registration (3), all business modules, desktop agent (10), AWS/Terraform (once an AWS account is provided).

## 3. Dependencies
Phase 4 schema and migration (reused unchanged). No external accounts needed.

## 4. Database changes
- No schema changes. The Phase 4 migration is applied by `npm run db:migrate`.
- **Seed** (`apps/backend/prisma/seed.mjs`, idempotent): 7 currencies, 5 country profiles (IN, GB, US, AE, DE), the 51-code permission catalog, 2 plans with 8 monthly prices. Prices are **placeholders** for the business to set.
- Operational requirement found: MySQL 8.4 needs `log_bin_trust_function_creators=1` for the app user to create the immutability triggers. Set in compose, in CI (`SET GLOBAL`), and to be set in the RDS parameter group.

## 5. API design
| Method | Path | Notes |
|---|---|---|
| GET | `/health/live` | Process alive |
| GET | `/health/ready` | MySQL + Redis with 1 s timeouts; 503 when degraded; failure details are logged, not returned |
| GET | `/api/docs` · `/api/docs/openapi.json` | Swagger UI and OpenAPI 3.1, generated from Zod; off in production unless `ENABLE_API_DOCS=true` |
| any | `/api/v1/*` | Router mounted; modules are added from Sprint 2. Unknown routes → 404 problem+json |

## 6. Backend implementation
`apps/backend/src/`: `config/env.js` (Zod-validated, frozen; empty `.env` values treated as unset) · `lib/context.js` (AsyncLocalStorage) · `lib/db.js` (tenant-scope Prisma extension, fails closed) · `lib/redis.js` · `lib/logger.js` (pino with redaction) · `lib/errors.js` · `middleware/` (request context/ID, validation, error handler) · `modules/health/` · `openapi/registry.js` · `app.js` / `server.js` (graceful shutdown).
`apps/worker/src/`: `worker.js` (schema-validated processors, permanent failure for bad payloads, graceful shutdown) · `scheduler.js` (idempotent `upsertJobScheduler`) · `processors/system.js`.
`packages/shared/src/`: UUIDv7 IDs, permission catalog, queue names and default job options.

## 7. Frontend implementation
`apps/frontend/src/`: Phase 2 tokens as Tailwind 4 `@theme` variables · shadcn/ui-style `Button` and `Badge` in JSX (`components.json` with `"tsx": false`) · app shell with skip link and a sidebar that stacks on narrow screens · system-status page (loading, error with retry, degraded and ok states, polling every 15 s) · 404 page · i18next with RTL switching · same-origin API client that parses problem+json.

## 8. Desktop agent
Not in this sprint.

## 9. Tests (results copied from runs on 2026-11-25)
| Suite | Command | Result |
|---|---|---|
| Shared unit | `npm test -w packages/shared` | 7 passed |
| Backend unit (env, app/health/headers/CORS/docs, error mapping, tenant-model guard) | `npm test -w apps/backend` | 25 passed |
| Worker unit | `npm test -w apps/worker` | 6 passed |
| Frontend (RTL: status states, API client) | `npm test -w apps/frontend` | 6 passed |
| Backend integration (real MySQL: tenant scoping on create/read/update/delete, cross-tenant write rejected, fail-closed without context) | `npm run test:integration` | 6 passed |
| Worker integration (real Redis: job end to end, idempotent job ID) | `npm run test:integration` | 1 passed |
| Database invariants | `npm run db:check -w apps/backend` | 14 / 14 pass |
| No TypeScript / syntax / lint / format | `check:no-ts`, `check:syntax`, `lint`, `format:check` | all pass |
| Frontend production build | `npm run build` | built (448 kB JS, 141 kB gzip) |
| Dependency audit | `npm audit --audit-level=high` | passes (0 high/critical; 18 moderate in dev-only Jest coverage tooling) |
| Live API | curl `/health/live`, `/health/ready`, 404, `/api/docs` | as expected; Redis stopped → 503 → recovered to 200 |
| Graceful shutdown | SIGTERM to API and worker | both log orderly shutdown |
| Browser (Playwright, Chromium) | status page at 1280 px and 390 px, 404 route | renders, no console errors, no horizontal scroll on phone |
| Docker | build 3 images; `docker compose --profile app up` | migrate+seed container OK, API healthy, worker started, Nginx serves SPA + deep links with CSP, proxies `/health` |
| CI MySQL workaround | fresh MySQL 8.4 + `SET GLOBAL …` + migrate + db:check | 14 / 14 pass |

The GitHub Actions workflow itself has not run yet, because there is no GitHub repository.

## 10. Documentation
`README.md` (setup, URLs, tests, Docker, troubleshooting) · this sprint record · `docs/phase-5/README.md` (working method).

## 11. Review
**Demo:** `docker compose up -d` → `npm run db:migrate && npm run db:seed` → `npm run dev:backend` / `dev:worker` / `dev:frontend` → open http://localhost:5173 and http://localhost:3000/api/docs.

**Issues found and fixed during the sprint**
1. Prisma queries are lazy. A query returned unawaited from a tenant context ran outside it and was rejected (fail closed). `runWithContext` now documents that queries must be awaited inside it, and the tests do so.
2. Empty `KEY=` lines in `.env` were read as empty strings. An empty `CORS_ORIGINS` would have allowed no origins. Both config loaders now treat empty values as unset (tests added).
3. Nginx doesn't inherit `add_header` into locations that set their own headers, so the security headers would have been lost on SPA routes. They now live in an include file used in each location.
4. `effect@3.20.0` (pulled in by the Prisma CLI) has a high-severity ReDoS advisory. It's overridden to the patched `3.22.5`, and the Prisma CLI was re-verified.

**Deviations from the plan**
| Plan | Actual | Reason |
|---|---|---|
| MinIO for local S3 | SeaweedFS 4.55 | MinIO no longer publishes free container images |
| ESLint 10 | ESLint 9.39 | `eslint-plugin-react` doesn't support ESLint 10 yet |
| Vite 7 / React Router 7 (Phase 1 table) | Vite 8.3 / React Router 8.5 / Zod 4 / BullMQ 6 | Current stable releases at build time |
| Node 24 | Node 24 in Docker and CI (`.nvmrc`); verified locally on Node 22.23 | This environment has Node 22 |

**Version baseline:** express 5.3.0 · zod 4.6.7 · prisma / @prisma/client / adapter-mariadb 7.10.1 · ioredis 6.1.0 · bullmq 6.7.10 · pino 10.4.0 · helmet 8.3.0 · react 19.3.1 · react-router 8.5.3 · @tanstack/react-query 5.108.4 · vite 8.3.8 · tailwindcss 4.3.5 · i18next 27.2.9 · jest 30.5.2 · eslint 9.39.5.

**Known limits (carried forward)**
- API and worker images are about 750 MB. Slimming them (workspace-aware pruning, distroless) is planned for Sprint 16.
- Inter is referenced but not yet self-hosted, so the browser falls back to the system font. Self-hosting comes with the Sprint 2 auth screens.
- The route-registry check (every route must call `authorize()`) arrives with RBAC in Sprint 2.
- No GitHub repository yet, so CI hasn't run and nothing is committed. **This workspace is temporary.**

## 12. Approval
Pending.
