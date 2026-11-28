// @ts-check
import { z } from 'zod';
import { ASSIGNMENT_TARGETS } from './leave.js';
import { patchOf } from './patch.js';

const Id = z.uuid();
const DateStr = z.iso.date();
const Email = z.email().max(254);

export const LAWFUL_BASES = /** @type {const} */ ([
  'LEGITIMATE_INTEREST',
  'CONTRACT',
  'LEGAL_OBLIGATION',
  'CONSENT',
]);
export const CAPTURE_MODES = /** @type {const} */ (['FULL_SCREEN', 'ACTIVE_WINDOW', 'BLURRED']);
export const SKIP_REASONS = /** @type {const} */ ([
  'EXCLUDED_APP',
  'IDLE',
  'ON_BREAK',
  'SCREEN_LOCKED',
  'NO_PERMISSION',
  'POLICY_OUTDATED',
  'OFFLINE',
  'OTHER',
]);
/** Steps a jurisdiction can require before monitoring applies there (see the platform registry). */
export const JURISDICTION_STEPS = /** @type {const} */ ([
  'WRITTEN_NOTICE',
  'DPIA',
  'WORKS_COUNCIL',
  'PURPOSE_LIMITATION',
  'EMPLOYEE_CONSULTATION',
]);
/** Apps whose window is never captured unless a company removes them on purpose (matched on app name). */
export const DEFAULT_EXCLUDED_APPS = Object.freeze([
  '1Password',
  'Bitwarden',
  'KeePass',
  'KeePassXC',
  'LastPass',
  'Dashlane',
  'Keychain Access',
  'WhatsApp',
  'Signal',
  'Telegram',
  'Messages',
  'FaceTime',
]);

const Step = z.object({ done: z.boolean(), note: z.string().trim().max(1000).optional() }).strict();

const ActivationShape = z
  .object({
    /** Why the company monitors: specific, written for employees. */
    purpose: z.string().trim().min(30, 'Describe the purpose in at least 30 characters').max(4000),
    scope: z
      .object({
        appliesTo: z.enum(ASSIGNMENT_TARGETS).default('COMPANY'),
        targetIds: z.array(Id).max(200).default([]),
        /** Screenshots only on company-managed devices (personal devices get session tracking only). */
        companyDevicesOnly: z.boolean().default(true),
        /** New desktop devices wait for an administrator before they may capture. */
        requireDeviceApproval: z.boolean().default(true),
      })
      .strict(),
    lawfulBasis: z
      .object({ basis: z.enum(LAWFUL_BASES), explanation: z.string().trim().min(20).max(4000) })
      .strict(),
    /** Shown to every employee in scope, who must acknowledge it before monitoring applies to them. */
    noticeText: z
      .string()
      .trim()
      .min(100, 'The notice must explain monitoring in at least 100 characters')
      .max(20_000),
    noticeLocales: z.array(z.string().min(2).max(16)).min(1).max(20).default(['en']),
    noticeStartsOn: DateStr,
    /** Roles whose members may view employees' screenshots (on top of the permission and its scope). */
    viewerRoleIds: z.array(Id).min(1, 'Choose at least one role that may view screenshots').max(50),
    retentionDays: z.number().int().min(7).max(90).default(30),
    contacts: z
      .object({
        privacyContactName: z.string().trim().min(2).max(120),
        privacyContactEmail: Email,
        grievanceEmail: Email,
      })
      .strict(),
    reviewDueOn: DateStr,
    /** Per work country: the steps its jurisdiction requires and whether they are done. */
    jurisdictionSteps: z
      .record(z.string().regex(/^[A-Z]{2}$/), z.partialRecord(z.enum(JURISDICTION_STEPS), Step))
      .default({}),
    /** The company confirms it took its own legal advice for every country in scope (the platform gives controls, not legal advice). */
    ownLegalAdviceConfirmed: z.boolean().default(false),
  })
  .strict();
export const ActivationBody = ActivationShape;
export const ActivationPatch = patchOf(ActivationShape);

