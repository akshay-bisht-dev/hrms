# 02 — Security Controls Specification

Each control has an ID used by the threat model (01) and the test plan (04). "MUST" items block release.

## 1. Authentication (AUTH)

| ID | Control | Parameters |
|---|---|---|
| AUTH-01 | Password hashing with Argon2id | m = 64 MiB, t = 3, p = 1, 16-byte salt, 32-byte hash; parameters stored in the hash string; rehash on login if parameters change |
| AUTH-02 | Password policy (NIST SP 800-63B) | Min 12 chars, max 128, no composition rules, all Unicode allowed (NFKC normalized), no forced rotation |
| AUTH-03 | Uniform responses | Login, forgot-password and registration responses don't reveal whether an email exists; constant-time comparisons |
| AUTH-04 | Rate limiting | Login: 5/min per account, 20/min per IP, with exponential delay after 5 failures; forgot-password: 3/hour per account; all limits in Redis (shared across instances) |
| AUTH-05 | Account lockout | Soft lock 15 min after 10 failures in 1 h; email notice to the user; no permanent lock (avoid DoS) |
| AUTH-06 | Breached password check | k-anonymity range query (first 5 SHA-1 chars) against a breached-password corpus; reject matches. Only a hash prefix leaves the system |
| AUTH-07 | MFA | TOTP (RFC 6238, 30 s, ±1 step), 10 single-use recovery codes (hashed). **Mandatory** for Super Admin, Company Admin, Payroll Manager, Finance Manager and anyone holding a sensitive monitoring permission. Tenants can require it for everyone. WebAuthn/passkeys planned for Sprint 16 |
| AUTH-08 | Access token | JWT, `alg: EdDSA` (Ed25519), 15 min, claims `sub, tid, sid, aud, iat, exp, jti`; key ID header; keys rotated every 90 days, two active at once; held in SPA memory only |
| AUTH-09 | Refresh token | 256-bit random, stored as SHA-256 hash, 14-day absolute / 24-hour idle; rotated on each use; reuse of an old token revokes the whole family and alerts the user |
| AUTH-10 | Cookie & CSRF | `__Host-rt` cookie: `HttpOnly; Secure; SameSite=Strict; Path=/`; refresh/logout also require `X-CSRF-Token` matching a non-HttpOnly cookie and an allowed `Origin` |
| AUTH-11 | Email verification & password reset tokens | 256-bit, hashed, single-use; 24 h (verify) / 30 min (reset); reset revokes all sessions |
| AUTH-12 | Session management | User can list and revoke sessions and devices; admins can force sign-out for any tenant member; permission changes take effect within 60 s (membership cache TTL) |
| AUTH-13 | Re-authentication | Password or MFA re-check (within 5 min) before: changing email/password/MFA, viewing full bank numbers, downloading screenshots, approving payroll, granting sensitive permissions |
| AUTH-14 | SSO (later) | SAML 2.0 / OIDC per tenant in Sprint 16; MFA policy delegated to IdP when SSO is enforced |

## 2. Authorization (RBAC)

| ID | Control |
|---|---|
| RBAC-01 | Deny by default: every route declares `authorize(permission)`; a route without it fails a startup check |
| RBAC-02 | Permissions are `module.resource.action` codes stored in a seeded catalog; tenants compose roles from them but cannot invent codes |
| RBAC-03 | Data scope (`own`, `team`, `department`, `branch`, `legal_entity`, `company`) resolved server-side from the hierarchy closure table and employment records |
| RBAC-04 | Object-level policy functions per module (e.g., `canApproveLeave(actor, request)`); nobody can approve their own request |
| RBAC-05 | Sensitive permissions (table below) cannot be self-granted, require a Company Admin (MFA) to grant, are audited, and notify all Company Admins |
| RBAC-06 | Field-level masking: bank account shows last 4 digits; national IDs masked unless `employee.sensitive.view`; salary hidden without `payroll.salary.view` |
| RBAC-07 | Break-glass (vendor access): request with reason → tenant Company Admin approval (or legal emergency with 2 vendor approvers) → time-boxed (max 4 h) read-only token → banner in the tenant's audit log |

### Sensitive permission catalog

| Group | Codes |
|---|---|
| Payroll | `payroll.salary.view`, `payroll.salary.manage`, `payroll.run.create`, `payroll.run.review`, `payroll.run.approve`, `payroll.bank.view`, `payroll.bank.manage`, `payroll.config.manage` |
| Monitoring | `view_team_work_status`, `view_own_screenshots`*, `view_team_screenshots`, `download_screenshots`, `manage_monitoring_policy`, `view_activity_reports` |
| Work management | `approve_timesheets`, `approve_work_reports`, `manage_work_sessions` |
| Employee data | `employee.sensitive.view`, `employee.documents.view`, `employee.bulk.export` |
| Admin | `roles.manage`, `audit.log.view`, `subscription.manage`, `reports.export` |

\* `view_own_screenshots` is granted to every monitored employee and cannot be removed while monitoring applies to them.

