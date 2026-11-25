# Sprint 2 — Authentication & RBAC

Status: **Complete, awaiting owner approval** · Date: 2026-11-25

## 1. Objectives
Let a company sign up and its people sign in securely: email verification, password sign-in with lockout, short-lived access tokens with rotating refresh tokens, optional (and for sensitive roles, required) two-step verification, password reset and change, session management, and the permission engine every later module uses.

## 2. Scope
**In:** register (user + company + legal entity + 9 default roles + Company Admin membership) · email verification · login with per-account lockout and per-IP limits · refresh rotation with reuse detection · CSRF + Origin checks · logout / logout everywhere · forgot / reset / change password · TOTP MFA with recovery codes · session list and revoke · RBAC: permission catalog, default roles, data scopes, `authorize`, MFA enforcement for sensitive permissions, deny-by-default route registry · transactional email through the worker · frontend sign-in, sign-up, verify, forgot/reset, MFA and Security screens.

**Out:** inviting more users and switching between companies (Sprint 3, with members), SSO/passkeys (Sprint 16), KMS-backed encryption keys (with the AWS setup).

## 3. Dependencies
Sprint 1 foundation. No external accounts. Breached-password check (HIBP) is implemented but off by default (`PASSWORD_BREACH_CHECK=hibp` to enable).

## 4. Database changes
None. All tables already existed from the Phase 4 schema: `users`, `refresh_tokens`, `mfa_factors`, `recovery_codes`, `auth_tokens`, `tenant_memberships`, `roles`, `role_permissions`, `membership_roles`, `audit_logs`.

## 5. API design (`/api/v1`)
| Method | Path | Access |
|---|---|---|
| POST | `/auth/register` · `/auth/verify-email` · `/auth/resend-verification` · `/auth/login` · `/auth/mfa/verify` · `/auth/forgot-password` · `/auth/reset-password` | public (rate-limited) |
| POST | `/auth/refresh` · `/auth/logout` | public + CSRF header + allowed Origin |
| GET | `/auth/me` · `/auth/sessions` | authenticated |
| POST | `/auth/logout-all` · `/auth/password` · `/auth/mfa/setup` · `/auth/mfa/confirm` · `/auth/mfa/disable` | authenticated |
| DELETE | `/auth/sessions/:id` | authenticated (own sessions only) |
| GET | `/reference/countries` | public |

All routes are in Swagger at `/api/docs`. A route without an access declaration makes the API refuse to start.

## 6. Backend implementation
- `modules/auth/`: `auth.service.js` (all flows), `auth.routes.js`, `jwt.js` (EdDSA/Ed25519 with key IDs, rotation, and region-bound issuer), `password.js` (Argon2id m=64 MiB t=3 p=1, NFKC normalisation, policy, HIBP k-anonymity), `totp.js` (RFC 6238 using `node:crypto`).
- `modules/rbac/access.js`: membership → roles → permissions. The broadest scope wins, and the result is cached for 60 s.
- `middleware/auth.js`: `authenticate` (checks the session-revoked marker), and `access.public / authenticated / permission(code)`. Sensitive permissions need an MFA-verified session.
- `lib/`: `crypto.js` (HMAC token hashing, AES-256-GCM with AAD), `cookies.js` (HttpOnly SameSite=Strict refresh cookie, `__Host-` prefix when Secure, double-submit CSRF), `route-registry.js`, `audit.js`, `queues.js`.
- Worker: `processors/notifications.js` + `email-templates.js` (7 templates, HTML-escaped), sent over SMTP (Mailpit locally; SES SMTP in production).
- `scripts/keys-dev.mjs`: generates local secrets into `.env`.

## 7. Frontend implementation
Sign-in (with MFA and recovery-code steps), sign-up with a country list from the API, email verification, forgot and reset password. The Security page has authenticator setup with a QR code, recovery codes, session list with revoke, and password change. The app shell shows the company name, user and sign-out, and a banner when the role requires MFA. The access token is kept in memory only. The refresh cookie restores the session on reload. Refreshes are serialised across tabs with Web Locks.

