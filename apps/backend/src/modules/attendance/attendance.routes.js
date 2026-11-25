// @ts-check
import { Router } from 'express';
import { stringify } from 'csv-stringify/sync';
import {
  AttendancePolicyBody,
  DecisionBody,
  OvertimeRuleBody,
  OvertimeRulePatch,
  PolicyQuery,
  PunchBody,
  RangeQuery,
  RecalculateBody,
  RegularizationBody,
  RegularizationListQuery,
  ReportQuery,
  ShiftAssignmentBody,
  ShiftAssignmentQuery,
  ShiftBody,
  ShiftPatch,
  TeamDayQuery,
  timeToMinutes,
} from '@hrms/shared/schemas/attendance';
import { z } from 'zod';
import { crudRoutes, IdParams } from '../../lib/crud.js';
import { db } from '../../lib/db.js';
import { ymdToDate } from '../../lib/time.js';
import { validate } from '../../middleware/validate.js';
import { registry } from '../../openapi/registry.js';
import { safeCsvCell } from '../employees/employees.service.js';

const BASE = '/api/v1/attendance';
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
    tags: ['Attendance'],
    summary,
    responses: { 200: { description: 'OK' } },
    ...extra,
  });
const StatusQuery = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() }).strict();

doc('get', '/me/status', "Today's clock-in state, plan, work locations and what is captured");
doc('post', '/punches', 'Clock in or out (server time)', { request: json(PunchBody) });
doc('get', '/me', 'Your attendance days with punches', { request: { query: RangeQuery } });
doc('get', '/days', 'Everyone you may see on one date', { request: { query: TeamDayQuery } });
doc('get', '/days/{id}', 'One attendance day with punches', { request: { params: IdParams } });
doc('post', '/days/{id}/overtime-decision', 'Approve or reject overtime on a day', {
  request: { params: IdParams, ...json(DecisionBody) },
});
doc('get', '/employees/{id}/days', "One employee's attendance days", {
  request: { params: IdParams, query: RangeQuery },
});
doc('get', '/overtime', 'Overtime waiting for you (or decided)', { request: { query: StatusQuery } });
doc('get', '/regularizations', 'Your correction requests, or ones waiting for your decision', {
  request: { query: RegularizationListQuery },
});
doc('post', '/regularizations', 'Ask for a correction to a day', { request: json(RegularizationBody) });
doc('get', '/regularizations/{id}', 'One correction request', { request: { params: IdParams } });
doc('post', '/regularizations/{id}/decision', 'Approve or reject a correction', {
  request: { params: IdParams, ...json(DecisionBody) },
});
doc('post', '/regularizations/{id}/cancel', 'Cancel your pending correction', {
  request: { params: IdParams },
});
doc('get', '/shift-assignments', 'Shift assignments', { request: { query: ShiftAssignmentQuery } });
doc('post', '/shift-assignments', 'Assign a shift to people from a date', {
  request: json(ShiftAssignmentBody),
});
doc('delete', '/shift-assignments/{id}', 'Remove a shift assignment', { request: { params: IdParams } });
doc('get', '/policy', 'Attendance policy in force (company default or a legal entity)', {
  request: { query: PolicyQuery },
});
doc('put', '/policy', 'Save the attendance policy for the company or a legal entity', {
  request: json(AttendancePolicyBody),
});
doc('post', '/recalculate', 'Recalculate days after changing shifts or rules (background job)', {
  request: json(RecalculateBody),
});
doc('get', '/reports/summary', 'Per-person totals for a period (JSON or CSV)', {
  request: { query: ReportQuery },
});

/** Shift times arrive as HH:MM and are stored as minutes after midnight. @param {any} b */
const shiftData = (b, existing = /** @type {any} */ (null)) => {
  const out = /** @type {any} */ ({});
  for (const k of ['name', 'breakMinutes', 'graceLateMin', 'graceEarlyMin'])
    if (b[k] !== undefined) out[k] = b[k];
  const start = b.startTime !== undefined ? timeToMinutes(b.startTime) : existing?.startMin;
  const end = b.endTime !== undefined ? timeToMinutes(b.endTime) : existing?.endMin;
  if (b.startTime !== undefined) out.startMin = start;
  if (b.endTime !== undefined) out.endMin = end;
  if (b.startTime !== undefined || b.endTime !== undefined) out.crossesMidnight = end <= start;
  return out;
};
const dates = (/** @type {any} */ b) => ({
  ...b,
  ...(b.effectiveFrom !== undefined ? { effectiveFrom: ymdToDate(b.effectiveFrom) } : {}),
  ...(b.effectiveTo !== undefined ? { effectiveTo: b.effectiveTo ? ymdToDate(b.effectiveTo) : null } : {}),
});

/**
 * Attendance routes. Self-service needs only a signed-in member linked to an employee record;
 * team views use attendance.view scope; approvals go to the direct manager or attendance.regularization.approve;
 * shifts, rules, policy and recalculation need attendance.manage.
 * @param {{ access: ReturnType<typeof import('../../middleware/auth.js').access>, attendance: ReturnType<typeof import('./attendance.service.js').createAttendanceService> }} deps
 */
