// @ts-check
/**
 * Manager live board and HR remote-work dashboard (Sprint 9).
 *
 * The board is Team status plus each person's open and overdue tasks and the task they are timing now, and the
 * approvals waiting for the viewer. It needs view_team_work_status (sensitive, MFA), like Team status.
 * The HR dashboard is company-wide aggregates only (reports.view): no names, no per-person activity.
 */
import { currentContext } from '../../lib/context.js';
import { db } from '../../lib/db.js';
import { ValidationError } from '../../lib/errors.js';
import { addDays, dateToYmd, daysBetween, eachDay, ymdToDate } from '../../lib/time.js';
import { REMOTE_LOCATION_TYPES } from '../attendance/engine.js';
import { OPEN_STATUSES } from '../tasks/task-engine.js';

const ctx = () => /** @type {any} */ (currentContext());

/**
 * @param {{ work: any, tasks: any, timesheets: any, now?: () => Date }} deps
 */
export function createDashboardsService({ work, tasks, timesheets, now = () => new Date() }) {
  return {
    /** @param {{ departmentId?: string, status?: string }} q */
    async board(q) {
      const team = await work.teamStatus(q);
      const ids = team.data.map((/** @type {any} */ r) => r.employee.id);
      const today = /** @type {string} */ (dateToYmd(now()));
      const [open, timers] = await Promise.all([
        db().taskAssignment.findMany({
          where: {
            employeeId: { in: ids },
            unassignedAt: null,
            task: { deletedAt: null, status: { in: [...OPEN_STATUSES] } },
          },
          select: { employeeId: true, task: { select: { dueDate: true, status: true } } },
        }),
        db().taskTimeEntry.findMany({
          where: { employeeId: { in: ids }, endedAt: null },
          select: { employeeId: true, startedAt: true, task: { select: { id: true, title: true } } },
        }),
      ]);
      const data = team.data.map((/** @type {any} */ r) => {
        const mine = open.filter((a) => a.employeeId === r.employee.id);
        const timer = timers.find((x) => x.employeeId === r.employee.id);
        return {
          ...r,
          tasks: {
            open: mine.length,
            overdue: mine.filter(
              (a) => a.task.dueDate && /** @type {string} */ (dateToYmd(a.task.dueDate)) < today,
            ).length,
            underReview: mine.filter((a) => a.task.status === 'UNDER_REVIEW').length,
          },
          currentTask: timer ? { id: timer.task.id, title: timer.task.title, since: timer.startedAt } : null,
        };
      });
      const [wfh, corrections, reports, sheets, teamReviews, myReviews] = await Promise.all([
        work.listWfh({ view: 'approvals', status: 'PENDING' }),
        work.listCorrections({ view: 'approvals', status: 'PENDING' }),
        timesheets.listReports({ view: 'approvals', status: 'SUBMITTED' }),
        timesheets.listTimesheets({ view: 'approvals', status: 'SUBMITTED' }),
        tasks.listTasks({ view: 'team', status: 'UNDER_REVIEW' }),
        tasks.listTasks({ view: 'created', status: 'UNDER_REVIEW' }),
      ]);
      // Work waiting for the viewer's review, not their own work waiting for someone else.
      const myId = ctx().employeeId;
      const reviews = new Set(
        [...teamReviews, ...myReviews]
          .filter((/** @type {any} */ t) => !t.assignees.some((/** @type {any} */ a) => a.id === myId))
          .map((/** @type {any} */ t) => t.id),
      );
      return {
        asOf: team.asOf,
        counts: team.counts,
        data,
        waitingForYou: {
          wfhRequests: wfh.length,
          workCorrections: corrections.length,
          dailyReports: reports.length,
          timesheets: sheets.length,
          taskReviews: reviews.size,
        },
      };
    },

    /**
     * Company remote-work figures for a period (default: the last 7 days). Aggregates only.
     * @param {{ from?: string, to?: string }} q
     */
    async remoteWork(q) {
      const to = q.to ?? /** @type {string} */ (dateToYmd(now()));
      const from = q.from ?? /** @type {string} */ (addDays(to, -6));
      if (daysBetween(from, to) > 92)
        throw new ValidationError([{ path: 'query.to', message: 'Choose at most 93 days' }]);
      const range = { gte: ymdToDate(from), lte: ymdToDate(to) };
      const [headcount, active, sessions, pending] = await Promise.all([
        db().employee.count({ where: { deletedAt: null, status: { not: 'EXITED' } } }),
        db().employeeActiveSession.findMany({ include: { session: { include: { policy: true } } } }),
        db().workSession.findMany({
          where: { workDate: range, endedAt: { not: null } },
          select: {
            employeeId: true,
            workDate: true,
            workedSec: true,
            breakSec: true,
            disconnectedSec: true,
            status: true,
            needsReview: true,
            workLocation: { select: { type: true } },
          },
        }),
        Promise.all([
          db().wfhRequest.count({ where: { status: 'PENDING' } }),
          db().workCorrection.count({ where: { status: 'PENDING' } }),
          db().dailyWorkReport.count({ where: { status: 'SUBMITTED' } }),
          db().timesheetApproval.count({ where: { status: 'SUBMITTED' } }),
        ]),
      ]);
      const t = now();
      const nowCounts = { working: 0, onBreak: 0, disconnected: 0 };
      for (const a of active) {
        const s = a.session;
        const lost =
          s.status === 'DISCONNECTED' ||
          t.getTime() - (s.lastHeartbeatAt ?? s.startedAt).getTime() > s.policy.heartbeatTimeoutSec * 1000;
        if (s.status === 'ON_BREAK') nowCounts.onBreak++;
        else if (lost) nowCounts.disconnected++;
        else nowCounts.working++;
      }
      const days = Object.fromEntries(
        eachDay(from, to).map((d) => [
          d,
          { date: d, people: new Set(), remotePeople: new Set(), workedSec: 0, remoteSec: 0 },
        ]),
      );
      let worked = 0;
      let disconnected = 0;
      let remoteSec = 0;
      let autoClosed = 0;
      let needsReview = 0;
      const personDays = new Set();
      for (const s of sessions) {
        const d = days[/** @type {string} */ (dateToYmd(s.workDate))];
        const remote = REMOTE_LOCATION_TYPES.has(s.workLocation.type);
        d.people.add(s.employeeId);
        if (remote) d.remotePeople.add(s.employeeId);
        d.workedSec += s.workedSec;
        if (remote) d.remoteSec += s.workedSec;
        worked += s.workedSec;
        disconnected += s.disconnectedSec;
        if (remote) remoteSec += s.workedSec;
        if (s.status === 'AUTO_CLOSED') autoClosed++;
        if (s.needsReview) needsReview++;
        personDays.add(`${s.employeeId}:${d.date}`);
      }
      const share = (/** @type {number} */ a, /** @type {number} */ b) =>
        b ? Math.round((a / b) * 1000) / 10 : 0;
      return {
        from,
        to,
        headcount,
        now: nowCounts,
        period: {
          sessions: sessions.length,
          personDays: personDays.size,
          workedSec: worked,
          avgWorkedSecPerPersonDay: personDays.size ? Math.round(worked / personDays.size) : 0,
          remoteSharePct: share(remoteSec, worked),
          disconnectedSharePct: share(disconnected, worked + disconnected),
          autoClosedSessions: autoClosed,
          sessionsNeedingReview: needsReview,
        },
        daily: Object.values(days).map((d) => ({
          date: d.date,
          people: d.people.size,
          remotePeople: d.remotePeople.size,
          workedSec: d.workedSec,
          remoteSec: d.remoteSec,
        })),
        pending: {
          wfhRequests: pending[0],
          workCorrections: pending[1],
          dailyReports: pending[2],
          timesheets: pending[3],
        },
      };
    },
  };
}
