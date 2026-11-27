// @ts-check
import { Router } from 'express';
import { stringify } from 'csv-stringify/sync';
import { z } from 'zod';
import {
  ComponentBody,
  ComponentPatch,
  FiscalYear,
  PayrollSettingsBody,
  RunCommentBody,
  RunCreateBody,
  RunInputBody,
  RunListQuery,
  RunRejectBody,
  SalaryBody,
  SalaryPreviewQuery,
  StatutorySettingsBody,
  StructureBody,
  StructureComponentsBody,
  StructurePatch,
  TaxDeclarationBody,
  TaxReviewBody,
} from '@hrms/shared/schemas/payroll';
import { crudRoutes, IdParams } from '../../lib/crud.js';
import { ymdToDate } from '../../lib/time.js';
import { validate } from '../../middleware/validate.js';
import { registry } from '../../openapi/registry.js';
import { safeCsvCell } from '../employees/employees.service.js';

const BASE = '/api/v1/payroll';
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
    tags: ['Payroll'],
    summary,
    responses: { 200: { description: 'OK' } },
    ...extra,
  });
const ChildParams = z.object({ id: z.uuid(), childId: z.uuid() }).strict();
const FyParams = z.object({ fy: FiscalYear }).strict();
const LeBody = z.object({ legalEntityId: z.uuid() }).strict();
const DeclarationQuery = z
  .object({ status: z.enum(['DRAFT', 'SUBMITTED', 'VERIFIED', 'REJECTED']).optional() })
  .strict();

doc('get', '/legal-entities/{id}/statutory-keys', "Statutory items the legal entity's country pack offers", {
  request: { params: IdParams },
});
doc('get', '/legal-entities/{id}/statutory-settings', 'Statutory settings in force (PF, ESI, PT state …)', {
  request: { params: IdParams },
});
doc('put', '/legal-entities/{id}/statutory-settings', 'New statutory settings from a date', {
  request: { params: IdParams, ...json(StatutorySettingsBody) },
});
doc('get', '/legal-entities/{id}/settings', 'Payroll settings (paid days, loss of pay, pay day)', {
  request: { params: IdParams },
});
doc('put', '/legal-entities/{id}/settings', 'Save payroll settings', {
  request: { params: IdParams, ...json(PayrollSettingsBody) },
});
doc('post', '/starter/in', 'Load the India starter components and structure', { request: json(LeBody) });
doc('put', '/structures/{id}/components', "Set a structure's components and their order (checked)", {
  request: { params: IdParams, ...json(StructureComponentsBody) },
});
doc('get', '/employees/{id}/salaries', 'Salary history (sensitive; audited)', {
  request: { params: IdParams },
});
doc('post', '/employees/{id}/salaries', 'New salary from a date', {
  request: { params: IdParams, ...json(SalaryBody) },
});
doc('get', '/salary-preview', 'Monthly breakdown of a CTC on a structure', {
  request: { query: SalaryPreviewQuery },
});
doc('get', '/runs', 'Payroll runs', { request: { query: RunListQuery } });
doc('post', '/runs', 'Create a run for a legal entity and month', { request: json(RunCreateBody) });
doc('get', '/runs/{id}', 'A run with totals and counts', { request: { params: IdParams } });
for (const [action, summary] of [
  ['lock', 'Lock inputs (also locks attendance in the period)'],
  ['unlock', 'Back to draft (discards results, unlocks attendance)'],
  ['calculate', 'Calculate (background job)'],
  ['review', 'Mark reviewed'],
  ['approve', 'Approve (must be someone other than the reviewer)'],
  ['finalize', 'Finalize: the run is frozen and payslips are generated'],
  ['mark-paid', 'Mark paid'],
  ['cancel', 'Cancel a run that is not finalized'],
])
  doc('post', `/runs/{id}/${action}`, summary, { request: { params: IdParams } });