export function attendanceRouter({ access, attendance }) {
  const r = Router();
  const signedIn = access.authenticated();
  const view = access.permission('attendance.view');
  const manage = access.permission('attendance.manage');

  r.get('/me/status', signedIn, async (_req, res) =>
    res.set('Cache-Control', 'no-store').json(await attendance.status()),
  );
  r.post('/punches', signedIn, validate({ body: PunchBody }), async (req, res) =>
    res.status(201).json(await attendance.punch(req.body, { ip: req.ip ?? null })),
  );
  r.get('/me', signedIn, validate({ query: RangeQuery }), async (req, res) => {
    const q = /** @type {any} */ (req.query);
    res.json({ data: await attendance.myDays(q.from, q.to) });
  });
  r.get('/days', view, validate({ query: TeamDayQuery }), async (req, res) =>
    res.json(await attendance.teamDay(req.query)),
  );
  r.get('/days/:id', signedIn, validate({ params: IdParams }), async (req, res) =>
    res.json(await attendance.day(req.params.id)),
  );
  r.post(
    '/days/:id/overtime-decision',
    signedIn,
    validate({ params: IdParams, body: DecisionBody }),
    async (req, res) => res.json(await attendance.decideOvertime(req.params.id, req.body)),
  );
  r.get(
    '/employees/:id/days',
    signedIn,
    validate({ params: IdParams, query: RangeQuery }),
    async (req, res) => {
      const q = /** @type {any} */ (req.query);
      res.json(await attendance.employeeDays(req.params.id, q.from, q.to));
    },
  );
  r.get('/overtime', signedIn, validate({ query: StatusQuery }), async (req, res) =>
    res.json({ data: await attendance.listOvertime(/** @type {any} */ (req.query)) }),
  );

  r.get('/regularizations', signedIn, validate({ query: RegularizationListQuery }), async (req, res) =>
    res.json({ data: await attendance.listCorrections(/** @type {any} */ (req.query)) }),
  );
  r.post('/regularizations', signedIn, validate({ body: RegularizationBody }), async (req, res) =>
    res.status(201).json(await attendance.requestCorrection(req.body)),
  );
  r.get('/regularizations/:id', signedIn, validate({ params: IdParams }), async (req, res) =>
    res.json(await attendance.getCorrection(req.params.id)),
  );
  r.post(
    '/regularizations/:id/decision',
    signedIn,
    validate({ params: IdParams, body: DecisionBody }),
    async (req, res) => res.json(await attendance.decideCorrection(req.params.id, req.body)),
  );
  r.post('/regularizations/:id/cancel', signedIn, validate({ params: IdParams }), async (req, res) =>
    res.json(await attendance.cancelCorrection(req.params.id)),
  );

  // ── Settings ──
  crudRoutes(r, {
    path: '/shifts',
    model: 'shift',
    entityType: 'Shift',
    tag: 'Attendance',
    basePath: BASE,
    createSchema: ShiftBody,
    updateSchema: ShiftPatch,
    readAccess: signedIn,
    writeAccess: manage,
    searchFields: ['name'],
    orderBy: { name: 'asc' },
    mapInput: async (b, { id }) => {
      const existing = id ? await db().shift.findUnique({ where: { id } }) : null;
      return shiftData(b, existing);
    },
  });
  crudRoutes(r, {
    path: '/overtime-rules',
    model: 'overtimeRule',
    entityType: 'OvertimeRule',
    tag: 'Attendance',
    basePath: BASE,
    createSchema: OvertimeRuleBody,
    updateSchema: OvertimeRulePatch,
    readAccess: manage,
    writeAccess: manage,
    searchFields: ['name'],
    orderBy: { effectiveFrom: 'desc' },
    mapInput: dates,
  });
  r.get('/shift-assignments', manage, validate({ query: ShiftAssignmentQuery }), async (req, res) =>
    res.json({ data: await attendance.listAssignments(/** @type {any} */ (req.query)) }),
  );
  r.post('/shift-assignments', manage, validate({ body: ShiftAssignmentBody }), async (req, res) =>
    res.status(201).json(await attendance.assignShift(req.body)),
  );
  r.delete('/shift-assignments/:id', manage, validate({ params: IdParams }), async (req, res) => {
    await attendance.removeAssignment(req.params.id);
    res.status(204).end();
  });
  r.get('/policy', signedIn, validate({ query: PolicyQuery }), async (req, res) =>
    res.json(await attendance.getPolicy(/** @type {any} */ (req.query).legalEntityId)),
  );
  r.put('/policy', manage, validate({ body: AttendancePolicyBody }), async (req, res) =>
    res.json(await attendance.savePolicy(req.body)),
  );
  r.post('/recalculate', manage, validate({ body: RecalculateBody }), async (req, res) =>
    res.status(202).json(await attendance.requestRecalculation(req.body)),
  );

  r.get('/reports/summary', view, validate({ query: ReportQuery }), async (req, res) => {
    const q = /** @type {any} */ (req.query);
    const out = await attendance.summary(q);
    if (q.format !== 'csv') return res.json(out);
    const header = [
      'employeeCode',
      'name',
      'department',
      'present',
      'wfh',
      'halfDay',
      'absent',
      'weekend',
      'holiday',
      'pending',
      'lateDays',
      'lateMinutes',
      'earlyLeaveDays',
      'missingOut',
      'workedHours',
      'overtimeApprovedHours',
      'overtimePendingHours',
    ];
    const hours = (/** @type {number} */ m) => (m / 60).toFixed(2);
    const rows = out.data.map((/** @type {any} */ row) => [
      row.employee.code,
      row.employee.name,
      row.employee.department ?? '',
      row.present,
      row.wfh,
      row.halfDay,
      row.absent,
      row.weekend,
      row.holiday,
      row.pending,
      row.lateDays,
      row.lateMinutes,
      row.earlyLeaveDays,
      row.missingOut,
      hours(row.workedMinutes),
      hours(row.overtimeApprovedMinutes),
      hours(row.overtimePendingMinutes),
    ]);
    res
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="attendance-${q.from}-to-${q.to}.csv"`,
        'Cache-Control': 'no-store',
      })
      .send(stringify([header, ...rows.map((cells) => cells.map(safeCsvCell))]));
  });
  return r;
}
