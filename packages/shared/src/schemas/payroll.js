// @ts-check
import { z } from 'zod';

const Id = z.uuid();
const DateStr = z.iso.date();
const Name = (max = 120) => z.string().trim().min(1, 'Required').max(max);
/** Money as a decimal string (up to 4 decimals). Never a JavaScript number. */
export const Money = z
  .string()
  .trim()
  .regex(/^\d{1,15}(\.\d{1,4})?$/, 'Use an amount like 1500 or 1500.50');
/** A rate as a fraction, e.g. '0.5' = 50%. */
export const Rate = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,6})?$/, 'Use a fraction like 0.5 for 50%');
export const Code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9_]{0,39}$/, 'Start with a letter; use letters, digits or _');
export const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
export const FiscalYear = z.string().regex(/^\d{4}-\d{2}$/, 'Use a year like 2025-26');

export const COMPONENT_KINDS = /** @type {const} */ ([
  'EARNING',
  'DEDUCTION',
  'EMPLOYER_CONTRIBUTION',
  'REIMBURSEMENT',
  'INFORMATIONAL',
]);
export const CALC_TYPES = /** @type {const} */ (['FIXED', 'PERCENTAGE', 'FORMULA', 'STATUTORY', 'INPUT']);
export const ROUNDING_RULES = /** @type {const} */ (['HALF_UP', 'HALF_EVEN', 'UP', 'DOWN', 'NONE']);
export const RUN_STATUSES = /** @type {const} */ ([
  'DRAFT',
  'INPUTS_LOCKED',
  'CALCULATING',
  'CALCULATED',
  'REVIEWED',
  'APPROVED',
  'FINALIZED',
  'PAID',
  'CANCELLED',
]);
/** Names formulas may use besides component codes. */
export const FORMULA_VARIABLES = /** @type {const} */ ([
  'CTC_ANNUAL',
  'CTC_MONTHLY',
  'PAID_DAYS',
  'PERIOD_DAYS',
  'LOP_DAYS',
]);

const ComponentShape = z
  .object({
    code: Code,
    name: Name(),
    kind: z.enum(COMPONENT_KINDS),
    calcType: z.enum(CALC_TYPES),
    formula: z.string().trim().max(500).nullish(),
    percentOf: z.string().trim().toUpperCase().max(40).nullish(),
    rate: Rate.nullish(),
    fixedAmount: Money.nullish(),
    taxable: z.boolean().default(true),
    roundingRule: z.enum(ROUNDING_RULES).default('HALF_UP'),
    statutoryKey: z.string().trim().max(60).nullish(),
    displayOrder: z.number().int().min(0).max(1000).default(0),
    isActive: z.boolean().default(true),
  })
  .strict();
const checkComponent = (/** @type {any} */ b, /** @type {z.RefinementCtx} */ ctx) => {
  const need = (/** @type {string} */ field, /** @type {string} */ message) => {
    if (b[field] === undefined || b[field] === null || b[field] === '')
      ctx.addIssue({ code: 'custom', path: [field], message });
  };
  if (b.calcType === 'FIXED') need('fixedAmount', 'Give the monthly amount');
  if (b.calcType === 'PERCENTAGE') {
    need('percentOf', 'Say what it is a percentage of (CTC or a component code)');
    need('rate', 'Give the rate');
  }
  if (b.calcType === 'FORMULA') need('formula', 'Write the formula');
  if (b.calcType === 'STATUTORY') need('statutoryKey', 'Choose the statutory item');
};
export const ComponentBody = ComponentShape.superRefine(checkComponent);
/** Code and calculation type are fixed once created: history refers to them. */
export const ComponentPatch = ComponentShape.omit({ code: true, calcType: true }).partial().strict();

export const StructureBody = z
  .object({
    legalEntityId: Id,
    name: Name(),
    currency: z.string().length(3).toUpperCase(),
    effectiveFrom: DateStr,
    effectiveTo: DateStr.nullish(),
  })
  .strict();
