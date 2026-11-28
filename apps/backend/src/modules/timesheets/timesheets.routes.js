// @ts-check
import { Router } from 'express';
import {
  DashboardQuery,
  DayParams,
  ReportNotesBody,
  ReviewBody,
  ReviewListQuery,
  WeekQuery,
} from '@hrms/shared/schemas/tasks';
import { TeamStatusQuery } from '@hrms/shared/schemas/work';
import { IdParams } from '../../lib/crud.js';
import { validate } from '../../middleware/validate.js';
import { registry } from '../../openapi/registry.js';

const json = (/** @type {any} */ schema) => ({ body: { content: { 'application/json': { schema } } } });
/** @param {string} base @param {string} tag */
const docFor =
  (base, tag) =>
  (/** @type {string} */ method, /** @type {string} */ path, /** @type {string} */ summary, extra = {}) =>
    registry.registerPath({
      method: /** @type {any} */ (method),
      path: `${base}${path}`,
      tags: [tag],
      summary,
      responses: { 200: { description: 'OK' } },
      ...extra,
    });
const byId = { request: { params: IdParams } };
const byDay = { request: { params: DayParams } };

const r = docFor('/api/v1/work-reports', 'Daily work reports');
r('get', '/me/{date}', 'Your report for a day (built from your sessions and task time)', byDay);
r('put', '/me/{date}', 'Save your notes for a day', {
  request: { params: DayParams, ...json(ReportNotesBody) },
});
r('post', '/me/{date}/submit', 'Submit the day to your manager (figures are frozen)', byDay);
r('get', '', 'Your reports, or ones waiting for your review', { request: { query: ReviewListQuery } });
r('get', '/{id}', 'One report', byId);
r('post', '/{id}/decision', 'Approve, reject or ask for changes', {
  request: { params: IdParams, ...json(ReviewBody) },
});

const s = docFor('/api/v1/timesheets', 'Timesheets');
s('get', '/me', 'Your weekly timesheet (built from sessions and task time)', {
  request: { query: WeekQuery },
});
s('post', '/me/{date}/submit', 'Submit the week starting on that date (locks its time)', byDay);
s('get', '', 'Your timesheets, or ones waiting for your decision', { request: { query: ReviewListQuery } });
s('get', '/{id}', 'One timesheet', byId);
s('post', '/{id}/decision', 'Approve, reject or ask for changes', {
  request: { params: IdParams, ...json(ReviewBody) },
});

const d = docFor('/api/v1/dashboards', 'Dashboards');
d('get', '/team-board', 'Manager live board: status, tasks and your approvals (view_team_work_status)', {
  request: { query: TeamStatusQuery },
});
d('get', '/remote-work', 'Company remote-work figures, aggregates only (reports.view)', {
  request: { query: DashboardQuery },
});

/** @param {{ access: any, timesheets: ReturnType<typeof import('./timesheets.service.js').createTimesheetsService> }} deps */
export function workReportsRouter({ access, timesheets }) {
  const router = Router();
  const signedIn = access.authenticated();
  router.get('/me/:date', signedIn, validate({ params: DayParams }), async (req, res) =>
    res.set('Cache-Control', 'no-store').json(await timesheets.myReport(req.params.date)),
  );
  router.put(
    '/me/:date',
    signedIn,
    validate({ params: DayParams, body: ReportNotesBody }),
    async (req, res) => res.json(await timesheets.saveReportNotes(req.params.date, req.body)),
  );
  router.post('/me/:date/submit', signedIn, validate({ params: DayParams }), async (req, res) =>
    res.json(await timesheets.submitReport(req.params.date)),
  );
  router.get('/', signedIn, validate({ query: ReviewListQuery }), async (req, res) =>
    res.json({ data: await timesheets.listReports(/** @type {any} */ (req.query)) }),
  );
  router.get('/:id', signedIn, validate({ params: IdParams }), async (req, res) =>
    res.json(await timesheets.getReport(req.params.id)),
  );
  router.post('/:id/decision', signedIn, validate({ params: IdParams, body: ReviewBody }), async (req, res) =>
    res.json(await timesheets.decideReport(req.params.id, req.body)),
  );
  return router;
}

/** @param {{ access: any, timesheets: ReturnType<typeof import('./timesheets.service.js').createTimesheetsService> }} deps */
export function timesheetsRouter({ access, timesheets }) {
  const router = Router();
  const signedIn = access.authenticated();
  router.get('/me', signedIn, validate({ query: WeekQuery }), async (req, res) =>
    res
      .set('Cache-Control', 'no-store')
      .json(await timesheets.myTimesheet(/** @type {any} */ (req.query).week)),
  );
  router.post('/me/:date/submit', signedIn, validate({ params: DayParams }), async (req, res) =>
    res.json(await timesheets.submitTimesheet(req.params.date)),
  );
  router.get('/', signedIn, validate({ query: ReviewListQuery }), async (req, res) =>
    res.json({ data: await timesheets.listTimesheets(/** @type {any} */ (req.query)) }),
  );
  router.get('/:id', signedIn, validate({ params: IdParams }), async (req, res) =>
    res.json(await timesheets.getTimesheet(req.params.id)),
  );
  router.post('/:id/decision', signedIn, validate({ params: IdParams, body: ReviewBody }), async (req, res) =>
    res.json(await timesheets.decideTimesheet(req.params.id, req.body)),
  );
  return router;
}

/** @param {{ access: any, dashboards: ReturnType<typeof import('../dashboards/dashboards.service.js').createDashboardsService> }} deps */
export function dashboardsRouter({ access, dashboards }) {
  const router = Router();
  router.get(
    '/team-board',
    access.permission('view_team_work_status'),
    validate({ query: TeamStatusQuery }),
    async (req, res) =>
      res.set('Cache-Control', 'no-store').json(await dashboards.board(/** @type {any} */ (req.query))),
  );
  router.get(
    '/remote-work',
    access.permission('reports.view'),
    validate({ query: DashboardQuery }),
    async (req, res) => res.json(await dashboards.remoteWork(/** @type {any} */ (req.query))),
  );
  return router;
}
