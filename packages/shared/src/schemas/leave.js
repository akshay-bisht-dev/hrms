// @ts-check
import { z } from 'zod';

const Id = z.uuid();
const DateStr = z.iso.date();
const Name = (max = 100) => z.string().trim().min(1, 'Required').max(max);
/** Days as a decimal string with at most two decimals, e.g. '18', '1.5'. Never a float. */
const Days = z.string().regex(/^\d{1,4}(\.\d{1,2})?$/, 'Use a number of days like 18 or 1.5');
const SignedDays = z
  .string()
  .regex(/^-?\d{1,4}(\.\d{1,2})?$/, 'Use a number of days like 2, -1 or 0.5')
  .refine((s) => !/^-?0+(\.0+)?$/.test(s), 'Must not be zero');

export const LEAVE_ENTRY_TYPES = /** @type {const} */ ([
  'OPENING_BALANCE',
  'ACCRUAL',
  'ADJUSTMENT',
  'CONSUMPTION',
  'REVERSAL',
  'CARRY_FORWARD',
  'EXPIRY',
  'ENCASHMENT',
]);
/** Policy targets the API accepts. Employees have no team on their record yet, so TEAM is not offered. */
export const ASSIGNMENT_TARGETS = /** @type {const} */ ([
  'COMPANY',
  'LEGAL_ENTITY',
  'BRANCH',
  'DEPARTMENT',
  'EMPLOYEE',
]);
/** Most specific first: an employee's own assignment beats their department's, and so on. */
export const TARGET_PRIORITY = /** @type {const} */ ([
  'EMPLOYEE',
  'DEPARTMENT',
  'BRANCH',
  'LEGAL_ENTITY',
  'COMPANY',
]);

export const LeaveTypeShape = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_]{1,20}$/, 'Use 1–20 letters, digits or _'),
    name: Name(),
    isPaid: z.boolean().default(true),
    allowNegative: z.boolean().default(false),
    requiresDocumentAfterDays: z.number().int().min(1).max(365).nullish(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #2563eb')
      .nullish(),
  })
  .strict();
export const LeaveTypeBody = LeaveTypeShape;
export const LeaveTypePatch = LeaveTypeShape.partial().strict();

/**
 * Policy rules, stored as JSON on leave_policies.rules. Every value is the company's choice; nothing is hardcoded.
 * - accrual.method: NONE (only opening balances and adjustments), ANNUAL_UPFRONT (all at the start of the leave year,
 *   prorated for joiners) or MONTHLY (one twelfth each month, credited on the 1st for anyone employed by the 15th).
 * - carryForwardMaxDays: at the end of the leave year anything above this expires; null keeps everything.
 */
export const LeavePolicyRules = z
  .object({
    accrual: z
      .object({
        method: z.enum(['NONE', 'ANNUAL_UPFRONT', 'MONTHLY']),
        daysPerYear: Days.default('0'),
        prorateForJoiners: z.boolean().default(true),
      })
      .strict(),
    yearStartMonth: z.number().int().min(1).max(12).default(1),
    carryForwardMaxDays: Days.nullable().default(null),
    maxBalanceDays: Days.nullable().default(null),
    allowHalfDay: z.boolean().default(true),
    countWeekends: z.boolean().default(false),
    countHolidays: z.boolean().default(false),
    /** Rest days and holidays between two leave days in the same request count as leave. */
    sandwich: z.boolean().default(false),
    minNoticeDays: z.number().int().min(0).max(365).default(0),
    maxConsecutiveDays: z.number().int().min(1).max(366).nullable().default(null),
    minTenureDays: z.number().int().min(0).max(3650).default(0),
    /** 1 = direct manager; 2 = manager, then someone holding leave.request.approve (HR). */
    approvalLevels: z.union([z.literal(1), z.literal(2)]).default(1),
  })
  .strict()
  .refine((r) => r.accrual.method === 'NONE' || Number(r.accrual.daysPerYear) > 0, {
    path: ['accrual', 'daysPerYear'],
    message: 'Set how many days accrue per year',
  });

const LeavePolicyShape = z
  .object({
    leaveTypeId: Id,
    legalEntityId: Id.nullish(),
    name: Name(120),
    rules: LeavePolicyRules,
    effectiveFrom: DateStr,
    effectiveTo: DateStr.nullish(),
  })
  .strict();
