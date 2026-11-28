// @ts-check
import { Router } from 'express';
import { assertRoutesDeclared } from '../lib/route-registry.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { referenceRouter } from '../modules/reference/reference.routes.js';
import { companyRouter } from '../modules/company/company.routes.js';
import { membersRouter } from '../modules/members/members.routes.js';
import { employeesRouter } from '../modules/employees/employees.routes.js';
import { attendanceRouter } from '../modules/attendance/attendance.routes.js';
import { leaveRouter } from '../modules/leave/leave.routes.js';
import { payrollRouter } from '../modules/payroll/payroll.routes.js';
import { workRouter } from '../modules/work/work.routes.js';
import { projectsRouter, tasksRouter } from '../modules/tasks/tasks.routes.js';
import {
  dashboardsRouter,
  timesheetsRouter,
  workReportsRouter,
} from '../modules/timesheets/timesheets.routes.js';
import {
  agentRouter,
  devicesRouter,
  monitoringRouter,
  screenshotsRouter,
} from '../modules/monitoring/monitoring.routes.js';

/**
 * Mounts all /api/v1 module routers. Every route must declare its access ('public', 'authenticated' or a
 * permission); assertRoutesDeclared() throws at startup otherwise (Phase 3, RBAC-01).
 * @param {object} [services] omitted in tests that only exercise the HTTP shell
 * @param {Parameters<typeof authRouter>[0]} [services.authRoutes]
 * @param {Parameters<typeof referenceRouter>[0]} [services.referenceRoutes]
 * @param {Parameters<typeof companyRouter>[0]} [services.companyRoutes]
 * @param {Parameters<typeof membersRouter>[0]} [services.membersRoutes]
 * @param {Parameters<typeof employeesRouter>[0]} [services.employeesRoutes]
 * @param {Parameters<typeof attendanceRouter>[0]} [services.attendanceRoutes]
 * @param {Parameters<typeof leaveRouter>[0]} [services.leaveRoutes]
 * @param {Parameters<typeof payrollRouter>[0]} [services.payrollRoutes]
 * @param {Parameters<typeof workRouter>[0]} [services.workRoutes]
 * @param {Parameters<typeof projectsRouter>[0]} [services.projectsRoutes]
 * @param {Parameters<typeof tasksRouter>[0]} [services.tasksRoutes]
 * @param {Parameters<typeof workReportsRouter>[0]} [services.workReportsRoutes]
 * @param {Parameters<typeof timesheetsRouter>[0]} [services.timesheetsRoutes]
 * @param {Parameters<typeof dashboardsRouter>[0]} [services.dashboardsRoutes]
 * @param {Parameters<typeof monitoringRouter>[0]} [services.monitoringRoutes]
 * @param {Parameters<typeof devicesRouter>[0]} [services.devicesRoutes]
 * @param {Parameters<typeof agentRouter>[0]} [services.agentRoutes]
 * @param {Parameters<typeof screenshotsRouter>[0]} [services.screenshotsRoutes]
 * @returns {import('express').Router}
 */
export function apiRouter(services) {
  const router = Router();
  if (services?.authRoutes) {
    const auth = authRouter(services.authRoutes);
    /** @type {any} */ (auth).__mountpath = '/auth';
    router.use('/auth', auth);
  }
  if (services?.referenceRoutes) {
    const ref = referenceRouter(services.referenceRoutes);
    /** @type {any} */ (ref).__mountpath = '/reference';
    router.use('/reference', ref);
  }
  if (services?.companyRoutes) {
    const company = companyRouter(services.companyRoutes);
    /** @type {any} */ (company).__mountpath = '/companies';
    router.use('/companies', company);
  }
  if (services?.membersRoutes) {
    const members = membersRouter(services.membersRoutes);
    /** @type {any} */ (members).__mountpath = '/tenants';
    router.use('/tenants', members);
  }
  if (services?.employeesRoutes) {
    const employees = employeesRouter(services.employeesRoutes);
    /** @type {any} */ (employees).__mountpath = '/employees';
    router.use('/employees', employees);
  }
  if (services?.attendanceRoutes) {
    const attendance = attendanceRouter(services.attendanceRoutes);
    /** @type {any} */ (attendance).__mountpath = '/attendance';
    router.use('/attendance', attendance);
  }
  if (services?.leaveRoutes) {
    const leave = leaveRouter(services.leaveRoutes);
    /** @type {any} */ (leave).__mountpath = '/leaves';
    router.use('/leaves', leave);
  }
  if (services?.payrollRoutes) {
    const payroll = payrollRouter(services.payrollRoutes);
    /** @type {any} */ (payroll).__mountpath = '/payroll';
    router.use('/payroll', payroll);
  }
  if (services?.workRoutes) {
    const work = workRouter(services.workRoutes);
    /** @type {any} */ (work).__mountpath = '/work';
    router.use('/work', work);
  }
  if (services?.projectsRoutes) {
    const r = projectsRouter(services.projectsRoutes);
    /** @type {any} */ (r).__mountpath = '/projects';
    router.use('/projects', r);
  }
  if (services?.tasksRoutes) {
    const r = tasksRouter(services.tasksRoutes);
    /** @type {any} */ (r).__mountpath = '/tasks';
    router.use('/tasks', r);
  }
  if (services?.workReportsRoutes) {
    const r = workReportsRouter(services.workReportsRoutes);
    /** @type {any} */ (r).__mountpath = '/work-reports';
    router.use('/work-reports', r);
  }
  if (services?.timesheetsRoutes) {
    const r = timesheetsRouter(services.timesheetsRoutes);
    /** @type {any} */ (r).__mountpath = '/timesheets';
    router.use('/timesheets', r);
  }
  if (services?.dashboardsRoutes) {
    const r = dashboardsRouter(services.dashboardsRoutes);
    /** @type {any} */ (r).__mountpath = '/dashboards';
    router.use('/dashboards', r);
  }
  if (services?.monitoringRoutes) {
    const r = monitoringRouter(services.monitoringRoutes);
    /** @type {any} */ (r).__mountpath = '/monitoring';
    router.use('/monitoring', r);
  }
  if (services?.devicesRoutes) {
    const r = devicesRouter(services.devicesRoutes);
    /** @type {any} */ (r).__mountpath = '/devices';
    router.use('/devices', r);
  }
  if (services?.agentRoutes) {
    const r = agentRouter(services.agentRoutes);
    /** @type {any} */ (r).__mountpath = '/agent';
    router.use('/agent', r);
  }
  if (services?.screenshotsRoutes) {
    const r = screenshotsRouter(services.screenshotsRoutes);
    /** @type {any} */ (r).__mountpath = '/screenshots';
    router.use('/screenshots', r);
  }
  assertRoutesDeclared(router);
  return router;
}
