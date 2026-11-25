// @ts-check
import { Router } from 'express';
import { z } from 'zod';
import { stringify } from 'csv-stringify/sync';
import {
  BankAccountBody,
  DocumentUploadBody,
  EmergencyContactBody,
  EmployeeCreateBody,
  EmployeeListQuery,
  EmployeeUpdateBody,
  EmploymentChangeBody,
  StatusChangeBody,
} from '@hrms/shared/schemas/employee';
import { IdParams } from '../../lib/crud.js';
import { validate } from '../../middleware/validate.js';
import { registry } from '../../openapi/registry.js';
import { importTemplate } from './imports.js';
import { safeCsvCell } from './employees.service.js';

const BASE = '/api/v1/employees';
const json = (schema) => ({ body: { content: { 'application/json': { schema } } } });
const doc = (method, path, summary, extra = {}) =>
  registry.registerPath({
    method,
    path: `${BASE}${path}`,
    tags: ['Employees'],
    summary,
    responses: { 200: { description: 'OK' } },
    ...extra,
  });
const ChildParams = z.object({ id: z.uuid(), childId: z.uuid() }).strict();

doc('get', '', 'Employee directory (filtered to what you may see)', {
  request: { query: EmployeeListQuery },
});
doc('post', '', 'Create an employee (code is generated when omitted)', { request: json(EmployeeCreateBody) });
doc('get', '/me', 'Your own employee record');
doc('get', '/export', 'CSV export of the directory within your export scope');
doc('get', '/imports/template', 'CSV template for bulk import');
doc('post', '/imports/upload-url', 'Presigned URL to upload an import CSV (≤ 2 MB, 60 s)');
doc('post', '/imports', 'Start an import from an uploaded file', {
  request: json(z.object({ uploadId: z.uuid() })),
});
doc('get', '/imports', 'Recent imports');
doc('get', '/imports/{id}', 'Import status', { request: { params: IdParams } });
doc('get', '/imports/{id}/result-url', 'Download link for the row-by-row result', {
  request: { params: IdParams },
});
doc('get', '/{id}', 'One employee', { request: { params: IdParams } });
doc('patch', '/{id}', 'Edit profile fields (self-service: preferred name, personal email, phone)', {
  request: { params: IdParams, ...json(EmployeeUpdateBody) },
});
doc('get', '/{id}/national-id', 'Reveal the full national ID (employee.sensitive.view; audited)', {
  request: { params: IdParams },
});
doc('get', '/{id}/employment-records', 'Employment history', { request: { params: IdParams } });
doc('post', '/{id}/employment-records', 'Transfer, promotion or manager change from a date', {
  request: { params: IdParams, ...json(EmploymentChangeBody) },
});
doc('post', '/{id}/status', 'Change status (probation, notice, exit …)', {
  request: { params: IdParams, ...json(StatusChangeBody) },
});
doc('get', '/{id}/emergency-contacts', 'Emergency contacts', { request: { params: IdParams } });
doc('post', '/{id}/emergency-contacts', 'Add an emergency contact', {
  request: { params: IdParams, ...json(EmergencyContactBody) },
});
doc('delete', '/{id}/emergency-contacts/{childId}', 'Remove an emergency contact', {
  request: { params: ChildParams },
});
doc('get', '/{id}/bank-accounts', 'Bank accounts (last 4 digits only)', { request: { params: IdParams } });
doc('post', '/{id}/bank-accounts', 'Add a bank account from a date (encrypted)', {
  request: { params: IdParams, ...json(BankAccountBody) },
});
doc('get', '/{id}/documents', 'Documents', { request: { params: IdParams } });
doc('post', '/{id}/documents/upload-url', 'Start a document upload (presigned PUT, 60 s)', {
  request: { params: IdParams, ...json(DocumentUploadBody) },
});
doc('post', '/{id}/documents/{childId}/complete', 'Mark an upload finished; the file is then type-checked', {
  request: { params: ChildParams },
});
doc('get', '/{id}/documents/{childId}/download-url', 'Download link (60 s, attachment)', {
  request: { params: ChildParams },
});
doc('post', '/{id}/documents/{childId}/verify', 'HR confirms the document is genuine', {
  request: { params: ChildParams },
});
doc('delete', '/{id}/documents/{childId}', 'Delete a document', { request: { params: ChildParams } });

/**
 * @param {{ access: ReturnType<typeof import('../../middleware/auth.js').access>,
 *           employees: ReturnType<typeof import('./employees.service.js').createEmployeesService>,
 *           imports: ReturnType<typeof import('./imports.js').createImportsService> }} deps
 */