Screenshots: [`sprint-02/s2-login.png`](sprint-02/s2-login.png), [`sprint-02/s2-register.png`](sprint-02/s2-register.png), [`sprint-02/s2-security.png`](sprint-02/s2-security.png).

## 8. Desktop agent
Not in this sprint (device tokens come in Sprint 10).

## 9. Tests (results copied from runs on 2026-11-25)
| Suite | Result |
|---|---|
| Shared unit (catalog, default roles, schemas) | 14 passed |
| Backend unit (TOTP against the RFC 4226/6238 vectors, AES-GCM, JWT incl. alg=none/HS256 forgery and key rotation, Argon2id, password policy, HIBP prefix-only, scope merging, route registry, CSRF, env) | 53 passed |
| Worker unit (templates, escaping, email processor) | 10 passed |
| Frontend (login validation and errors, MFA step, resend verification, token refresh + retry, registration, route guard, no refresh without session) | 14 passed |
| Backend integration, real MySQL + Redis (29): registration side effects, uniform responses, password rules, unverified login blocked, one-time links, cookie flags, tampered tokens, refresh rotation, **reuse detection revokes the family**, session list/revoke and ownership, logout/logout-all, account lockout (known and unknown emails), per-IP limit, reset/change password revoke sessions, full MFA lifecycle incl. replay block, recovery code once, 5-attempt challenge cap, MFA-gated sensitive permission, missing permission → 403, suspended membership rejected, public countries | 29 passed |
| Worker integration (BullMQ end to end) | 1 passed |
| **Mutation check:** disabled refresh reuse detection and TOTP replay protection on purpose | suite failed as it should (2 failures); code restored |
| **End-to-end (Playwright, Chromium, real email via worker → SMTP → Mailpit):** register → open the emailed link → sign in → reload keeps the session and no token is in storage → turn on MFA (QR) → 10 recovery codes → sign out → sign in with a TOTP code → session listed; and forgot password → emailed link → old password rejected, new one works | 2 passed |
| Lint, no-TypeScript, syntax, format, frontend build, `npm audit --audit-level=high` | all pass |

## 10. Documentation
README (local secrets step, E2E command, troubleshooting), `.env.example` (auth settings), Swagger, this record.

## 11. Review
**Issues found and fixed during the sprint**
1. Every anonymous page load sent a refresh request that the CSRF check rejected (403). The app now skips it when no session cookie exists.
2. **Per-IP sign-in limit:** Phase 3 set 20/min, which would block an office of 50 people behind one IP at 9:00. It's now configurable (`AUTH_IP_LIMIT_PER_MIN`, default 60). Per-account lockout (10 failures → 15 min, the same for unknown emails) remains the main brute-force control.
3. Frontend tests: React Router 8 ships only as ES modules, so frontend Jest now runs in native ESM mode, with a jsdom environment that adds Node's Fetch API classes.
4. The `otplib` v13 API changed. TOTP is implemented directly with `node:crypto` and checked against the RFC test vectors.

**Deviations from Phase 3**
| Phase 3 | Now | Reason |
|---|---|---|
| AUTH-04: login 20/min per IP | 60/min default, configurable | Shared office IPs (see 2 above) |
| CRY-03: KMS envelope keys | Local AES-256-GCM key (`DATA_ENCRYPTION_KEY`) behind the same interface | KMS comes with the AWS setup |
| AUTH-12: list and revoke sessions | Done. Admin "force sign-out" for other members | Moves to Sprint 3 (members) |

**Known limits**
- Users have exactly one company until invitations arrive in Sprint 3. Company switching comes then.
- `MFA_ENFORCE_FOR_SENSITIVE` applies per request. A Company Admin without MFA can sign in and use non-sensitive features, and is shown a banner.
- The E2E suite runs locally. A CI job that starts the full stack is planned with Sprint 3.
- The workspace is still not in a git repository.

## 12. Approval
Pending.
