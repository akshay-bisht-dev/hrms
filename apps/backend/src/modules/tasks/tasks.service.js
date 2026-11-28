// @ts-check
/**
 * Projects, tasks, comments and task time (Sprint 9).
 *
 * Who sees a task: the people assigned, whoever created it, members and the owner of its project, their direct
 * managers, and holders of task.assign whose scope covers an assignee. Reviewers (creator, an assignee's manager,
 * task.assign in scope) cancel, reopen and approve; assignees move their own work forward (task-engine.js).
 * Task time is recorded with a timer that runs only inside a work session (not on a break), or entered by hand
 * for recent days; a submitted or approved timesheet locks its week.
 */
import { newId } from '@hrms/shared/ids';
import { audit } from '../../lib/audit.js';
import { currentContext } from '../../lib/context.js';
import { db } from '../../lib/db.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { addDays, dateToYmd, daysBetween, localYmd, ymdToDate, zonedTime } from '../../lib/time.js';
import { anyOf, employeeScope } from '../employees/scope.js';
import { assertWeekOpen } from '../timesheets/lock.js';
import { OPEN_STATUSES, allowedMoves, checkMove } from './task-engine.js';
import { refreshActual, stopRunningTimers } from './timers.js';

const ctx = () => /** @type {any} */ (currentContext());
const fullName = (/** @type {any} */ e) => [e.firstName, e.lastName].filter(Boolean).join(' ');
const MANUAL_WINDOW_DAYS = 14;
const PERSON = { select: { id: true, employeeCode: true, firstName: true, lastName: true } };
const person = (/** @type {any} */ e) => (e ? { id: e.id, code: e.employeeCode, name: fullName(e) } : null);

/** @param {any} p */
const projectDto = (p) => ({
  id: p.id,
  code: p.code,
  name: p.name,
  description: p.description,
  clientName: p.clientName,
  status: p.status,
  isBillable: p.isBillable,
  ownerEmployeeId: p.ownerEmployeeId,
  startDate: dateToYmd(p.startDate),
  endDate: dateToYmd(p.endDate),
  members: p.projectMembers?.map((/** @type {any} */ m) => ({ ...person(m.employee), role: m.role })),
  openTasks: p._count?.tasks,
});

/** @param {any} t */
const taskDto = (t) => ({
  id: t.id,
  title: t.title,
  description: t.description,
  project: t.project ? { id: t.project.id, code: t.project.code, name: t.project.name } : null,
  parentTaskId: t.parentTaskId,
  priority: t.priority,
  status: t.status,
  dueDate: dateToYmd(t.dueDate),
  estimateMin: t.estimateMin,
  actualMin: t.actualMin,
  progressPct: t.progressPct,
  requiresApproval: t.requiresApproval,
  createdByEmployeeId: t.createdByEmployeeId,
  approvedAt: t.approvedAt,
  completedAt: t.completedAt,
  createdAt: t.createdAt,
  assignees: (t.taskAssignments ?? [])
    .filter((/** @type {any} */ a) => !a.unassignedAt)
    .map((/** @type {any} */ a) => person(a.employee)),
});

const TASK_INCLUDE = {
  project: { select: { id: true, code: true, name: true } },
  taskAssignments: { where: { unassignedAt: null }, include: { employee: PERSON } },
};

/** @param {any} e */
const entryDto = (e) => ({
  id: e.id,
  taskId: e.taskId,
  task: e.task ? { id: e.task.id, title: e.task.title, project: e.task.project?.code ?? null } : undefined,
  sessionId: e.sessionId,
  startedAt: e.startedAt,
  endedAt: e.endedAt,
  durationSec: e.durationSec,
  source: e.source,
  note: e.note,
});