const PolicyShape = z
  .object({
    name: z.string().trim().min(1).max(120),
    appliesTo: z.enum(ASSIGNMENT_TARGETS).default('COMPANY'),
    targetId: Id.nullable().optional(),
    enabled: z.boolean().default(false),
    intervalMin: z.number().int().min(5, 'At least 5 minutes between screenshots').max(240).default(10),
    jitterPct: z.number().int().min(0).max(50).default(20),
    captureMode: z.enum(CAPTURE_MODES).default('FULL_SCREEN'),
    retentionDays: z.number().int().min(1).max(90).default(30),
    excludedApps: z
      .array(z.string().trim().min(1).max(120))
      .max(200)
      .default([...DEFAULT_EXCLUDED_APPS]),
    blurZones: z
      .array(
        z
          .object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
            w: z.number().min(0).max(1),
            h: z.number().min(0).max(1),
          })
          .strict(),
      )
      .max(10)
      .nullable()
      .optional(),
    employeeCanDelete: z.boolean().default(false),
    /** Application activity is not offered yet; the field exists so a policy can never turn it on by accident. */
    activityTrackingEnabled: z.literal(false).default(false),
    effectiveFrom: DateStr,
  })
  .strict();
/** @param {any} b @param {z.RefinementCtx} c */
const checkTarget = (b, c) => {
  if (b.appliesTo && b.appliesTo !== 'COMPANY' && !b.targetId)
    c.addIssue({ code: 'custom', path: ['targetId'], message: 'Choose who this policy applies to' });
};
export const ScreenshotPolicyBody = PolicyShape.superRefine(checkTarget);
export const ScreenshotPolicyChange = PolicyShape.omit({ name: true }).superRefine(checkTarget);

export const AcknowledgeBody = z
  .object({ activationId: Id, locale: z.string().min(2).max(16).default('en') })
  .strict();

// ── Devices ──
export const RegisterDeviceBody = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-HJ-NP-Z2-9]{4}-?[A-HJ-NP-Z2-9]{4}$/, 'Enter the 8-character code from the web app'),
    os: z.enum(['WINDOWS', 'MACOS', 'LINUX']),
    osVersion: z.string().trim().min(1).max(40),
    agentVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    /** sha256 of a stable machine identifier, computed on the device; the raw identifier never leaves it. */
    fingerprintHash: z.string().regex(/^[a-f0-9]{64}$/),
    hostnameHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    ownership: z.enum(['COMPANY_MANAGED', 'BYOD']),
  })
  .strict();
export const RefreshDeviceBody = z.object({ refreshToken: z.string().min(40).max(200) }).strict();
export const RevokeDeviceBody = z.object({ reason: z.string().trim().min(3).max(120) }).strict();

// ── Agent ──
export const AgentStartBody = z
  .object({ workLocationId: Id, clientTs: z.iso.datetime({ offset: true }).optional() })
  .strict();
export const AgentIdleBody = z.object({ state: z.enum(['IDLE_START', 'IDLE_END']) }).strict();
export const SlotBody = z
  .object({
    sessionId: Id,
    policyId: Id,
    policyVersion: z.number().int().min(1),
    capturedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export const ConfirmBody = z
  .object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().min(1).max(2_000_000) })
  .strict();
export const SkipBody = z
  .object({ sessionId: Id, reason: z.enum(SKIP_REASONS), occurredAt: z.iso.datetime({ offset: true }) })
  .strict();

// ── Viewing, disputes, incidents ──
export const ScreenshotListQuery = z
  .object({ employeeId: Id.optional(), date: DateStr.optional(), sessionId: Id.optional() })
  .strict();
export const DeleteScreenshotBody = z.object({ reason: z.string().trim().min(3).max(60) }).strict();
export const DisputeBody = z.object({ reason: z.string().trim().min(5).max(2000) }).strict();
export const ResolveDisputeBody = z
  .object({
    outcome: z.enum(['RESTORED', 'DELETED', 'TIME_CORRECTED']),
    resolution: z.string().trim().min(5).max(2000),
  })
  .strict();
export const IncidentBody = z
  .object({ screenshotId: Id.optional(), description: z.string().trim().min(10).max(4000) })
  .strict();
export const ResolveIncidentBody = z
  .object({ resolution: z.string().trim().min(5).max(4000), deleteScreenshot: z.boolean().default(true) })
  .strict();
export const AccessLogQuery = z.object({ screenshotId: Id.optional(), actorUserId: Id.optional() }).strict();