Default role mapping: **no** default role except Company Admin holds `view_team_screenshots`, `download_screenshots` or payroll permissions. Department Manager and Team Leader get `view_team_work_status`, `approve_timesheets` and `approve_work_reports` only.

## 3. Tenant isolation (TEN)

| ID | Control |
|---|---|
| TEN-01 | Tenant resolved from verified token + active membership lookup; request-supplied tenant identifiers ignored |
| TEN-02 | AsyncLocalStorage context set by middleware and job runner; missing context on a tenant model throws (fail closed) |
| TEN-03 | Prisma client extension injects `tenantId` on all operations for tenant models, including nested writes and `findUnique` (rewritten to `findFirst` with tenant filter) |
| TEN-04 | Composite unique `(tenant_id, id)` and composite foreign keys on all tenant tables |
| TEN-05 | Raw SQL only through `tenantSql\`...\`` helper that requires the tenant parameter; Semgrep rule forbids `$queryRawUnsafe` |
| TEN-06 | Storage keys derived only from DB records already loaded under tenant scope |
| TEN-07 | Cache keys namespaced `t:{tenantId}:`; helper refuses keys without it |
| TEN-08 | Cross-tenant automated suite (04 §2) gates every merge |
| TEN-09 | Regional cell isolation: separate accounts/VPCs per cell; token signing keys per cell |

## 4. Application security (APP)

| ID | Control |
|---|---|
| APP-01 | All DB access through Prisma; no string-built SQL |
| APP-02 | React escaping by default; `dangerouslySetInnerHTML` only via a `SafeHtml` component that runs DOMPurify; lint rule enforces it |
| APP-03 | Security headers (Helmet): CSP `default-src 'self'; script-src 'self' 'nonce-…'; style-src 'self'; img-src 'self' data: https://*.amazonaws.com; connect-src 'self' https://api.<cell>; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`; HSTS 2 years with preload; `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy` disabling camera, microphone, geolocation (unless geo check-in is enabled) |
| APP-04 | CORS: allowlist of the SPA origins for that cell; credentials only for auth routes |
| APP-05 | Validation: Zod schemas with `.strict()` (unknown keys rejected); max body 1 MB JSON (uploads go to S3 directly); string length limits on every field |
| APP-06 | Export safety: CSV formula injection neutralized; exports watermarked with requester and time |
| APP-07 | Error handling: no stack traces or SQL errors to clients; `problem+json` with request ID |
| APP-08 | Mass-assignment protection: services accept explicit DTOs built from validated input |
| APP-09 | SSRF: no user-supplied URLs fetched server-side, except webhooks to tenant-configured endpoints via an egress proxy that blocks private IP ranges |
| APP-10 | Idempotency keys on create/financial/session endpoints; stored with request hash; replay with a different body → 422 |
| APP-11 | Rate limits per route class (auth, read, write, export, heartbeat, upload-slot) with `RateLimit-*` headers |
| APP-12 | Public endpoints (careers apply) protected by CAPTCHA (privacy-friendly, e.g., Turnstile/hCaptcha) and per-IP limits |

## 5. Files & screenshots (FILE / SCR)

| ID | Control |
|---|---|
| FILE-01 | Uploads via presigned POST with exact key, `Content-Type` and `content-length-range`; 60 s expiry |
| FILE-02 | Allowed types per purpose (documents: PDF, PNG, JPEG, DOCX; resumes: PDF, DOCX; screenshots: WebP only) verified by magic bytes in the worker |
| FILE-03 | Malware scan (ClamAV) before a document is marked available; infected files quarantined and owner notified |
| FILE-04 | Images re-encoded with `sharp` (strips EXIF/metadata, neutralizes polyglots) |
| FILE-05 | Downloads via 60 s presigned GET with `Content-Disposition: attachment` and the original name sanitized |
| FILE-06 | No server-side archive extraction; DOCX parsed in a sandboxed worker with size and time limits |
| SCR-01 | Separate screenshots bucket, SSE-KMS with a dedicated CMK per cell; key policy lets only the worker role decrypt for processing and the API role sign GETs |
| SCR-02 | View URLs expire in 60 s; never cached by the SPA; `Cache-Control: no-store` |
| SCR-03 | Every view, download, export, delete and dispute action writes `screenshot_access_logs`; employees can see who viewed their screenshots |
| SCR-04 | Downloaded copies are watermarked (viewer name, time, tenant) |
| SCR-05 | Retention deletion nightly; S3 lifecycle backstop by tag; deletion verified by a follow-up HEAD check |
| SCR-06 | Disputed and incident-reported images hidden from all viewers except the assigned reviewer |
| SCR-07 | Never sent by email, never embedded in notifications or reports |

## 6. Desktop agent (DEV / MON)