export const StructurePatch = z.object({ name: Name(), effectiveTo: DateStr.nullish() }).partial().strict();
export const StructureComponentsBody = z
  .object({
    components: z
      .array(
        z
          .object({
            componentId: Id,
            sequence: z.number().int().min(0).max(10000),
            overrideRate: Rate.nullish(),
            overrideFormula: z.string().trim().max(500).nullish(),
          })
          .strict(),
      )
      .min(1)
      .max(60),
  })
  .strict();

export const SALARY_REASONS = /** @type {const} */ (['JOINING', 'REVISION', 'PROMOTION', 'CORRECTION']);
export const SalaryBody = z
  .object({ structureId: Id, annualCtc: Money, effectiveFrom: DateStr, reason: z.enum(SALARY_REASONS) })
  .strict();
export const SalaryPreviewQuery = z.object({ structureId: Id, annualCtc: Money }).strict();

/** India pack settings per legal entity. Other packs add their own shapes. */
export const InStatutorySettings = z
  .object({
    pfEnabled: z.boolean().default(true),
    pfWageCodes: z.array(Code).min(1).max(10).default(['BASIC']),
    pfOnActualWages: z.boolean().default(false),
    esiEnabled: z.boolean().default(true),
    ptState: z.string().length(2).toUpperCase().nullable().default(null),
  })
  .strict();
export const StatutorySettingsBody = z
  .object({
    settings: z.record(z.string(), z.unknown()),
    registrationNumbers: z.record(z.string().max(40), z.string().trim().max(60)).optional(),
    effectiveFrom: DateStr,
  })
  .strict();

export const PayrollSettingsBody = z
  .object({
    paidDaysBasis: z.enum(['CALENDAR', 'FIXED_30']),
    lopFromAbsence: z.boolean(),
    payDayOfMonth: z.number().int().min(1).max(31).nullable(),
  })
  .strict();

export const RunCreateBody = z.object({ legalEntityId: Id, month: Month }).strict();
export const RunListQuery = z
  .object({ status: z.enum(RUN_STATUSES).optional(), legalEntityId: Id.optional() })
  .strict();
export const RunInputBody = z
  .object({ employeeId: Id, componentId: Id, amount: Money, note: z.string().trim().max(255).optional() })
  .strict();
export const RunCommentBody = z.object({ comment: z.string().trim().max(1000).optional() }).strict();
export const RunRejectBody = z
  .object({ comment: z.string().trim().min(3, 'Say what needs fixing').max(1000) })
  .strict();

export const TaxDeclarationBody = z
  .object({
    regime: z.enum(['NEW', 'OLD']),
    deductions: z.record(z.string().regex(/^[0-9A-Z]{2,10}$/, 'Unknown section'), Money).default({}),
  })
  .strict();
export const TaxReviewBody = z
  .object({ decision: z.enum(['VERIFIED', 'REJECTED']), comment: z.string().trim().max(500).optional() })
  .strict();

/** '12.5' → '0.125' without floating point (for forms that show percentages). */
export function percentToFraction(/** @type {string} */ percent) {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(percent).trim());
  if (!m) return null;
  const digits = (m[1] + (m[2] ?? '')).replace(/^0+(?=\d)/, '');
  const scale = (m[2] ?? '').length + 2;
  const padded = digits.padStart(scale + 1, '0');
  const out = `${padded.slice(0, -scale)}.${padded.slice(-scale)}`.replace(/\.?0+$/, '');
  return out === '' ? '0' : out;
}

/** '0.125' → '12.5' without floating point. */
export function fractionToPercent(/** @type {string | null | undefined} */ fraction) {
  if (fraction === null || fraction === undefined) return '';
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(fraction).trim());
  if (!m) return '';
  const frac = (m[2] ?? '').padEnd(2, '0');
  const whole = (m[1] + frac.slice(0, 2)).replace(/^0+(?=\d)/, '');
  const rest = frac.slice(2).replace(/0+$/, '');
  return rest ? `${whole}.${rest}` : whole;
}
