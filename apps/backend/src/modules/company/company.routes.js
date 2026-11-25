// @ts-check
import { Router } from 'express';
import {
  BranchBody,
  CompanyProfileBody,
  DepartmentBody,
  DesignationBody,
  HolidayBody,
  HolidayCalendarBody,
  LegalEntityBody,
  TeamBody,
  WorkScheduleBody,
  WorkSchedulePatch,
  partial,
} from '@hrms/shared/schemas/org';
import { newId } from '@hrms/shared/ids';
import { z } from 'zod';
import { audit } from '../../lib/audit.js';
import { currentContext } from '../../lib/context.js';
import { crudRoutes, withoutTenant } from '../../lib/crud.js';
import { db, platformDb } from '../../lib/db.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { validate } from '../../middleware/validate.js';
import { registry } from '../../openapi/registry.js';

const BASE = '/api/v1/companies';
const tenantId = () => /** @type {string} */ (currentContext()?.tenantId);

/** A department's parent must not be itself or one of its descendants. @param {string} id @param {string | null | undefined} parentId */
export async function assertNoDepartmentCycle(id, parentId) {
  let cursor = parentId;
  for (let depth = 0; cursor; depth++) {
    if (cursor === id || depth > 50)
      throw new ValidationError([
        {
          path: 'body.parentId',
          message: 'A department cannot sit under itself or one of its sub-departments',
        },
      ]);
    const parent = await db().department.findUnique({ where: { id: cursor }, select: { parentId: true } });
    cursor = parent?.parentId ?? null;
  }
}

/** Turns a validated YYYY-MM-DD string into a UTC midnight Date for DATE columns. @param {string} d */
const asDate = (d) => new Date(`${d}T00:00:00.000Z`);

/**
 * Company profile, legal entities, branches, departments, designations, teams, work schedules and holiday calendars.
 * Reading org structure needs a signed-in member; changing it needs company.org.manage (profile/entities: company.profile.manage).
 * @param {{ access: ReturnType<typeof import('../../middleware/auth.js').access> }} deps
 */
