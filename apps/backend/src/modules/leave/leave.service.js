// @ts-check
import { newId } from '@hrms/shared/ids';
import { fromCenti, toCenti } from '@hrms/shared/quantity';
import { LeavePolicyRules, STARTER_LEAVE_TYPES, TARGET_PRIORITY } from '@hrms/shared/schemas/leave';
import { audit } from '../../lib/audit.js';
import { currentContext } from '../../lib/context.js';
import { db } from '../../lib/db.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { addDays, dateToYmd, daysBetween, localYmd, ymdToDate } from '../../lib/time.js';
import { anyOf, employeeScope } from '../employees/scope.js';
import {
  accrualsDue,
  capCredit,
  countLeaveDays,
  leaveYearOf,
  validateRequest,
  yearEndExpiry,
} from './engine.js';

const ctx = () => /** @type {any} */ (currentContext());
const fullName = (/** @type {any} */ e) => [e.firstName, e.lastName].filter(Boolean).join(' ');
const centi = (/** @type {any} */ decimal) =>
  decimal === null || decimal === undefined ? 0 : toCenti(String(decimal));
const MAX_REQUEST_DAYS = 93;
const STEP_ENTITY = 'LEAVE_REQUEST';

const EMPLOYEE_SELECT = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  timezone: true,
  legalEntityId: true,
  branchId: true,
  departmentId: true,
  managerId: true,
  dateOfJoining: true,
  exitDate: true,
  status: true,
  legalEntity: { select: { weekendDays: true, weekStartDay: true } },
  branch: { select: { holidayCalendarId: true } },
  department: { select: { name: true } },
};

/** A scope `where` must be combined with AND, never spread next to an `id` (it may itself be `{ id }`). */
const scoped = (/** @type {object} */ where, /** @type {object} */ scope) => ({ AND: [where, scope] });

/**
 * Leave: types, effective-dated policies, ledger balances, requests with approval chains, accruals (LEV-01..04).
 * @param {{ attendance: ReturnType<typeof import('../attendance/attendance.service.js').createAttendanceService>,
 *           queues?: { workSessions?: { add: Function } }, now?: () => Date }} deps
 */