export function employeesRouter({ access, employees, imports }) {
  const r = Router();
  const signedIn = access.authenticated();
  const create = access.permission('employee.profile.create');
  const update = access.permission('employee.profile.update');
  const bulkImport = access.permission('employee.bulk.import');
  const bulkExport = access.permission('employee.bulk.export');
  const bankManage = access.permission('payroll.bank.manage');
  const docsManage = access.permission('employee.documents.manage');
  const sensitive = access.permission('employee.sensitive.view');

  // Fixed paths first so they are not taken as ids.
  r.get('/', signedIn, validate({ query: EmployeeListQuery }), async (req, res) =>
    res.json(await employees.list(req.query)),
  );
  r.post('/', create, validate({ body: EmployeeCreateBody }), async (req, res) =>
    res.status(201).json(await employees.create(req.body)),
  );
  r.get('/me', signedIn, async (_req, res) => res.json(await employees.me()));
  r.get('/export', bulkExport, async (_req, res) => {
    const rows = await employees.exportRows();
    const header = [
      'employeeCode',
      'firstName',
      'lastName',
      'workEmail',
      'phone',
      'status',
      'dateOfJoining',
      'legalEntity',
      'department',
      'designation',
      'branch',
      'manager',
      'workMode',
      'employmentType',
    ];
    const csv = stringify([header, ...rows.map((row) => header.map((h) => safeCsvCell(row[h])))]);
    res
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="employees.csv"',
        'Cache-Control': 'no-store',
      })
      .send(csv);
  });
  r.get('/imports/template', bulkImport, (_req, res) => {
    res
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="employee-import-template.csv"',
      })
      .send(importTemplate());
  });
  r.post('/imports/upload-url', bulkImport, async (_req, res) => res.json(await imports.startUpload()));
  r.post(
    '/imports',
    bulkImport,
    validate({ body: z.object({ uploadId: z.uuid() }).strict() }),
    async (req, res) => res.status(202).json(await imports.start(req.body.uploadId)),
  );
  r.get('/imports', bulkImport, async (_req, res) => res.json({ data: await imports.list() }));
  r.get('/imports/:id', bulkImport, validate({ params: IdParams }), async (req, res) =>
    res.json(await imports.get(req.params.id)),
  );
  r.get('/imports/:id/result-url', bulkImport, validate({ params: IdParams }), async (req, res) =>
    res.json(await imports.resultUrl(req.params.id)),
  );

  r.get('/:id', signedIn, validate({ params: IdParams }), async (req, res) =>
    res.json(await employees.get(req.params.id)),
  );
  r.patch('/:id', signedIn, validate({ params: IdParams, body: EmployeeUpdateBody }), async (req, res) =>
    res.json(await employees.update(req.params.id, req.body)),
  );
  r.get('/:id/national-id', sensitive, validate({ params: IdParams }), async (req, res) =>
    res.set('Cache-Control', 'no-store').json(await employees.revealNationalId(req.params.id)),
  );
  r.get('/:id/employment-records', signedIn, validate({ params: IdParams }), async (req, res) =>
    res.json({ data: await employees.employmentHistory(req.params.id) }),
  );
  r.post(
    '/:id/employment-records',
    update,
    validate({ params: IdParams, body: EmploymentChangeBody }),
    async (req, res) => res.status(201).json(await employees.changeEmployment(req.params.id, req.body)),
  );
  r.post('/:id/status', update, validate({ params: IdParams, body: StatusChangeBody }), async (req, res) =>
    res.json(await employees.changeStatus(req.params.id, req.body)),
  );

  r.get('/:id/emergency-contacts', signedIn, validate({ params: IdParams }), async (req, res) =>
    res.json({ data: await employees.contacts(req.params.id) }),
  );
  r.post(
    '/:id/emergency-contacts',
    signedIn,
    validate({ params: IdParams, body: EmergencyContactBody }),
    async (req, res) => res.status(201).json(await employees.addContact(req.params.id, req.body)),
  );
  r.delete(
    '/:id/emergency-contacts/:childId',
    signedIn,
    validate({ params: ChildParams }),
    async (req, res) => {
      await employees.removeContact(req.params.id, req.params.childId);
      res.status(204).end();
    },
  );

  r.get('/:id/bank-accounts', signedIn, validate({ params: IdParams }), async (req, res) =>
    res.set('Cache-Control', 'no-store').json({ data: await employees.bankAccounts(req.params.id) }),
  );
  r.post(
    '/:id/bank-accounts',
    bankManage,
    validate({ params: IdParams, body: BankAccountBody }),
    async (req, res) => res.status(201).json(await employees.addBankAccount(req.params.id, req.body)),
  );

  r.get('/:id/documents', signedIn, validate({ params: IdParams }), async (req, res) =>
    res.json({ data: await employees.documents(req.params.id) }),
  );
  r.post(
    '/:id/documents/upload-url',
    signedIn,
    validate({ params: IdParams, body: DocumentUploadBody }),
    async (req, res) => res.status(201).json(await employees.startDocumentUpload(req.params.id, req.body)),
  );
  r.post('/:id/documents/:childId/complete', signedIn, validate({ params: ChildParams }), async (req, res) =>
    res.json(await employees.completeDocumentUpload(req.params.id, req.params.childId)),
  );
  r.get(
    '/:id/documents/:childId/download-url',
    signedIn,
    validate({ params: ChildParams }),
    async (req, res) =>
      res
        .set('Cache-Control', 'no-store')
        .json(await employees.documentDownloadUrl(req.params.id, req.params.childId)),
  );
  r.post(
    '/:id/documents/:childId/verify',
    docsManage,
    validate({ params: ChildParams }),
    async (req, res) => {
      await employees.verifyDocument(req.params.id, req.params.childId);
      res.status(204).end();
    },
  );
  r.delete('/:id/documents/:childId', signedIn, validate({ params: ChildParams }), async (req, res) => {
    await employees.deleteDocument(req.params.id, req.params.childId);
    res.status(204).end();
  });
  return r;
}
