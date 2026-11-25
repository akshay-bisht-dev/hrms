// @ts-check
import { z } from 'zod';
import { Email } from './auth.js';
import { TimeZone } from './org.js';

const opt = (/** @type {z.ZodTypeAny} */ s) => s.nullish();
const DateStr = z.iso.date();
const Text = (max) => z.string().trim().max(max);
const Name = (max = 100) => z.string().trim().min(1, 'Required').max(max);

export const EMPLOYEE_STATUSES = /** @type {const} */ ([
  'PREBOARDING',
  'PROBATION',
  'ACTIVE',
  'NOTICE',
  'EXITED',
]);
export const WORK_MODES = /** @type {const} */ (['OFFICE', 'REMOTE', 'HYBRID']);
export const EMPLOYMENT_TYPES = /** @type {const} */ (['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN']);
export const CHANGE_REASONS = /** @type {const} */ ([
  'TRANSFER',
  'PROMOTION',
  'MANAGER_CHANGE',
  'REORGANIZATION',
  'CORRECTION',
]);

/** Allowed status transitions (Phase 1, EMP-02). EXITED is final; rehiring creates a new employee record. */
export const STATUS_TRANSITIONS = Object.freeze({
  PREBOARDING: ['PROBATION', 'ACTIVE', 'EXITED'],
  PROBATION: ['ACTIVE', 'NOTICE', 'EXITED'],
  ACTIVE: ['NOTICE', 'EXITED'],
  NOTICE: ['ACTIVE', 'EXITED'],
  EXITED: [],
});

const Personal = {
  firstName: Name(),
  middleName: opt(Text(100)),
  lastName: opt(Text(100)),
  preferredName: opt(Text(100)),
  workEmail: opt(Email),
  personalEmail: opt(Email),
  phone: opt(
    z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{6,20}$/, 'Enter a valid phone number'),
  ),
  dateOfBirth: opt(DateStr),
  gender: opt(Text(20)),
  nationality: opt(
    z
      .string()
      .length(2)
      .transform((s) => s.toUpperCase()),
  ),
  locale: opt(Text(16)),
  timezone: opt(TimeZone),
  countryFields: opt(z.record(z.string().max(60), z.union([z.string().max(200), z.number(), z.boolean()]))),
};

const NationalId = {
  nationalIdType: opt(Text(30)),
  nationalId: opt(z.string().trim().min(3).max(40)),
};

export const EmployeeCreateBody = z
  .object({
    ...Personal,
    ...NationalId,
    employeeCode: opt(
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z0-9][A-Z0-9_-]{0,39}$/, 'Use letters, digits, - or _'),
    ),
    legalEntityId: z.uuid(),
    departmentId: opt(z.uuid()),
    designationId: opt(z.uuid()),
    branchId: opt(z.uuid()),
    managerId: opt(z.uuid()),
    scheduleId: opt(z.uuid()),
    workCountry: opt(
      z
        .string()
        .length(2)
        .transform((s) => s.toUpperCase()),
    ),
    payCurrency: opt(
      z
        .string()
        .length(3)
        .transform((s) => s.toUpperCase()),
    ),
    dateOfJoining: DateStr,
    probationEndDate: opt(DateStr),
    status: z.enum(['PREBOARDING', 'PROBATION', 'ACTIVE']).optional(),
    workMode: z.enum(WORK_MODES).default('OFFICE'),
    employmentType: z.enum(EMPLOYMENT_TYPES).default('FULL_TIME'),
  })
  .strict()
  .refine((b) => !b.nationalId || b.nationalIdType, {
    path: ['nationalIdType'],
    message: 'Choose the ID type',
  })
  .refine((b) => !b.probationEndDate || b.probationEndDate > b.dateOfJoining, {
    path: ['probationEndDate'],
    message: 'Must be after the joining date',
  });

/** Profile edits. Job, team and manager changes go through employment records so history is kept. */
export const EmployeeUpdateBody = z
  .object({
    ...Personal,
    ...NationalId,
    firstName: Name().optional(),
    workMode: z.enum(WORK_MODES).optional(),
    employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
    probationEndDate: opt(DateStr),
  })
  .partial()
  .strict()
  .refine((b) => b.nationalId === undefined || b.nationalId === null || b.nationalIdType, {
    path: ['nationalIdType'],
    message: 'Choose the ID type',
  });

