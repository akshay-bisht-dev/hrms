// @ts-check
import { Router } from 'express';
import { stringify } from 'csv-stringify/sync';
import { z } from 'zod';
import {
  AccrualRunBody,
  AdjustmentBody,
  CalendarQuery,
  LeaveCancelBody,
  LeaveDecisionBody,
  LeavePolicyBody,
  LeavePolicyPatch,
  LeavePolicyVersionBody,
  LeaveReportQuery,
  LeaveRequestBody,
  LeaveRequestListQuery,
  LeaveTypeBody,
  LeaveTypePatch,
  PolicyAssignmentBody,
} from '@hrms/shared/schemas/leave';
import { crudRoutes, IdParams } from '../../lib/crud.js';
import { ymdToDate } from '../../lib/time.js';
import { validate } from '../../middleware/validate.js';
import { registry } from '../../openapi/registry.js';
import { safeCsvCell } from '../employees/employees.service.js';

const BASE = '/api/v1/leaves';
const json = (/** @type {any} */ schema) => ({ body: { content: { 'application/json': { schema } } } });
const doc = (
  /** @type {string} */ method,
  /** @type {string} */ path,
  /** @type {string} */ summary,
  extra = {},
) =>
  registry.registerPath({
    method: /** @type {any} */ (method),
    path: `${BASE}${path}`,
    tags: ['Leave'],
    summary,
    responses: { 200: { description: 'OK' } },
    ...extra,
  });
const LedgerQuery = z.object({ leaveTypeId: z.uuid().optional() }).strict();

doc('get', '/balances/me', 'Your balances for every leave type a policy gives you');
doc('get', '/balances/{id}', "An employee's balances (leave.request.view scope)", {
  request: { params: IdParams },
});
doc('get', '/ledger/{id}', "An employee's ledger with running balance", {
  request: { params: IdParams, query: LedgerQuery },
});
doc('post', '/adjustments', 'Opening balance or correction (append-only ledger)', {
  request: json(AdjustmentBody),
});
doc('post', '/requests/preview', 'Day count, balance and problems for a request, without saving', {
  request: json(LeaveRequestBody),
});
doc('post', '/requests', 'Apply for leave', { request: json(LeaveRequestBody) });
doc('get', '/requests', 'Your requests, ones waiting for you, or your team', {
  request: { query: LeaveRequestListQuery },
});
doc('get', '/requests/{id}', 'One request with its approval steps', { request: { params: IdParams } });
doc('post', '/requests/{id}/decision', 'Approve or reject the current step', {
  request: { params: IdParams, ...json(LeaveDecisionBody) },
});
doc('post', '/requests/{id}/cancel', 'Cancel (reverses the ledger debit for approved leave)', {
  request: { params: IdParams, ...json(LeaveCancelBody) },
});
doc('get', '/calendar', 'Who is away (approved and pending) in a period', {
  request: { query: CalendarQuery },
});
doc('post', '/policies/{id}/versions', 'New rules from a date (previous version ends the day before)', {
  request: { params: IdParams, ...json(LeavePolicyVersionBody) },
});
doc('get', '/policy-assignments', 'Policy assignments');
doc(
  'post',
  '/policy-assignments',
  'Assign a policy to the company, a legal entity, branch, department or person',
  {
    request: json(PolicyAssignmentBody),
  },
);
doc('delete', '/policy-assignments/{id}', 'Remove a policy assignment', { request: { params: IdParams } });
doc('post', '/starter-pack', 'Load starter leave types (annual, sick, unpaid) with company-wide policies');
doc('post', '/accruals/run', 'Run accruals and year-end expiry for a month (background, idempotent)', {
  request: json(AccrualRunBody),
});
doc('get', '/reports/summary', 'Leave taken and balances per person (JSON or CSV)', {
  request: { query: LeaveReportQuery },
});

const dates = (/** @type {any} */ b) => ({
  ...b,
  ...(b.effectiveFrom !== undefined ? { effectiveFrom: ymdToDate(b.effectiveFrom) } : {}),
  ...(b.effectiveTo !== undefined ? { effectiveTo: b.effectiveTo ? ymdToDate(b.effectiveTo) : null } : {}),
});

/**
 * Leave routes. Self-service needs a signed-in member linked to an employee record; approvals go to the direct
 * manager (step 1) and holders of leave.request.approve; configuration needs leave.config.manage.
 * @param {{ access: ReturnType<typeof import('../../middleware/auth.js').access>, leave: ReturnType<typeof import('./leave.service.js').createLeaveService> }} deps
 */