| ID | Control |
|---|---|
| DEV-01 | Electron hardening: `contextIsolation`, `sandbox`, no `nodeIntegration`, no `webview`, navigation and window-open blocked, strict CSP, fuses (`RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` off, `OnlyLoadAppFromAsar` on, `EnableEmbeddedAsarIntegrityValidation` on) |
| DEV-02 | IPC: one `contextBridge` API with a fixed list of channels; each handler validates sender origin and payload (Zod) |
| DEV-03 | Device tokens: pairing code (single use, 10 min) → device refresh token in OS keychain via `safeStorage` → 10 min access tokens with `aud=desktop-agent`, `did` claim |
| DEV-04 | Device revocation takes effect at the next API call (≤ 10 min, typically seconds via heartbeat response) and wipes local tokens and queues |
| DEV-05 | Policy is declarative JSON validated against a schema; the agent has **no** remote-command capability |
| DEV-06 | Updates: `electron-updater` over HTTPS from our CDN; signature checked (Authenticode / Apple code signature) before install; staged rollout |
| DEV-07 | Local queue encrypted with a key held in the OS keychain; max 72 h / 50 MB; contains no screenshots |
| MON-01 | Capture preconditions enforced in the agent **and** the server (slot request rejected unless session active, policy acknowledged, inside allowed hours, device active) |
| MON-02 | Policy limits: minimum interval 5 min; jitter ±20%; default exclusion list cannot be emptied; retention ≤ plan max; group size ≥ 5 unless a reason is recorded |
| MON-03 | Policy changes that expand collection require employee re-acknowledgment before they apply |
| MON-04 | No APIs for keyboard hooks, clipboard, camera or microphone are linked; macOS entitlements file reviewed in CI (fails if those entitlements appear) |

## 7. Cryptography & key management (CRY)

| ID | Control |
|---|---|
| CRY-01 | TLS 1.2+ (prefer 1.3) at CloudFront/ALB; internal traffic over TLS within the VPC for DB and Redis (`require_secure_transport=ON`, Redis TLS + AUTH) |
| CRY-02 | At rest: RDS, ElastiCache, S3, EBS encrypted with KMS CMKs per cell and data class |
| CRY-03 | Field encryption for Restricted fields: AES-256-GCM envelope encryption; per-tenant data key encrypted by KMS; cached in memory ≤ 5 min; key ID stored with ciphertext for rotation |
| CRY-04 | Searchable sensitive fields (e.g., national ID uniqueness) use HMAC-SHA256 blind index with a separate key |
| CRY-05 | Key rotation: KMS yearly automatic; JWT signing keys 90 days; tenant data keys re-wrapped on CMK rotation |
| CRY-06 | Secure randomness only from `crypto.randomBytes` / `crypto.randomUUID` |

## 8. Secrets, infrastructure & supply chain (OPS)

| ID | Control |
|---|---|
| OPS-01 | Secrets in AWS Secrets Manager, injected as ECS secrets; never in images, env files committed, or logs |
| OPS-02 | CI uses GitHub OIDC to assume short-lived AWS roles; no long-lived cloud keys in GitHub |
| OPS-03 | IAM least privilege per service; SCPs deny disabling CloudTrail, making S3 public, or sharing snapshots outside the org |
| OPS-04 | Network: private subnets, security groups by service, VPC endpoints, no SSH (ECS Exec audited for break-glass) |
| OPS-05 | Dependencies: lockfile, Dependabot, OSV-Scanner, `npm audit --audit-level=high` blocking, new-package review for packages < 30 days old |
| OPS-06 | Containers: minimal base (distroless Node), non-root user, read-only filesystem, Trivy scan blocking on critical |
| OPS-07 | SBOM (CycloneDX) per release; artifacts and images signed (cosign) |
| OPS-08 | Branch protection: reviews required, signed commits on `main`, CODEOWNERS for `auth/`, `tenant/`, `payroll/`, `screenshot/`, `desktop-agent/` |

## 9. Logging, monitoring & audit (LOG)

| ID | Control |
|---|---|
| LOG-01 | Structured logs with request ID, tenant ID, user ID (pseudonymous), route, status, latency; redaction list for secrets and PII |
| LOG-02 | Security events: login success/failure, MFA changes, token reuse, permission grants, break-glass, monitoring policy changes, screenshot views/downloads, exports, device registration/revocation, rate-limit hits |
| LOG-03 | Alerts: token reuse, > 20 failed logins/min per tenant, cross-tenant 404 spikes, unusual screenshot viewing volume, export volume, admin actions outside business hours (tenant-configurable) |
| LOG-04 | Audit log immutable (trigger), exported monthly to S3 Object Lock; retention 7 years for audit, 1 year for app logs |
| LOG-05 | Tenant admins get an in-app audit log view and export; employees see access logs for their own sensitive data (screenshots, salary views by HR) |

## 10. Webhooks & integrations (WH)

| ID | Control |
|---|---|
| WH-01 | Incoming webhooks verified by provider signature with ≤ 5 min timestamp tolerance; processed idempotently by event ID |
| WH-02 | Outgoing webhooks signed with HMAC-SHA256 per subscription secret; retries with backoff; endpoint allowlist validation |
| WH-03 | API keys for integrations (later): scoped, hashed at rest, expiring, per-tenant, shown once |