export const EmploymentChangeBody = z
  .object({
    effectiveFrom: DateStr,
    changeReason: z.enum(CHANGE_REASONS),
    departmentId: opt(z.uuid()),
    designationId: opt(z.uuid()),
    branchId: opt(z.uuid()),
    managerId: opt(z.uuid()),
    scheduleId: opt(z.uuid()),
  })
  .strict()
  .refine(
    (b) => ['departmentId', 'designationId', 'branchId', 'managerId', 'scheduleId'].some((k) => k in b),
    { message: 'Change at least one field' },
  );

export const StatusChangeBody = z
  .object({
    status: z.enum(EMPLOYEE_STATUSES),
    effectiveDate: DateStr,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const EmergencyContactBody = z
  .object({
    name: Name(150),
    relationship: Name(40),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{6,20}$/, 'Enter a valid phone number'),
    email: opt(Email),
  })
  .strict();

export const BankAccountBody = z
  .object({
    accountHolder: Name(150),
    accountNumber: z
      .string()
      .trim()
      .transform((s) => s.replace(/[\s-]/g, '').toUpperCase())
      .pipe(z.string().regex(/^[A-Z0-9]{4,34}$/, 'Enter a valid account number or IBAN')),
    bankFields: z.record(z.string().max(30), z.string().trim().max(60)).default({}),
    currency: z
      .string()
      .length(3)
      .transform((s) => s.toUpperCase()),
    effectiveFrom: DateStr,
  })
  .strict();

/** Files employees may upload, by declared type. The worker re-checks the real type from the file's bytes. */
export const DOCUMENT_TYPES = Object.freeze({
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
});
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_CATEGORIES = /** @type {const} */ ([
  'ID_PROOF',
  'ADDRESS_PROOF',
  'EDUCATION',
  'EMPLOYMENT',
  'CONTRACT',
  'TAX',
  'MEDICAL',
  'OTHER',
]);

export const DocumentUploadBody = z
  .object({
    category: z.enum(DOCUMENT_CATEGORIES),
    fileName: z.string().trim().min(1).max(200),
    mimeType: z.enum(/** @type {[string, ...string[]]} */ (Object.keys(DOCUMENT_TYPES))),
    sizeBytes: z.number().int().min(1).max(DOCUMENT_MAX_BYTES, 'Files can be up to 10 MB'),
    expiresOn: opt(DateStr),
  })
  .strict();

export const EmployeeListQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.uuid().optional(),
    q: z.string().trim().max(100).optional(),
    status: z.enum(EMPLOYEE_STATUSES).optional(),
    departmentId: z.uuid().optional(),
    branchId: z.uuid().optional(),
    managerId: z.uuid().optional(),
    includeExited: z.enum(['true', 'false']).optional(),
  })
  .strict();

export const IMPORT_COLUMNS = Object.freeze([
  'employeeCode',
  'firstName',
  'lastName',
  'workEmail',
  'phone',
  'dateOfJoining',
  'legalEntity',
  'departmentCode',
  'designation',
  'branchCode',
  'managerEmployeeCode',
  'workMode',
  'employmentType',
  'status',
  'probationEndDate',
]);

/** One CSV row (all values arrive as strings). */
export const ImportRow = z
  .object({
    // Required so a re-run of the same file is idempotent: existing codes are skipped, never duplicated.
    employeeCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9_-]{0,39}$/, 'Use letters, digits, - or _'),
    firstName: Name(),
    lastName: Text(100).optional(),
    workEmail: z.union([z.literal(''), Email]).optional(),
    phone: z.string().trim().max(20).optional(),
    dateOfJoining: DateStr,
    legalEntity: Text(200).optional(),
    departmentCode: Text(20).optional(),
    designation: Text(150).optional(),
    branchCode: Text(20).optional(),
    managerEmployeeCode: Text(40).optional(),
    workMode: z.union([z.literal(''), z.enum(WORK_MODES)]).optional(),
    employmentType: z.union([z.literal(''), z.enum(EMPLOYMENT_TYPES)]).optional(),
    status: z.union([z.literal(''), z.enum(['PREBOARDING', 'PROBATION', 'ACTIVE'])]).optional(),
    probationEndDate: z.union([z.literal(''), DateStr]).optional(),
  })
  .strict();
