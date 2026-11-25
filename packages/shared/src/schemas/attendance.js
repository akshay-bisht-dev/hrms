// @ts-check
import { z } from 'zod';

const Id = z.uuid();
const DateStr = z.iso.date();
const Name = (max = 100) => z.string().trim().min(1, 'Required').max(max);
const Minutes = (max) => z.number().int().min(0).max(max);
/** 'HH:MM' on a 24-hour clock. */
export const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
/** @param {string} t 'HH:MM' @returns {number} */
export const timeToMinutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** @param {number} m @returns {string} */
export const minutesToTime = (m) =>
  `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export const PUNCH_TYPES = /** @type {const} */ (['IN', 'OUT']);
export const ATTENDANCE_STATUSES = /** @type {const} */ ([
  'PRESENT',
  'WFH',
  'HALF_DAY',
  'ABSENT',
  'ON_LEAVE',
  'HOLIDAY',
  'WEEKEND',
  'PENDING',
]);
export const WORK_LOCATION_TYPES = /** @type {const} */ ([
  'OFFICE',
  'WFH',
  'HYBRID',
  'REMOTE',
  'CLIENT_SITE',
  'TRAVEL',
  'CUSTOM',
]);
export const DECISIONS = /** @type {const} */ (['APPROVED', 'REJECTED']);

export const PunchBody = z
  .object({
    type: z.enum(PUNCH_TYPES),
    workLocationId: Id.nullish(),
    /** The device's clock, kept for reference only; the server time is what counts. */
    clientTs: z.iso.datetime({ offset: true }).optional(),
    /** Sent only when the company turned on location capture and the person allowed it in the browser. */
    geo: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        accuracyM: z.number().min(0).max(100_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const RangeQuery = z
  .object({ from: DateStr, to: DateStr })
  .strict()
  .refine((q) => q.from <= q.to, { path: ['to'], message: 'Must be on or after the start date' });

export const TeamDayQuery = z
  .object({
    date: DateStr,
    departmentId: Id.optional(),
    status: z.enum([...ATTENDANCE_STATUSES, 'NOT_RECORDED']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
    cursor: Id.optional(),
  })
  .strict();

export const RegularizationBody = z
  .object({
    workDate: DateStr,
    inTime: TimeOfDay.optional(),
    outTime: TimeOfDay.optional(),
    /** Set when the corrected clock-out is on the next calendar day (night shifts). */
    outNextDay: z.boolean().default(false),
    reason: z.string().trim().min(5, 'Say briefly why the record is wrong').max(1000),
  })
  .strict()
  .refine((b) => b.inTime || b.outTime, { path: ['inTime'], message: 'Give a clock-in or a clock-out time' })
  .refine(
    (b) => !b.inTime || !b.outTime || b.outNextDay || timeToMinutes(b.outTime) > timeToMinutes(b.inTime),
    { path: ['outTime'], message: 'Clock-out must be after clock-in (tick "next day" for night shifts)' },
  );

export const RegularizationListQuery = z
  .object({
    view: z.enum(['mine', 'approvals']).default('mine'),
    status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']).optional(),
  })
  .strict();

export const DecisionBody = z
  .object({ decision: z.enum(DECISIONS), comment: z.string().trim().max(1000).optional() })
  .strict()
  .refine((b) => b.decision === 'APPROVED' || (b.comment && b.comment.length > 0), {
    path: ['comment'],
    message: 'Add a short reason when rejecting',
  });

const ShiftShape = z
  .object({
    name: Name(),
    startTime: TimeOfDay,
    endTime: TimeOfDay,
    breakMinutes: Minutes(600).default(0),
    graceLateMin: Minutes(240).default(0),
    graceEarlyMin: Minutes(240).default(0),
  })
  .strict();
const checkShift = (/** @type {any} */ b, /** @type {z.RefinementCtx} */ ctx) => {
  if (b.startTime === undefined || b.endTime === undefined) return;
  if (b.startTime === b.endTime)
    ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Start and end cannot be the same' });
  const start = timeToMinutes(b.startTime);
  let end = timeToMinutes(b.endTime);
  if (end <= start) end += 1440;
  if (b.breakMinutes !== undefined && b.breakMinutes >= end - start)
    ctx.addIssue({
      code: 'custom',
      path: ['breakMinutes'],
      message: 'The break must be shorter than the shift',
    });
};
export const ShiftBody = ShiftShape.superRefine(checkShift);
export const ShiftPatch = ShiftShape.partial().strict().superRefine(checkShift);

export const ShiftAssignmentBody = z
  .object({
    shiftId: Id,
    employeeIds: z.array(Id).min(1).max(500),
    effectiveFrom: DateStr,
    effectiveTo: DateStr.nullish(),
  })
  .strict()
  .refine((b) => !b.effectiveTo || b.effectiveTo >= b.effectiveFrom, {
    path: ['effectiveTo'],
    message: 'Must be on or after the start date',
  });

export const ShiftAssignmentQuery = z
  .object({ employeeId: Id.optional(), shiftId: Id.optional(), activeOn: DateStr.optional() })
  .strict();

/** Decimal as a string so money-like rates never pass through floating point. */
const Multiplier = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,6})?$/, 'Use a number like 1.5')
  .refine((s) => Number(s) >= 1, 'At least 1');

const OvertimeRuleShape = z
  .object({
    name: Name(),
    legalEntityId: Id.nullish(),
    dailyThresholdMin: Minutes(1440).nullish(),
    weeklyThresholdMin: Minutes(10080).nullish(),
    multiplier: Multiplier,
    requiresApproval: z.boolean().default(true),
    restDayAllOvertime: z.boolean().default(true),
    effectiveFrom: DateStr,
    effectiveTo: DateStr.nullish(),
  })
  .strict();
const checkRule = (/** @type {any} */ b, /** @type {z.RefinementCtx} */ ctx) => {
  if (b.effectiveTo && b.effectiveFrom && b.effectiveTo < b.effectiveFrom)
    ctx.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'Must be on or after the start date' });
};
export const OvertimeRuleBody = OvertimeRuleShape.superRefine(checkRule).refine(
  (b) =>
    (b.dailyThresholdMin ?? null) !== null || (b.weeklyThresholdMin ?? null) !== null || b.restDayAllOvertime,
  { path: ['dailyThresholdMin'], message: 'Set a daily or weekly threshold, or count rest-day work' },
);
export const OvertimeRulePatch = OvertimeRuleShape.partial().strict().superRefine(checkRule);

export const AttendancePolicyBody = z
  .object({
    legalEntityId: Id.nullable().default(null),
    presentPercent: z.number().int().min(1).max(100),
    halfDayPercent: z.number().int().min(1).max(100),
    autoDeductBreak: z.boolean(),
    captureIp: z.boolean(),
    captureGeo: z.boolean(),
    regularizationWindowDays: z.number().int().min(0).max(366),
  })
  .strict()
  .refine((b) => b.halfDayPercent <= b.presentPercent, {
    path: ['halfDayPercent'],
    message: 'Must not be higher than the present threshold',
  });

export const PolicyQuery = z.object({ legalEntityId: Id.optional() }).strict();

export const RecalculateBody = z
  .object({ from: DateStr, to: DateStr, employeeIds: z.array(Id).max(500).optional() })
  .strict()
  .refine((b) => b.from <= b.to, { path: ['to'], message: 'Must be on or after the start date' });

export const ReportQuery = z
  .object({
    from: DateStr,
    to: DateStr,
    departmentId: Id.optional(),
    format: z.enum(['json', 'csv']).default('json'),
  })
  .strict()
  .refine((q) => q.from <= q.to, { path: ['to'], message: 'Must be on or after the start date' });