export function createLeaveService({ attendance, queues, now = () => new Date() }) {
  const loadEmployee = (/** @type {string} */ id) =>
    db().employee.findUnique({ where: { id }, select: EMPLOYEE_SELECT });

  async function me() {
    const id = ctx().employeeId;
    const emp = id ? await loadEmployee(id) : null;
    if (!emp)
      throw new AppError(
        409,
        'no_employee_record',
        'Your sign-in is not linked to an employee record. Ask HR to link it.',
      );
    return emp;
  }

  /** @param {string} permission @param {string} employeeId @param {{ includeSelf?: boolean }} [opts] */
  async function employeeInScope(permission, employeeId, opts = {}) {
    const scope = await employeeScope(permission, opts);
    const emp = await db().employee.findFirst({
      where: scoped({ id: employeeId, deletedAt: null }, scope),
      select: EMPLOYEE_SELECT,
    });
    if (!emp) throw new NotFoundError();
    return emp;
  }

  /**
   * The policy for one employee, leave type and date. The most specific assignment wins
   * (employee → department → branch → legal entity → company); among equals, the latest start.
   * @param {any} emp @param {string} leaveTypeId @param {string} ymd
   */
  async function policyFor(emp, leaveTypeId, ymd) {
    const date = ymdToDate(ymd);
    const inForce = (/** @type {string} */ prefix = '') => ({
      [`${prefix}effectiveFrom`]: { lte: date },
    });
    const rows = await db().leavePolicyAssignment.findMany({
      where: {
        ...inForce(),
        AND: [
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] },
          {
            policy: {
              leaveTypeId,
              effectiveFrom: { lte: date },
              AND: [
                { OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] },
                { OR: [{ legalEntityId: null }, { legalEntityId: emp.legalEntityId }] },
              ],
            },
          },
          {
            OR: [
              { appliesTo: 'COMPANY' },
              { appliesTo: 'EMPLOYEE', targetId: emp.id },
              ...(emp.departmentId ? [{ appliesTo: 'DEPARTMENT', targetId: emp.departmentId }] : []),
              ...(emp.branchId ? [{ appliesTo: 'BRANCH', targetId: emp.branchId }] : []),
              { appliesTo: 'LEGAL_ENTITY', targetId: emp.legalEntityId },
            ],
          },
        ],
      },
      include: { policy: true },
    });
    if (!rows.length) return null;
    rows.sort(
      (a, b) =>
        TARGET_PRIORITY.indexOf(/** @type {any} */ (a.appliesTo)) -
          TARGET_PRIORITY.indexOf(/** @type {any} */ (b.appliesTo)) ||
        b.effectiveFrom.getTime() - a.effectiveFrom.getTime() ||
        b.policy.effectiveFrom.getTime() - a.policy.effectiveFrom.getTime(),
    );
    const policy = rows[0].policy;
    return { ...policy, rules: LeavePolicyRules.parse(policy.rules) };
  }

  /** @param {string} employeeId @param {string} leaveTypeId @param {string} [asOf] */
  async function balanceCenti(employeeId, leaveTypeId, asOf) {
    const agg = await db().leaveLedgerEntry.aggregate({
      where: { employeeId, leaveTypeId, ...(asOf ? { postedOn: { lte: ymdToDate(asOf) } } : {}) },
      _sum: { quantity: true },
    });
    return centi(agg._sum.quantity);
  }

  /** @param {string} employeeId @param {string} leaveTypeId @param {string} [excludeRequestId] */
  async function pendingCenti(employeeId, leaveTypeId, excludeRequestId) {
    const agg = await db().leaveRequest.aggregate({
      where: {
        employeeId,
        leaveTypeId,
        status: 'PENDING',
        ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
      },
      _sum: { totalQuantity: true },
    });
    return centi(agg._sum.totalQuantity);
  }

  /** Counts the days of a request using the employee's attendance plan (shift, schedule, weekends, holidays). */
  async function countDays(/** @type {any} */ emp, /** @type {any} */ input, /** @type {any} */ rules) {
    if (daysBetween(input.fromDate, input.toDate) + 1 > MAX_REQUEST_DAYS)
      throw new ValidationError([
        { path: 'body.toDate', message: `At most ${MAX_REQUEST_DAYS} days in one request` },
      ]);
    /** @type {Map<string, string>} */
    const kinds = new Map();
    for (let d = input.fromDate; d <= input.toDate; d = /** @type {string} */ (addDays(d, 1)))
      kinds.set(d, (await attendance.planFor(emp, d)).kind);
    return countLeaveDays({ ...input, dayKind: (d) => /** @type {any} */ (kinds.get(d)), rules });
  }

  /** Builds and checks a request without saving it. @param {any} emp @param {any} input */
  async function evaluate(emp, input, excludeRequestId = undefined) {
    const leaveType = await db().leaveType.findFirst({ where: { id: input.leaveTypeId, deletedAt: null } });
    if (!leaveType)
      throw new ValidationError([{ path: 'body.leaveTypeId', message: 'Leave type not found' }]);
    const policy = await policyFor(emp, leaveType.id, input.fromDate);
    if (!policy)
      throw new ValidationError([
        { path: 'body.leaveTypeId', message: 'No leave policy gives you this type of leave on these dates' },
      ]);
    const counted = await countDays(emp, input, policy.rules);
    const [balance, pending, overlapping] = await Promise.all([
      balanceCenti(emp.id, leaveType.id),
      pendingCenti(emp.id, leaveType.id, excludeRequestId),
      counted.days.length
        ? db().leaveRequestDay.count({
            where: {
              date: { in: counted.days.map((d) => ymdToDate(d.date)) },
              request: {
                employeeId: emp.id,
                status: { in: ['PENDING', 'APPROVED'] },
                ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
              },
            },
          })
        : 0,
    ]);
    if (input.documentId) {
      const doc = await db().employeeDocument.findFirst({
        where: { id: input.documentId, employeeId: emp.id, deletedAt: null },
      });
      if (!doc)
        throw new ValidationError([{ path: 'body.documentId', message: 'Choose one of your own documents' }]);
    }
    const errors = validateRequest({
      rules: policy.rules,
      leaveType,
      dateOfJoining: /** @type {string} */ (dateToYmd(emp.dateOfJoining)),
      today: localYmd(now(), emp.timezone),
      request: input,
      totalCenti: counted.totalCenti,
      availableCenti: balance - pending,
      overlaps: overlapping > 0,
    });
    return { leaveType, policy, counted, balance, pending, errors };
  }

  /** Can the caller decide this step? Never your own request; step 1 also goes to the direct manager. */
  async function canDecide(/** @type {any} */ request, /** @type {any} */ step, /** @type {any[]} */ steps) {
    const myEmp = ctx().employeeId ?? null;
    if (myEmp && myEmp === request.employeeId) return false;
    if (step.stepNo > 1 && steps.some((s) => s.stepNo < step.stepNo && s.decidedBy === ctx().userId))
      return false;
    if (step.stepNo === 1 && myEmp && step.approverEmployeeId === myEmp) return true;
    if (!ctx().permissions?.has('leave.request.approve')) return false;
    const scope = await employeeScope('leave.request.approve');
    return (await db().employee.count({ where: scoped({ id: request.employeeId }, scope) })) > 0;
  }

  const stepsOf = (/** @type {string} */ id) =>
    db().approvalStep.findMany({
      where: { entityType: STEP_ENTITY, entityId: id },
      orderBy: { stepNo: 'asc' },
    });

  /** API shape. @param {any} r @param {any[]} steps */
  const requestDto = (r, steps = []) => ({
    id: r.id,
    status: r.status,
    leaveType: r.leaveType
      ? { id: r.leaveType.id, code: r.leaveType.code, name: r.leaveType.name, color: r.leaveType.color }
      : undefined,
    fromDate: dateToYmd(r.fromDate),
    toDate: dateToYmd(r.toDate),
    fromHalfDay: r.fromHalfDay,
    toHalfDay: r.toHalfDay,
    quantity: fromCenti(centi(r.totalQuantity)),
    reason: r.reason,
    documentId: r.documentId,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
    cancelledAt: r.cancelledAt,
    employee: r.employee
      ? {
          id: r.employee.id,
          code: r.employee.employeeCode,
          name: fullName(r.employee),
          department: r.employee.department?.name ?? null,
        }
      : undefined,
    steps: steps.map((s) => ({
      stepNo: s.stepNo,
      status: s.status,
      comment: s.comment,
      decidedAt: s.decidedAt,
    })),
  });

  const REQUEST_INCLUDE = {
    leaveType: true,
    employee: {
      select: {
        id: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
        managerId: true,
        department: { select: { name: true } },
      },
    },
  };

  /** Recalculates attendance for the request's days up to today (future days are calculated when they come). */
  async function refreshAttendance(
    /** @type {string} */ employeeId,
    /** @type {string} */ from,
    /** @type {string} */ to,
  ) {
    const emp = await loadEmployee(employeeId);
    if (!emp) return;
    const today = localYmd(now(), emp.timezone);
    for (let d = from; d <= to && d <= today; d = /** @type {string} */ (addDays(d, 1)))
      await attendance.recomputeDay(emp, d);
  }

  /** New or newly assigned policies credit this month's entitlement right away instead of waiting for the schedule. */
  async function accrueSoon() {
    await queues?.workSessions?.add('leave-accrual-tenant', {
      tenantId: ctx().tenantId,
      month: now().toISOString().slice(0, 7),
    });
  }

  const service = {
    policyFor,

    // ── Balances and ledger ─────────────────────────────────────────────────────

    /** Balances for every leave type a policy gives this employee today. @param {any} emp */
    async balancesFor(emp) {
      const today = localYmd(now(), emp.timezone);
      const types = await db().leaveType.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
      const out = [];
      for (const t of types) {
        const policy = await policyFor(emp, t.id, today);
        if (!policy) continue;
        const year = leaveYearOf(today, policy.rules.yearStartMonth);
        const [balance, pending, used, accrued] = await Promise.all([
          balanceCenti(emp.id, t.id),
          pendingCenti(emp.id, t.id),
          db().leaveLedgerEntry.aggregate({
            where: {
              employeeId: emp.id,
              leaveTypeId: t.id,
              entryType: { in: ['CONSUMPTION', 'REVERSAL'] },
              postedOn: { gte: ymdToDate(year.start), lte: ymdToDate(year.end) },
            },
            _sum: { quantity: true },
          }),
          db().leaveLedgerEntry.aggregate({
            where: {
              employeeId: emp.id,
              leaveTypeId: t.id,
              entryType: 'ACCRUAL',
              postedOn: { gte: ymdToDate(year.start), lte: ymdToDate(year.end) },
            },
            _sum: { quantity: true },
          }),
        ]);
        out.push({
          leaveType: {
            id: t.id,
            code: t.code,
            name: t.name,
            isPaid: t.isPaid,
            color: t.color,
            allowNegative: t.allowNegative,
            requiresDocumentAfterDays: t.requiresDocumentAfterDays,
          },
          policy: {
            id: policy.id,
            name: policy.name,
            allowHalfDay: policy.rules.allowHalfDay,
            approvalLevels: policy.rules.approvalLevels,
            minNoticeDays: policy.rules.minNoticeDays,
          },
          year: { start: year.start, end: year.end },
          balance: fromCenti(balance),
          pending: fromCenti(pending),
          available: fromCenti(balance - pending),
          usedThisYear: fromCenti(-centi(used._sum.quantity)),
          accruedThisYear: fromCenti(centi(accrued._sum.quantity)),
        });
      }
      return out;
    },

    async myBalances() {
      return service.balancesFor(await me());
    },

    /** @param {string} employeeId */
    async employeeBalances(employeeId) {
      const emp = await employeeInScope('leave.request.view', employeeId, { includeSelf: true });
      return {
        employee: { id: emp.id, code: emp.employeeCode, name: fullName(emp) },
        data: await service.balancesFor(emp),
      };
    },

    /** Every ledger entry with a running balance. @param {string} employeeId @param {string} [leaveTypeId] */
    async ledger(employeeId, leaveTypeId) {
      const emp = await employeeInScope('leave.request.view', employeeId, { includeSelf: true });
      const rows = await db().leaveLedgerEntry.findMany({
        where: { employeeId: emp.id, ...(leaveTypeId ? { leaveTypeId } : {}) },
        orderBy: [{ postedOn: 'asc' }, { createdAt: 'asc' }],
        include: { leaveType: { select: { id: true, code: true, name: true } } },
        take: 2000,
      });
      /** @type {Map<string, number>} */
      const running = new Map();
      return {
        employee: { id: emp.id, code: emp.employeeCode, name: fullName(emp) },
        data: rows.map((r) => {
          const next = (running.get(r.leaveTypeId) ?? 0) + centi(r.quantity);
          running.set(r.leaveTypeId, next);
          return {
            id: r.id,
            leaveType: r.leaveType,
            entryType: r.entryType,
            quantity: fromCenti(centi(r.quantity)),
            balanceAfter: fromCenti(next),
            postedOn: dateToYmd(r.postedOn),
            note: r.note,
            sourceType: r.sourceType,
            sourceId: r.sourceId,
            createdAt: r.createdAt,
          };
        }),
      };
    },

    /** Opening balances and manual corrections. The ledger is append-only, so a mistake is fixed by another entry. @param {any} input */
    async adjust(input) {
      const emp = await employeeInScope('leave.balance.adjust', input.employeeId);
      const type = await db().leaveType.findFirst({ where: { id: input.leaveTypeId, deletedAt: null } });
      if (!type) throw new ValidationError([{ path: 'body.leaveTypeId', message: 'Leave type not found' }]);
      const id = newId();
      try {
        await db().leaveLedgerEntry.create({
          data: {
            id,
            employeeId: emp.id,
            leaveTypeId: type.id,
            entryType: input.entryType,
            quantity: fromCenti(toCenti(input.quantity)),
            postedOn: ymdToDate(input.postedOn),
            periodKey: input.entryType === 'OPENING_BALANCE' ? 'OPENING' : null,
            sourceType: 'MANUAL',
            note: input.note,
            createdBy: ctx().userId,
          },
        });
      } catch (err) {
        if (/** @type {any} */ (err)?.code === 'P2002')
          throw new ConflictError(
            'opening_exists',
            'This person already has an opening balance for this leave type. Use an adjustment.',
          );
        throw err;
      }
      await audit(db(), {
        action: 'leave.balance_adjusted',
        entityType: 'Employee',
        entityId: emp.id,
        changes: {
          leaveType: type.code,
          entryType: input.entryType,
          quantity: input.quantity,
          note: input.note,
        },
      });
      return { id, balance: fromCenti(await balanceCenti(emp.id, type.id)) };
    },

    // ── Requests ────────────────────────────────────────────────────────────────

    /** Day count, balance and any problems, before submitting. @param {any} input */
    async preview(input) {
      const emp = await me();
      const e = await evaluate(emp, input);
      return {
        quantity: fromCenti(e.counted.totalCenti),
        days: e.counted.days.map((d) => ({ date: d.date, quantity: fromCenti(d.centi), kind: d.kind })),
        balance: fromCenti(e.balance),
        available: fromCenti(e.balance - e.pending),
        approvalLevels: e.policy.rules.approvalLevels,
        errors: e.errors,
      };
    },

    /** @param {any} input validated LeaveRequestBody */
    async apply(input) {
      const emp = await me();
      if (emp.status === 'EXITED')
        throw new ConflictError('employee_exited', 'This person has left the company');
      const e = await evaluate(emp, input);
      if (e.errors.length) throw new ValidationError(e.errors);
      const id = newId();
      await db().$transaction(async (/** @type {any} */ tx) => {
        await tx.leaveRequest.create({
          data: {
            id,
            employeeId: emp.id,
            leaveTypeId: e.leaveType.id,
            fromDate: ymdToDate(input.fromDate),
            toDate: ymdToDate(input.toDate),
            fromHalfDay: input.fromHalfDay,
            toHalfDay: input.toHalfDay,
            totalQuantity: fromCenti(e.counted.totalCenti),
            reason: input.reason ?? null,
            documentId: input.documentId ?? null,
          },
        });
        await tx.leaveRequestDay.createMany({
          data: e.counted.days.map((d) => ({
            requestId: id,
            date: ymdToDate(d.date),
            quantity: fromCenti(d.centi),
          })),
        });
        for (let stepNo = 1; stepNo <= e.policy.rules.approvalLevels; stepNo++)
          await tx.approvalStep.create({
            data: {
              id: newId(),
              entityType: STEP_ENTITY,
              entityId: id,
              stepNo,
              approverEmployeeId: stepNo === 1 ? emp.managerId : null,
            },
          });
        await audit(tx, {
          action: 'leave.requested',
          entityType: 'LeaveRequest',
          entityId: id,
          changes: {
            leaveType: e.leaveType.code,
            from: input.fromDate,
            to: input.toDate,
            quantity: fromCenti(e.counted.totalCenti),
          },
        });
      });
      return service.get(id);
    },

    /** @param {string} id */
    async get(id) {
      const r = await db().leaveRequest.findUnique({ where: { id }, include: REQUEST_INCLUDE });
      if (!r) throw new NotFoundError();
      const steps = await stepsOf(id);
      const own = r.employeeId === ctx().employeeId;
      const current = steps.find((s) => s.status === 'PENDING');
      const decider = !own && r.status === 'PENDING' && current ? await canDecide(r, current, steps) : false;
      if (!own && !decider) await employeeInScope('leave.request.view', r.employeeId);
      const today = localYmd(now(), (await loadEmployee(r.employeeId))?.timezone ?? 'UTC');
      return {
        ...requestDto(r, steps),
        currentStep: current?.stepNo ?? null,
        canDecide: decider,
        canCancel:
          (own &&
            (r.status === 'PENDING' ||
              (r.status === 'APPROVED' && /** @type {string} */ (dateToYmd(r.fromDate)) > today))) ||
          (!own &&
            ['PENDING', 'APPROVED'].includes(r.status) &&
            (await service.canManageRequestsOf(r.employeeId))),
      };
    },

    /** HR may cancel anyone's request in their approval scope. @param {string} employeeId */
    async canManageRequestsOf(employeeId) {
      if (!ctx().permissions?.has('leave.request.approve')) return false;
      if (employeeId === ctx().employeeId) return false;
      const scope = await employeeScope('leave.request.approve');
      return (await db().employee.count({ where: scoped({ id: employeeId }, scope) })) > 0;
    },

    /** @param {{ view: 'mine' | 'approvals' | 'team', status?: string }} q */
    async list(q) {
      /** @type {any} */
      let where;
      if (q.view === 'mine') where = { employeeId: (await me()).id };
      else if (q.view === 'team') {
        const scope = await employeeScope('leave.request.view', { includeSelf: true });
        where = { employee: scope };
      } else {
        const myEmp = ctx().employeeId ?? null;
        /** @type {object[]} */
        const or = [];
        if (myEmp) or.push({ managerId: myEmp });
        if (ctx().permissions?.has('leave.request.approve'))
          or.push(await employeeScope('leave.request.approve'));
        if (!or.length) return [];
        where = { status: 'PENDING', employee: anyOf(or), ...(myEmp ? { employeeId: { not: myEmp } } : {}) };
      }
      const rows = await db().leaveRequest.findMany({
        where: { ...where, ...(q.status ? { status: q.status } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: REQUEST_INCLUDE,
      });
      const steps = await db().approvalStep.findMany({
        where: { entityType: STEP_ENTITY, entityId: { in: rows.map((r) => r.id) } },
        orderBy: { stepNo: 'asc' },
      });
      const byRequest = (/** @type {string} */ id) => steps.filter((s) => s.entityId === id);
      const out = [];
      for (const r of rows) {
        const own = byRequest(r.id);
        const current = own.find((s) => s.status === 'PENDING');
        if (q.view === 'approvals' && (!current || !(await canDecide(r, current, own)))) continue;
        out.push({ ...requestDto(r, own), currentStep: current?.stepNo ?? null });
      }
      return out;
    },

    /**
     * Decides the current step. The last approval posts the ledger debit (paid types) and marks attendance.
     * @param {string} id @param {{ decision: 'APPROVED' | 'REJECTED', comment?: string }} input
     */
    async decide(id, input) {
      const r = await db().leaveRequest.findUnique({ where: { id }, include: { leaveType: true } });
      if (!r) throw new NotFoundError();
      if (r.employeeId === ctx().employeeId)
        throw new ForbiddenError('own_request', 'You cannot decide your own leave');
      const steps = await stepsOf(id);
      const current = steps.find((s) => s.status === 'PENDING');
      if (r.status !== 'PENDING' || !current) {
        // Tell people who could have decided it; everyone else learns nothing (404).
        const emp = await loadEmployee(r.employeeId);
        const couldDecide =
          (ctx().employeeId && emp?.managerId === ctx().employeeId) ||
          (await service.canManageRequestsOf(r.employeeId));
        if (couldDecide) throw new ConflictError('already_decided', 'This request has already been decided');
        throw new NotFoundError();
      }
      if (!(await canDecide(r, current, steps))) throw new NotFoundError();
      const last = current.stepNo === steps.at(-1)?.stepNo;
      const total = centi(r.totalQuantity);
      if (input.decision === 'APPROVED' && last && r.leaveType.isPaid && !r.leaveType.allowNegative) {
        const balance = await balanceCenti(r.employeeId, r.leaveTypeId);
        if (balance < total)
          throw new ConflictError(
            'insufficient_balance',
            `Not enough balance now: ${fromCenti(balance)} days left`,
          );
      }
      const t = now();
      const finalStatus = input.decision === 'REJECTED' ? 'REJECTED' : last ? 'APPROVED' : null;
      await db().$transaction(async (/** @type {any} */ tx) => {
        const moved = await tx.approvalStep.updateMany({
          where: { id: current.id, status: 'PENDING' },
          data: {
            status: input.decision,
            decidedAt: t,
            decidedBy: ctx().userId,
            comment: input.comment ?? null,
          },
        });
        if (!moved.count) throw new ConflictError('already_decided', 'This request has already been decided');
        if (finalStatus) {
          await tx.leaveRequest.update({ where: { id }, data: { status: finalStatus, decidedAt: t } });
          if (finalStatus === 'REJECTED')
            await tx.approvalStep.updateMany({
              where: { entityType: STEP_ENTITY, entityId: id, status: 'PENDING' },
              data: { status: 'SKIPPED' },
            });
        }
        if (finalStatus === 'APPROVED' && r.leaveType.isPaid && total > 0)
          await tx.leaveLedgerEntry.create({
            data: {
              id: newId(),
              employeeId: r.employeeId,
              leaveTypeId: r.leaveTypeId,
              entryType: 'CONSUMPTION',
              quantity: fromCenti(-total),
              postedOn: r.fromDate,
              sourceType: 'LEAVE_REQUEST',
              sourceId: id,
              note: `${dateToYmd(r.fromDate)} – ${dateToYmd(r.toDate)}`,
              createdBy: ctx().userId,
            },
          });
        await audit(tx, {
          action: `leave.step_${input.decision.toLowerCase()}`,
          entityType: 'LeaveRequest',
          entityId: id,
          changes: { step: current.stepNo, final: finalStatus, comment: input.comment ?? null },
        });
      });
      if (finalStatus === 'APPROVED')
        await refreshAttendance(
          r.employeeId,
          /** @type {string} */ (dateToYmd(r.fromDate)),
          /** @type {string} */ (dateToYmd(r.toDate)),
        );
      return service.get(id);
    },

    /**
     * The employee cancels a pending request, or an approved one that hasn't started. HR (approval permission in
     * scope) can cancel any pending or approved request. Cancelling approved leave reverses the ledger debit.
     * @param {string} id @param {{ reason?: string }} input
     */
    async cancel(id, input) {
      const r = await db().leaveRequest.findUnique({ where: { id }, include: { leaveType: true } });
      if (!r) throw new NotFoundError();
      const emp = await loadEmployee(r.employeeId);
      const today = localYmd(now(), emp?.timezone ?? 'UTC');
      const own = r.employeeId === ctx().employeeId;
      const hr = !own && (await service.canManageRequestsOf(r.employeeId));
      if (!own && !hr) throw new NotFoundError();
      if (!['PENDING', 'APPROVED'].includes(r.status))
        throw new ConflictError('not_cancellable', 'Only pending or approved requests can be cancelled');
      if (own && r.status === 'APPROVED' && /** @type {string} */ (dateToYmd(r.fromDate)) <= today)
        throw new ConflictError('already_started', 'This leave has started. Ask HR to cancel it.');
      const t = now();
      await db().$transaction(async (/** @type {any} */ tx) => {
        const moved = await tx.leaveRequest.updateMany({
          where: { id, status: r.status },
          data: { status: 'CANCELLED', cancelledAt: t },
        });
        if (!moved.count)
          throw new ConflictError('not_cancellable', 'This request changed. Reload and try again.');
        await tx.approvalStep.updateMany({
          where: { entityType: STEP_ENTITY, entityId: id, status: 'PENDING' },
          data: { status: 'CANCELLED' },
        });
        const consumed = await tx.leaveLedgerEntry.aggregate({
          where: { sourceType: 'LEAVE_REQUEST', sourceId: id },
          _sum: { quantity: true },
        });
        const net = centi(consumed._sum.quantity);
        if (net < 0)
          await tx.leaveLedgerEntry.create({
            data: {
              id: newId(),
              employeeId: r.employeeId,
              leaveTypeId: r.leaveTypeId,
              entryType: 'REVERSAL',
              quantity: fromCenti(-net),
              postedOn: r.fromDate,
              sourceType: 'LEAVE_REQUEST',
              sourceId: id,
              note: `Cancelled${input.reason ? `: ${input.reason}` : ''}`,
              createdBy: ctx().userId,
            },
          });
        await audit(tx, {
          action: 'leave.cancelled',
          entityType: 'LeaveRequest',
          entityId: id,
          changes: { previousStatus: r.status, by: own ? 'employee' : 'hr', reason: input.reason ?? null },
        });
      });
      if (r.status === 'APPROVED')
        await refreshAttendance(
          r.employeeId,
          /** @type {string} */ (dateToYmd(r.fromDate)),
          /** @type {string} */ (dateToYmd(r.toDate)),
        );
      return service.get(id);
    },

    /** Who is away: approved and pending leave overlapping the range, within leave.request.view scope. @param {any} q */
    async calendar(q) {
      if (daysBetween(q.from, q.to) + 1 > MAX_REQUEST_DAYS)
        throw new ValidationError([{ path: 'query.to', message: `Choose at most ${MAX_REQUEST_DAYS} days` }]);
      const scope = await employeeScope('leave.request.view', { includeSelf: true });
      const rows = await db().leaveRequest.findMany({
        where: {
          status: { in: ['PENDING', 'APPROVED'] },
          fromDate: { lte: ymdToDate(q.to) },
          toDate: { gte: ymdToDate(q.from) },
          employee: q.departmentId ? { AND: [scope, { departmentId: q.departmentId }] } : scope,
        },
        orderBy: { fromDate: 'asc' },
        take: 1000,
        include: REQUEST_INCLUDE,
      });
      return rows.map((r) => requestDto(r));
    },

    // ── Policies ────────────────────────────────────────────────────────────────

    /**
     * New rules from a date: the current version ends the day before, and its assignments are copied to the new
     * version, so history keeps the rules that applied at the time.
     * @param {string} policyId @param {{ rules: any, effectiveFrom: string }} input
     */
    async newVersion(policyId, input) {
      const old = await db().leavePolicy.findUnique({
        where: { id: policyId },
        include: { leavePolicyAssignments: true },
      });
      if (!old) throw new NotFoundError();
      if (input.effectiveFrom <= /** @type {string} */ (dateToYmd(old.effectiveFrom)))
        throw new ValidationError([
          {
            path: 'body.effectiveFrom',
            message: `Must be after ${dateToYmd(old.effectiveFrom)}, when this version started`,
          },
        ]);
      if (old.effectiveTo && input.effectiveFrom > /** @type {string} */ (dateToYmd(old.effectiveTo)))
        throw new ValidationError([
          { path: 'body.effectiveFrom', message: 'This version has already ended' },
        ]);
      const id = newId();
      const from = ymdToDate(input.effectiveFrom);
      await db().$transaction(async (/** @type {any} */ tx) => {
        await tx.leavePolicy.update({
          where: { id: old.id },
          data: { effectiveTo: ymdToDate(/** @type {string} */ (addDays(input.effectiveFrom, -1))) },
        });
        await tx.leavePolicy.create({
          data: {
            id,
            leaveTypeId: old.leaveTypeId,
            legalEntityId: old.legalEntityId,
            name: old.name,
            version: old.version + 1,
            rules: input.rules,
            effectiveFrom: from,
            effectiveTo: old.effectiveTo,
          },
        });
        for (const a of old.leavePolicyAssignments) {
          if (a.effectiveTo && a.effectiveTo < from) continue;
          await tx.leavePolicyAssignment.create({
            data: {
              id: newId(),
              policyId: id,
              appliesTo: a.appliesTo,
              targetId: a.targetId,
              effectiveFrom: a.effectiveFrom > from ? a.effectiveFrom : from,
              effectiveTo: a.effectiveTo,
            },
          });
        }
        await audit(tx, {
          action: 'leave.policy_versioned',
          entityType: 'LeavePolicy',
          entityId: id,
          changes: { previous: old.id, version: old.version + 1, effectiveFrom: input.effectiveFrom },
        });
      });
      return db().leavePolicy.findUnique({ where: { id } });
    },

    /** @param {any} input validated PolicyAssignmentBody */
    async assign(input) {
      const policy = await db().leavePolicy.findUnique({ where: { id: input.policyId } });
      if (!policy) throw new ValidationError([{ path: 'body.policyId', message: 'Policy not found' }]);
      const model = {
        LEGAL_ENTITY: 'legalEntity',
        BRANCH: 'branch',
        DEPARTMENT: 'department',
        EMPLOYEE: 'employee',
      }[/** @type {string} */ (input.appliesTo)];
      if (model && !(await /** @type {any} */ (db())[model].count({ where: { id: input.targetId } })))
        throw new ValidationError([{ path: 'body.targetId', message: 'Not found' }]);
      const id = newId();
      await db().leavePolicyAssignment.create({
        data: {
          id,
          policyId: policy.id,
          appliesTo: input.appliesTo,
          targetId: input.targetId ?? null,
          effectiveFrom: ymdToDate(input.effectiveFrom),
          effectiveTo: input.effectiveTo ? ymdToDate(input.effectiveTo) : null,
        },
      });
      await audit(db(), {
        action: 'leave.policy_assigned',
        entityType: 'LeavePolicy',
        entityId: policy.id,
        changes: input,
      });
      await accrueSoon();
      return { id };
    },

    async assignments() {
      const rows = await db().leavePolicyAssignment.findMany({
        orderBy: { effectiveFrom: 'desc' },
        take: 500,
        include: { policy: { select: { id: true, name: true, version: true, leaveTypeId: true } } },
      });
      return rows.map((a) => ({
        id: a.id,
        policy: a.policy,
        appliesTo: a.appliesTo,
        targetId: a.targetId,
        effectiveFrom: dateToYmd(a.effectiveFrom),
        effectiveTo: dateToYmd(a.effectiveTo),
      }));
    },

    /** @param {string} id */
    async unassign(id) {
      const { count } = await db().leavePolicyAssignment.deleteMany({ where: { id } });
      if (!count) throw new NotFoundError();
      await audit(db(), {
        action: 'leave.policy_unassigned',
        entityType: 'LeavePolicyAssignment',
        entityId: id,
      });
    },

    /** Loads the starter leave types with a company-wide policy from 1 January. Skips codes that already exist. */
    async starterPack() {
      const year = localYmd(now(), 'UTC').slice(0, 4);
      const created = [];
      for (const s of STARTER_LEAVE_TYPES) {
        if (await db().leaveType.count({ where: { code: s.type.code } })) continue;
        const typeId = newId();
        const policyId = newId();
        await db().$transaction(async (/** @type {any} */ tx) => {
          await tx.leaveType.create({ data: { id: typeId, isSystem: true, ...s.type } });
          await tx.leavePolicy.create({
            data: {
              id: policyId,
              leaveTypeId: typeId,
              name: `${s.type.name} policy`,
              rules: LeavePolicyRules.parse(s.rules),
              effectiveFrom: ymdToDate(`${year}-01-01`),
            },
          });
          await tx.leavePolicyAssignment.create({
            data: { id: newId(), policyId, appliesTo: 'COMPANY', effectiveFrom: ymdToDate(`${year}-01-01`) },
          });
        });
        created.push(s.type.code);
      }
      await audit(db(), {
        action: 'leave.starter_pack_loaded',
        entityType: 'Tenant',
        entityId: ctx().tenantId,
        changes: { created },
      });
      if (created.length) await accrueSoon();
      return { created };
    },

    // ── Accruals ────────────────────────────────────────────────────────────────

    /** Queues the accrual run for a month (idempotent: each credit has a period key). @param {string} month */
    async requestAccrualRun(month) {
      if (!queues?.workSessions)
        throw new AppError(503, 'queue_unavailable', 'Background jobs are not available');
      await queues.workSessions.add('leave-accrual-tenant', { tenantId: ctx().tenantId, month });
      await audit(db(), {
        action: 'leave.accrual_requested',
        entityType: 'Tenant',
        entityId: ctx().tenantId,
        changes: { month },
      });
      return { queued: true, month };
    },

    /**
     * Posts year-end expiry and this month's credits for everyone in the current tenant (worker). Safe to repeat.
     * @param {string} month 'YYYY-MM'
     */
    async runAccruals(month) {
      const monthStart = `${month}-01`;
      const employees = await db().employee.findMany({
        where: {
          deletedAt: null,
          dateOfJoining: { lte: ymdToDate(/** @type {string} */ (addDays(`${month}-28`, 4))) },
          OR: [
            { exitDate: null },
            { exitDate: { gte: ymdToDate(/** @type {string} */ (addDays(monthStart, -1))) } },
          ],
        },
        select: EMPLOYEE_SELECT,
      });
      const types = await db().leaveType.findMany({ where: { deletedAt: null } });
      let credited = 0;
      let expired = 0;
      const post = async (/** @type {any} */ data) => {
        try {
          await db().leaveLedgerEntry.create({ data: { id: newId(), sourceType: 'SCHEDULED', ...data } });
          return true;
        } catch (err) {
          if (/** @type {any} */ (err)?.code === 'P2002') return false; // already posted for this period
          throw err;
        }
      };
      for (const emp of employees) {
        const doj = /** @type {string} */ (dateToYmd(emp.dateOfJoining));
        for (const t of types) {
          // Year-end: expire what is above the carry-forward limit, using the rules in force on the last day.
          const prevDay = /** @type {string} */ (addDays(monthStart, -1));
          const prevPolicy = doj <= prevDay ? await policyFor(emp, t.id, prevDay) : null;
          if (prevPolicy && leaveYearOf(prevDay, prevPolicy.rules.yearStartMonth).end === prevDay) {
            const year = leaveYearOf(prevDay, prevPolicy.rules.yearStartMonth);
            const excess = yearEndExpiry({
              balanceCenti: await balanceCenti(emp.id, t.id, prevDay),
              rules: prevPolicy.rules,
            });
            if (
              excess > 0 &&
              (await post({
                employeeId: emp.id,
                leaveTypeId: t.id,
                entryType: 'EXPIRY',
                quantity: fromCenti(-excess),
                postedOn: ymdToDate(prevDay),
                periodKey: `EXP-${year.key}`,
                note: `Above the carry-forward limit at the end of ${year.key}`,
              }))
            )
              expired++;
          }
          const on = doj > monthStart ? doj : monthStart;
          const policy = await policyFor(emp, t.id, on);
          if (!policy) continue;
          for (const due of accrualsDue({
            rules: policy.rules,
            month,
            dateOfJoining: doj,
            exitDate: dateToYmd(emp.exitDate),
          })) {
            const amount = capCredit({
              centi: due.centi,
              balanceCenti: await balanceCenti(emp.id, t.id),
              rules: policy.rules,
            });
            if (amount <= 0) continue;
            if (
              await post({
                employeeId: emp.id,
                leaveTypeId: t.id,
                entryType: 'ACCRUAL',
                quantity: fromCenti(amount),
                postedOn: ymdToDate(due.postedOn),
                periodKey: due.periodKey,
                note: due.note,
              })
            )
              credited++;
          }
        }
      }
      return { employees: employees.length, credited, expired };
    },

    // ── Reports ─────────────────────────────────────────────────────────────────

    /** Leave taken in a period and current balance, per person and type, within leave.request.view scope. @param {any} q */
    async summary(q) {
      if (daysBetween(q.from, q.to) + 1 > 366)
        throw new ValidationError([{ path: 'query.to', message: 'Choose at most a year' }]);
      const scope = await employeeScope('leave.request.view', { includeSelf: true });
      const employees = await db().employee.findMany({
        where: scoped(
          { deletedAt: null, ...(q.departmentId ? { departmentId: q.departmentId } : {}) },
          scope,
        ),
        select: EMPLOYEE_SELECT,
        orderBy: { employeeCode: 'asc' },
        take: 5000,
      });
      const ids = employees.map((e) => e.id);
      const [types, days, balances] = await Promise.all([
        db().leaveType.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
        db().leaveRequestDay.findMany({
          where: {
            date: { gte: ymdToDate(q.from), lte: ymdToDate(q.to) },
            request: { status: 'APPROVED', employeeId: { in: ids } },
          },
          select: { quantity: true, request: { select: { employeeId: true, leaveTypeId: true } } },
        }),
        db().leaveLedgerEntry.groupBy({
          by: ['employeeId', 'leaveTypeId'],
          where: { employeeId: { in: ids } },
          _sum: { quantity: true },
        }),
      ]);
      const key = (/** @type {string} */ e, /** @type {string} */ t) => `${e}:${t}`;
      /** @type {Map<string, number>} */
      const taken = new Map();
      for (const d of days) {
        const k = key(d.request.employeeId, d.request.leaveTypeId);
        taken.set(k, (taken.get(k) ?? 0) + centi(d.quantity));
      }
      const balance = new Map(
        balances.map((b) => [key(b.employeeId, b.leaveTypeId), centi(b._sum.quantity)]),
      );
      return {
        from: q.from,
        to: q.to,
        leaveTypes: types.map((t) => ({ id: t.id, code: t.code, name: t.name })),
        data: employees.map((e) => ({
          employee: {
            id: e.id,
            code: e.employeeCode,
            name: fullName(e),
            department: e.department?.name ?? null,
          },
          byType: Object.fromEntries(
            types.map((t) => [
              t.code,
              {
                taken: fromCenti(taken.get(key(e.id, t.id)) ?? 0),
                balance: fromCenti(balance.get(key(e.id, t.id)) ?? 0),
              },
            ]),
          ),
        })),
      };
    },
  };
  return service;
}
