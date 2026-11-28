// @ts-check
/**
 * Daily work reports and weekly timesheets (Sprint 9).
 *
 * Both are built automatically from the record: work sessions (worked, break and disconnected time) and task time.
 * People add notes and submit; the figures are frozen at submission so a reviewer approves exactly what was sent.
 * Reviewers: the direct manager, or a holder of approve_work_reports / approve_timesheets (sensitive, MFA) whose
 * scope covers the person; never the person themselves. A submitted or approved timesheet locks its week (lock.js).
 */
import { newId } from '@hrms/shared/ids';
import { audit } from '../../lib/audit.js';
import { currentContext } from '../../lib/context.js';
import { db } from '../../lib/db.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { addDays, dateToYmd, eachDay, localYmd, ymdToDate, zonedTime } from '../../lib/time.js';
import { anyOf, employeeScope } from '../employees/scope.js';
import { weekOf } from './lock.js';

const ctx = () => /** @type {any} */ (currentContext());
const fullName = (/** @type {any} */ e) => [e.firstName, e.lastName].filter(Boolean).join(' ');
const EMP = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  timezone: true,
  managerId: true,
  legalEntity: { select: { weekStartDay: true } },
};
const EDITABLE = ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'];

/**
 * @param {{ work: { liveTotals: (s: any) => Promise<any> }, mfaEnforce?: boolean, now?: () => Date }} deps
 */