export function companyRouter({ access }) {
  const r = Router();
  const read = access.authenticated();
  const manageOrg = access.permission('company.org.manage');
  const manageProfile = access.permission('company.profile.manage');

  // ── Company profile (the tenant row itself) ──
  registry.registerPath({
    method: 'get',
    path: `${BASE}/current`,
    tags: ['Company'],
    summary: 'Current company profile',
    responses: { 200: { description: 'OK' } },
  });
  registry.registerPath({
    method: 'patch',
    path: `${BASE}/current`,
    tags: ['Company'],
    summary: 'Update company name, time zone or locale',
    request: { body: { content: { 'application/json': { schema: CompanyProfileBody } } } },
    responses: { 200: { description: 'OK' } },
  });
  const profile = (t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status,
    countryCode: t.countryCode,
    defaultCurrency: t.defaultCurrency,
    defaultLocale: t.defaultLocale,
    timezone: t.timezone,
    trialEndsAt: t.trialEndsAt,
    region: t.region,
  });
  r.get('/current', read, async (_req, res) => {
    const t = await platformDb().tenant.findUnique({ where: { id: tenantId() } });
    res.json(profile(t));
  });
  r.patch('/current', manageProfile, validate({ body: CompanyProfileBody }), async (req, res) => {
    const t = await platformDb().tenant.update({ where: { id: tenantId() }, data: req.body });
    await audit(db(), { action: 'tenant.updated', entityType: 'Tenant', entityId: t.id, changes: req.body });
    res.json(profile(t));
  });

  // ── Org resources ──
  const common = { tag: 'Company', basePath: BASE, readAccess: read };
  crudRoutes(r, {
    ...common,
    path: '/legal-entities',
    model: 'legalEntity',
    entityType: 'LegalEntity',
    createSchema: LegalEntityBody,
    updateSchema: partial(LegalEntityBody),
    writeAccess: manageProfile,
    searchFields: ['name'],
  });
  crudRoutes(r, {
    ...common,
    path: '/branches',
    model: 'branch',
    entityType: 'Branch',
    createSchema: BranchBody,
    updateSchema: partial(BranchBody),
    writeAccess: manageOrg,
    searchFields: ['name', 'code'],
  });
  crudRoutes(r, {
    ...common,
    path: '/departments',
    model: 'department',
    entityType: 'Department',
    createSchema: DepartmentBody,
    updateSchema: partial(DepartmentBody),
    writeAccess: manageOrg,
    searchFields: ['name', 'code'],
    beforeUpdate: async (body, { id }) => {
      if (body.parentId !== undefined) await assertNoDepartmentCycle(id, body.parentId);
    },
  });
  crudRoutes(r, {
    ...common,
    path: '/designations',
    model: 'designation',
    entityType: 'Designation',
    createSchema: DesignationBody,
    updateSchema: partial(DesignationBody),
    writeAccess: manageOrg,
    searchFields: ['title'],
  });
  crudRoutes(r, {
    ...common,
    path: '/teams',
    model: 'team',
    entityType: 'Team',
    createSchema: TeamBody,
    updateSchema: partial(TeamBody),
    writeAccess: manageOrg,
    searchFields: ['name'],
  });
  crudRoutes(r, {
    ...common,
    path: '/work-schedules',
    model: 'workSchedule',
    entityType: 'WorkSchedule',
    createSchema: WorkScheduleBody,
    updateSchema: WorkSchedulePatch,
    writeAccess: manageOrg,
    searchFields: ['name'],
  });
  crudRoutes(r, {
    ...common,
    path: '/holiday-calendars',
    model: 'holidayCalendar',
    entityType: 'HolidayCalendar',
    createSchema: HolidayCalendarBody,
    updateSchema: partial(HolidayCalendarBody),
    writeAccess: manageOrg,
    searchFields: ['name'],
    orderBy: { year: 'desc' },
  });

  // ── Holidays inside a calendar ──
  const CalParams = z.object({ calendarId: z.uuid() }).strict();
  const HolParams = z.object({ calendarId: z.uuid(), id: z.uuid() }).strict();
  registry.registerPath({
    method: 'get',
    path: `${BASE}/holiday-calendars/{calendarId}/holidays`,
    tags: ['Company'],
    summary: 'Holidays in a calendar',
    request: { params: CalParams },
    responses: { 200: { description: 'OK' } },
  });
  registry.registerPath({
    method: 'post',
    path: `${BASE}/holiday-calendars/{calendarId}/holidays`,
    tags: ['Company'],
    summary: 'Add a holiday (date must fall in the calendar year)',
    request: { params: CalParams, body: { content: { 'application/json': { schema: HolidayBody } } } },
    responses: { 201: { description: 'Created' } },
  });
  registry.registerPath({
    method: 'delete',
    path: `${BASE}/holiday-calendars/{calendarId}/holidays/{id}`,
    tags: ['Company'],
    summary: 'Remove a holiday',
    request: { params: HolParams },
    responses: { 204: { description: 'Deleted' } },
  });

  const calendarOr404 = async (calendarId) => {
    const cal = await db().holidayCalendar.findUnique({ where: { id: calendarId } });
    if (!cal) throw new NotFoundError();
    return cal;
  };
  const holidayDto = (h) => ({ ...withoutTenant(h), date: h.date.toISOString().slice(0, 10) });
  r.get(
    '/holiday-calendars/:calendarId/holidays',
    read,
    validate({ params: CalParams }),
    async (req, res) => {
      await calendarOr404(req.params.calendarId);
      const rows = await db().holiday.findMany({
        where: { calendarId: req.params.calendarId },
        orderBy: { date: 'asc' },
      });
      res.json({ data: rows.map(holidayDto) });
    },
  );
  r.post(
    '/holiday-calendars/:calendarId/holidays',
    manageOrg,
    validate({ params: CalParams, body: HolidayBody }),
    async (req, res) => {
      const cal = await calendarOr404(req.params.calendarId);
      if (Number(req.body.date.slice(0, 4)) !== cal.year)
        throw new ValidationError([{ path: 'body.date', message: `The date must be in ${cal.year}` }]);
      const id = newId();
      const row = await db().holiday.create({
        data: {
          id,
          calendarId: cal.id,
          date: asDate(req.body.date),
          name: req.body.name,
          isOptional: req.body.isOptional,
        },
      });
      await audit(db(), {
        action: 'holiday.created',
        entityType: 'Holiday',
        entityId: id,
        changes: req.body,
      });
      res.status(201).json(holidayDto(row));
    },
  );
  r.delete(
    '/holiday-calendars/:calendarId/holidays/:id',
    manageOrg,
    validate({ params: HolParams }),
    async (req, res) => {
      const { count } = await db().holiday.deleteMany({
        where: { id: req.params.id, calendarId: req.params.calendarId },
      });
      if (!count) throw new NotFoundError();
      await audit(db(), { action: 'holiday.deleted', entityType: 'Holiday', entityId: req.params.id });
      res.status(204).end();
    },
  );

  // ── Org chart: departments as a tree, with their teams ──
  registry.registerPath({
    method: 'get',
    path: `${BASE}/org-chart`,
    tags: ['Company'],
    summary: 'Departments as a tree with their teams (people are added in Sprint 4)',
    responses: { 200: { description: 'OK' } },
  });
  r.get('/org-chart', read, async (_req, res) => {
    const [departments, teams] = await Promise.all([
      db().department.findMany({ orderBy: { name: 'asc' } }),
      db().team.findMany({ orderBy: { name: 'asc' } }),
    ]);
    const nodes = new Map(
      departments.map((d) => [d.id, { id: d.id, name: d.name, code: d.code, teams: [], children: [] }]),
    );
    const roots = [];
    for (const d of departments)
      (d.parentId && nodes.has(d.parentId) ? nodes.get(d.parentId).children : roots).push(nodes.get(d.id));
    const unassignedTeams = [];
    for (const t of teams)
      (t.departmentId && nodes.has(t.departmentId) ? nodes.get(t.departmentId).teams : unassignedTeams).push({
        id: t.id,
        name: t.name,
      });
    res.json({ departments: roots, unassignedTeams });
  });

  return r;
}