doc('post', '/runs/{id}/reject', 'Send back for corrections', {
  request: { params: IdParams, ...json(RunRejectBody) },
});
doc('get', '/runs/{id}/inputs', 'Variable pay and reimbursement inputs', { request: { params: IdParams } });
doc('post', '/runs/{id}/inputs', 'Add an input (draft runs only)', {
  request: { params: IdParams, ...json(RunInputBody) },
});
doc('delete', '/runs/{id}/inputs/{childId}', 'Remove an input', { request: { params: ChildParams } });
doc('get', '/runs/{id}/employees', 'Per-employee results', { request: { params: IdParams } });
doc('get', '/runs/{id}/employees/{childId}', 'One employee: lines with calculation traces', {
  request: { params: ChildParams },
});
doc('get', '/runs/{id}/variance', 'Net pay change against the previous finalized run', {
  request: { params: IdParams },
});
doc('get', '/runs/{id}/register', 'Payroll register (CSV)', { request: { params: IdParams } });
doc('get', '/runs/{id}/bank-file', 'Bank transfer file (CSV; sensitive; audited)', {
  request: { params: IdParams },
});
doc('get', '/payslips/me', 'Your payslips');
doc('get', '/payslips/{id}/download-url', 'Download link for a payslip (60 s)', {
  request: { params: IdParams },
});
doc('get', '/tax-declarations/me/{fy}', 'Your tax regime and declarations for a fiscal year', {
  request: { params: FyParams },
});
doc('put', '/tax-declarations/me/{fy}', 'Submit your tax regime and declarations', {
  request: { params: FyParams, ...json(TaxDeclarationBody) },
});
doc('get', '/tax-declarations', 'Declarations to review', { request: { query: DeclarationQuery } });
doc('post', '/tax-declarations/{id}/review', 'Verify or reject a declaration', {
  request: { params: IdParams, ...json(TaxReviewBody) },
});

const csv = (
  /** @type {any} */ res,
  /** @type {string} */ name,
  /** @type {string[]} */ header,
  /** @type {any[][]} */ rows,
  extra = {},
) =>
  res
    .set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
      ...extra,
    })
    .send(stringify([header, ...rows.map((r) => r.map(safeCsvCell))]));

/**
 * Payroll routes. Every payroll permission is sensitive (MFA required). Self-service: payslips and tax declarations.
 * @param {{ access: ReturnType<typeof import('../../middleware/auth.js').access>,
 *           config: ReturnType<typeof import('./config.service.js').createPayrollConfigService>,
 *           runs: ReturnType<typeof import('./run.service.js').createPayrollRunService> }} deps
 */