/** @param {{ mfaEnforce?: boolean, now?: () => Date }} [deps] */
export function createTasksService({ mfaEnforce = true, now = () => new Date() } = {}) {
  const holds = (/** @type {string} */ permission) => Boolean(ctx().permissions?.has(permission));
  void mfaEnforce;

  async function me() {
    const id = ctx().employeeId;
    const emp = id
      ? await db().employee.findUnique({
          where: { id },
          select: { id: true, timezone: true, managerId: true, status: true },
        })
      : null;
    if (!emp)
      throw new AppError(
        409,
        'no_employee_record',
        'Your sign-in is not linked to an employee record. Ask HR to link it.',
      );
    return emp;
  }

  /** People the caller may give work to: themselves, direct reports, and task.assign scope. @param {string[]} ids */
  async function assertCanAssign(ids) {
    const myId = ctx().employeeId;
    const others = ids.filter((id) => id !== myId);
    if (!others.length) return;
    /** @type {object[]} */
    const or = [{ managerId: myId }];
    if (holds('task.assign')) or.push(await employeeScope('task.assign'));
    const found = await db().employee.findMany({
      where: { AND: [{ id: { in: others }, deletedAt: null, status: { not: 'EXITED' } }, anyOf(or)] },
      select: { id: true },
    });
    if (found.length !== new Set(others).size)
      throw new ValidationError([
        {
          path: 'body.assigneeIds',
          message: 'You can assign work only to yourself, your team or people in your scope',
        },
      ]);
  }

  /** Where-clause for tasks the caller may see. */
  async function visibleTasks() {
    const myId = ctx().employeeId;
    /** @type {object[]} */
    const or = [];
    if (myId) {
      or.push({ taskAssignments: { some: { employeeId: myId, unassignedAt: null } } });
      or.push({ createdByEmployeeId: myId });
      or.push({ project: { projectMembers: { some: { employeeId: myId } } } });
      or.push({ project: { ownerEmployeeId: myId } });
      or.push({ taskAssignments: { some: { unassignedAt: null, employee: { managerId: myId } } } });
    }
    if (holds('task.assign')) {
      const scope = await employeeScope('task.assign');
      or.push(
        Object.keys(scope).length
          ? { taskAssignments: { some: { unassignedAt: null, employee: scope } } }
          : {},
      );
    }
    if (!or.length) return { id: '00000000-0000-0000-0000-000000000000' };
    return anyOf(or);
  }

  /** Is the caller a reviewer of this task (creator, an assignee's manager, or task.assign over an assignee)? @param {any} t */
  async function isReviewer(t) {
    const myId = ctx().employeeId;
    if (!myId) return false;
    if (t.createdByEmployeeId === myId) return true;
    const assigneeIds = t.taskAssignments
      .filter((/** @type {any} */ a) => !a.unassignedAt)
      .map((/** @type {any} */ a) => a.employeeId);
    if (!assigneeIds.length) return false;
    /** @type {object[]} */
    const or = [{ managerId: myId }];
    if (holds('task.assign')) or.push(await employeeScope('task.assign'));
    const n = await db().employee.count({
      where: {
        AND: [{ id: { in: assigneeIds.filter((/** @type {string} */ id) => id !== myId) } }, anyOf(or)],
      },
    });
    return n > 0;
  }

  /** @param {string} id */
  async function taskOr404(id) {
    const t = await db().task.findFirst({
      where: { AND: [{ id, deletedAt: null }, await visibleTasks()] },
      include: TASK_INCLUDE,
    });
    if (!t) throw new NotFoundError();
    return t;
  }

  /** @param {any} t */
  async function actorFor(t) {
    const myId = ctx().employeeId;
    return {
      isAssignee: t.taskAssignments.some((/** @type {any} */ a) => a.employeeId === myId && !a.unassignedAt),
      isReviewer: await isReviewer(t),
    };
  }

  /** May the caller change this project (project.manage, or its owner)? @param {any} p */
  const canManageProject = (p) =>
    holds('project.manage') || (p.ownerEmployeeId && p.ownerEmployeeId === ctx().employeeId);

  /** Day boundaries of `ymd` in a time zone. @param {string} ymd @param {string} tz */
  const dayRange = (ymd, tz) => ({
    gte: zonedTime(ymd, 0, tz),
    lt: zonedTime(/** @type {string} */ (addDays(ymd, 1)), 0, tz),
  });

  const service = {
    // ── Projects ──
    async listProjects() {
      const myId = ctx().employeeId;
      const where = holds('project.manage')
        ? { deletedAt: null }
        : {
            deletedAt: null,
            OR: [{ ownerEmployeeId: myId ?? '-' }, { projectMembers: { some: { employeeId: myId ?? '-' } } }],
          };
      const rows = await db().project.findMany({
        where,
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        include: {
          projectMembers: { include: { employee: PERSON } },
          _count: { select: { tasks: { where: { deletedAt: null, status: { in: [...OPEN_STATUSES] } } } } },
        },
        take: 500,
      });
      return rows.map(projectDto);
    },

    /** @param {any} b ProjectBody */
    async createProject(b) {
      if (!holds('project.manage')) throw new ForbiddenError();
      if (b.ownerEmployeeId && !(await db().employee.findUnique({ where: { id: b.ownerEmployeeId } })))
        throw new ValidationError([{ path: 'body.ownerEmployeeId', message: 'Not found in this company' }]);
      try {
        const row = await db().project.create({
          data: {
            id: newId(),
            ...b,
            code: b.code.toUpperCase(),
            startDate: b.startDate ? ymdToDate(b.startDate) : null,
            endDate: b.endDate ? ymdToDate(b.endDate) : null,
          },
        });
        if (b.ownerEmployeeId)
          await db().projectMember.create({
            data: { projectId: row.id, employeeId: b.ownerEmployeeId, role: 'LEAD' },
          });
        await audit(db(), {
          action: 'project.created',
          entityType: 'Project',
          entityId: row.id,
          changes: { code: row.code },
        });
        return projectDto(row);
      } catch (err) {
        if (/** @type {any} */ (err)?.code === 'P2002')
          throw new ConflictError('project_code_exists', 'A project with this code already exists');
        throw err;
      }
    },

    /** @param {string} id @param {any} b ProjectPatch */
    async updateProject(id, b) {
      const p = await db().project.findFirst({ where: { id, deletedAt: null } });
      if (!p) throw new NotFoundError();
      if (!canManageProject(p)) throw new NotFoundError();
      if (b.ownerEmployeeId && !(await db().employee.findUnique({ where: { id: b.ownerEmployeeId } })))
        throw new ValidationError([{ path: 'body.ownerEmployeeId', message: 'Not found in this company' }]);
      const data = { ...b };
      if (b.code) data.code = b.code.toUpperCase();
      if (b.startDate !== undefined) data.startDate = b.startDate ? ymdToDate(b.startDate) : null;
      if (b.endDate !== undefined) data.endDate = b.endDate ? ymdToDate(b.endDate) : null;
      try {
        const row = await db().project.update({ where: { id }, data });
        await audit(db(), {
          action: 'project.updated',
          entityType: 'Project',
          entityId: id,
          changes: { fields: Object.keys(b) },
        });
        return projectDto(row);
      } catch (err) {
        if (/** @type {any} */ (err)?.code === 'P2002')
          throw new ConflictError('project_code_exists', 'A project with this code already exists');
        throw err;
      }
    },

    /** @param {string} id @param {{ employeeIds: string[], role: string }} b */
    async addMembers(id, b) {
      const p = await db().project.findFirst({ where: { id, deletedAt: null } });
      if (!p || !canManageProject(p)) throw new NotFoundError();
      const found = await db().employee.findMany({
        where: { id: { in: b.employeeIds }, deletedAt: null },
        select: { id: true },
      });
      if (found.length !== new Set(b.employeeIds).size)
        throw new ValidationError([
          { path: 'body.employeeIds', message: 'Some people were not found in this company' },
        ]);
      await db().projectMember.createMany({
        data: b.employeeIds.map((employeeId) => ({ projectId: id, employeeId, role: b.role })),
        skipDuplicates: true,
      });
      await audit(db(), {
        action: 'project.members_added',
        entityType: 'Project',
        entityId: id,
        changes: { count: b.employeeIds.length },
      });
      return projectDto(
        await db().project.findUnique({
          where: { id },
          include: { projectMembers: { include: { employee: PERSON } } },
        }),
      );
    },

    /** @param {string} id @param {string} employeeId */
    async removeMember(id, employeeId) {
      const p = await db().project.findFirst({ where: { id, deletedAt: null } });
      if (!p || !canManageProject(p)) throw new NotFoundError();
      await db().projectMember.deleteMany({ where: { projectId: id, employeeId } });
      await audit(db(), {
        action: 'project.member_removed',
        entityType: 'Project',
        entityId: id,
        changes: { employeeId },
      });
    },

    // ── Tasks ──

    /** @param {{ view: string, projectId?: string, status?: string, open?: string, q?: string }} q */
    async listTasks(q) {
      const myId = ctx().employeeId;
      /** @type {any[]} */
      const and = [{ deletedAt: null }, await visibleTasks()];
      if (q.view === 'mine')
        and.push({ taskAssignments: { some: { employeeId: myId ?? '-', unassignedAt: null } } });
      if (q.view === 'created') and.push({ createdByEmployeeId: myId ?? '-' });
      if (q.view === 'team') {
        /** @type {object[]} */
        const or = [{ managerId: myId ?? '-' }];
        if (holds('task.assign')) or.push(await employeeScope('task.assign'));
        and.push({
          taskAssignments: {
            some: { unassignedAt: null, employee: { AND: [anyOf(or), { id: { not: myId ?? '-' } }] } },
          },
        });
      }
      if (q.projectId) and.push({ projectId: q.projectId });
      if (q.status) and.push({ status: q.status });
      if (q.open === 'true') and.push({ status: { in: [...OPEN_STATUSES] } });
      if (q.open === 'false') and.push({ status: { notIn: [...OPEN_STATUSES] } });
      if (q.q) and.push({ title: { contains: q.q } });
      const rows = await db().task.findMany({
        where: { AND: and },
        include: TASK_INCLUDE,
        orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: 300,
      });
      const running = myId
        ? await db().taskTimeEntry.findFirst({
            where: { employeeId: myId, endedAt: null },
            select: { taskId: true },
          })
        : null;
      return rows.map((t) => ({ ...taskDto(t), timerRunning: running?.taskId === t.id }));
    },

    /** @param {string} id */
    async getTask(id) {
      const t = await taskOr404(id);
      const actor = await actorFor(t);
      const [comments, subtasks] = await Promise.all([
        db().taskComment.findMany({
          where: { taskId: id, deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: { author: PERSON },
          take: 500,
        }),
        db().task.findMany({ where: { parentTaskId: id, deletedAt: null }, include: TASK_INCLUDE }),
      ]);
      return {
        ...taskDto(t),
        you: { ...actor, allowedMoves: allowedMoves(/** @type {any} */ (t), actor) },
        comments: comments.map((c) => ({
          id: c.id,
          body: c.body,
          author: person(c.author),
          createdAt: c.createdAt,
        })),
        subtasks: subtasks.map(taskDto),
      };
    },

    /** @param {any} b TaskBody */
    async createTask(b) {
      const emp = await me();
      const assigneeIds = [...new Set(b.assigneeIds.length ? b.assigneeIds : [emp.id])];
      await assertCanAssign(assigneeIds);
      if (b.projectId) {
        const p = await db().project.findFirst({
          where: { id: b.projectId, deletedAt: null },
          include: { projectMembers: { select: { employeeId: true } } },
        });
        if (!p) throw new ValidationError([{ path: 'body.projectId', message: 'Not found in this company' }]);
        if (['COMPLETED', 'ARCHIVED'].includes(p.status))
          throw new ConflictError('project_closed', 'This project is closed to new tasks');
        const member = p.ownerEmployeeId === emp.id || p.projectMembers.some((m) => m.employeeId === emp.id);
        if (!member && !holds('project.manage'))
          throw new ValidationError([
            { path: 'body.projectId', message: 'Join the project before adding tasks to it' },
          ]);
      }
      if (b.parentTaskId) {
        const parent = await taskOr404(b.parentTaskId).catch(() => null);
        if (!parent) throw new ValidationError([{ path: 'body.parentTaskId', message: 'Not found' }]);
        if ((parent.projectId ?? null) !== (b.projectId ?? null))
          throw new ValidationError([
            { path: 'body.parentTaskId', message: 'A subtask belongs to the same project' },
          ]);
      }
      const id = newId();
      await db().$transaction(async (/** @type {any} */ tx) => {
        await tx.task.create({
          data: {
            id,
            title: b.title,
            description: b.description ?? null,
            projectId: b.projectId ?? null,
            parentTaskId: b.parentTaskId ?? null,
            priority: b.priority,
            dueDate: b.dueDate ? ymdToDate(b.dueDate) : null,
            estimateMin: b.estimateMin ?? null,
            requiresApproval: b.requiresApproval,
            createdByEmployeeId: emp.id,
          },
        });
        await tx.taskAssignment.createMany({
          data: assigneeIds.map((employeeId) => ({
            id: newId(),
            taskId: id,
            employeeId,
            assignedBy: emp.id,
          })),
        });
        await audit(tx, {
          action: 'task.created',
          entityType: 'Task',
          entityId: id,
          changes: { assignees: assigneeIds.length },
        });
      });
      return service.getTask(id);
    },

    /** @param {string} id @param {any} b TaskPatch */
    async updateTask(id, b) {
      const t = await taskOr404(id);
      const actor = await actorFor(t);
      const onlyProgress = Object.keys(b).every((k) => k === 'progressPct');
      if (!actor.isReviewer && !(onlyProgress && actor.isAssignee))
        throw new ForbiddenError(
          'not_reviewer',
          'Only the person who set the task, or a manager, can change it',
        );
      if (['COMPLETED', 'CANCELLED'].includes(t.status) && !onlyProgress)
        throw new ConflictError('task_closed', 'Reopen the task before changing it');
      const data = { ...b };
      if (b.dueDate !== undefined) data.dueDate = b.dueDate ? ymdToDate(b.dueDate) : null;
      await db().task.update({ where: { id }, data });
      await audit(db(), {
        action: 'task.updated',
        entityType: 'Task',
        entityId: id,
        changes: { fields: Object.keys(b) },
      });
      return service.getTask(id);
    },

    /** Replaces who works on the task (reviewers only). @param {string} id @param {{ assigneeIds: string[] }} b */
    async setAssignees(id, b) {
      const t = await taskOr404(id);
      if (!(await isReviewer(t)))
        throw new ForbiddenError(
          'not_reviewer',
          'Only the person who set the task, or a manager, can reassign it',
        );
      const ids = [...new Set(b.assigneeIds)];
      await assertCanAssign(ids);
      const t0 = now();
      await db().$transaction(async (/** @type {any} */ tx) => {
        const current = await tx.taskAssignment.findMany({ where: { taskId: id } });
        for (const a of current) {
          const keep = ids.includes(a.employeeId);
          if (keep && a.unassignedAt)
            await tx.taskAssignment.update({
              where: { id: a.id },
              data: { unassignedAt: null, assignedAt: t0, assignedBy: ctx().employeeId },
            });
          if (!keep && !a.unassignedAt) {
            await tx.taskAssignment.update({ where: { id: a.id }, data: { unassignedAt: t0 } });
            const running = await tx.taskTimeEntry.findFirst({
              where: { taskId: id, employeeId: a.employeeId, endedAt: null },
            });
            if (running) await stopRunningTimers(tx, a.employeeId, t0);
          }
        }
        const fresh = ids.filter((e) => !current.some((a) => a.employeeId === e));
        if (fresh.length)
          await tx.taskAssignment.createMany({
            data: fresh.map((employeeId) => ({
              id: newId(),
              taskId: id,
              employeeId,
              assignedBy: ctx().employeeId,
            })),
          });
        await audit(tx, {
          action: 'task.reassigned',
          entityType: 'Task',
          entityId: id,
          changes: { assignees: ids.length },
        });
      });
      return service.getTask(id);
    },

    /** @param {string} id @param {{ status: string, comment?: string }} b */
    async changeStatus(id, b) {
      const t = await taskOr404(id);
      const actor = await actorFor(t);
      const check = checkMove(/** @type {any} */ (t), /** @type {any} */ (b.status), actor);
      if (!check.ok) throw new ConflictError(check.code, check.message);
      const t0 = now();
      await db().$transaction(async (/** @type {any} */ tx) => {
        const n = await tx.task.updateMany({
          where: { id, status: t.status },
          data: {
            status: b.status,
            completedAt: b.status === 'COMPLETED' ? t0 : null,
            ...(t.status === 'UNDER_REVIEW' && b.status === 'COMPLETED'
              ? { approvedBy: ctx().userId, approvedAt: t0 }
              : {}),
            ...(b.status === 'COMPLETED' ? { progressPct: 100 } : {}),
          },
        });
        if (!n.count) throw new ConflictError('task_changed', 'This task changed. Reload and try again.');
        // A timer only runs on work in progress.
        if (b.status !== 'IN_PROGRESS') {
          const runners = await tx.taskTimeEntry.findMany({
            where: { taskId: id, endedAt: null },
            select: { employeeId: true },
          });
          for (const r of runners) await stopRunningTimers(tx, r.employeeId, t0);
        }
        if (b.comment)
          await tx.taskComment.create({
            data: { id: newId(), taskId: id, authorEmployeeId: ctx().employeeId, body: b.comment },
          });
        await audit(tx, {
          action: 'task.status_changed',
          entityType: 'Task',
          entityId: id,
          changes: { from: t.status, to: b.status },
        });
      });
      return service.getTask(id);
    },

    /** Soft delete; a task with recorded time is cancelled instead. @param {string} id */
    async deleteTask(id) {
      const t = await taskOr404(id);
      if (!(await isReviewer(t)))
        throw new ForbiddenError(
          'not_reviewer',
          'Only the person who set the task, or a manager, can delete it',
        );
      if (await db().taskTimeEntry.count({ where: { taskId: id } }))
        throw new ConflictError('task_has_time', 'Time was recorded on this task. Cancel it instead.');
      await db().task.update({ where: { id }, data: { deletedAt: now() } });
      await audit(db(), { action: 'task.deleted', entityType: 'Task', entityId: id });
    },

    /** @param {string} id @param {{ body: string }} b */
    async addComment(id, b) {
      await taskOr404(id);
      const emp = await me();
      const c = await db().taskComment.create({
        data: { id: newId(), taskId: id, authorEmployeeId: emp.id, body: b.body },
        include: { author: PERSON },
      });
      return { id: c.id, body: c.body, author: person(c.author), createdAt: c.createdAt };
    },

    // ── Task time ──

    /** The running timer of the caller, if any. */
    async currentTimer() {
      const myId = ctx().employeeId;
      if (!myId) return null;
      const e = await db().taskTimeEntry.findFirst({
        where: { employeeId: myId, endedAt: null },
        include: { task: { include: { project: { select: { code: true } } } } },
      });
      return e ? entryDto(e) : null;
    },

    /**
     * Starts a timer on a task: only for an assignee, only inside a running work session and not on a break.
     * Any other running timer of the caller stops at the same moment.
     * @param {string} id
     */
    async startTimer(id) {
      const t = await taskOr404(id);
      const emp = await me();
      if (!t.taskAssignments.some((a) => a.employeeId === emp.id))
        throw new ForbiddenError('not_assignee', 'You can record time only on tasks assigned to you');
      if (!['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'].includes(t.status))
        throw new ConflictError('task_not_open', 'This task is not open for work');
      const active = await db().employeeActiveSession.findUnique({
        where: { tenantId_employeeId: { tenantId: ctx().tenantId, employeeId: emp.id } },
        include: { session: true },
      });
      if (!active) throw new ConflictError('no_active_session', 'Start a work session first');
      if (active.session.status === 'ON_BREAK') throw new ConflictError('on_break', 'End your break first');
      await assertWeekOpen(emp.id, /** @type {string} */ (dateToYmd(active.session.workDate)));
      const t0 = now();
      await db().$transaction(async (/** @type {any} */ tx) => {
        // One timer per person: the session's lock row serialises concurrent starts.
        await tx.$queryRaw`SELECT employee_id FROM employee_active_sessions WHERE tenant_id = ${ctx().tenantId} AND employee_id = ${emp.id} FOR UPDATE`;
        await stopRunningTimers(tx, emp.id, t0);
        await tx.taskTimeEntry.create({
          data: {
            id: newId(),
            taskId: id,
            employeeId: emp.id,
            sessionId: active.sessionId,
            startedAt: t0,
            source: 'TIMER',
          },
        });
        if (t.status !== 'IN_PROGRESS')
          await tx.task.update({ where: { id }, data: { status: 'IN_PROGRESS' } });
      });
      return service.currentTimer();
    },

    async stopTimer() {
      const emp = await me();
      const stopped = await db().$transaction((/** @type {any} */ tx) =>
        stopRunningTimers(tx, emp.id, now()),
      );
      if (!stopped.length) throw new ConflictError('no_timer', 'No timer is running');
      return { stopped: stopped.length };
    },

    /** Time entered by hand for a recent day. @param {any} b ManualTimeBody */
    async addManualTime(b) {
      const emp = await me();
      const today = localYmd(now(), emp.timezone);
      if (b.date > today)
        throw new ValidationError([{ path: 'body.date', message: 'Must not be in the future' }]);
      if (daysBetween(b.date, today) > MANUAL_WINDOW_DAYS)
        throw new ValidationError([
          { path: 'body.date', message: `Add time for the last ${MANUAL_WINDOW_DAYS} days only` },
        ]);
      const t = await taskOr404(b.taskId);
      if (!t.taskAssignments.some((a) => a.employeeId === emp.id))
        throw new ForbiddenError('not_assignee', 'You can record time only on tasks assigned to you');
      if (t.status === 'CANCELLED') throw new ConflictError('task_not_open', 'This task was cancelled');
      await assertWeekOpen(emp.id, b.date);
      // Recorded at noon local time so the entry always falls on the chosen day.
      const startedAt = zonedTime(b.date, 12 * 60, emp.timezone);
      const e = await db().$transaction(async (/** @type {any} */ tx) => {
        const row = await tx.taskTimeEntry.create({
          data: {
            id: newId(),
            taskId: t.id,
            employeeId: emp.id,
            startedAt,
            endedAt: new Date(startedAt.getTime() + b.minutes * 60_000),
            durationSec: b.minutes * 60,
            source: 'MANUAL',
            note: b.note ?? null,
          },
        });
        await refreshActual(tx, t.id);
        await audit(tx, {
          action: 'task.time_added',
          entityType: 'Task',
          entityId: t.id,
          changes: { minutes: b.minutes, date: b.date },
        });
        return row;
      });
      return entryDto(e);
    },

    /** Removes your own hand-entered time (timer entries are kept). @param {string} id */
    async deleteTimeEntry(id) {
      const e = await db().taskTimeEntry.findUnique({ where: { id } });
      if (!e || e.employeeId !== ctx().employeeId) throw new NotFoundError();
      const emp = await me();
      if (e.source !== 'MANUAL')
        throw new ConflictError('not_manual', 'Only time you entered by hand can be removed');
      await assertWeekOpen(emp.id, localYmd(e.startedAt, emp.timezone));
      await db().$transaction(async (/** @type {any} */ tx) => {
        await tx.taskTimeEntry.delete({ where: { id } });
        await refreshActual(tx, e.taskId);
        await audit(tx, {
          action: 'task.time_removed',
          entityType: 'Task',
          entityId: e.taskId,
          changes: { minutes: Math.round((e.durationSec ?? 0) / 60) },
        });
      });
    },

    /** Your time entries between two dates (your time zone). @param {{ from: string, to: string }} q */
    async myTimeEntries(q) {
      const emp = await me();
      if (daysBetween(q.from, q.to) > 62)
        throw new ValidationError([{ path: 'query.to', message: 'Choose at most 63 days' }]);
      const rows = await db().taskTimeEntry.findMany({
        where: {
          employeeId: emp.id,
          startedAt: { gte: dayRange(q.from, emp.timezone).gte, lt: dayRange(q.to, emp.timezone).lt },
        },
        include: { task: { include: { project: { select: { code: true } } } } },
        orderBy: { startedAt: 'desc' },
      });
      return rows.map(entryDto);
    },
  };
  return service;
}
