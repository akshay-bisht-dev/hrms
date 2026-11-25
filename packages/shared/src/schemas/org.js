// @ts-check
import { z } from 'zod';

/** IANA time zone known to the runtime (Intl rejects unknown zones). */
export const TimeZone = z
  .string()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Choose a valid time zone');

export const Id = z.uuid();
export const Code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, 'Use 1–20 letters, digits, - or _');
const Name = (max = 150) => z.string().trim().min(1, 'Required').max(max);
const Country = z
  .string()
  .length(2)
  .transform((s) => s.toUpperCase());
const Currency = z
  .string()
  .length(3)
  .transform((s) => s.toUpperCase());
const Weekday = z.number().int().min(0).max(6); // 0 = Sunday

export const CompanyProfileBody = z
  .object({
    name: Name(200).optional(),
    timezone: TimeZone.optional(),
    defaultLocale: z.string().min(2).max(16).optional(),
  })
  .strict();

export const LegalEntityBody = z
  .object({
    name: Name(200),
    countryCode: Country,
    currency: Currency,
    registrationNumber: z.string().trim().max(80).nullish(),
    fiscalYearStartMonth: z.number().int().min(1).max(12).default(1),
    weekStartDay: Weekday.default(1),
    weekendDays: z
      .array(Weekday)
      .max(7)
      .refine((a) => new Set(a).size === a.length, 'Days must be unique'),
    timezone: TimeZone,
  })
  .strict();

const Address = z
  .object({
    line1: z.string().trim().max(200).optional(),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().max(100).optional(),
    region: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().max(20).optional(),
    countryCode: Country.optional(),
  })
  .strict();

export const BranchBody = z
  .object({
    legalEntityId: Id,
    holidayCalendarId: Id.nullish(),
    name: Name(),
    code: Code,
    address: Address.nullish(),
    timezone: TimeZone,
  })
  .strict();

export const DepartmentBody = z.object({ name: Name(), code: Code, parentId: Id.nullish() }).strict();
export const DesignationBody = z
  .object({ title: Name(), level: z.number().int().min(1).max(20).nullish() })
  .strict();
export const TeamBody = z.object({ name: Name(), departmentId: Id.nullish() }).strict();

const ScheduleDay = z
  .object({
    day: Weekday,
    working: z.boolean(),
    startMin: z.number().int().min(0).max(1439).optional(),
    endMin: z.number().int().min(1).max(1440).optional(),
  })
  .strict();

const WorkScheduleShape = z
  .object({
    name: Name(120),
    type: z.enum(['FIXED', 'FLEXIBLE', 'SHIFT']),
    weeklyPattern: z.array(ScheduleDay).length(7),
    dailyMinutes: z.number().int().min(1).max(1440),
    graceMinutes: z.number().int().min(0).max(240).default(0),
  })
  .strict();

/** Cross-field checks shared by create and update (only applied to fields that are present). */
const checkSchedule = (/** @type {any} */ b, /** @type {z.RefinementCtx} */ ctx) => {
  if (!b.weeklyPattern) return;
  if (new Set(b.weeklyPattern.map((/** @type {any} */ d) => d.day)).size !== 7) {
    ctx.addIssue({ code: 'custom', path: ['weeklyPattern'], message: 'Give each day of the week once' });
  }
  if (b.type === 'FIXED' || b.type === undefined) {
    b.weeklyPattern.forEach((/** @type {any} */ d, /** @type {number} */ i) => {
      if (
        b.type === 'FIXED' &&
        d.working &&
        (d.startMin === undefined || d.endMin === undefined || d.endMin <= d.startMin)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['weeklyPattern', i],
          message: 'Working days need a start time before the end time',
        });
      }
    });
  }
};

export const WorkScheduleBody = WorkScheduleShape.superRefine(checkSchedule);
export const WorkSchedulePatch = WorkScheduleShape.partial().strict().superRefine(checkSchedule);

export const HolidayCalendarBody = z
  .object({
    name: Name(120),
    countryCode: Country,
    regionCode: z.string().trim().max(10).default(''),
    year: z.number().int().min(2000).max(2100),
  })
  .strict();

export const HolidayBody = z
  .object({ date: z.iso.date(), name: Name(), isOptional: z.boolean().default(false) })
  .strict();

/** Partial versions for PATCH: every field optional, unknown keys still rejected. */
export const partial = (/** @type {z.ZodObject<any>} */ schema) => schema.partial().strict();
