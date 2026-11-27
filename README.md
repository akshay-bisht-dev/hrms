# Workforce HRMS

Multi-tenant HRMS and remote workforce management SaaS for small and medium companies, worldwide.
**JavaScript only:** React + Vite, Node.js + Express, Prisma + MySQL 8.4, Redis + BullMQ, and later an Electron desktop agent.

- Planning and design: [`docs/`](docs) (Phases 1–5) · Sprint records: [`docs/sprints/`](docs/sprints)
- Status: **Sprint 7 (Payroll core and India pack)** complete. Sprint records: [`docs/sprints/`](docs/sprints).

## Repository layout

```
apps/
  backend/      Express API (src/), Prisma schema + migrations (prisma/)
  worker/       BullMQ processors and the job scheduler
  frontend/     React 19 + Vite SPA (Tailwind 4, shadcn/ui-style components in JSX)
packages/
  shared/       Code shared by all apps: IDs, permission catalog, queue names, validation schemas
  payroll/      Payroll engine (decimal.js, safe formulas) and country packs; statutory rates live in versioned rule data
infrastructure/
  docker/       Dockerfiles, local MySQL init, local S3 config
  nginx/        SPA + API reverse proxy config
  scripts/      Repository checks (no TypeScript, syntax)
docs/           Phase 1–5 deliverables and sprint records
```

## Prerequisites

- Node.js 24 LTS (22.12+ works) and npm 10+
- Docker Desktop (or Docker Engine with Compose v2)
- Git and VS Code (recommended)

## Local setup

Install dependencies (this also generates the Prisma client):

```bash
npm install
```

Create your local environment file:

```bash
cp .env.example .env
```

Generate local signing and encryption secrets into `.env` (never used outside your machine):

```bash
npm run keys:dev -w apps/backend
```

Start MySQL 8.4, Redis 7, S3-compatible storage (SeaweedFS) and Mailpit:

```bash
docker compose up -d
```

Create the local storage buckets (SeaweedFS stands in for S3):

```bash
npm run storage:init -w apps/backend
```

Apply database migrations:

```bash
npm run db:migrate
```

Seed reference data (currencies, countries, permission catalog, plans). Safe to run repeatedly:

```bash
npm run db:seed
```

Start the API on http://localhost:3000 (Swagger UI at http://localhost:3000/api/docs):

```bash
npm run dev:backend
```

Start the background worker in a second terminal:

```bash
npm run dev:worker
```

Register the repeatable jobs (run once, or again after adding schedules). They include the attendance roll-up (every 30 minutes), applying future-dated job changes (hourly) and leave accruals with year-end carry-forward (every 6 hours):

```bash
npm run scheduler -w apps/worker
```

Start the frontend on http://localhost:5173 in a third terminal:

```bash
npm run dev:frontend
```

The desktop agent arrives in Sprint 10 and will have its own `npm run dev -w apps/desktop-agent`.

### Local URLs

| Service                  | URL                                                        |
| ------------------------ | ---------------------------------------------------------- |
| Frontend                 | http://localhost:5173                                      |
| API                      | http://localhost:3000                                      |
| Swagger UI               | http://localhost:3000/api/docs                             |
| MySQL                    | localhost:3306 (user `hrms`, password `hrms_dev_password`) |
| Redis                    | localhost:6379                                             |
| S3-compatible storage    | http://localhost:9000                                      |
| Mailpit (captured email) | http://localhost:8025                                      |

## Tests and checks

Unit tests (no services needed):

```bash
npm test
```

Integration tests run against a disposable database (`hrms_test`, created by the local MySQL init script) and Redis. Migrate it once:

```bash
DATABASE_URL='mysql://hrms:hrms_dev_password@127.0.0.1:3306/hrms_test?allowPublicKeyRetrieval=true' npm run db:migrate
```

Then run the database invariant checks and the integration tests:

```bash
DATABASE_URL='mysql://hrms:hrms_dev_password@127.0.0.1:3306/hrms_test?allowPublicKeyRetrieval=true' npm run db:check -w apps/backend
```

```bash
DATABASE_URL='mysql://hrms:hrms_dev_password@127.0.0.1:3306/hrms_test?allowPublicKeyRetrieval=true' npm run test:integration
```

End-to-end tests in a real browser (needs the API, worker and frontend running, plus Mailpit from Docker Compose). All journeys run in parallel from one IP address, so start the API with a higher per-IP sign-in limit for the run (the production default stays 60 a minute):

```bash
AUTH_IP_LIMIT_PER_MIN=300 npm run dev:backend
```

Then:

```bash
npm run test:e2e
```

Repository checks, lint and formatting:

```bash
npm run check:no-ts && npm run check:syntax && npm run lint && npm run format:check
```

Production build of the frontend:

```bash
npm run build
```

## Production-like stack in Docker

Builds the API, worker and web images, runs migrations and the seed in a one-off container, then serves the SPA and API through Nginx on http://localhost:8080:

```bash
docker compose --profile app up -d --build
```

Behind a TLS-inspecting corporate proxy, pass your proxy's CA certificate as an optional build secret (it is never stored in an image layer):

```bash
docker build --secret id=extra_ca,src=/path/to/proxy-ca.pem -f infrastructure/docker/backend.Dockerfile -t hrms-backend:dev .
```

## Troubleshooting

| Symptom                                                          | Cause and fix                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Invalid environment configuration: DATABASE_URL …` at startup   | `.env` missing or incomplete. Run `cp .env.example .env`. `npm start` deliberately ignores `.env`; use the `dev` scripts locally.                                                                                                                            |
| Migration fails with database error **1419**                     | MySQL has binary logging on, and the app user can't create triggers without `log_bin_trust_function_creators=1`. The compose file sets it. For other servers, run `SET GLOBAL log_bin_trust_function_creators = 1;` as root, or use the RDS parameter group. |
| `P3018 A migration failed to apply` after a failed run           | Local only: `docker compose down -v` removes the database volume, then migrate again. Never do this in production; use `prisma migrate resolve`.                                                                                                             |
| `/health/ready` returns 503                                      | The body says which dependency is down. Check `docker compose ps`.                                                                                                                                                                                           |
| Port 3306/6379/5173 already in use                               | Stop the other service, or change the published port in `docker-compose.yml` and the matching URL in `.env`.                                                                                                                                                 |
| Frontend shows "Couldn't reach the API"                          | Start the API (`npm run dev:backend`). Vite proxies `/api` and `/health` to port 3000.                                                                                                                                                                       |
| `SELF_SIGNED_CERT_IN_CHAIN` during `docker build`                | A TLS-inspecting proxy. Pass its CA as `--secret id=extra_ca,src=…` (see above).                                                                                                                                                                             |
| `Invalid environment configuration: JWT_ACCESS_PRIVATE_KEY …`    | Run `npm run keys:dev -w apps/backend` once.                                                                                                                                                                                                                 |
| E2E or manual sign-ins get "Too many attempts"                   | Per-IP and per-account limits work as designed. Locally, `docker compose exec redis redis-cli --scan --pattern 'rl:*' \| xargs docker compose exec -T redis redis-cli del`, or wait for the window to pass. `npm run test:e2e` clears them itself.           |
| Past days show "Not recorded" in Team attendance                 | Day rows for people who didn't clock in are created by the roll-up job. Start the worker and run `npm run scheduler -w apps/worker` once. After changing shifts or rules, use Settings → Attendance → Recalculate.                                           |
| Clock-in says "Your sign-in is not linked to an employee record" | Link the account in Settings → Members, or invite the person from their employee profile (_Invite to sign in_).                                                                                                                                              |
| Jest says "did not exit one second after the test run"           | A test left a Redis or DB connection open. BullMQ does not close connections it is given; close them in `afterAll`.                                                                                                                                          |
