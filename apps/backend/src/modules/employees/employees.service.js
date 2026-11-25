// @ts-check
import { createHmac } from 'node:crypto';
import { newId } from '@hrms/shared/ids';
import { DOCUMENT_TYPES, STATUS_TRANSITIONS } from '@hrms/shared/schemas/employee';
import { audit } from '../../lib/audit.js';
import { currentContext } from '../../lib/context.js';
import { db } from '../../lib/db.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { keys } from '../../lib/storage.js';
import { invalidateAccess } from '../rbac/access.js';
import { insertNode, moveSubtree, wouldCreateCycle } from './hierarchy.js';
import { employeeScope, isSelf } from './scope.js';

/** @returns {any} */
const ctx = () => currentContext();
/** 'YYYY-MM-DD' → Date at UTC midnight (DATE columns). @param {string} d */
export const asDate = (d) => new Date(`${d}T00:00:00.000Z`);
/** Date → 'YYYY-MM-DD'. @param {Date | null | undefined} d */
const ymd = (d) => (d ? d.toISOString().slice(0, 10) : null);
const todayYmd = () => new Date().toISOString().slice(0, 10);
/** @param {string} d @param {number} days */
const addDays = (d, days) => ymd(new Date(asDate(d).getTime() + days * 86400_000));

const PROFILE_FIELDS = [
  'firstName',
  'middleName',
  'lastName',
  'preferredName',
  'workEmail',
  'personalEmail',
  'phone',
  'gender',
  'nationality',
  'locale',
  'timezone',
  'countryFields',
  'workMode',
  'employmentType',
];
/** What people may change about themselves without HR (self-service). */
const SELF_EDITABLE = new Set(['preferredName', 'personalEmail', 'phone']);
const JOB_FIELDS = ['departmentId', 'designationId', 'branchId', 'managerId', 'scheduleId'];
/** Current-snapshot columns on the employee row (the schedule lives only on employment records). */
const SNAPSHOT_FIELDS = ['departmentId', 'designationId', 'branchId', 'managerId'];
const RELATIONS = {
  legalEntity: { select: { id: true, name: true, countryCode: true } },
  department: { select: { id: true, name: true, code: true } },
  designation: { select: { id: true, title: true } },
  branch: { select: { id: true, name: true, code: true } },
  manager: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
  tenantMembership: { select: { id: true, status: true, user: { select: { email: true } } } },
};

/**
 * Employee records (Phase 1, EMP-01 … EMP-04). Reads and writes are limited to the caller's data scope;
 * job, team and manager changes are effective-dated records so history is never overwritten.
 * @param {{ cipher?: ReturnType<typeof import('../../lib/crypto.js').createCipher>, blindIndexKey?: Buffer,
 *           files?: ReturnType<typeof import('../../lib/storage.js').storage>, buckets?: { documents: string, reports: string },
 *           queues?: { files?: import('bullmq').Queue }, redis?: import('ioredis').Redis,
 *           revokeMember?: (userId: string, tenantId: string, reason: string) => Promise<unknown> }} deps
 */
