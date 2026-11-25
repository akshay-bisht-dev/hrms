# Phase 2 — Quality, UI/UX & Design (for approval)

| # | Deliverable | Location |
|---|---|---|
| 1 | Design system: tokens, typography, spacing, components, states | [01-design-system.md](01-design-system.md) |
| 2 | Screen inventory per role, with required states | [02-screen-inventory.md](02-screen-inventory.md) |
| 3 | Quality standards: Definition of Done, test strategy, code standards | [03-quality-standards.md](03-quality-standards.md) |
| 4 | Visual designs of the key screens | [Design canvas "HRMS Phase 2 Screens"](https://claude.ai/artifact/KdrmQ8HFuA6yDpTCwwxmJd) (private until shared) |

Designed screens on the canvas:
1. **Design system** — colors, type, buttons, badges, form fields, and the four required states (loading, empty, error, success).
2. **Employee Work Status** (interactive) — check-in with location, monitoring notice, live timer, breaks, tasks, timeline, daily report.
3. **Manager team board** — live availability, filters, approvals queue, task progress. Screenshots stay locked without permission.
4. **Screenshot review** — timeline, access-logged viewing, dispute and privacy-incident actions, retention notice.
5. **Payroll run** — lifecycle stepper, variance review, maker-checker approval, frozen state after finalization.
6. **Desktop agent** — status window, tray indicator and first-run monitoring notice.

The remaining screens in the inventory reuse these patterns and are built in their sprints. Each is reviewed against this design system before it is merged.

## Not in Phase 2
No application code is written. The design tokens become `tailwind.config` / CSS variables in Sprint 1.
