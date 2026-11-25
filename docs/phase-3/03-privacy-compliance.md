# 03 — Privacy & Compliance Program

> **Not legal advice.** This document describes the product controls and processes the platform provides. Each tenant (as data controller/fiduciary) must get its own legal review for every country where it employs people. Before general availability, the vendor's own policies, DPA and the jurisdiction registry must be reviewed by qualified counsel in each launch market.

## 1. Roles under privacy law

| Party | Role |
|---|---|
| Tenant (the employer) | Controller (GDPR) / Data Fiduciary (DPDP) / Business (CCPA) |
| Our company (the SaaS vendor) | Processor / Data Processor / Service Provider, under a DPA with each tenant |
| Sub-processors | AWS (hosting), Amazon SES (email), Stripe / Razorpay (billing — tenant admin data only), CAPTCHA provider (careers page), error-monitoring service (scrubbed) |

The vendor is a controller only for its own customer-account and billing data.

## 2. Data inventory & classification

| Category | Examples | Class | Default retention | Lawful basis examples (tenant decides) |
|---|---|---|---|---|
| Identity & contact | Name, work email, phone, address | Confidential | Employment + per country rules | Contract, legal obligation |
| Employment | Job, manager, location, history | Confidential | Employment + statutory period | Contract |
| Financial | Salary, bank, tax IDs, payslips | Restricted | Statutory books period (e.g., 8 years IN, 6 years UK) | Legal obligation, contract |
| National IDs | PAN, Aadhaar (masked), NI number, SSN | Restricted | As required by law only | Legal obligation |
| Health / special category | Sick-leave notes, medical certificates, disability accommodations | Restricted | Minimum needed | Employment-law exemptions; explicit consent where required |
| Attendance & leave | Punches, leave requests | Confidential | Per country (typically 3–6 years) | Contract, legal obligation (working-time records) |
| Work sessions & idle | Session events, breaks, idle periods | Confidential | 13 months | Legitimate interest / contract — **requires tenant assessment** |
| App activity metadata | App category, approved-app time buckets | Confidential | 90 days | Legitimate interest — **requires tenant assessment**; off by default |
| Screenshots | Images of the screen | Restricted | 30 days default, max 90 | Legitimate interest — **requires DPIA where required**; off by default |
| Candidates | CV, interview feedback | Confidential | 12 months after decision | Legitimate interest / consent (for talent pool) |
| Audit logs | Who did what | Confidential | 7 years | Legitimate interest, legal obligation |

**Prohibited by design:** keystrokes, typed content, clipboard, passwords, webcam, microphone, location tracking during sessions (only an optional disclosed check-in location), browser history beyond approved work domains, personal messages.

## 3. Privacy-by-design defaults

1. Monitoring features (screenshots, app activity) are **off** for every new tenant.
2. Minimum screenshot interval 5 min, default 10 min; default retention 30 days.
3. App activity stores category + approved-app ID, never window titles or URLs by default.
4. Optional fields that are sensitive in some countries (religion, ethnicity, marital status, photo) are disabled unless the country profile allows them and the tenant turns them on.
5. Managers see aggregated work status; raw activity and screenshots need separate permissions.
6. Exports are watermarked and logged; no bulk screenshot export.

## 4. Monitoring activation checklist (in-app, blocking)

A tenant cannot switch on screenshots or app activity for any group until a Company Admin (with MFA) completes and saves this record. It is versioned; any change creates a new version.

| Step | Content recorded | Blocking? |
|---|---|---|
| 1. Purpose | Why monitoring is needed (e.g., client-contract evidence, security on managed devices) and why less intrusive options are not enough | Yes |
| 2. Scope | Which groups, devices (company-managed only in v1), and which features (screenshots, app activity) | Yes |
| 3. Jurisdictions | Auto-listed from the work countries of employees in scope. For each, the registry's required steps (e.g., DPIA, works-council approval, written notice period) | Yes, per jurisdiction |
| 4. Lawful basis | Tenant's stated basis per jurisdiction, with a note that consent alone may not be valid in employment | Yes |
| 5. DPIA | Upload or complete the built-in DPIA template where required (§5) | Yes where required |
| 6. Employee representatives | Works-council / union consultation evidence where required | Yes where required |
| 7. Notice | Notice text generated from settings (§6), reviewed, translated; notice period before start (registry minimum, default 7 days) | Yes |
| 8. Access | Named roles that can view screenshots; confirmation that each holder has MFA | Yes |
| 9. Retention | Days (within plan and jurisdiction limits) | Yes |
| 10. Contacts | Privacy contact / DPO / grievance officer details shown to employees | Yes |
| 11. Review date | Next review (max 12 months); reminders before expiry; monitoring pauses if the review lapses by more than 30 days | Yes |