export function payrollRouter({ access, config, runs }) {
  const r = Router();
  const signedIn = access.authenticated();
  const configure = access.permission('payroll.config.manage');
  const salaryView = access.permission('payroll.salary.view');
  const salaryManage = access.permission('payroll.salary.manage');
  const taxReview = access.permission('payroll.tax.review');
  const runCreate = access.permission('payroll.run.create');
  const runReview = access.permission('payroll.run.review');
  const runApprove = access.permission('payroll.run.approve');
  const bank = access.permission('payroll.bank.view');

  // ── Configuration ──
  r.get('/legal-entities/:id/statutory-keys', configure, validate({ params: IdParams }), async (req, res) =>
    res.json(await config.statutoryKeys(req.params.id)),
  );
  r.get(
    '/legal-entities/:id/statutory-settings',
    configure,
    validate({ params: IdParams }),
    async (req, res) => res.json(await config.getStatutorySettings(req.params.id)),
  );
  r.put(
    '/legal-entities/:id/statutory-settings',
    configure,
    validate({ params: IdParams, body: StatutorySettingsBody }),
    async (req, res) => res.json(await config.saveStatutorySettings(req.params.id, req.body)),
  );
  r.get('/legal-entities/:id/settings', configure, validate({ params: IdParams }), async (req, res) =>
    res.json(await config.getPayrollSettings(req.params.id)),
  );
  r.put(
    '/legal-entities/:id/settings',
    configure,
    validate({ params: IdParams, body: PayrollSettingsBody }),
    async (req, res) => res.json(await config.savePayrollSettings(req.params.id, req.body)),
  );
  r.post('/starter/in', configure, validate({ body: LeBody }), async (req, res) =>
    res.status(201).json(await config.loadIndiaStarter(req.body.legalEntityId)),
  );
  crudRoutes(r, {
    path: '/components',
    model: 'salaryComponent',
    entityType: 'SalaryComponent',
    tag: 'Payroll',
    basePath: BASE,
    createSchema: ComponentBody,
    updateSchema: ComponentPatch,
    readAccess: configure,
    writeAccess: configure,
    searchFields: ['code', 'name'],
    orderBy: { displayOrder: 'asc' },
    mapInput: async (b) => {
      await config.checkComponent(b);
      return b;
    },
  });
  crudRoutes(r, {
    path: '/structures',
    model: 'salaryStructure',
    entityType: 'SalaryStructure',
    tag: 'Payroll',
    basePath: BASE,
    createSchema: StructureBody,
    updateSchema: StructurePatch,
    readAccess: configure,
    writeAccess: configure,
    searchFields: ['name'],
    orderBy: { name: 'asc' },
    mapInput: (b) => ({
      ...b,
      ...(b.effectiveFrom !== undefined ? { effectiveFrom: ymdToDate(b.effectiveFrom) } : {}),
      ...(b.effectiveTo !== undefined
        ? { effectiveTo: b.effectiveTo ? ymdToDate(b.effectiveTo) : null }
        : {}),
    }),
  });
  r.get('/structures/:id/components', configure, validate({ params: IdParams }), async (req, res) =>
    res.json(await config.getStructure(req.params.id)),
  );
  r.put(
    '/structures/:id/components',
    configure,
    validate({ params: IdParams, body: StructureComponentsBody }),
    async (req, res) => res.json(await config.setStructureComponents(req.params.id, req.body)),
  );

  // ── Salaries ──
  r.get('/employees/:id/salaries', salaryView, validate({ params: IdParams }), async (req, res) =>
    res.set('Cache-Control', 'no-store').json({ data: await config.salaries(req.params.id) }),
  );
  r.post(
    '/employees/:id/salaries',
    salaryManage,
    validate({ params: IdParams, body: SalaryBody }),
    async (req, res) => res.status(201).json(await config.setSalary(req.params.id, req.body)),
  );
  r.get('/salary-preview', salaryView, validate({ query: SalaryPreviewQuery }), async (req, res) =>
    res.set('Cache-Control', 'no-store').json(await config.preview(/** @type {any} */ (req.query))),
  );

  // ── Runs ──
  const anyRunAccess = access.authenticated(); // the service checks run.create / review / approve
  r.get('/runs', anyRunAccess, validate({ query: RunListQuery }), async (req, res) =>
    res.json({ data: await runs.list(/** @type {any} */ (req.query)) }),
  );
  r.post('/runs', runCreate, validate({ body: RunCreateBody }), async (req, res) =>
    res.status(201).json(await runs.create(req.body)),
  );
  r.get('/runs/:id', anyRunAccess, validate({ params: IdParams }), async (req, res) =>
    res.json(await runs.get(req.params.id)),
  );
  r.post('/runs/:id/lock', runCreate, validate({ params: IdParams }), async (req, res) =>
    res.json(await runs.lock(req.params.id)),
  );
  r.post('/runs/:id/unlock', runCreate, validate({ params: IdParams }), async (req, res) =>
    res.json(await runs.unlock(req.params.id)),
  );
  r.post('/runs/:id/calculate', runCreate, validate({ params: IdParams }), async (req, res) =>
    res.status(202).json(await runs.requestCalculation(req.params.id)),
  );
  r.post(
    '/runs/:id/review',
    runReview,
    validate({ params: IdParams, body: RunCommentBody }),
    async (req, res) => res.json(await runs.review(req.params.id, req.body)),
  );
  r.post('/runs/:id/approve', runApprove, validate({ params: IdParams }), async (req, res) =>
    res.json(await runs.approve(req.params.id)),
  );
  r.post(
    '/runs/:id/reject',
    runApprove,
    validate({ params: IdParams, body: RunRejectBody }),
    async (req, res) => res.json(await runs.reject(req.params.id, req.body)),
  );
  r.post('/runs/:id/finalize', runApprove, validate({ params: IdParams }), async (req, res) =>
    res.json(await runs.finalize(req.params.id)),
  );
  r.post('/runs/:id/mark-paid', runApprove, validate({ params: IdParams }), async (req, res) =>
    res.json(await runs.markPaid(req.params.id)),
  );
  r.post('/runs/:id/cancel', runCreate, validate({ params: IdParams }), async (req, res) =>
    res.json(await runs.cancel(req.params.id)),
  );
  r.get('/runs/:id/inputs', anyRunAccess, validate({ params: IdParams }), async (req, res) =>
    res.json({ data: await runs.inputs(req.params.id) }),
  );
  r.post(
    '/runs/:id/inputs',
    runCreate,
    validate({ params: IdParams, body: RunInputBody }),
    async (req, res) => res.status(201).json(await runs.addInput(req.params.id, req.body)),
  );
  r.delete('/runs/:id/inputs/:childId', runCreate, validate({ params: ChildParams }), async (req, res) => {
    await runs.removeInput(req.params.id, req.params.childId);
    res.status(204).end();
  });
  r.get('/runs/:id/employees', anyRunAccess, validate({ params: IdParams }), async (req, res) =>
    res.set('Cache-Control', 'no-store').json({ data: await runs.employees(req.params.id) }),
  );
  r.get('/runs/:id/employees/:childId', anyRunAccess, validate({ params: ChildParams }), async (req, res) =>
    res.set('Cache-Control', 'no-store').json(await runs.employeeLines(req.params.id, req.params.childId)),
  );
  r.get('/runs/:id/variance', anyRunAccess, validate({ params: IdParams }), async (req, res) =>
    res.json(await runs.variance(req.params.id)),
  );
  r.get('/runs/:id/register', salaryView, validate({ params: IdParams }), async (req, res) => {
    const out = await runs.register(req.params.id);
    csv(res, `payroll-register-${req.params.id.slice(0, 8)}.csv`, out.header, out.rows);
  });
  r.get('/runs/:id/bank-file', bank, validate({ params: IdParams }), async (req, res) => {
    const out = await runs.bankFile(req.params.id);
    csv(res, `bank-transfer-${req.params.id.slice(0, 8)}.csv`, out.header, out.rows, {
      'X-Missing-Bank-Accounts': out.missing.join(','),
    });
  });

  // ── Self-service ──
  r.get('/payslips/me', signedIn, async (_req, res) => res.json({ data: await runs.myPayslips() }));
  r.get('/payslips/:id/download-url', signedIn, validate({ params: IdParams }), async (req, res) =>
    res.set('Cache-Control', 'no-store').json(await runs.payslipUrl(req.params.id)),
  );
  r.get('/tax-declarations/me/:fy', signedIn, validate({ params: FyParams }), async (req, res) =>
    res.json(await config.myDeclaration(req.params.fy)),
  );
  r.put(
    '/tax-declarations/me/:fy',
    signedIn,
    validate({ params: FyParams, body: TaxDeclarationBody }),
    async (req, res) => res.json(await config.saveMyDeclaration(req.params.fy, req.body)),
  );
  r.get('/tax-declarations', taxReview, validate({ query: DeclarationQuery }), async (req, res) =>
    res.json({ data: await config.declarations(/** @type {any} */ (req.query)) }),
  );
  r.post(
    '/tax-declarations/:id/review',
    taxReview,
    validate({ params: IdParams, body: TaxReviewBody }),
    async (req, res) => res.json(await config.reviewDeclaration(req.params.id, req.body)),
  );
  return r;
}