export const LeavePolicyBody = LeavePolicyShape.refine(
  (b) => !b.effectiveTo || b.effectiveTo >= b.effectiveFrom,
  {
    path: ['effectiveTo'],
    message: 'Must be on or after the start date',
  },
);
/** Rules are versioned: changing them creates a new version from a date (see the API), so only names and end dates patch. */
export const LeavePolicyPatch = z
  .object({ name: Name(120), effectiveTo: DateStr.nullish() })
  .partial()
  .strict();
export const LeavePolicyVersionBody = z.object({ rules: LeavePolicyRules, effectiveFrom: DateStr }).strict();

export const PolicyAssignmentBody = z
  .object({
    policyId: Id,
    appliesTo: z.enum(ASSIGNMENT_TARGETS),
    targetId: Id.nullish(),
    effectiveFrom: DateStr,
    effectiveTo: DateStr.nullish(),
  })
  .strict()
  .refine((b) => (b.appliesTo === 'COMPANY') === !b.targetId, {
    path: ['targetId'],
    message: 'Choose what this applies to (not needed for the whole company)',
  });

export const LeaveRequestBody = z
  .object({
    leaveTypeId: Id,
    fromDate: DateStr,
    toDate: DateStr,
    /** Leave starts at midday on the first day (second half only). */
    fromHalfDay: z.boolean().default(false),
    /** Leave ends at midday on the last day (first half only). */
    toHalfDay: z.boolean().default(false),
    reason: z.string().trim().max(1000).optional(),
    documentId: Id.nullish(),
  })
  .strict()
  .refine((b) => b.toDate >= b.fromDate, { path: ['toDate'], message: 'Must be on or after the first day' });

export const LeaveRequestListQuery = z
  .object({
    view: z.enum(['mine', 'approvals', 'team']).default('mine'),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  })
  .strict();

export const LeaveDecisionBody = z
  .object({ decision: z.enum(['APPROVED', 'REJECTED']), comment: z.string().trim().max(1000).optional() })
  .strict()
  .refine((b) => b.decision === 'APPROVED' || (b.comment && b.comment.length > 0), {
    path: ['comment'],
    message: 'Add a short reason when rejecting',
  });

export const LeaveCancelBody = z.object({ reason: z.string().trim().max(500).optional() }).strict();

export const AdjustmentBody = z
  .object({
    employeeId: Id,
    leaveTypeId: Id,
    entryType: z.enum(['OPENING_BALANCE', 'ADJUSTMENT']).default('ADJUSTMENT'),
    quantity: SignedDays,
    postedOn: DateStr,
    note: z.string().trim().min(3, 'Say why').max(255),
  })
  .strict();

export const CalendarQuery = z
  .object({ from: DateStr, to: DateStr, departmentId: Id.optional() })
  .strict()
  .refine((q) => q.from <= q.to, { path: ['to'], message: 'Must be on or after the start date' });

export const AccrualRunBody = z
  .object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM') })
  .strict();

export const LeaveReportQuery = z
  .object({
    from: DateStr,
    to: DateStr,
    departmentId: Id.optional(),
    format: z.enum(['json', 'csv']).default('json'),
  })
  .strict()
  .refine((q) => q.from <= q.to, { path: ['to'], message: 'Must be on or after the start date' });

/** A sensible starting set a company can load and then edit. Numbers are placeholders to review against local law. */
export const STARTER_LEAVE_TYPES = Object.freeze([
  {
    type: { code: 'ANNUAL', name: 'Annual leave', isPaid: true, color: '#2563eb' },
    rules: { accrual: { method: 'MONTHLY', daysPerYear: '20' }, carryForwardMaxDays: '5', minNoticeDays: 0 },
  },
  {
    type: { code: 'SICK', name: 'Sick leave', isPaid: true, requiresDocumentAfterDays: 2, color: '#dc2626' },
    rules: { accrual: { method: 'ANNUAL_UPFRONT', daysPerYear: '10' }, carryForwardMaxDays: '0' },
  },
  {
    type: { code: 'UNPAID', name: 'Unpaid leave', isPaid: false, color: '#64748b' },
    rules: { accrual: { method: 'NONE', daysPerYear: '0' }, approvalLevels: 2 },
  },
]);