## 5. DPIA template (built in)

Sections: description of processing · necessity and proportionality · data flows (auto-filled from settings) · risks to employees (likelihood × severity) · mitigations (auto-listed product controls + tenant measures) · residual risk · consultation (employees, DPO) · sign-off and date. Exportable as PDF for the tenant's records.

## 6. Employee monitoring notice template

Generated from the tenant's settings and shown in the employee's language before monitoring applies, again in the desktop agent at first run, and always available from the monitoring indicator.

> **Remote Work Monitoring Notice — {Company}, version {n}, effective {date}**
>
> **What we collect:** session start, end and break times; {if screenshots} a screenshot of your screen every {interval} minutes from the desktop app on your company device, only during an active work session; {if activity} which approved work application categories you use and for how long.
> **What we never collect:** keystrokes or typed text, passwords, clipboard, webcam, microphone, or anything outside a work session.
> **When it pauses:** breaks, idle for {idle} minutes, screen locked, and when {excluded app list} is in focus.
> **Why:** {purpose}. **Legal basis:** {basis}.
> **Who can see it:** you, and {roles}. Every view is logged, and you can see the log.
> **How long we keep it:** screenshots {retention} days; session records {n} months.
> **Your rights:** see all your data, dispute any screenshot, ask for correction or deletion, object, and complain to {contact} or your data protection authority.
> **Limits:** a screenshot may still show other windows; please use Focus / Do Not Disturb for personal notifications during work sessions.

Acknowledgment records: employee, notice version, language, timestamp, channel (web/agent). The acknowledgment confirms the employee was informed. It is not treated as consent or as the legal basis.

## 7. Data-subject / data-principal rights

| Right | Product support | Default deadline tracked |
|---|---|---|
| Access / copy | Self-service export (JSON + PDF) of own profile, attendance, leave, payslips, sessions, screenshots metadata (images viewable in app) | 30 days (GDPR), 45 (CCPA), per DPDP Rules |
| Correction | Change requests for profile fields; work-session corrections; screenshot disputes | 30 days |
| Deletion / erasure | HR workflow with statutory-retention check (payroll records kept, others anonymized) | 30 days |
| Objection / restriction | Request routed to HR; monitoring can be paused per employee while it's assessed | 30 days |
| Portability | Machine-readable export | 30 days |
| Grievance | Contact shown in notice; request tracking in `data_subject_requests` | Per jurisdiction |

## 8. Retention & deletion

- Retention rules are configuration per tenant, legal entity and data category, bounded by platform minimums (statutory) and maximums (privacy).
- Nightly retention jobs delete or anonymize; each run writes a summary to the audit log.
- Tenant offboarding: export package available for 30 days after cancellation, then full deletion within 30 more days (including backups aging out within 35 days); deletion certificate issued.
- Legal hold: per record or per employee, needs a reason, expires after 12 months unless renewed.

## 9. Breach response

1. Detection and triage within 1 hour (on-call security).
2. Containment and evidence preservation (immutable logs, snapshot copies).
3. Notify affected tenants **without undue delay and within 24 hours** of confirmation (contractual target), so they can meet their own deadlines (GDPR 72 h to the authority; DPDP and other regimes per their rules).
4. Tenant-facing incident report: what happened, data and employees affected, actions taken, recommended actions.
5. Post-incident review within 10 business days; controls updated.

## 10. Cross-border transfers

- Tenant data stays in its home cell's jurisdiction (Phase 1, 06 §3).
- Sub-processors are listed per cell; access from other regions (e.g., vendor support) only via break-glass and covered by SCCs / UK IDTA / equivalent mechanisms.
- Tenants with employees outside their cell's region record the transfer basis in the DPA annex.

## 11. Compliance roadmap (vendor)

| Item | Target |
|---|---|
| DPA, sub-processor list, privacy policy, security whitepaper | Before pilot (week 34) |
| External penetration test (web, API, desktop agent) | Before pilot, then yearly |
| Jurisdiction registry legal review (launch countries) | Before Sprint 10 ends |
| SOC 2 Type I → Type II | Type I within 6 months of GA; Type II after a 6-month window |
| ISO/IEC 27001 | Year 2 (customer-driven) |
