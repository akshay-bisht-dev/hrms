# 04 — Security Test Plan & Security Operations

## 1. Security test catalogue

Every case below becomes an automated test in the sprint that builds the feature (✓ = automated in CI, M = manual/pen test). IDs are stable so results can be tracked release by release.

| ID | Brief item | Test | Expected | Type |
|---|---|---|---|---|
| ST-01 | Cross-tenant access | Tenant B token requests every tenant-scoped route with tenant A IDs (generated from route table) | 404 for all, no data in body | ✓ |
| ST-02 | Cross-tenant access | Create a child record in tenant B pointing at tenant A's parent ID | Rejected (composite FK / validation) | ✓ |
| ST-03 | Cross-tenant access | Repository call without tenant context | Throws, nothing returned | ✓ |
| ST-04 | Unauthorized screenshots | Manager without `view_team_screenshots` requests list and view-URL | 403/404, access attempt logged | ✓ |
| ST-05 | Unauthorized screenshots | Manager with permission requests screenshot of employee outside their scope | 404 | ✓ |
| ST-06 | Unauthorized screenshots | Request a view URL for a disputed screenshot (non-reviewer) | 404 | ✓ |
| ST-07 | Unauthorized screenshots | Reuse a signed URL after 60 s | S3 403 | ✓ |
| ST-08 | Expired desktop tokens | Agent calls with expired access token / revoked device / reused refresh token | 401; reuse revokes family | ✓ |
| ST-09 | Invalid device registration | Expired, reused, other-tenant or brute-forced pairing codes | Rejected; 5 failures lock the code | ✓ |
| ST-10 | Invalid device registration | Web access token used on agent-only endpoints and vice versa (`aud` mismatch) | 401 | ✓ |
| ST-11 | Screenshot upload | Slot request with no active session / on break / outside allowed hours / unacknowledged policy | 409/403, no slot | ✓ |
| ST-12 | Screenshot upload | Upload to a different key, oversized file, non-WebP content | S3 rejects / worker marks invalid and deletes | ✓ |
| ST-13 | Unauthorized file downloads | Document download by an employee without document permission; by another tenant | 404 | ✓ |
| ST-14 | Privilege escalation | User grants self a sensitive permission; manager edits own role; employee calls admin routes | 403, audit event | ✓ |
| ST-15 | Privilege escalation | Self-approval of leave, timesheet, correction, payroll (reviewer = approver) | 403 | ✓ |
| ST-16 | SQL injection | Fuzz all string params with SQLi payloads (Supertest + payload list); Semgrep raw-SQL rule | No 500s, no data change | ✓ |
| ST-17 | XSS | Stored payloads in names, comments, job posts rendered in Playwright; CSP violation report check | No script execution | ✓ |
| ST-18 | CSRF | Cross-origin POST to refresh/logout without CSRF header or wrong Origin | 403 | ✓ |
| ST-19 | File upload attacks | Polyglot JPEG/JS, EICAR test file, SVG with script, zip bomb DOCX, path-traversal filenames | Rejected/quarantined; names sanitized | ✓ |
| ST-20 | API abuse | Exceed rate limits per class; enumerate IDs; large page sizes; deep filters | 429 / capped; no timing difference for existence | ✓ |
| ST-21 | Data leakage | Snapshot-test API responses for forbidden fields (password hash, token hashes, full bank numbers without permission) | Fields absent | ✓ |
| ST-22 | Data leakage | Log capture during test run scanned for tokens, emails in plaintext, bank numbers | None found | ✓ |
| ST-23 | Payroll integrity | UPDATE/DELETE on finalized payroll rows via SQL | Trigger error | ✓ |
| ST-24 | Audit integrity | UPDATE/DELETE on audit_logs | Trigger error | ✓ |
| ST-25 | Monitoring policy limits | Set interval < 5 min, remove default exclusions, retention > max, group < 5 without reason | 422 | ✓ |
| ST-26 | Monitoring transparency | Agent E2E: capture is never attempted without tray "ON" state and acknowledged policy; pause on break/lock/idle | No capture events | ✓ (Playwright Electron) |
| ST-27 | Electron hardening | Automated check of BrowserWindow options, fuses, CSP, entitlements; attempt `window.open`, navigation, `require` from renderer | Blocked | ✓ |
| ST-28 | Auth | Brute force, lockout, MFA bypass attempts (skip step, replay TOTP), password reset token reuse | Blocked | ✓ |
| ST-29 | Headers/TLS | Header scan (ZAP baseline), TLS config scan on staging | No high findings | ✓ nightly |
| ST-30 | Whole system | External penetration test incl. desktop agent and cloud config review | No unresolved high/critical | M |

## 2. Cross-tenant suite design

- A route registry is exported by the backend (method, path, permission, tenant-scoped flag, sample-ID resolver).
- Test fixture seeds two tenants with one of every entity.
- For each tenant-scoped route the suite runs: (a) tenant A owner — expects success (sanity), (b) tenant B Company Admin with full permissions — expects 404 and no tenant-A field values anywhere in the response.
- New routes without a registry entry fail the suite, so coverage can't silently drop.

## 3. Vulnerability management

| Severity (CVSS) | Fix target in production |
|---|---|
| Critical | 48 hours |
| High | 7 days |
| Medium | 30 days |
| Low | 90 days or accepted with sign-off |

Sources: scanners in CI, dependency alerts, pen tests, bug reports via `security.txt` and a responsible-disclosure page (bug bounty after GA).

## 4. Incident response

| Phase | Actions |
|---|---|
| Prepare | On-call rota, runbooks (token leak, data exposure, compromised device fleet, signing key compromise, ransomware), contact list, tabletop exercise each quarter |
| Detect | Alerts from LOG-03, GuardDuty, WAF, customer reports |
| Contain | Revoke tokens/keys, block IPs, disable features via flags (e.g., stop all screenshot slots for a tenant or cell), isolate tasks |
| Eradicate & recover | Patch, rotate secrets, restore from clean backups, verify |
| Notify | Tenants per 03 §9; regulators where the vendor is controller |
| Learn | Blameless review, control updates, test cases added to §1 |

Special runbook — **code-signing or update-channel compromise**: revoke certificate, pull update feed, publish emergency signed release, notify tenants' IT with hashes, agents refuse unsigned updates by design.

## 5. Security sign-off per sprint

Each sprint review includes: threat-model delta for new features · new ST tests passing · scanner results · secrets check · privacy check (new data fields classified, retention set, notice text updated if monitoring changed).
