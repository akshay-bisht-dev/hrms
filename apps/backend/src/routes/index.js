// @ts-check
import { Router } from 'express';
import { assertRoutesDeclared } from '../lib/route-registry.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { referenceRouter } from '../modules/reference/reference.routes.js';
import { companyRouter } from '../modules/company/company.routes.js';
import { membersRouter } from '../modules/members/members.routes.js';
import { employeesRouter } from '../modules/employees/employees.routes.js';
import { attendanceRouter } from '../modules/attendance/attendance.routes.js';

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
  assertRoutesDeclared(router);
  return router;
}