export function createEmployeesService(deps) {
  const { cipher, blindIndexKey, files, buckets, queues, redis } = deps;

  // ── National IDs: encrypted, with a blind index for uniqueness (Phase 3, CRY-03/CRY-04) ──
  /** @param {string} type @param {string} value */
  const normalizeId = (type, value) => `${type}:${value.replace(/[\s-]/g, '').toUpperCase()}`;
  /** @param {string} type @param {string} value */
  const blindIndex = (type, value) =>
    createHmac('sha256', /** @type {Buffer} */ (blindIndexKey))
      .update(normalizeId(type, value))
      .digest('hex');

  /** Validates the ID against the work country's formats, returns the columns to store. @param {string} countryCode @param {string} type @param {string} value @param {string} employeeId */
  async function nationalIdColumns(countryCode, type, value, employeeId) {
    if (!cipher || !blindIndexKey) throw new Error('National ID encryption is not configured');
    const profile = await db().countryProfile.findUnique({ where: { code: countryCode } });
    const types = /** @type {Array<{ type: string, pattern: string }>} */ (profile?.nationalIdTypes ?? []);
    const def = types.find((t) => t.type === type);
    if (!def)
      throw new ValidationError([
        {
          path: 'body.nationalIdType',
          message: `Use one of: ${types.map((t) => t.type).join(', ') || 'no ID types configured for this country'}`,
        },
      ]);
    const clean = value.replace(/\s+/g, '').toUpperCase();
    if (!new RegExp(def.pattern).test(clean))
      throw new ValidationError([
        { path: 'body.nationalId', message: `This doesn't look like a valid ${type}` },
      ]);
    return {
      nationalIdType: type,
      nationalIdEnc: cipher.encrypt(clean, employeeId),
      nationalIdIndex: blindIndex(type, clean),
    };
  }

  /** @param {any} e */
  function maskedNationalId(e) {
    if (!e.nationalIdEnc || !cipher) return null;
    const value = cipher.decrypt(e.nationalIdEnc, e.id);
    return { type: e.nationalIdType, masked: `•••• ${value.slice(-4)}` };
  }

  /** API shape of an employee. Encrypted columns never leave the service. @param {any} e */
  function dto(e) {
    return {
      id: e.id,
      employeeCode: e.employeeCode,
      firstName: e.firstName,
      middleName: e.middleName,
      lastName: e.lastName,
      preferredName: e.preferredName,
      displayName: [e.preferredName || e.firstName, e.lastName].filter(Boolean).join(' '),
      workEmail: e.workEmail,
      personalEmail: e.personalEmail,
      phone: e.phone,
      dateOfBirth: ymd(e.dateOfBirth),
      gender: e.gender,
      nationality: e.nationality,
      workCountry: e.workCountry,
      locale: e.locale,
      timezone: e.timezone,
      payCurrency: e.payCurrency,
      dateOfJoining: ymd(e.dateOfJoining),
      probationEndDate: ymd(e.probationEndDate),
      exitDate: ymd(e.exitDate),
      status: e.status,
      workMode: e.workMode,
      employmentType: e.employmentType,
      countryFields: e.countryFields,
      nationalId: maskedNationalId(e),
      legalEntity: e.legalEntity ?? null,
      department: e.department ?? null,
      designation: e.designation ?? null,
      branch: e.branch ?? null,
      manager: e.manager
        ? {
            id: e.manager.id,
            employeeCode: e.manager.employeeCode,
            name: [e.manager.firstName, e.manager.lastName].filter(Boolean).join(' '),
          }
        : null,
      member: e.tenantMembership
        ? {
            id: e.tenantMembership.id,
            status: e.tenantMembership.status,
            email: e.tenantMembership.user.email,
          }
        : null,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
  }

  /** Loads one employee inside the caller's scope for a permission, else 404 (no existence leak). @param {string} id @param {string} permission @param {{ includeSelf?: boolean }} [opts] */
  async function scopedOr404(id, permission, opts = {}) {
    const where = await employeeScope(permission, opts);
    const e = await db().employee.findFirst({
      where: { AND: [{ id, deletedAt: null }, where] },
      include: RELATIONS,
    });
    if (!e) throw new NotFoundError();
    return e;
  }

  /** Next free code like E00042 (tenant-wide, zero-padded so it sorts). @param {any} tx */
  async function nextEmployeeCode(tx) {
    const rows = await tx.employee.findMany({
      where: { employeeCode: { startsWith: 'E' } },
      select: { employeeCode: true },
      orderBy: { employeeCode: 'desc' },
      take: 50,
    });
    const max = rows
      .map((r) => /^E(\d{5,})$/.exec(r.employeeCode)?.[1])
      .filter(Boolean)
      .map(Number)
      .reduce((a, b) => Math.max(a, b), 0);
    return `E${String(max + 1).padStart(5, '0')}`;
  }

  /** A manager must exist in this company and not have left. @param {any} tx @param {string | null | undefined} managerId */
  async function assertManagerUsable(tx, managerId) {
    if (!managerId) return;
    const m = await tx.employee.findUnique({
      where: { id: managerId },
      select: { status: true, deletedAt: true },
    });
    if (!m || m.deletedAt)
      throw new ValidationError([{ path: 'body.managerId', message: 'This manager does not exist' }]);
    if (m.status === 'EXITED')
      throw new ValidationError([{ path: 'body.managerId', message: 'This person has left the company' }]);
  }

  const service = {
    dto,

    /**
     * Creates an employee with their first employment record and hierarchy rows, in one transaction.
     * Used by the API and by the bulk import job.
     * @param {any} input validated EmployeeCreateBody
     * @param {{ source?: string }} [opts]
     */
    async create(input, opts = {}) {
      const id = newId();
      const le = await db().legalEntity.findUnique({ where: { id: input.legalEntityId } });
      if (!le || le.deletedAt)
        throw new ValidationError([
          { path: 'body.legalEntityId', message: 'This legal entity does not exist' },
        ]);
      const workCountry = input.workCountry ?? le.countryCode;
      const idCols = input.nationalId
        ? await nationalIdColumns(workCountry, input.nationalIdType, input.nationalId, id)
        : {};
      const status =
        input.status ??
        (input.dateOfJoining > todayYmd() ? 'PREBOARDING' : input.probationEndDate ? 'PROBATION' : 'ACTIVE');

      for (let attempt = 0; ; attempt++) {
        try {
          await db().$transaction(async (/** @type {any} */ tx) => {
            await assertManagerUsable(tx, input.managerId);
            const employeeCode = input.employeeCode ?? (await nextEmployeeCode(tx));
            await tx.employee.create({
              data: {
                id,
                employeeCode,
                legalEntityId: le.id,
                ...Object.fromEntries(
                  PROFILE_FIELDS.filter((f) => input[f] !== undefined).map((f) => [f, input[f]]),
                ),
                dateOfBirth: input.dateOfBirth ? asDate(input.dateOfBirth) : null,
                workCountry,
                timezone: input.timezone ?? le.timezone,
                locale: input.locale ?? 'en',
                payCurrency: input.payCurrency ?? le.currency,
                dateOfJoining: asDate(input.dateOfJoining),
                probationEndDate: input.probationEndDate ? asDate(input.probationEndDate) : null,
                status,
                workMode: input.workMode ?? 'OFFICE',
                employmentType: input.employmentType ?? 'FULL_TIME',
                ...Object.fromEntries(SNAPSHOT_FIELDS.filter((f) => input[f]).map((f) => [f, input[f]])),
                ...idCols,
              },
            });
            await tx.employmentRecord.create({
              data: {
                id: newId(),
                employeeId: id,
                changeReason: 'JOINING',
                effectiveFrom: asDate(input.dateOfJoining),
                createdBy: ctx().userId ?? 'system',
                ...Object.fromEntries(JOB_FIELDS.map((f) => [f, input[f] ?? null])),
              },
            });
            await insertNode(tx, id, input.managerId ?? null);
            await audit(tx, {
              action: 'employee.created',
              entityType: 'Employee',
              entityId: id,
              changes: { employeeCode, source: opts.source ?? 'api' },
            });
          });
          break;
        } catch (err) {
          const target = String(
            /** @type {any} */ (err)?.meta?.target ?? /** @type {any} */ (err)?.message ?? '',
          );
          if (/** @type {any} */ (err)?.code === 'P2002' && /national_id_index/.test(target))
            throw new ConflictError('national_id_in_use', 'Another employee already has this ID number');
          if (/** @type {any} */ (err)?.code === 'P2002' && !input.employeeCode && attempt < 3) continue; // concurrent auto-numbering
          if (/** @type {any} */ (err)?.code === 'P2002')
            throw new ConflictError(
              'employee_code_in_use',
              'Another employee already has this employee code',
            );
          throw err;
        }
      }
      return dto(await db().employee.findUnique({ where: { id }, include: RELATIONS }));
    },

    /** @param {any} q validated EmployeeListQuery */
    async list(q) {
      const scope = await employeeScope('employee.profile.view', { includeSelf: true });
      const filters = {
        deletedAt: null,
        ...(q.status
          ? { status: q.status }
          : q.includeExited === 'true'
            ? {}
            : { status: { not: 'EXITED' } }),
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
        ...(q.branchId ? { branchId: q.branchId } : {}),
        ...(q.managerId ? { managerId: q.managerId } : {}),
        ...(q.q
          ? {
              OR: [
                { firstName: { contains: q.q } },
                { lastName: { contains: q.q } },
                { preferredName: { contains: q.q } },
                { employeeCode: { contains: q.q } },
                { workEmail: { contains: q.q } },
              ],
            }
          : {}),
      };
      const rows = await db().employee.findMany({
        where: { AND: [filters, scope] },
        include: RELATIONS,
        orderBy: { id: 'asc' },
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, q.limit);
      return { data: page.map(dto), nextCursor: rows.length > q.limit ? page[page.length - 1].id : null };
    },

    /** @param {string} id */
    async get(id) {
      return dto(await scopedOr404(id, 'employee.profile.view', { includeSelf: true }));
    },

    async me() {
      const c = ctx();
      if (!c.employeeId)
        throw new AppError(
          404,
          'no_employee_record',
          'Your account is not linked to an employee record yet. Ask HR.',
        );
      return service.get(c.employeeId);
    },

    /** Full national ID for people with employee.sensitive.view (audited). @param {string} id */
    async revealNationalId(id) {
      const e = await scopedOr404(id, 'employee.sensitive.view');
      if (!e.nationalIdEnc || !cipher) throw new NotFoundError();
      await audit(db(), { action: 'employee.national_id_viewed', entityType: 'Employee', entityId: id });
      return { type: e.nationalIdType, value: cipher.decrypt(e.nationalIdEnc, e.id) };
    },

    /** Profile edits. Self-service may change only a few contact fields. @param {string} id @param {any} input */
    async update(id, input) {
      const canUpdate = ctx().permissions.has('employee.profile.update');
      let e;
      if (canUpdate) {
        e = await scopedOr404(id, 'employee.profile.update', { includeSelf: isSelf(id) });
      } else if (isSelf(id)) {
        const blocked = Object.keys(input).filter((k) => !SELF_EDITABLE.has(k));
        if (blocked.length)
          throw new ForbiddenError('self_service_limited', `Ask HR to change: ${blocked.join(', ')}`);
        e = await scopedOr404(id, 'employee.profile.view', { includeSelf: true });
      } else {
        throw new ForbiddenError();
      }
      if (canUpdate && isSelf(id) && ctx().permissions.get('employee.profile.update') !== 'COMPANY') {
        const blocked = Object.keys(input).filter((k) => !SELF_EDITABLE.has(k));
        if (blocked.length)
          throw new ForbiddenError('self_service_limited', `Ask HR to change: ${blocked.join(', ')}`);
      }
      const data = Object.fromEntries(
        PROFILE_FIELDS.filter((f) => input[f] !== undefined).map((f) => [f, input[f]]),
      );
      if (input.dateOfBirth !== undefined)
        data.dateOfBirth = input.dateOfBirth ? asDate(input.dateOfBirth) : null;
      if (input.probationEndDate !== undefined)
        data.probationEndDate = input.probationEndDate ? asDate(input.probationEndDate) : null;
      if (input.nationalId !== undefined) {
        Object.assign(
          data,
          input.nationalId
            ? await nationalIdColumns(e.workCountry, input.nationalIdType, input.nationalId, e.id)
            : { nationalIdType: null, nationalIdEnc: null, nationalIdIndex: null },
        );
      }
      try {
        await db().employee.update({ where: { id }, data });
      } catch (err) {
        if (/** @type {any} */ (err)?.code === 'P2002')
          throw new ConflictError('national_id_in_use', 'Another employee already has this ID number');
        throw err;
      }
      const changed = Object.keys(input).map((k) => (k === 'nationalId' ? 'nationalId (encrypted)' : k));
      await audit(db(), {
        action: 'employee.updated',
        entityType: 'Employee',
        entityId: id,
        changes: { fields: changed },
      });
      return service.get(id);
    },

    /**
     * Records a transfer, promotion or manager change as a new effective-dated employment record, updates the
     * current snapshot on the employee, and moves the reporting subtree when the manager changes.
     * @param {string} id @param {any} input validated EmploymentChangeBody
     */
    async changeEmployment(id, input) {
      const e = await scopedOr404(id, 'employee.profile.update');
      if (e.status === 'EXITED')
        throw new ConflictError('employee_exited', 'This person has left the company');
      if (input.effectiveFrom > todayYmd())
        throw new ValidationError([
          {
            path: 'body.effectiveFrom',
            message: 'Future-dated changes are not supported yet. Use today or an earlier date.',
          },
        ]);
      if (input.effectiveFrom < ymd(e.dateOfJoining))
        throw new ValidationError([
          { path: 'body.effectiveFrom', message: 'Must be on or after the joining date' },
        ]);
      await db().$transaction(async (/** @type {any} */ tx) => {
        const current = await tx.employmentRecord.findFirst({
          where: { employeeId: id, effectiveTo: null },
          orderBy: { effectiveFrom: 'desc' },
        });
        if (current && input.effectiveFrom < ymd(current.effectiveFrom)) {
          throw new ValidationError([
            {
              path: 'body.effectiveFrom',
              message: `Must be on or after the current record's start (${ymd(current.effectiveFrom)})`,
            },
          ]);
        }
        if ('managerId' in input && input.managerId) {
          await assertManagerUsable(tx, input.managerId);
          if (await wouldCreateCycle(tx, id, input.managerId)) {
            throw new ValidationError([
              {
                path: 'body.managerId',
                message: 'Someone cannot report to themselves or to a person who reports to them',
              },
            ]);
          }
        }
        const next = Object.fromEntries(
          JOB_FIELDS.map((f) => [f, f in input ? (input[f] ?? null) : (current?.[f] ?? e[f] ?? null)]),
        );
        if (current && ymd(current.effectiveFrom) === input.effectiveFrom) {
          await tx.employmentRecord.update({
            where: { id: current.id },
            data: { ...next, changeReason: input.changeReason },
          });
        } else {
          if (current)
            await tx.employmentRecord.update({
              where: { id: current.id },
              data: { effectiveTo: asDate(addDays(input.effectiveFrom, -1)) },
            });
          await tx.employmentRecord.create({
            data: {
              id: newId(),
              employeeId: id,
              changeReason: input.changeReason,
              effectiveFrom: asDate(input.effectiveFrom),
              createdBy: ctx().userId,
              ...next,
            },
          });
        }
        await tx.employee.update({
          where: { id },
          data: Object.fromEntries(SNAPSHOT_FIELDS.map((f) => [f, next[f]])),
        });
        if (next.managerId !== e.managerId) await moveSubtree(tx, id, next.managerId);
        await audit(tx, {
          action: 'employee.employment_changed',
          entityType: 'Employee',
          entityId: id,
          changes: {
            reason: input.changeReason,
            effectiveFrom: input.effectiveFrom,
            ...Object.fromEntries(
              JOB_FIELDS.filter((f) => f in input).map((f) => [f, { from: e[f], to: next[f] }]),
            ),
          },
        });
      });
      return service.get(id);
    },

    /** @param {string} id */
    async employmentHistory(id) {
      await scopedOr404(id, 'employee.profile.view', { includeSelf: true });
      const rows = await db().employmentRecord.findMany({
        where: { employeeId: id },
        orderBy: { effectiveFrom: 'desc' },
        include: {
          department: { select: { name: true } },
          designation: { select: { title: true } },
          branch: { select: { name: true } },
          manager: { select: { firstName: true, lastName: true } },
        },
      });
      return rows.map((r) => ({
        id: r.id,
        changeReason: r.changeReason,
        effectiveFrom: ymd(r.effectiveFrom),
        effectiveTo: ymd(r.effectiveTo),
        department: r.department?.name ?? null,
        designation: r.designation?.title ?? null,
        branch: r.branch?.name ?? null,
        manager: r.manager ? [r.manager.firstName, r.manager.lastName].filter(Boolean).join(' ') : null,
      }));
    },

    /**
     * Status lifecycle (PREBOARDING → PROBATION → ACTIVE → NOTICE → EXITED). Leaving needs direct reports moved first,
     * and signs the person out of this company.
     * @param {string} id @param {{ status: string, effectiveDate: string, reason: string }} input
     */
    async changeStatus(id, input) {
      const e = await scopedOr404(id, 'employee.profile.update');
      const allowed = /** @type {Record<string, string[]>} */ (STATUS_TRANSITIONS)[e.status];
      if (!allowed.includes(input.status))
        throw new ConflictError(
          'invalid_transition',
          `Can't change status from ${e.status} to ${input.status}`,
        );
      if (input.status === 'EXITED') {
        const reports = await db().employee.count({
          where: { managerId: id, status: { not: 'EXITED' }, deletedAt: null },
        });
        if (reports)
          throw new ConflictError(
            'has_reports',
            `${reports} people report to this person. Move them to another manager first.`,
          );
      }
      await db().employee.update({
        where: { id },
        data: {
          status: input.status,
          ...(input.status === 'EXITED' ? { exitDate: asDate(input.effectiveDate) } : {}),
          ...(e.status === 'PROBATION' && input.status === 'ACTIVE'
            ? { probationEndDate: asDate(input.effectiveDate) }
            : {}),
        },
      });
      if (input.status === 'EXITED') {
        await db().employmentRecord.updateMany({
          where: { employeeId: id, effectiveTo: null },
          data: { effectiveTo: asDate(input.effectiveDate) },
        });
        const m = await db().tenantMembership.findFirst({ where: { employeeId: id } });
        if (m && m.status === 'ACTIVE') {
          await db().tenantMembership.update({ where: { id: m.id }, data: { status: 'SUSPENDED' } });
          await deps.revokeMember?.(m.userId, m.tenantId, 'employee_exited');
        }
      }
      await audit(db(), {
        action: 'employee.status_changed',
        entityType: 'Employee',
        entityId: id,
        changes: {
          from: e.status,
          to: input.status,
          effectiveDate: input.effectiveDate,
          reason: input.reason,
        },
      });
      return service.get(id);
    },

    // ── Emergency contacts: visible to whoever can see the profile; editable by the person or HR ──

    /** @param {string} id */
    async contacts(id) {
      await scopedOr404(id, 'employee.profile.view', { includeSelf: true });
      const rows = await db().emergencyContact.findMany({
        where: { employeeId: id },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(({ tenantId: _t, ...r }) => r);
    },
    /** @param {string} id */
    async assertCanEditContacts(id) {
      if (isSelf(id)) return scopedOr404(id, 'employee.profile.view', { includeSelf: true });
      return scopedOr404(id, 'employee.profile.update');
    },
    /** @param {string} id @param {any} input */
    async addContact(id, input) {
      await service.assertCanEditContacts(id);
      const contactId = newId();
      const row = await db().emergencyContact.create({
        data: { id: contactId, employeeId: id, ...input, email: input.email ?? null },
      });
      await audit(db(), { action: 'employee.contact_added', entityType: 'Employee', entityId: id });
      const { tenantId: _t, ...out } = row;
      return out;
    },
    /** @param {string} id @param {string} contactId */
    async removeContact(id, contactId) {
      await service.assertCanEditContacts(id);
      const { count } = await db().emergencyContact.deleteMany({ where: { id: contactId, employeeId: id } });
      if (!count) throw new NotFoundError();
      await audit(db(), { action: 'employee.contact_removed', entityType: 'Employee', entityId: id });
    },

    // ── Bank accounts: account numbers are encrypted; only the last 4 digits are ever returned ──

    /** @param {string} id */
    async bankAccounts(id) {
      if (!isSelf(id)) await scopedOr404(id, 'payroll.bank.view');
      const rows = await db().employeeBankAccount.findMany({
        where: { employeeId: id },
        orderBy: { effectiveFrom: 'desc' },
      });
      return rows.map((r) => ({
        id: r.id,
        accountHolder: r.accountHolder,
        accountNumber: `•••• ${r.accountNumberLast4}`,
        bankFields: r.bankFields,
        currency: r.currency,
        isPrimary: r.isPrimary,
        effectiveFrom: ymd(r.effectiveFrom),
        effectiveTo: ymd(r.effectiveTo),
      }));
    },
    /** New account from a date; the previous open account ends the day before. @param {string} id @param {any} input */
    async addBankAccount(id, input) {
      if (!cipher) throw new Error('Encryption is not configured');
      await scopedOr404(id, 'payroll.bank.manage');
      const accountId = newId();
      await db().$transaction(async (/** @type {any} */ tx) => {
        const open = await tx.employeeBankAccount.findFirst({ where: { employeeId: id, effectiveTo: null } });
        if (open) {
          if (input.effectiveFrom <= ymd(open.effectiveFrom))
            throw new ValidationError([
              { path: 'body.effectiveFrom', message: `Must be after ${ymd(open.effectiveFrom)}` },
            ]);
          await tx.employeeBankAccount.update({
            where: { id: open.id },
            data: { effectiveTo: asDate(addDays(input.effectiveFrom, -1)), isPrimary: false },
          });
        }
        await tx.employeeBankAccount.create({
          data: {
            id: accountId,
            employeeId: id,
            accountHolder: input.accountHolder,
            accountNumberEnc: cipher.encrypt(input.accountNumber, accountId),
            accountNumberLast4: input.accountNumber.slice(-4),
            bankFields: input.bankFields,
            currency: input.currency,
            isPrimary: true,
            effectiveFrom: asDate(input.effectiveFrom),
          },
        });
        await audit(tx, {
          action: 'employee.bank_account_added',
          entityType: 'Employee',
          entityId: id,
          changes: { last4: input.accountNumber.slice(-4), effectiveFrom: input.effectiveFrom },
        });
      });
      return (await service.bankAccounts(id)).find((a) => a.id === accountId);
    },

    // ── Documents: uploaded straight to private S3 with a 60-second presigned URL, then type-checked by the worker ──

    /** People see their own documents; others need employee.documents.view in scope. @param {string} id */
    async assertCanViewDocuments(id) {
      if (isSelf(id)) return;
      await scopedOr404(id, 'employee.documents.view');
    },
    /** @param {string} id */
    async assertCanManageDocuments(id) {
      if (isSelf(id)) return;
      await scopedOr404(id, 'employee.documents.manage');
    },
    /** @param {string} id */
    async documents(id) {
      await service.assertCanViewDocuments(id);
      const rows = await db().employeeDocument.findMany({
        where: { employeeId: id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((d) => ({
        id: d.id,
        category: d.category,
        fileName: d.fileName,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        scanStatus: d.scanStatus,
        verifiedAt: d.verifiedAt,
        expiresOn: ymd(d.expiresOn),
        createdAt: d.createdAt,
      }));
    },
    /** @param {string} id @param {any} input validated DocumentUploadBody */
    async startDocumentUpload(id, input) {
      await service.assertCanManageDocuments(id);
      if (!files || !buckets) throw new Error('Storage is not configured');
      const documentId = newId();
      const ext = /** @type {Record<string, string>} */ (DOCUMENT_TYPES)[input.mimeType];
      const s3Key = keys.employeeDocument(ctx().tenantId, id, documentId, ext);
      await db().employeeDocument.create({
        data: {
          id: documentId,
          employeeId: id,
          category: input.category,
          fileName: input.fileName,
          s3Key,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          expiresOn: input.expiresOn ? asDate(input.expiresOn) : null,
        },
      });
      const uploadUrl = await files.uploadUrl(buckets.documents, s3Key, input.mimeType);
      return {
        documentId,
        uploadUrl,
        method: 'PUT',
        headers: { 'Content-Type': input.mimeType },
        expiresInSec: 60,
      };
    },
    /** @param {string} id @param {string} documentId */
    async completeDocumentUpload(id, documentId) {
      await service.assertCanManageDocuments(id);
      const d = await db().employeeDocument.findFirst({
        where: { id: documentId, employeeId: id, deletedAt: null },
      });
      if (!d) throw new NotFoundError();
      if (d.scanStatus !== 'PENDING') return { scanStatus: d.scanStatus };
      try {
        await /** @type {any} */ (files).head(/** @type {any} */ (buckets).documents, d.s3Key);
      } catch {
        throw new ConflictError('upload_missing', 'The file has not been uploaded yet');
      }
      await queues?.files?.add(
        'verify-document',
        { tenantId: ctx().tenantId, documentId },
        { jobId: `verify-document-${documentId}` },
      );
      await audit(db(), {
        action: 'employee.document_uploaded',
        entityType: 'Employee',
        entityId: id,
        changes: { documentId, category: d.category },
      });
      return { scanStatus: 'PENDING' };
    },
    /** @param {string} id @param {string} documentId */
    async documentDownloadUrl(id, documentId) {
      await service.assertCanViewDocuments(id);
      const d = await db().employeeDocument.findFirst({
        where: { id: documentId, employeeId: id, deletedAt: null },
      });
      if (!d) throw new NotFoundError();
      if (d.scanStatus !== 'CLEAN')
        throw new ConflictError(
          'not_ready',
          d.scanStatus === 'PENDING'
            ? 'The file is still being checked'
            : 'This file failed the safety check',
        );
      await audit(db(), {
        action: 'employee.document_downloaded',
        entityType: 'Employee',
        entityId: id,
        changes: { documentId },
      });
      return {
        url: await /** @type {any} */ (files).downloadUrl(
          /** @type {any} */ (buckets).documents,
          d.s3Key,
          d.fileName,
        ),
        expiresInSec: 60,
      };
    },
    /** HR confirms a document is genuine. @param {string} id @param {string} documentId */
    async verifyDocument(id, documentId) {
      await scopedOr404(id, 'employee.documents.manage');
      const { count } = await db().employeeDocument.updateMany({
        where: { id: documentId, employeeId: id, deletedAt: null, scanStatus: 'CLEAN' },
        data: { verifiedAt: new Date(), verifiedBy: ctx().userId },
      });
      if (!count) throw new NotFoundError();
      await audit(db(), {
        action: 'employee.document_verified',
        entityType: 'Employee',
        entityId: id,
        changes: { documentId },
      });
    },
    /** Soft-deletes the record and removes the file. @param {string} id @param {string} documentId */
    async deleteDocument(id, documentId) {
      await service.assertCanManageDocuments(id);
      const d = await db().employeeDocument.findFirst({
        where: { id: documentId, employeeId: id, deletedAt: null },
      });
      if (!d) throw new NotFoundError();
      await db().employeeDocument.update({ where: { id: d.id }, data: { deletedAt: new Date() } });
      await /** @type {any} */ (files)
        .remove(/** @type {any} */ (buckets).documents, d.s3Key)
        .catch(() => {});
      await audit(db(), {
        action: 'employee.document_deleted',
        entityType: 'Employee',
        entityId: id,
        changes: { documentId },
      });
    },

    // ── Link to a sign-in account ──

    /** Connects (or disconnects) a member's account to an employee record; this is what "own" and "team" scopes use. @param {string} membershipId @param {string | null} employeeId */
    async linkMember(membershipId, employeeId) {
      const m = await db().tenantMembership.findUnique({ where: { id: membershipId } });
      if (!m) throw new NotFoundError();
      if (employeeId) {
        const e = await db().employee.findUnique({ where: { id: employeeId } });
        if (!e || e.deletedAt)
          throw new ValidationError([{ path: 'body.employeeId', message: 'This employee does not exist' }]);
      }
      try {
        await db().tenantMembership.update({ where: { id: m.id }, data: { employeeId } });
      } catch (err) {
        if (/** @type {any} */ (err)?.code === 'P2002')
          throw new ConflictError(
            'employee_already_linked',
            'This employee is already linked to another account',
          );
        throw err;
      }
      await invalidateAccess(redis, m.tenantId, m.userId);
      await audit(db(), {
        action: 'member.employee_linked',
        entityType: 'TenantMembership',
        entityId: m.id,
        changes: { employeeId },
      });
    },

    // ── Export ──

    /** Rows for CSV export within the caller's bulk-export scope (formula injection handled by the CSV writer). */
    async exportRows() {
      const scope = await employeeScope('employee.bulk.export');
      const rows = await db().employee.findMany({
        where: { AND: [{ deletedAt: null }, scope] },
        include: RELATIONS,
        orderBy: { employeeCode: 'asc' },
        take: 50_000,
      });
      await audit(db(), {
        action: 'employee.exported',
        entityType: 'Employee',
        changes: { rows: rows.length },
      });
      return rows.map((e) => {
        const d = dto(e);
        return {
          employeeCode: d.employeeCode,
          firstName: d.firstName,
          lastName: d.lastName ?? '',
          workEmail: d.workEmail ?? '',
          phone: d.phone ?? '',
          status: d.status,
          dateOfJoining: d.dateOfJoining,
          legalEntity: d.legalEntity?.name ?? '',
          department: d.department?.name ?? '',
          designation: d.designation?.title ?? '',
          branch: d.branch?.name ?? '',
          manager: d.manager?.employeeCode ?? '',
          workMode: d.workMode,
          employmentType: d.employmentType,
        };
      });
    },
  };
  return service;
}

/**
 * Neutralizes spreadsheet formula injection: cells starting with = + - @ tab or CR get a leading apostrophe (Phase 3, APP-06).
 * @param {unknown} value
 */
export function safeCsvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
