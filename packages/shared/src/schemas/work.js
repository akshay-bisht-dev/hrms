// @ts-check
import { z } from 'zod';
import { ASSIGNMENT_TARGETS } from './leave.js';
import { DecisionBody, TimeOfDay, timeToMinutes } from './attendance.js';

const Id = z.uuid();
const DateStr = z.iso.date();
const Instant = z.iso.datetime({ offset: true });

export { DecisionBody };
export const IDLE_COUNTING = /** @type {const} */ (['NOT_COUNTED', 'COUNTED', 'COUNTED_UNTIL_THRESHOLD']);
export const BREAK_TYPES = /** @type {const} */ (['REGULAR', 'MEAL', 'PERSONAL']);
export const CORRECTION_KINDS = /** @type {const} */ ([
  'ADD_WORK_TIME',
  'REMOVE_WORK_TIME',
  'MARK_BREAK',
  'MISSING_CHECKOUT',
  'IDLE_DISPUTE',
  'DISCONNECT_DISPUTE',
]);
export const SESSION_STATUSES = /** @type {const} */ ([
  'ACTIVE',
  'ON_BREAK',
  'DISCONNECTED',
  'ENDED',
  'AUTO_CLOSED',
]);
/** How often the web page sends a heartbeat. The policy's timeout must be comfortably longer. */
export const HEARTBEAT_INTERVAL_SEC = 60;

const PolicyShape = z
  .object({
    name: z.string().trim().min(1, 'Required').max(120),
    appliesTo: z.enum(ASSIGNMENT_TARGETS),
    targetId: Id.nullable().optional(),
    priority: z.number().int().min(0).max(100).default(0),
    wfhAllowed: z.boolean().default(true),
    wfhRequiresApproval: z.boolean().default(true),
    wfhMaxDaysPerMonth: z.number().int().min(1).max(31).nullable().optional(),
    /** Earliest start and latest end, local time. 00:00 to 24:00 means any time. */
    allowedStart: TimeOfDay.default('00:00'),
    allowedEnd: z.union([TimeOfDay, z.literal('24:00')]).default('24:00'),
    heartbeatTimeoutSec: z.number().int().min(120).max(3600).default(180),
    idleThresholdSec: z.number().int().min(60).max(3600).default(300),
    idleCounting: z.enum(IDLE_COUNTING).default('COUNTED_UNTIL_THRESHOLD'),
    maxBreakMinutes: z.number().int().min(1).max(600).nullable().optional(),
    /** After this long without a heartbeat, the session is closed automatically at the last heartbeat. */
    resumeWindowMin: z.number().int().min(5).max(720).default(120),
    timesheetRequired: z.boolean().default(false),
    dailyReportRequired: z.boolean().default(false),
    effectiveFrom: DateStr,
  })
  .strict();

/** @param {any} b @param {z.RefinementCtx} c */
const checkPolicy = (b, c) => {
  if (b.appliesTo && b.appliesTo !== 'COMPANY' && !b.targetId)
    c.addIssue({ code: 'custom', path: ['targetId'], message: 'Choose who this policy applies to' });
  if (b.appliesTo === 'COMPANY' && b.targetId)
    c.addIssue({ code: 'custom', path: ['targetId'], message: 'A company-wide policy has no target' });
  const toMin = (/** @type {string} */ t) => (t === '24:00' ? 1440 : timeToMinutes(t));
  if (b.allowedStart && b.allowedEnd && toMin(b.allowedEnd) <= toMin(b.allowedStart))
    c.addIssue({ code: 'custom', path: ['allowedEnd'], message: 'Must be after the start time' });
};
export const WorkPolicyBody = PolicyShape.superRefine(checkPolicy);
/** A change creates a new version of the policy from effectiveFrom; sessions already started keep theirs. */
export const WorkPolicyChange = PolicyShape.omit({ name: true }).superRefine(checkPolicy);
export const allowedMinutes = (/** @type {string} */ t) => (t === '24:00' ? 1440 : timeToMinutes(t));

export const WfhRequestBody = z
  .object({
    workLocationId: Id,
    fromDate: DateStr,
    toDate: DateStr,
    /** Optional weekly pattern inside the range, e.g. every Monday and Wednesday: [1, 3] (0 = Sunday). */
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((b) => b.toDate >= b.fromDate, { path: ['toDate'], message: 'Must be on or after the start date' });

export const RequestListQuery = z
  .object({
    view: z.enum(['mine', 'approvals']).default('mine'),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  })
  .strict();

export const StartSessionBody = z
  .object({ workLocationId: Id, clientTs: Instant.optional(), idempotencyKey: z.string().max(80).optional() })
  .strict();
export const SessionSignalBody = z
  .object({ clientTs: Instant.optional(), idempotencyKey: z.string().max(80).optional() })
  .strict();
export const BreakBody = SessionSignalBody.extend({ type: z.enum(BREAK_TYPES).default('REGULAR') }).strict();

export const SessionListQuery = z
  .object({ from: DateStr, to: DateStr, employeeId: Id.optional() })
  .strict()
  .refine((q) => q.to >= q.from, { path: ['to'], message: 'Must be on or after the start date' });

export const CorrectionBody = z
  .object({
    sessionId: Id,
    kind: z.enum(CORRECTION_KINDS),
    fromTs: Instant,
    toTs: Instant,
    reason: z.string().trim().min(5, 'Explain what happened (at least 5 characters)').max(1000),
  })
  .strict()
  .refine((b) => Date.parse(b.toTs) > Date.parse(b.fromTs), {
    path: ['toTs'],
    message: 'Must be after the start time',
  });

export const TeamStatusQuery = z
  .object({
    departmentId: Id.optional(),
    status: z.enum(['WORKING', 'ON_BREAK', 'DISCONNECTED', 'NOT_STARTED', 'FINISHED']).optional(),
  })
  .strict();
