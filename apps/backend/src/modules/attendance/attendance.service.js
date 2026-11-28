// @ts-check
import { newId } from '@hrms/shared/ids';
import { timeToMinutes } from '@hrms/shared/schemas/attendance';
import { audit } from '../../lib/audit.js';
import { currentContext } from '../../lib/context.js';
import { db } from '../../lib/db.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import {
  addDays,
  dateToYmd,
  daysBetween,
  eachDay,
  localYmd,
  weekStart,
  ymdToDate,
  zonedTime,
} from '../../lib/time.js';
import { toCenti } from '@hrms/shared/quantity';
import { anyOf, employeeScope } from '../employees/scope.js';
import { DEFAULT_POLICY, MAX_SESSION_HOURS, computeDay, resolvePlan } from './engine.js';

const ctx = () => /** @type {any} */ (currentContext());
const activeKey = (/** @type {string} */ employeeId) => ({
  tenantId_employeeId: { tenantId: ctx().tenantId, employeeId },
});
const fullName = (/** @type {any} */ e) => [e.firstName, e.lastName].filter(Boolean).join(' ');
const MAX_RANGE_DAYS = 93;

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

/** @param {string} from @param {string} to */
function assertRange(from, to, max = MAX_RANGE_DAYS) {
  if (daysBetween(from, to) + 1 > max)
    throw new ValidationError([{ path: 'query.to', message: `Choose at most ${max} days` }]);
}

/** API shape of an attendance day. @param {any} row */
export function dayDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    employeeId: row.employeeId,
    workDate: dateToYmd(row.workDate),
    status: row.status,
    firstInAt: row.firstInAt,
    lastOutAt: row.lastOutAt,
    workedMinutes: row.workedMinutes,
    breakMinutes: row.breakMinutes,
    lateMinutes: row.lateMinutes,
    earlyLeaveMinutes: row.earlyLeaveMinutes,
    overtimeMinutes: row.overtimeMinutes,
    overtimeStatus: row.overtimeStatus,
    expectedMinutes: row.expectedMinutes,
    workLocationId: row.workLocationId,
    flags: Array.isArray(row.flags) ? row.flags : [],
    isLocked: row.isLocked,
    computedAt: row.computedAt,
  };
}

const punchDto = (/** @type {any} */ p) => ({
  id: p.id,
  type: p.type,
  at: p.serverTs,
  source: p.source,
  workLocation: p.workLocation
    ? { id: p.workLocation.id, name: p.workLocation.name, type: p.workLocation.type }
    : null,
});

/**
 * Attendance: clock-in/out, daily calculation, corrections, overtime approval, shifts and reports (Phase 1, ATT-01..04).
 * @param {{ queues?: { workSessions?: { add: Function } }, now?: () => Date }} [deps]
 */
