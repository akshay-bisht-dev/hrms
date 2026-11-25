# 03 — Quality Standards

## 1. Definition of Done (every story)

A story is done only when all of these are true:

1. Code is JavaScript only (`.js` / `.jsx` / `.mjs`). CI fails if a `.ts` or `.tsx` file is added.
2. Inputs are validated with Zod at the API boundary. Each endpoint is in the generated OpenAPI document.
3. Authorization is checked on the server for the permission **and** the data scope. Object-level checks are in the module's policy file.
4. Tenant scope: new tenant tables have `tenantId`, composite keys, and are covered by the cross-tenant test suite.
5. Tests are written and passing (§2). Coverage for the changed module is at least 80% of lines, and 100% of branches for calculation code (payroll, leave, work time).
6. The UI has loading, empty, error, success and permission-denied states. It works at 360 px width and passes axe checks with no serious or critical issues.
7. Strings are externalized. No physical left/right CSS.
8. Audit events are written for changes to HR, payroll, permission and monitoring data.
9. Docs are updated: API notes, the module README, and the admin guide if behavior changed.
10. The pull request is reviewed by one other engineer, and by two for payroll, auth, tenancy or monitoring code.

## 2. Test strategy

| Level | Tool | What | Where it runs |
|---|---|---|---|
| Unit | Jest | Pure functions: payroll packs (golden files), leave accrual and day counts, work-session totals, break/idle rules, policy resolution, permission resolution | Every push |
| Property-based | Jest + `fast-check` | Work-session totals: for any event order, worked + break + idle + disconnected = elapsed, and no negative values | Every push |
| Integration | Jest + Supertest + Testcontainers (MySQL 8.4, Redis, MinIO) | Endpoints with a real database: auth flows, tenant isolation, approvals, screenshot slot authorization, device registration | Every push |
| Cross-tenant suite | Generated from the route table | Tenant B tries every tenant-scoped route with tenant A's IDs and expects 404 | Every push; blocks merge |
| Component | React Testing Library + `jest-axe` | Forms, tables, Work Status controls, state rendering | Every push |
| End-to-end | Playwright | The full WFH flow from the brief, payroll run, leave approval. Desktop agent through Playwright's Electron support | On merge to main, and nightly on staging |
| Security | Semgrep, npm audit, OSV, Gitleaks, Trivy, OWASP ZAP baseline on staging | Every push (scanners), nightly (ZAP) |
| Load | k6 | Scenarios in Phase 1 §4 NFRs: heartbeats, session starts, screenshot slots, payroll run, imports | Before each release on staging-sized infra |
| Migration | Custom | Apply all migrations to an empty DB and to a copy of the previous release's schema; run triggers tests | Every push that changes `prisma/` |

## 3. Code standards

- ESLint 9 flat config: `eslint:recommended`, `plugin:react`, `react-hooks`, `jsx-a11y`, `security`, `import`. Prettier for formatting.
- Every exported function has JSDoc with `@param` and `@returns`. Files start with `// @ts-check` so editors flag type mistakes without TypeScript.
- No `Number` arithmetic on money. A lint rule flags `parseFloat` and arithmetic in payroll modules; use `Decimal`.
- No `Date` arithmetic for business days; use the Temporal helpers in `packages/shared/time`.
- Errors are thrown as typed `AppError` subclasses and turned into `problem+json` by one handler.
- Logs are structured (pino) and must never contain tokens, passwords, bank numbers or screenshot URLs.
- Conventional Commits; small pull requests (aim for fewer than 400 changed lines).

## 4. Release quality gates

| Gate | Requirement |
|---|---|
| Merge to main | All push-level checks green; required reviews |
| Deploy to staging | Main green; migrations dry-run |
| Promote to production | E2E green on staging, no high/critical vulnerabilities, k6 targets met for the release, manual approval |
| Desktop agent release | Signed + notarized builds, beta channel for at least 3 days with no crash-rate regression |
