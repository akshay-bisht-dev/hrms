# Phase 5 — Working Method

## 1. Cadence

- Two-week sprints, 16 planned (see Phase 1, 05 §1 and 06 §7 for the order).
- Each sprint has a document at `docs/sprints/sprint-NN.md`, written before coding starts and completed at the end.
- **The owner approves each sprint at its review.** The next sprint starts only after approval. Feedback on a reviewed sprint is fixed before new scope begins.

## 2. Sprint document template

Every sprint document uses these headings, in this order:

1. **Objectives** — the outcome in 2–4 sentences.
2. **Scope** — in scope / out of scope.
3. **Dependencies** — earlier sprints, external services, decisions.
4. **Database changes** — migrations, triggers, seed data.
5. **API design** — endpoints, permissions, request/response schemas.
6. **Backend implementation** — modules and files.
7. **Frontend implementation** — screens and components.
8. **Desktop agent** — only if touched.
9. **Tests** — what was added, with the exact commands and their results.
10. **Documentation** — what was updated.
11. **Review** — demo steps, known limits, deviations from the plan.
12. **Approval** — owner decision and date.

## 3. Rules that apply to every sprint

- Definition of Done from Phase 2 (`docs/phase-2/03-quality-standards.md`) and the security sign-off from Phase 3 (`docs/phase-3/04-security-testing-and-operations.md` §5).
- **No fake functionality:** a button is either wired to a working backend path or not shown.
- Test results in the sprint document are copied from real runs, never written by hand.
- Anything not done is listed under "Review → known limits", never silently dropped.
- JavaScript only. `npm run check:no-ts` must pass.

## 4. Branching & commits (once the GitHub repository exists)

- `main` is protected. Work happens on `sprint-NN/<topic>` branches, with pull requests reviewed and CI green before merge.
- Conventional Commits (`feat(auth): …`, `fix(payroll): …`).
- Each sprint ends with a tag `sprint-NN`.

## 5. Environments per sprint

| Sprint | Runs on |
|---|---|
| 1–9 | Local Docker Compose + CI |
| 10+ | Also staging on AWS (Terraform), once the AWS account and domain are provided |