export function leaveRouter({ access, leave }) {
  const r = Router();
  const signedIn = access.authenticated();
  const config = access.permission('leave.config.manage');
  const adjust = access.permission('leave.balance.adjust');
  const view = access.permission('leave.request.view');

  r.get('/balances/me', signedIn, async (_req, res) => res.json({ data: await leave.myBalances() }));
  r.get('/balances/:id', signedIn, validate({ params: IdParams }), async (req, res) =>
    res.json(await leave.employeeBalances(req.params.id)),
  );
  r.get('/ledger/:id', signedIn, validate({ params: IdParams, query: LedgerQuery }), async (req, res) =>
    res.json(await leave.ledger(req.params.id, /** @type {any} */ (req.query).leaveTypeId)),
  );
  r.post('/adjustments', adjust, validate({ body: AdjustmentBody }), async (req, res) =>
    res.status(201).json(await leave.adjust(req.body)),
  );

  r.post('/requests/preview', signedIn, validate({ body: LeaveRequestBody }), async (req, res) =>
    res.json(await leave.preview(req.body)),
  );
  r.post('/requests', signedIn, validate({ body: LeaveRequestBody }), async (req, res) =>
    res.status(201).json(await leave.apply(req.body)),
  );
  r.get('/requests', signedIn, validate({ query: LeaveRequestListQuery }), async (req, res) =>
    res.json({ data: await leave.list(/** @type {any} */ (req.query)) }),
  );
  r.get('/requests/:id', signedIn, validate({ params: IdParams }), async (req, res) =>
    res.json(await leave.get(req.params.id)),
  );
  r.post(
    '/requests/:id/decision',
    signedIn,
    validate({ params: IdParams, body: LeaveDecisionBody }),
    async (req, res) => res.json(await leave.decide(req.params.id, req.body)),
  );
  r.post(
    '/requests/:id/cancel',
    signedIn,
    validate({ params: IdParams, body: LeaveCancelBody }),
    async (req, res) => res.json(await leave.cancel(req.params.id, req.body)),
  );
  r.get('/calendar', signedIn, validate({ query: CalendarQuery }), async (req, res) =>
    res.json({ data: await leave.calendar(req.query) }),
  );

  // ── Configuration ──
  crudRoutes(r, {
    path: '/types',
    model: 'leaveType',
    entityType: 'LeaveType',
    tag: 'Leave',
    basePath: BASE,
    createSchema: LeaveTypeBody,
    updateSchema: LeaveTypePatch,
    readAccess: signedIn,
    writeAccess: config,
    searchFields: ['name', 'code'],
    orderBy: { name: 'asc' },
  });
  crudRoutes(r, {
    path: '/policies',
    model: 'leavePolicy',
    entityType: 'LeavePolicy',
    tag: 'Leave',
    basePath: BASE,
    createSchema: LeavePolicyBody,
    updateSchema: LeavePolicyPatch,
    readAccess: config,
    writeAccess: config,
    searchFields: ['name'],
    orderBy: { effectiveFrom: 'desc' },
    mapInput: dates,
  });
  r.post(
    '/policies/:id/versions',
    config,
    validate({ params: IdParams, body: LeavePolicyVersionBody }),
    async (req, res) => res.status(201).json(await leave.newVersion(req.params.id, req.body)),
  );
  r.get('/policy-assignments', config, async (_req, res) => res.json({ data: await leave.assignments() }));
  r.post('/policy-assignments', config, validate({ body: PolicyAssignmentBody }), async (req, res) =>
    res.status(201).json(await leave.assign(req.body)),
  );
  r.delete('/policy-assignments/:id', config, validate({ params: IdParams }), async (req, res) => {
    await leave.unassign(req.params.id);
    res.status(204).end();
  });
  r.post('/starter-pack', config, async (_req, res) => res.status(201).json(await leave.starterPack()));
  r.post('/accruals/run', config, validate({ body: AccrualRunBody }), async (req, res) =>
    res.status(202).json(await leave.requestAccrualRun(req.body.month)),
  );

  r.get('/reports/summary', view, validate({ query: LeaveReportQuery }), async (req, res) => {
    const q = /** @type {any} */ (req.query);
    const out = await leave.summary(q);
    if (q.format !== 'csv') return res.json(out);
    const header = [
      'employeeCode',
      'name',
      'department',
      ...out.leaveTypes.flatMap((/** @type {any} */ t) => [`${t.code}_taken`, `${t.code}_balance`]),
    ];
    const rows = out.data.map((/** @type {any} */ row) => [
      row.employee.code,
      row.employee.name,
      row.employee.department ?? '',
      ...out.leaveTypes.flatMap((/** @type {any} */ t) => [
        row.byType[t.code].taken,
        row.byType[t.code].balance,
      ]),
    ]);
    res
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="leave-${q.from}-to-${q.to}.csv"`,
        'Cache-Control': 'no-store',
      })
      .send(stringify([header, ...rows.map((cells) => cells.map(safeCsvCell))]));
  });
  return r;
}
