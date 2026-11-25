# Phase 3 — Security & Safety (for approval)

| # | Deliverable | Location |
|---|---|---|
| 1 | Threat model: assets, actors, trust boundaries, STRIDE, monitoring abuse cases, accepted risks | [01-threat-model.md](01-threat-model.md) |
| 2 | Security controls spec: auth, RBAC and the sensitive-permission catalog, tenant isolation, app security, files and screenshots, desktop agent, crypto, ops, logging | [02-security-controls.md](02-security-controls.md) |
| 3 | Privacy and compliance program: data inventory, defaults, monitoring activation checklist, DPIA template, employee notice template, data-subject rights, retention, breach response | [03-privacy-compliance.md](03-privacy-compliance.md) |
| 4 | Security test catalogue (30 cases covering every item in the brief), cross-tenant suite, vulnerability SLAs, incident response | [04-security-testing-and-operations.md](04-security-testing-and-operations.md) |

## Decisions that need the owner's sign-off

1. **Accepted risks** (01 §6): automated keep-alive of sessions is not detected invasively; screenshots may still show other windows; no Wayland screenshots.
2. **Mandatory MFA** for admins, payroll/finance and anyone with screenshot permissions (AUTH-07).
3. **Monitoring guardrails** that tenants cannot override: minimum 5-minute interval, a default exclusion list, a 90-day retention maximum, a minimum group size of 5 (unless a reason is recorded), and re-acknowledgment when collection expands (MON-02, MON-03).
4. **Breach notification** to tenants within 24 hours of confirmation (03 §9).
5. **Certifications:** SOC 2 Type I within 6 months of GA, ISO 27001 in year 2 (03 §11).