export function createAttendanceService({ queues, now = () => new Date() } = {}) {
  /** @param {string} id */
  const loadEmployee = (id) => db().employee.findUnique({ where: { id }, select: EMPLOYEE_SELECT });

  /** The signed-in person's employee record, or a clear error when the account is not linked to one. */
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

  /** @param {string | null} legalEntityId */
  async function policyFor(legalEntityId) {
    const rows = await db().attendancePolicy.findMany({
      where: { scopeKey: { in: [legalEntityId ?? 'default', 'default'] } },
    });
    const row = rows.find((r) => r.scopeKey === legalEntityId) ?? rows.find((r) => r.scopeKey === 'default');
    const source = row ? (row.scopeKey === 'default' ? 'COMPANY' : 'LEGAL_ENTITY') : 'DEFAULT';
    const values = row
      ? {
          presentPercent: row.presentPercent,
          halfDayPercent: row.halfDayPercent,
          autoDeductBreak: row.autoDeductBreak,
          captureIp: row.captureIp,
          captureGeo: row.captureGeo,
          regularizationWindowDays: row.regularizationWindowDays,
        }
      : { ...DEFAULT_POLICY };
    return { source, ...values };
  }

  /** @param {any} emp @param {string} ymd */
  async function planFor(emp, ymd) {
    const date = ymdToDate(ymd);
    const covering = {
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
    };
    const [assignment, record, holiday] = await Promise.all([
      db().shiftAssignment.findFirst({
        where: { employeeId: emp.id, ...covering },
        orderBy: { effectiveFrom: 'desc' },
        include: { shift: true },
      }),
      db().employmentRecord.findFirst({
        where: { employeeId: emp.id, ...covering },
        orderBy: { effectiveFrom: 'desc' },
        include: { schedule: true },
      }),
      emp.branch?.holidayCalendarId
        ? db().holiday.findFirst({
            where: { calendarId: emp.branch.holidayCalendarId, date, isOptional: false },
          })
        : null,
    ]);
    return resolvePlan({
      workDate: ymd,
      shift: assignment?.shift ?? null,
      schedule: record?.schedule ?? null,
      weekendDays: Array.isArray(emp.legalEntity?.weekendDays) ? emp.legalEntity.weekendDays : [0, 6],
      holiday,
    });
  }

  /** The overtime rule in force: the legal entity's own rule wins over a company-wide one. @param {any} emp @param {string} ymd */
  async function overtimeRuleFor(emp, ymd) {
    const date = ymdToDate(ymd);
    const rules = await db().overtimeRule.findMany({
      where: {
        effectiveFrom: { lte: date },
        AND: [
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] },
          { OR: [{ legalEntityId: emp.legalEntityId }, { legalEntityId: null }] },
        ],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    return rules.find((r) => r.legalEntityId === emp.legalEntityId) ?? rules[0] ?? null;
  }

  /**
   * Recalculates and stores one day. Locked days are returned unchanged; days outside employment return null.
   * @param {any} emp from loadEmployee
   * @param {string} ymd
   */
  async function recomputeDay(emp, ymd) {
    if (ymd < /** @type {string} */ (dateToYmd(emp.dateOfJoining))) return null;
    if (emp.exitDate && ymd > /** @type {string} */ (dateToYmd(emp.exitDate))) return null;
    const workDate = ymdToDate(ymd);
    const key = { tenantId_employeeId_workDate: { tenantId: ctx().tenantId, employeeId: emp.id, workDate } };
    const existing = await db().attendanceDay.findUnique({ where: key });
    if (existing?.isLocked) return existing;

    const ws = weekStart(ymd, emp.legalEntity?.weekStartDay ?? 1);
    const [plan, policy, rule, punches, week, leaveDays] = await Promise.all([
      planFor(emp, ymd),
      policyFor(emp.legalEntityId),
      overtimeRuleFor(emp, ymd),
      db().attendancePunch.findMany({
        where: { employeeId: emp.id, workDate },
        include: { workLocation: { select: { type: true } } },
      }),
      ws < ymd
        ? db().attendanceDay.aggregate({
            where: { employeeId: emp.id, workDate: { gte: ymdToDate(ws), lt: workDate } },
            _sum: { workedMinutes: true },
          })
        : null,
      db().leaveRequestDay.findMany({
        where: { date: workDate, request: { employeeId: emp.id, status: 'APPROVED' } },
        select: { quantity: true },
      }),
    ]);
    const t = now();
    const result = computeDay({
      workDate: ymd,
      tz: emp.timezone,
      plan,
      punches: punches.map((p) => ({ ...p, locationType: p.workLocation?.type ?? null })),
      policy,
      overtimeRule: rule,
      weekWorkedBefore: week?._sum.workedMinutes ?? 0,
      now: t,
      leaveCenti: Math.min(
        100,
        leaveDays.reduce((s, d) => s + toCenti(String(d.quantity)), 0),
      ),
    });

    // A decision stays valid only for the minutes it was made on.
    let overtimeStatus = 'NONE';
    let decision = { overtimeDecidedBy: null, overtimeDecidedAt: null };
    if (result.closed && result.overtimeMinutes > 0) {
      if (
        existing &&
        existing.overtimeMinutes === result.overtimeMinutes &&
        ['APPROVED', 'REJECTED'].includes(existing.overtimeStatus) &&
        existing.overtimeDecidedBy
      ) {
        overtimeStatus = existing.overtimeStatus;
        decision = {
          overtimeDecidedBy: existing.overtimeDecidedBy,
          overtimeDecidedAt: existing.overtimeDecidedAt,
        };
      } else overtimeStatus = rule?.requiresApproval === false ? 'APPROVED' : 'PENDING';
    }
    const data = {
      status: result.status,
      firstInAt: result.firstInAt,
      lastOutAt: result.lastOutAt,
      workedMinutes: result.workedMinutes,
      breakMinutes: result.breakMinutes,
      lateMinutes: result.lateMinutes,
      earlyLeaveMinutes: result.earlyLeaveMinutes,
      overtimeMinutes: result.overtimeMinutes,
      expectedMinutes: result.expectedMinutes,
      workLocationId: result.workLocationId,
      flags: result.flags,
      overtimeStatus,
      ...decision,
      computedAt: t,
    };
    const write = () =>
      db().attendanceDay.upsert({
        where: key,
        create: { id: newId(), employeeId: emp.id, workDate, ...data },
        update: data,
      });
    try {
      return await write();
    } catch (err) {
      if (/** @type {any} */ (err)?.code === 'P2002') return await write(); // two writers created the row at once
      throw err;
    }
  }

  /** Recomputes `ymd` and the rest of its week up to today (weekly overtime depends on earlier days). */
  async function recomputeFrom(/** @type {any} */ emp, /** @type {string} */ ymd) {
    const today = localYmd(now(), emp.timezone);
    const weekEnd = /** @type {string} */ (addDays(weekStart(ymd, emp.legalEntity?.weekStartDay ?? 1), 6));
    const last = weekEnd < today ? weekEnd : today;
    let first = null;
    for (const d of eachDay(ymd, last < ymd ? ymd : last)) {
      const row = await recomputeDay(emp, d);
      first ??= row;
    }
    return first;
  }

  /** An IN belongs to yesterday when it falls inside yesterday's night shift. @param {any} emp @param {Date} t */
  async function workDateForIn(emp, t) {
    const today = localYmd(t, emp.timezone);
    const yesterday = /** @type {string} */ (addDays(today, -1));
    const plan = await planFor(emp, yesterday);
    if (plan.kind === 'WORKING' && (plan.endMin ?? null) !== null && plan.endMin > 1440) {
      if (t < zonedTime(yesterday, plan.endMin, emp.timezone)) return yesterday;
    }
    return today;
  }

  /** The person's last real (non-correction) punch, if it is an IN that is still open. @param {string} employeeId */
  async function openPunch(employeeId) {
    const last = await db().attendancePunch.findFirst({
      where: { employeeId, source: { not: 'CORRECTION' } },
      orderBy: { serverTs: 'desc' },
    });
    if (last?.type !== 'IN') return null;
    return now().getTime() - last.serverTs.getTime() < MAX_SESSION_HOURS * 3_600_000 ? last : null;
  }

  /** May the caller approve requests for this employee? Never their own; the direct manager or a holder of the permission in scope. */
  async function canApprove(
    /** @type {string} */ employeeId,
    /** @type {string | null} */ managerId,
    approverEmployeeId = null,
  ) {
    const myId = ctx().employeeId ?? null;
    if (myId && myId === employeeId) return false;
    if (myId && (managerId === myId || approverEmployeeId === myId)) return true;
    if (!ctx().permissions?.has('attendance.regularization.approve')) return false;
    const scope = await employeeScope('attendance.regularization.approve');
    return (await db().employee.count({ where: { AND: [{ id: employeeId, deletedAt: null }, scope] } })) > 0;
  }

  /** Employee filter for approval lists: direct reports plus the permission's scope, never yourself. */
  async function approvableEmployees() {
    const myId = ctx().employeeId ?? null;
    /** @type {object[]} */
    const or = [];
    if (myId) or.push({ managerId: myId });
    if (ctx().permissions?.has('attendance.regularization.approve'))
      or.push(await employeeScope('attendance.regularization.approve'));
    if (!or.length) return null;
    return { ...anyOf(or), ...(myId ? { id: { not: myId } } : {}) };
  }

  /** @param {string} employeeId */
  async function viewableEmployeeOr404(employeeId) {
    const scope = await employeeScope('attendance.view', { includeSelf: true });
    const emp = await db().employee.findFirst({
      where: { AND: [{ id: employeeId, deletedAt: null }, scope] },
      select: EMPLOYEE_SELECT,
    });
    if (!emp) throw new NotFoundError();
    return emp;
  }

  /** Days with their punches for one employee. @param {any} emp @param {string} from @param {string} to */
  async function daysWithPunches(emp, from, to) {
    const range = { gte: ymdToDate(from), lte: ymdToDate(to) };
    const [days, punches, requests] = await Promise.all([
      db().attendanceDay.findMany({
        where: { employeeId: emp.id, workDate: range },
        orderBy: { workDate: 'asc' },
      }),
      db().attendancePunch.findMany({
        where: { employeeId: emp.id, workDate: range },
        orderBy: { serverTs: 'asc' },
        include: { workLocation: { select: { id: true, name: true, type: true } } },
      }),
      db().attendanceRegularization.findMany({
        where: { employeeId: emp.id, attendanceDay: { workDate: range } },
        include: { attendanceDay: { select: { workDate: true } } },
      }),
    ]);
    return days.map((d) => {
      const ymd = dateToYmd(d.workDate);
      return {
        ...dayDto(d),
        punches: punches.filter((p) => dateToYmd(p.workDate) === ymd).map(punchDto),
        requests: requests
          .filter((r) => dateToYmd(r.attendanceDay.workDate) === ymd)
          .map((r) => ({ id: r.id, status: r.status })),
      };
    });
  }

  const service = {
    recomputeDay,
    planFor,
    policyFor,

    /** Today's state for the clock-in card. */
    async status() {
      const emp = ctx().employeeId ? await loadEmployee(ctx().employeeId) : null;
      if (!emp) return { hasEmployeeRecord: false };
      const t = now();
      const open = await openPunch(emp.id);
      const workDate = open ? /** @type {string} */ (dateToYmd(open.workDate)) : localYmd(t, emp.timezone);
      const [day, plan, policy, locations] = await Promise.all([
        db().attendanceDay.findUnique({
          where: {
            tenantId_employeeId_workDate: {
              tenantId: ctx().tenantId,
              employeeId: emp.id,
              workDate: ymdToDate(workDate),
            },
          },
        }),
        planFor(emp, workDate),
        policyFor(emp.legalEntityId),
        db().workLocation.findMany({
          where: { isActive: true, requiresApproval: false },
          orderBy: { name: 'asc' },
          select: { id: true, name: true, type: true },
        }),
      ]);
      return {
        hasEmployeeRecord: true,
        employee: { id: emp.id, name: fullName(emp), timezone: emp.timezone },
        workDate,
        clockedIn: Boolean(open),
        openSince: open?.serverTs ?? null,
        openLocationId: open?.workLocationId ?? null,
        today: dayDto(day),
        plan: {
          kind: plan.kind,
          holidayName: plan.holidayName ?? null,
          startMin: plan.startMin,
          endMin: plan.endMin,
          expectedMinutes: plan.expectedMinutes,
          flexible: plan.flexible,
        },
        locations,
        capture: { ip: policy.captureIp, geo: policy.captureGeo },
        serverTime: t,
      };
    },

    /**
     * Clock in or out. The server's clock decides the time; the device time is kept for reference.
     * IP address and location are stored only when the company turned them on (both are shown to the person).
     * @param {any} input validated PunchBody @param {{ ip?: string | null }} meta
     */
    async punch(input, { ip } = {}) {
      const emp = await me();
      if (emp.status === 'EXITED')
        throw new ConflictError('employee_exited', 'This person has left the company');
      const t = now();
      if (dateToYmd(emp.dateOfJoining) > localYmd(t, emp.timezone))
        throw new ConflictError('not_started', 'You can clock in from your joining date');
      const open = await openPunch(emp.id);
      if (input.type === 'IN' && open)
        throw new ConflictError('already_clocked_in', 'You are already clocked in');
      if (input.type === 'OUT' && !open) throw new ConflictError('not_clocked_in', 'You are not clocked in');
      if (input.type === 'OUT' && (await db().employeeActiveSession.findUnique({ where: activeKey(emp.id) })))
        throw new ConflictError(
          'work_session_open',
          'You have a work session running. End it on My work, which also clocks you out.',
        );

      let workLocationId = open?.workLocationId ?? null;
      if (input.type === 'IN' && input.workLocationId) {
        const loc = await db().workLocation.findUnique({ where: { id: input.workLocationId } });
        if (!loc || !loc.isActive)
          throw new ValidationError([
            { path: 'body.workLocationId', message: 'Choose an active work location' },
          ]);
        if (loc.requiresApproval)
          throw new ValidationError([
            { path: 'body.workLocationId', message: 'This location needs an approved request first' },
          ]);
        workLocationId = loc.id;
      }
      const policy = await policyFor(emp.legalEntityId);
      const workDate = open ? /** @type {string} */ (dateToYmd(open.workDate)) : await workDateForIn(emp, t);
      await db().attendancePunch.create({
        data: {
          id: newId(),
          employeeId: emp.id,
          type: input.type,
          serverTs: t,
          clientTs: input.clientTs ? new Date(input.clientTs) : null,
          source: 'WEB',
          workLocationId,
          workDate: ymdToDate(workDate),
          ipAddress: policy.captureIp && ip ? ip.slice(0, 45) : null,
          ...(policy.captureGeo && input.geo ? { geo: input.geo } : {}),
        },
      });
      await recomputeDay(emp, workDate);
      return service.status();
    },

    /**
     * Clock-in and clock-out that follow a work session (start, end, or an automatic close at the last heartbeat).
     * Does nothing when the attendance state already matches, so a person who clocked in on the attendance page
     * can start a work session without a second IN. The location was already checked by the work-session rules.
     * @param {string} employeeId
     * @param {{ type: 'IN' | 'OUT', at: Date, source: 'WEB' | 'SYSTEM', workLocationId?: string | null }} p
     */
    async recordWorkPunch(employeeId, { type, at, source, workLocationId = null }) {
      const emp = await loadEmployee(employeeId);
      if (!emp) throw new NotFoundError();
      const open = await openPunch(emp.id);
      if (type === 'IN' && open) return null;
      if (type === 'OUT' && !open) return null;
      const workDate = open ? /** @type {string} */ (dateToYmd(open.workDate)) : await workDateForIn(emp, at);
      await db().attendancePunch.create({
        data: {
          id: newId(),
          employeeId: emp.id,
          type,
          serverTs: at,
          source,
          workLocationId: type === 'IN' ? workLocationId : (open?.workLocationId ?? null),
          workDate: ymdToDate(workDate),
        },
      });
      return recomputeDay(emp, workDate);
    },

    /** @param {string} from @param {string} to */
    async myDays(from, to) {
      assertRange(from, to);
      return daysWithPunches(await me(), from, to);
    },

    /** @param {string} employeeId @param {string} from @param {string} to */
    async employeeDays(employeeId, from, to) {
      assertRange(from, to);
      const emp = await viewableEmployeeOr404(employeeId);
      return {
        employee: { id: emp.id, code: emp.employeeCode, name: fullName(emp), timezone: emp.timezone },
        data: await daysWithPunches(emp, from, to),
      };
    },

    /** One day with punches and correction requests, if the caller may see that employee. @param {string} id */
    async day(id) {
      const row = await db().attendanceDay.findUnique({ where: { id } });
      if (!row) throw new NotFoundError();
      const emp = await viewableEmployeeOr404(row.employeeId);
      const ymd = /** @type {string} */ (dateToYmd(row.workDate));
      const [withPunches] = await daysWithPunches(emp, ymd, ymd);
      return { ...withPunches, employee: { id: emp.id, code: emp.employeeCode, name: fullName(emp) } };
    },

    /** Everyone the caller may see on one date, with their day (or nothing recorded yet). @param {any} q */
    async teamDay(q) {
      const scope = await employeeScope('attendance.view', { includeSelf: true });
      const date = ymdToDate(q.date);
      const base = {
        AND: [scope, { deletedAt: null }, { OR: [{ exitDate: null }, { exitDate: { gte: date } }] }],
        dateOfJoining: { lte: date },
        ...(q.departmentId ? { departmentId: q.departmentId } : {}),
      };
      const statusFilter =
        q.status === 'NOT_RECORDED'
          ? { attendanceDays: { none: { workDate: date } } }
          : q.status
            ? { attendanceDays: { some: { workDate: date, status: q.status } } }
            : {};
      const employees = await db().employee.findMany({
        where: { ...base, ...statusFilter },
        select: EMPLOYEE_SELECT,
        orderBy: { id: 'asc' },
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      });
      const page = employees.slice(0, q.limit);
      const [days, total, grouped] = await Promise.all([
        db().attendanceDay.findMany({ where: { workDate: date, employeeId: { in: page.map((e) => e.id) } } }),
        db().employee.count({ where: base }),
        db().attendanceDay.groupBy({
          by: ['status'],
          where: { workDate: date, employee: base },
          _count: { _all: true },
        }),
      ]);
      const byEmp = new Map(days.map((d) => [d.employeeId, d]));
      const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
      const recorded = grouped.reduce((s, g) => s + g._count._all, 0);
      return {
        date: q.date,
        counts: { ...counts, NOT_RECORDED: total - recorded, total },
        data: page.map((e) => ({
          employee: {
            id: e.id,
            code: e.employeeCode,
            name: fullName(e),
            department: e.department?.name ?? null,
            timezone: e.timezone,
          },
          day: dayDto(byEmp.get(e.id)),
        })),
        nextCursor: employees.length > q.limit ? page[page.length - 1].id : null,
      };
    },

    // ── Corrections ─────────────────────────────────────────────────────────────

    /** @param {any} input validated RegularizationBody */
    async requestCorrection(input) {
      const emp = await me();
      const policy = await policyFor(emp.legalEntityId);
      const t = now();
      const today = localYmd(t, emp.timezone);
      const fail = (/** @type {string} */ path, /** @type {string} */ message) => {
        throw new ValidationError([{ path: `body.${path}`, message }]);
      };
      if (input.workDate > today) fail('workDate', 'You cannot correct a future day');
      if (input.workDate < /** @type {string} */ (dateToYmd(emp.dateOfJoining)))
        fail('workDate', 'Before your joining date');
      if (daysBetween(input.workDate, today) > policy.regularizationWindowDays)
        fail('workDate', `Corrections can go back ${policy.regularizationWindowDays} days`);
      const requestedIn = input.inTime
        ? zonedTime(input.workDate, timeToMinutes(input.inTime), emp.timezone)
        : null;
      const requestedOut = input.outTime
        ? zonedTime(
            /** @type {string} */ (input.outNextDay ? addDays(input.workDate, 1) : input.workDate),
            timeToMinutes(input.outTime),
            emp.timezone,
          )
        : null;
      if ((requestedIn && requestedIn > t) || (requestedOut && requestedOut > t))
        fail(requestedOut && requestedOut > t ? 'outTime' : 'inTime', 'This time has not happened yet');

      const day = await recomputeDay(emp, input.workDate);
      if (!day) fail('workDate', 'Outside your employment dates');
      if (day.isLocked) throw new ConflictError('day_locked', 'This day is locked for payroll');
      const pending = await db().attendanceRegularization.count({
        where: { attendanceDayId: day.id, status: 'PENDING' },
      });
      if (pending)
        throw new ConflictError('already_requested', 'There is already a pending correction for this day');

      const id = newId();
      await db().$transaction(async (/** @type {any} */ tx) => {
        await tx.attendanceRegularization.create({
          data: {
            id,
            employeeId: emp.id,
            attendanceDayId: day.id,
            requestedIn,
            requestedOut,
            reason: input.reason,
          },
        });
        await tx.approvalStep.create({
          data: {
            id: newId(),
            entityType: 'ATTENDANCE_REGULARIZATION',
            entityId: id,
            stepNo: 1,
            approverEmployeeId: emp.managerId,
          },
        });
        await audit(tx, {
          action: 'attendance.correction_requested',
          entityType: 'AttendanceRegularization',
          entityId: id,
          changes: { workDate: input.workDate, inTime: input.inTime ?? null, outTime: input.outTime ?? null },
        });
      });
      return service.getCorrection(id);
    },

    /** @param {string} id */
    async getCorrection(id) {
      const r = await db().attendanceRegularization.findUnique({
        where: { id },
        include: {
          attendanceDay: true,
          employee: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              managerId: true,
              timezone: true,
            },
          },
        },
      });
      if (!r) throw new NotFoundError();
      const step = await db().approvalStep.findFirst({
        where: { entityType: 'ATTENDANCE_REGULARIZATION', entityId: id, stepNo: 1 },
      });
      const own = r.employeeId === ctx().employeeId;
      const approver =
        !own && (await canApprove(r.employeeId, r.employee.managerId, step?.approverEmployeeId ?? null));
      if (!own && !approver) {
        // Viewers in attendance.view scope may read it; anyone else gets 404.
        await viewableEmployeeOr404(r.employeeId);
      }
      return {
        id: r.id,
        status: r.status,
        reason: r.reason,
        requestedIn: r.requestedIn,
        requestedOut: r.requestedOut,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt,
        decisionComment: step?.comment ?? null,
        workDate: dateToYmd(r.attendanceDay.workDate),
        day: dayDto(r.attendanceDay),
        employee: {
          id: r.employee.id,
          code: r.employee.employeeCode,
          name: fullName(r.employee),
          timezone: r.employee.timezone,
        },
        canDecide: approver && r.status === 'PENDING',
        canCancel: own && r.status === 'PENDING',
      };
    },

    /** @param {{ view: 'mine' | 'approvals', status?: string }} q */
    async listCorrections(q) {
      /** @type {any} */
      let where;
      if (q.view === 'mine') {
        where = { employeeId: (await me()).id };
      } else {
        const myId = ctx().employeeId ?? null;
        const steps = myId
          ? await db().approvalStep.findMany({
              where: { entityType: 'ATTENDANCE_REGULARIZATION', approverEmployeeId: myId },
              select: { entityId: true },
            })
          : [];
        const scoped = await approvableEmployees();
        const or = [
          ...(steps.length ? [{ id: { in: steps.map((s) => s.entityId) } }] : []),
          // An empty filter means everyone (company scope); `{ employee: {} }` would match nothing inside OR.
          ...(scoped ? [Object.keys(scoped).length ? { employee: scoped } : {}] : []),
        ];
        if (!or.length) return [];
        where = { ...anyOf(or), ...(myId ? { employeeId: { not: myId } } : {}) };
      }
      const rows = await db().attendanceRegularization.findMany({
        where: { ...where, ...(q.status ? { status: q.status } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          attendanceDay: true,
          employee: {
            select: { id: true, employeeCode: true, firstName: true, lastName: true, timezone: true },
          },
        },
      });
      const steps = await db().approvalStep.findMany({
        where: { entityType: 'ATTENDANCE_REGULARIZATION', entityId: { in: rows.map((r) => r.id) } },
      });
      const comments = new Map(steps.map((s) => [s.entityId, s.comment]));
      return rows.map((r) => ({
        id: r.id,
        status: r.status,
        reason: r.reason,
        requestedIn: r.requestedIn,
        requestedOut: r.requestedOut,
        createdAt: r.createdAt,
        decidedAt: r.decidedAt,
        decisionComment: comments.get(r.id) ?? null,
        workDate: dateToYmd(r.attendanceDay.workDate),
        day: dayDto(r.attendanceDay),
        employee: {
          id: r.employee.id,
          code: r.employee.employeeCode,
          name: fullName(r.employee),
          timezone: r.employee.timezone,
        },
      }));
    },

    /**
     * Approve or reject. Approval adds CORRECTION punches (originals stay stored) and recalculates the day.
     * @param {string} id @param {{ decision: 'APPROVED' | 'REJECTED', comment?: string }} input
     */
    async decideCorrection(id, input) {
      const r = await db().attendanceRegularization.findUnique({
        where: { id },
        include: { attendanceDay: true, employee: { select: { managerId: true } } },
      });
      if (!r) throw new NotFoundError();
      if (r.employeeId === ctx().employeeId)
        throw new ForbiddenError('own_request', 'You cannot decide your own correction');
      const step = await db().approvalStep.findFirst({
        where: { entityType: 'ATTENDANCE_REGULARIZATION', entityId: id, stepNo: 1 },
      });
      if (!(await canApprove(r.employeeId, r.employee.managerId, step?.approverEmployeeId ?? null)))
        throw new NotFoundError();
      if (r.status !== 'PENDING')
        throw new ConflictError('already_decided', 'This request has already been decided');
      if (r.attendanceDay.isLocked) throw new ConflictError('day_locked', 'This day is locked for payroll');
      const t = now();
      await db().$transaction(async (/** @type {any} */ tx) => {
        const { count } = await tx.attendanceRegularization.updateMany({
          where: { id, status: 'PENDING' },
          data: { status: input.decision, decidedAt: t },
        });
        if (!count) throw new ConflictError('already_decided', 'This request has already been decided');
        if (step)
          await tx.approvalStep.update({
            where: { id: step.id },
            data: {
              status: input.decision,
              decidedAt: t,
              decidedBy: ctx().userId,
              comment: input.comment ?? null,
            },
          });
        if (input.decision === 'APPROVED') {
          for (const [type, ts] of /** @type {const} */ ([
            ['IN', r.requestedIn],
            ['OUT', r.requestedOut],
          ])) {
            if (!ts) continue;
            await tx.attendancePunch.create({
              data: {
                id: newId(),
                employeeId: r.employeeId,
                type,
                serverTs: ts,
                source: 'CORRECTION',
                workDate: r.attendanceDay.workDate,
                createdAt: t,
              },
            });
          }
        }
        await audit(tx, {
          action: `attendance.correction_${input.decision.toLowerCase()}`,
          entityType: 'AttendanceRegularization',
          entityId: id,
          changes: { comment: input.comment ?? null },
        });
      });
      if (input.decision === 'APPROVED') {
        const emp = await loadEmployee(r.employeeId);
        await recomputeFrom(emp, /** @type {string} */ (dateToYmd(r.attendanceDay.workDate)));
      }
      return service.getCorrection(id);
    },

    /** @param {string} id */
    async cancelCorrection(id) {
      const r = await db().attendanceRegularization.findUnique({ where: { id } });
      if (!r || r.employeeId !== ctx().employeeId) throw new NotFoundError();
      const { count } = await db().attendanceRegularization.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'CANCELLED', decidedAt: now() },
      });
      if (!count) throw new ConflictError('already_decided', 'Only pending requests can be cancelled');
      await db().approvalStep.updateMany({
        where: { entityType: 'ATTENDANCE_REGULARIZATION', entityId: id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      await audit(db(), {
        action: 'attendance.correction_cancelled',
        entityType: 'AttendanceRegularization',
        entityId: id,
      });
      return service.getCorrection(id);
    },

    // ── Overtime ────────────────────────────────────────────────────────────────

    /** @param {{ status?: string }} q */
    async listOvertime(q) {
      const scoped = await approvableEmployees();
      if (!scoped) return [];
      const rows = await db().attendanceDay.findMany({
        where: { overtimeStatus: q.status ?? 'PENDING', employee: scoped },
        orderBy: { workDate: 'desc' },
        take: 200,
        include: { employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } } },
      });
      return rows.map((d) => ({
        ...dayDto(d),
        employee: { id: d.employee.id, code: d.employee.employeeCode, name: fullName(d.employee) },
      }));
    },

    /** @param {string} dayId @param {{ decision: 'APPROVED' | 'REJECTED', comment?: string }} input */
    async decideOvertime(dayId, input) {
      const d = await db().attendanceDay.findUnique({
        where: { id: dayId },
        include: { employee: { select: { managerId: true } } },
      });
      if (!d) throw new NotFoundError();
      if (d.employeeId === ctx().employeeId)
        throw new ForbiddenError('own_request', 'You cannot approve your own overtime');
      if (!(await canApprove(d.employeeId, d.employee.managerId))) throw new NotFoundError();
      if (d.isLocked) throw new ConflictError('day_locked', 'This day is locked for payroll');
      const { count } = await db().attendanceDay.updateMany({
        where: { id: dayId, overtimeStatus: 'PENDING' },
        data: { overtimeStatus: input.decision, overtimeDecidedBy: ctx().userId, overtimeDecidedAt: now() },
      });
      if (!count)
        throw new ConflictError('not_pending', 'There is no overtime waiting for a decision on this day');
      await audit(db(), {
        action: `attendance.overtime_${input.decision.toLowerCase()}`,
        entityType: 'AttendanceDay',
        entityId: dayId,
        changes: { minutes: d.overtimeMinutes, comment: input.comment ?? null },
      });
      return dayDto(await db().attendanceDay.findUnique({ where: { id: dayId } }));
    },

    // ── Shift assignments ───────────────────────────────────────────────────────

    /** @param {{ employeeId?: string, shiftId?: string, activeOn?: string }} q */
    async listAssignments(q) {
      const scope = await employeeScope('attendance.manage');
      const on = q.activeOn ? ymdToDate(q.activeOn) : null;
      const rows = await db().shiftAssignment.findMany({
        where: {
          employee: scope,
          ...(q.employeeId ? { employeeId: q.employeeId } : {}),
          ...(q.shiftId ? { shiftId: q.shiftId } : {}),
          ...(on
            ? { effectiveFrom: { lte: on }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }] }
            : {}),
        },
        orderBy: [{ effectiveFrom: 'desc' }],
        take: 500,
        include: {
          shift: { select: { id: true, name: true } },
          employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
        },
      });
      return rows.map((a) => ({
        id: a.id,
        effectiveFrom: dateToYmd(a.effectiveFrom),
        effectiveTo: dateToYmd(a.effectiveTo),
        shift: a.shift,
        employee: { id: a.employee.id, code: a.employee.employeeCode, name: fullName(a.employee) },
      }));
    },

    /**
     * Assigns a shift from a date. An earlier open assignment ends the day before; one that starts on or after the date is a conflict.
     * @param {{ shiftId: string, employeeIds: string[], effectiveFrom: string, effectiveTo?: string | null }} input
     */
    async assignShift(input) {
      const shift = await db().shift.findUnique({ where: { id: input.shiftId } });
      if (!shift) throw new ValidationError([{ path: 'body.shiftId', message: 'Shift not found' }]);
      const scope = await employeeScope('attendance.manage');
      const ids = [...new Set(input.employeeIds)];
      const found = await db().employee.findMany({
        where: { AND: [{ id: { in: ids }, deletedAt: null }, scope] },
        select: { id: true },
      });
      if (found.length !== ids.length)
        throw new ValidationError([{ path: 'body.employeeIds', message: 'Some employees were not found' }]);
      const from = ymdToDate(input.effectiveFrom);
      const later = await db().shiftAssignment.findMany({
        where: { employeeId: { in: ids }, effectiveFrom: { gte: from } },
        select: { employeeId: true },
      });
      if (later.length)
        throw new ConflictError(
          'assignment_overlap',
          'Some of these people already have a shift starting on or after this date. Remove it first.',
        );
      const created = [];
      await db().$transaction(async (/** @type {any} */ tx) => {
        await tx.shiftAssignment.updateMany({
          where: {
            employeeId: { in: ids },
            effectiveFrom: { lt: from },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
          },
          data: { effectiveTo: ymdToDate(/** @type {string} */ (addDays(input.effectiveFrom, -1))) },
        });
        for (const employeeId of ids) {
          const id = newId();
          await tx.shiftAssignment.create({
            data: {
              id,
              shiftId: shift.id,
              employeeId,
              effectiveFrom: from,
              effectiveTo: input.effectiveTo ? ymdToDate(input.effectiveTo) : null,
            },
          });
          created.push(id);
        }
        await audit(tx, {
          action: 'attendance.shift_assigned',
          entityType: 'Shift',
          entityId: shift.id,
          changes: {
            employees: ids.length,
            effectiveFrom: input.effectiveFrom,
            effectiveTo: input.effectiveTo ?? null,
          },
        });
      });
      return { created: created.length };
    },

    /** @param {string} id */
    async removeAssignment(id) {
      const scope = await employeeScope('attendance.manage');
      const a = await db().shiftAssignment.findFirst({ where: { id, employee: scope } });
      if (!a) throw new NotFoundError();
      await db().shiftAssignment.delete({ where: { id } });
      await audit(db(), {
        action: 'attendance.shift_unassigned',
        entityType: 'ShiftAssignment',
        entityId: id,
      });
    },

    // ── Policy ──────────────────────────────────────────────────────────────────

    /** @param {string | undefined} legalEntityId */
    async getPolicy(legalEntityId) {
      if (legalEntityId && !(await db().legalEntity.count({ where: { id: legalEntityId } })))
        throw new NotFoundError();
      return { legalEntityId: legalEntityId ?? null, ...(await policyFor(legalEntityId ?? null)) };
    },

    /** @param {any} input validated AttendancePolicyBody */
    async savePolicy(input) {
      const { legalEntityId, ...values } = input;
      if (legalEntityId && !(await db().legalEntity.count({ where: { id: legalEntityId } })))
        throw new ValidationError([{ path: 'body.legalEntityId', message: 'Legal entity not found' }]);
      const scopeKey = legalEntityId ?? 'default';
      await db().attendancePolicy.upsert({
        where: { tenantId_scopeKey: { tenantId: ctx().tenantId, scopeKey } },
        create: { id: newId(), scopeKey, legalEntityId, ...values },
        update: values,
      });
      await audit(db(), {
        action: 'attendance.policy_saved',
        entityType: 'AttendancePolicy',
        entityId: scopeKey,
        changes: values,
      });
      return service.getPolicy(legalEntityId ?? undefined);
    },

    // ── Recalculation and roll-up ───────────────────────────────────────────────

    /** Queues a recalculation after settings change. @param {{ from: string, to: string, employeeIds?: string[] }} input */
    async requestRecalculation(input) {
      assertRange(input.from, input.to, 62);
      if (!queues?.workSessions)
        throw new AppError(503, 'queue_unavailable', 'Background jobs are not available');
      await queues.workSessions.add('attendance-recalculate', {
        tenantId: ctx().tenantId,
        userId: ctx().userId,
        from: input.from,
        to: input.to,
        ...(input.employeeIds ? { employeeIds: input.employeeIds } : {}),
      });
      await audit(db(), {
        action: 'attendance.recalculation_requested',
        entityType: 'Tenant',
        entityId: ctx().tenantId,
        changes: input,
      });
      return { queued: true };
    },

    /**
     * Recalculates days for employees in the current tenant context (worker). Locked days are skipped.
     * @param {{ from?: string, to?: string, employeeIds?: string[], lookbackDays?: number }} opts
     *   With from/to: that range. Otherwise the last `lookbackDays` closed days plus today, per employee's own time zone.
     */
    async rollup({ from, to, employeeIds, lookbackDays = 2 } = {}) {
      const t = now();
      const lastWindow = ymdToDate(/** @type {string} */ (addDays(dateToYmd(t), -(lookbackDays + 2))));
      const employees = await db().employee.findMany({
        where: {
          ...(employeeIds ? { id: { in: employeeIds } } : {}),
          OR: [{ exitDate: null }, { exitDate: { gte: from ? ymdToDate(from) : lastWindow } }],
          dateOfJoining: { lte: to ? ymdToDate(to) : t },
        },
        select: EMPLOYEE_SELECT,
      });
      let days = 0;
      for (const emp of employees) {
        const today = localYmd(t, emp.timezone);
        const start = from ?? /** @type {string} */ (addDays(today, -lookbackDays));
        const end = to && to < today ? to : today;
        for (const d of eachDay(start, end)) {
          if (await recomputeDay(emp, d)) days++;
        }
      }
      return { employees: employees.length, days };
    },

    // ── Reports ─────────────────────────────────────────────────────────────────

    /** Per-employee totals for a period, within attendance.view scope. @param {{ from: string, to: string, departmentId?: string }} q */
    async summary(q) {
      assertRange(q.from, q.to);
      const scope = await employeeScope('attendance.view', { includeSelf: true });
      const range = { gte: ymdToDate(q.from), lte: ymdToDate(q.to) };
      const employees = await db().employee.findMany({
        where: {
          AND: [scope, { deletedAt: null }, { OR: [{ exitDate: null }, { exitDate: { gte: range.gte } }] }],
          dateOfJoining: { lte: range.lte },
          ...(q.departmentId ? { departmentId: q.departmentId } : {}),
        },
        select: EMPLOYEE_SELECT,
        orderBy: { employeeCode: 'asc' },
        take: 5000,
      });
      const days = await db().attendanceDay.findMany({
        where: { workDate: range, employeeId: { in: employees.map((e) => e.id) } },
        select: {
          employeeId: true,
          status: true,
          workedMinutes: true,
          lateMinutes: true,
          earlyLeaveMinutes: true,
          overtimeMinutes: true,
          overtimeStatus: true,
          flags: true,
        },
      });
      const blank = () => ({
        present: 0,
        wfh: 0,
        halfDay: 0,
        absent: 0,
        weekend: 0,
        holiday: 0,
        pending: 0,
        lateDays: 0,
        lateMinutes: 0,
        earlyLeaveDays: 0,
        missingOut: 0,
        workedMinutes: 0,
        overtimeApprovedMinutes: 0,
        overtimePendingMinutes: 0,
      });
      /** @type {Map<string, ReturnType<typeof blank>>} */
      const totals = new Map(employees.map((e) => [e.id, blank()]));
      const key = /** @type {Record<string, keyof ReturnType<typeof blank>>} */ ({
        PRESENT: 'present',
        WFH: 'wfh',
        HALF_DAY: 'halfDay',
        ABSENT: 'absent',
        WEEKEND: 'weekend',
        HOLIDAY: 'holiday',
        PENDING: 'pending',
      });
      for (const d of days) {
        const s = /** @type {ReturnType<typeof blank>} */ (totals.get(d.employeeId));
        if (key[d.status]) s[key[d.status]]++;
        if (d.lateMinutes > 0) s.lateDays++;
        s.lateMinutes += d.lateMinutes;
        if (d.earlyLeaveMinutes > 0) s.earlyLeaveDays++;
        if (Array.isArray(d.flags) && d.flags.includes('MISSING_OUT')) s.missingOut++;
        s.workedMinutes += d.workedMinutes;
        if (d.overtimeStatus === 'APPROVED') s.overtimeApprovedMinutes += d.overtimeMinutes;
        if (d.overtimeStatus === 'PENDING') s.overtimePendingMinutes += d.overtimeMinutes;
      }
      return {
        from: q.from,
        to: q.to,
        data: employees.map((e) => ({
          employee: {
            id: e.id,
            code: e.employeeCode,
            name: fullName(e),
            department: e.department?.name ?? null,
          },
          ...totals.get(e.id),
        })),
      };
    },
  };
  return service;
}