export function createTimesheetsService({ work, mfaEnforce = true, now = () => new Date() }) {
  const holds = (/** @type {string} */ p) =>
    Boolean(ctx().permissions?.has(p)) && (!mfaEnforce || ctx().mfa === true);

  async function me() {
    const id = ctx().employeeId;
    const emp = id ? await db().employee.findUnique({ where: { id }, select: EMP }) : null;
    if (!emp)
      throw new AppError(
        409,
        'no_employee_record',
        'Your sign-in is not linked to an employee record. Ask HR to link it.',
      );
    return emp;
  }

  /**
   * The record for a range of local days: sessions by work date, task time by the local day it started.
   * @param {any} emp @param {string} from @param {string} to
   */
  async function collect(emp, from, to) {
    const [sessions, entries, completed] = await Promise.all([
      db().workSession.findMany({
        where: { employeeId: emp.id, workDate: { gte: ymdToDate(from), lte: ymdToDate(to) } },
        include: { policy: true, workLocation: { select: { name: true, type: true } } },
        orderBy: { startedAt: 'asc' },
      }),
      db().taskTimeEntry.findMany({
        where: {
          employeeId: emp.id,
          startedAt: {
            gte: zonedTime(from, 0, emp.timezone),
            lt: zonedTime(/** @type {string} */ (addDays(to, 1)), 0, emp.timezone),
          },
        },
        include: {
          task: { select: { id: true, title: true, project: { select: { code: true, name: true } } } },
        },
      }),
      db().task.findMany({
        where: {
          completedAt: {
            gte: zonedTime(from, 0, emp.timezone),
            lt: zonedTime(/** @type {string} */ (addDays(to, 1)), 0, emp.timezone),
          },
          taskAssignments: { some: { employeeId: emp.id } },
          deletedAt: null,
        },
        select: { id: true, title: true, completedAt: true },
      }),
    ]);
    const t = now();
    const days = /** @type {Record<string, any>} */ ({});
    for (const d of eachDay(from, to))
      days[d] = {
        date: d,
        workedSec: 0,
        breakSec: 0,
        disconnectedSec: 0,
        sessions: [],
        tasks: {},
        taskSec: 0,
        completed: [],
      };
    for (const s of sessions) {
      const day = days[/** @type {string} */ (dateToYmd(s.workDate))];
      const totals = s.endedAt ? s : await work.liveTotals(s);
      day.workedSec += totals.workedSec;
      day.breakSec += totals.breakSec;
      day.disconnectedSec += totals.disconnectedSec;
      day.sessions.push({
        id: s.id,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        status: s.status,
        location: s.workLocation.name,
        locationType: s.workLocation.type,
        workedSec: totals.workedSec,
      });
    }
    for (const e of entries) {
      const day = days[localYmd(e.startedAt, emp.timezone)];
      if (!day) continue;
      const sec = e.durationSec ?? Math.max(0, Math.floor((t.getTime() - e.startedAt.getTime()) / 1000));
      const key = e.taskId;
      day.tasks[key] ??= { taskId: key, title: e.task.title, project: e.task.project?.code ?? null, sec: 0 };
      day.tasks[key].sec += sec;
      day.taskSec += sec;
    }
    for (const c of completed) {
      const day = days[localYmd(/** @type {Date} */ (c.completedAt), emp.timezone)];
      if (day) day.completed.push({ id: c.id, title: c.title });
    }
    for (const d of Object.values(days)) {
      d.tasks = Object.values(d.tasks).sort((a, b) => b.sec - a.sec);
      d.unallocatedSec = Math.max(0, d.workedSec - d.taskSec);
    }
    return { days: Object.values(days), running: sessions.some((s) => !s.endedAt) };
  }

  /** May the caller review this person's reports or timesheets? @param {any} emp @param {string} permission */
  async function canReview(emp, permission) {
    const myId = ctx().employeeId ?? null;
    if (myId && myId === emp.id) return false;
    if (myId && emp.managerId === myId) return true;
    if (!holds(permission)) return false;
    const scope = await employeeScope(permission);
    return (await db().employee.count({ where: { AND: [{ id: emp.id }, scope] } })) > 0;
  }

  async function reviewable(/** @type {string} */ permission) {
    const myId = ctx().employeeId ?? null;
    /** @type {object[]} */
    const or = [];
    if (myId) or.push({ managerId: myId });
    if (holds(permission)) or.push(await employeeScope(permission));
    if (!or.length) return null;
    return { AND: [anyOf(or), ...(myId ? [{ id: { not: myId } }] : [])] };
  }

  /** @param {any} r */
  const reportDto = (r, live = /** @type {any} */ (null)) => ({
    id: r?.id ?? null,
    workDate: r ? dateToYmd(r.workDate) : live?.date,
    employee: r?.employee
      ? { id: r.employee.id, code: r.employee.employeeCode, name: fullName(r.employee) }
      : undefined,
    status: r?.status ?? 'DRAFT',
    notes: r?.notes ?? '',
    summary: r && !EDITABLE.includes(r.status) ? r.summarySnapshot : (live ?? r?.summarySnapshot),
    submittedAt: r?.submittedAt ?? null,
    reviewedAt: r?.reviewedAt ?? null,
    reviewComment: r?.reviewComment ?? null,
  });

  /** @param {any} t */
  const timesheetDto = (t, live = /** @type {any} */ (null)) => ({
    id: t?.id ?? null,
    weekStart: t ? dateToYmd(t.weekStart) : live?.weekStart,
    employee: t?.employee
      ? { id: t.employee.id, code: t.employee.employeeCode, name: fullName(t.employee) }
      : undefined,
    status: t?.status ?? 'DRAFT',
    totalSec: t && !EDITABLE.includes(t.status) ? t.totalSec : (live?.totalSec ?? t?.totalSec ?? 0),
    breakdown: t && !EDITABLE.includes(t.status) ? t.breakdown : (live ?? t?.breakdown),
    submittedAt: t?.submittedAt ?? null,
    decidedAt: t?.decidedAt ?? null,
    comment: t?.comment ?? null,
  });

  /** @param {any} emp @param {string} ws */
  async function weekSummary(emp, ws) {
    const we = /** @type {string} */ (addDays(ws, 6));
    const { days, running } = await collect(emp, ws, we);
    const byTask = /** @type {Record<string, any>} */ ({});
    for (const d of days)
      for (const t of d.tasks) {
        byTask[t.taskId] ??= { taskId: t.taskId, title: t.title, project: t.project, sec: 0, perDay: {} };
        byTask[t.taskId].sec += t.sec;
        byTask[t.taskId].perDay[d.date] = t.sec;
      }
    const sum = (/** @type {string} */ k) => days.reduce((n, d) => n + d[k], 0);
    return {
      summary: {
        weekStart: ws,
        weekEnd: we,
        totalSec: sum('workedSec'),
        breakSec: sum('breakSec'),
        disconnectedSec: sum('disconnectedSec'),
        taskSec: sum('taskSec'),
        unallocatedSec: Math.max(0, sum('workedSec') - sum('taskSec')),
        days: days.map((d) => ({
          date: d.date,
          workedSec: d.workedSec,
          taskSec: d.taskSec,
          sessions: d.sessions.length,
        })),
        tasks: Object.values(byTask).sort((a, b) => b.sec - a.sec),
      },
      running,
    };
  }

  const service = {
    // ── Daily reports ──

    /** Your report for a day: frozen if submitted, otherwise built live from your record. @param {string} date */
    async myReport(date) {
      const emp = await me();
      const row = await db().dailyWorkReport.findUnique({
        where: {
          tenantId_employeeId_workDate: {
            tenantId: ctx().tenantId,
            employeeId: emp.id,
            workDate: ymdToDate(date),
          },
        },
      });
      const live = !row || EDITABLE.includes(row.status) ? (await collect(emp, date, date)).days[0] : null;
      return { ...reportDto(row, live), canEdit: !row || EDITABLE.includes(row.status) };
    },

    /** @param {string} date @param {{ notes: string }} b */
    async saveReportNotes(date, b) {
      const emp = await me();
      if (date > localYmd(now(), emp.timezone))
        throw new ValidationError([{ path: 'params.date', message: 'Must not be in the future' }]);
      const key = {
        tenantId_employeeId_workDate: {
          tenantId: ctx().tenantId,
          employeeId: emp.id,
          workDate: ymdToDate(date),
        },
      };
      const row = await db().dailyWorkReport.findUnique({ where: key });
      if (row && !EDITABLE.includes(row.status))
        throw new ConflictError('report_locked', 'This report was already submitted');
      const live = (await collect(emp, date, date)).days[0];
      await db().dailyWorkReport.upsert({
        where: key,
        create: {
          id: newId(),
          employeeId: emp.id,
          workDate: ymdToDate(date),
          summarySnapshot: live,
          notes: b.notes,
        },
        update: { notes: b.notes, summarySnapshot: live },
      });
      return service.myReport(date);
    },

    /** Freezes the figures and sends the report to your manager. @param {string} date */
    async submitReport(date) {
      const emp = await me();
      if (date > localYmd(now(), emp.timezone))
        throw new ValidationError([{ path: 'params.date', message: 'Must not be in the future' }]);
      const key = {
        tenantId_employeeId_workDate: {
          tenantId: ctx().tenantId,
          employeeId: emp.id,
          workDate: ymdToDate(date),
        },
      };
      const row = await db().dailyWorkReport.findUnique({ where: key });
      if (row && !EDITABLE.includes(row.status))
        throw new ConflictError('report_locked', 'This report was already submitted');
      const { days, running } = await collect(emp, date, date);
      if (running)
        throw new ConflictError('session_running', 'End your work session before submitting the day');
      if (!days[0].sessions.length && !days[0].taskSec)
        throw new ConflictError('nothing_to_report', 'There is no work recorded on this day');
      const data = {
        summarySnapshot: days[0],
        status: 'SUBMITTED',
        submittedAt: now(),
        reviewedBy: null,
        reviewedAt: null,
      };
      const saved = await db().dailyWorkReport.upsert({
        where: key,
        create: { id: newId(), employeeId: emp.id, workDate: ymdToDate(date), notes: '', ...data },
        update: data,
      });
      await audit(db(), {
        action: 'work_report.submitted',
        entityType: 'DailyWorkReport',
        entityId: saved.id,
        changes: { date },
      });
      return service.myReport(date);
    },

    /** @param {{ view: 'mine' | 'approvals', status?: string }} q */
    async listReports(q) {
      let where;
      if (q.view === 'mine') where = { employeeId: (await me()).id };
      else {
        const employees = await reviewable('approve_work_reports');
        if (!employees) return [];
        where = { employee: employees, status: { not: 'DRAFT' } };
      }
      const rows = await db().dailyWorkReport.findMany({
        where: { ...where, ...(q.status ? { status: /** @type {any} */ (q.status) } : {}) },
        include: { employee: { select: EMP } },
        orderBy: { workDate: 'desc' },
        take: 200,
      });
      return rows.map((r) => reportDto(r));
    },

    /** @param {string} id */
    async getReport(id) {
      const r = await db().dailyWorkReport.findUnique({
        where: { id },
        include: { employee: { select: EMP } },
      });
      if (!r) throw new NotFoundError();
      if (r.employeeId !== ctx().employeeId && !(await canReview(r.employee, 'approve_work_reports')))
        throw new NotFoundError();
      return reportDto(r);
    },

    /** @param {string} id @param {{ decision: string, comment?: string }} d */
    async decideReport(id, d) {
      const r = await db().dailyWorkReport.findUnique({
        where: { id },
        include: { employee: { select: EMP } },
      });
      if (!r) throw new NotFoundError();
      if (r.employeeId === ctx().employeeId)
        throw new ForbiddenError('own_request', 'You cannot review your own report');
      if (!(await canReview(r.employee, 'approve_work_reports'))) throw new NotFoundError();
      const n = await db().dailyWorkReport.updateMany({
        where: { id, status: 'SUBMITTED' },
        data: {
          status: /** @type {any} */ (d.decision),
          reviewedBy: ctx().userId,
          reviewedAt: now(),
          reviewComment: d.comment ?? null,
        },
      });
      if (!n.count) throw new ConflictError('already_decided', 'This report is not waiting for a review');
      await audit(db(), {
        action: `work_report.${d.decision.toLowerCase()}`,
        entityType: 'DailyWorkReport',
        entityId: id,
      });
      return service.getReport(id);
    },

    // ── Timesheets ──

    /** Your timesheet for the week containing `week` (today by default). @param {string | undefined} week */
    async myTimesheet(week) {
      const emp = await me();
      const ws = await weekOf(emp.id, week ?? localYmd(now(), emp.timezone));
      const row = await db().timesheetApproval.findUnique({
        where: {
          tenantId_employeeId_weekStart: {
            tenantId: ctx().tenantId,
            employeeId: emp.id,
            weekStart: ymdToDate(ws),
          },
        },
      });
      const live = !row || EDITABLE.includes(row.status) ? await weekSummary(emp, ws) : null;
      return {
        ...timesheetDto(row, live?.summary ?? null),
        weekStart: ws,
        canSubmit: (!row || EDITABLE.includes(row.status)) && ws <= localYmd(now(), emp.timezone),
        sessionRunning: live?.running ?? false,
      };
    },

    /** @param {string} weekStart */
    async submitTimesheet(weekStart) {
      const emp = await me();
      const ws = await weekOf(emp.id, weekStart);
      if (ws !== weekStart)
        throw new ValidationError([{ path: 'params.date', message: `Weeks start on ${ws}` }]);
      if (ws > localYmd(now(), emp.timezone))
        throw new ValidationError([{ path: 'params.date', message: 'This week has not started' }]);
      const key = {
        tenantId_employeeId_weekStart: {
          tenantId: ctx().tenantId,
          employeeId: emp.id,
          weekStart: ymdToDate(ws),
        },
      };
      const row = await db().timesheetApproval.findUnique({ where: key });
      if (row && !EDITABLE.includes(row.status))
        throw new ConflictError('timesheet_locked', 'This timesheet was already submitted');
      const { summary, running } = await weekSummary(emp, ws);
      if (running)
        throw new ConflictError('session_running', 'End your work session before submitting the week');
      if (!summary.totalSec && !summary.taskSec)
        throw new ConflictError('nothing_to_report', 'There is no work recorded in this week');
      const data = {
        totalSec: summary.totalSec,
        breakdown: summary,
        status: 'SUBMITTED',
        submittedAt: now(),
        approverEmployeeId: emp.managerId,
        decidedAt: null,
      };
      const saved = await db().$transaction(async (/** @type {any} */ tx) => {
        const t = await tx.timesheetApproval.upsert({
          where: key,
          create: { id: newId(), employeeId: emp.id, weekStart: ymdToDate(ws), ...data },
          update: data,
        });
        await tx.dailyWorkReport.updateMany({
          where: {
            employeeId: emp.id,
            workDate: { gte: ymdToDate(ws), lte: ymdToDate(/** @type {string} */ (addDays(ws, 6))) },
          },
          data: { timesheetId: t.id },
        });
        await audit(tx, {
          action: 'timesheet.submitted',
          entityType: 'TimesheetApproval',
          entityId: t.id,
          changes: { weekStart: ws, totalSec: summary.totalSec },
        });
        return t;
      });
      void saved;
      return service.myTimesheet(ws);
    },

    /** @param {{ view: 'mine' | 'approvals', status?: string }} q */
    async listTimesheets(q) {
      let where;
      if (q.view === 'mine') where = { employeeId: (await me()).id };
      else {
        const employees = await reviewable('approve_timesheets');
        if (!employees) return [];
        where = { employee: employees, status: { not: 'DRAFT' } };
      }
      const rows = await db().timesheetApproval.findMany({
        where: { ...where, ...(q.status ? { status: /** @type {any} */ (q.status) } : {}) },
        include: { employee: { select: EMP } },
        orderBy: { weekStart: 'desc' },
        take: 200,
      });
      return rows.map((t) => timesheetDto(t));
    },

    /** @param {string} id */
    async getTimesheet(id) {
      const t = await db().timesheetApproval.findUnique({
        where: { id },
        include: { employee: { select: EMP } },
      });
      if (!t) throw new NotFoundError();
      if (t.employeeId !== ctx().employeeId && !(await canReview(t.employee, 'approve_timesheets')))
        throw new NotFoundError();
      return timesheetDto(t);
    },

    /** @param {string} id @param {{ decision: string, comment?: string }} d */
    async decideTimesheet(id, d) {
      const t = await db().timesheetApproval.findUnique({
        where: { id },
        include: { employee: { select: EMP } },
      });
      if (!t) throw new NotFoundError();
      if (t.employeeId === ctx().employeeId)
        throw new ForbiddenError('own_request', 'You cannot approve your own timesheet');
      if (!(await canReview(t.employee, 'approve_timesheets'))) throw new NotFoundError();
      const n = await db().timesheetApproval.updateMany({
        where: { id, status: 'SUBMITTED' },
        data: {
          status: /** @type {any} */ (d.decision),
          approverEmployeeId: ctx().employeeId ?? t.approverEmployeeId,
          decidedAt: now(),
          comment: d.comment ?? null,
        },
      });
      if (!n.count)
        throw new ConflictError('already_decided', 'This timesheet is not waiting for a decision');
      await audit(db(), {
        action: `timesheet.${d.decision.toLowerCase()}`,
        entityType: 'TimesheetApproval',
        entityId: id,
      });
      return service.getTimesheet(id);
    },
  };
  return service;
}
