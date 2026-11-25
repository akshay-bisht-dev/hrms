// Integration: employee records, scopes, history, documents (real S3), import and export.
import { parse } from 'csv-parse/sync';
import { runWithContext } from '../src/lib/context.js';
import { verifyDocument } from '../src/modules/employees/verify-document.js';
import { startHarness } from './helpers/harness.js';

let h;
let owner; // Company Admin with MFA → COMPANY scope on everything
let le;
let refs;
beforeAll(async () => {
  h = await startHarness();
  owner = await h.owner('emp', { mfa: true });
  le = (await owner.call('get', '/companies/legal-entities').expect(200)).body.data[0];
  const post = async (path, body) => (await owner.call('post', path).send(body).expect(201)).body;
  refs = {
    eng: await post('/companies/departments', { name: 'Engineering', code: 'ENG' }),
    sales: await post('/companies/departments', { name: 'Sales', code: 'SALES' }),
    swe: await post('/companies/designations', { title: 'Software Engineer' }),
    lead: await post('/companies/designations', { title: 'Engineering Lead' }),
    blr: await post('/companies/branches', {
      legalEntityId: le.id,
      name: 'Bengaluru',
      code: 'BLR',
      timezone: 'Asia/Kolkata',
    }),
  };
});
afterAll(() => h.stop());

const mk = (body, c = owner) =>
  c.call('post', '/employees').send({ legalEntityId: le.id, dateOfJoining: '2026-01-05', ...body });
const create = async (body) => (await mk(body).expect(201)).body;
/** Member with a role, linked to an employee record. */
async function linkedMember(roleKey, employee, tag) {
  const m = await h.member(owner, [roleKey], tag);
  await owner
    .call('put', `/tenants/members/${m.membershipId}/employee`)
    .send({ employeeId: employee.id })
    .expect(204);
  return m;
}
const asWorker = (fn) =>
  runWithContext(
    { requestId: 'test-worker', tenantId: owner.tenantId, userId: owner.userId },
    async () => await fn(),
  );

describe('create and read', () => {
  test('defaults from the legal entity, auto employee code, joining record, ACTIVE status', async () => {
    const e = await create({
      firstName: 'Priya',
      lastName: 'Sharma',
      workEmail: 'Priya.S@Example.com',
      departmentId: refs.eng.id,
      designationId: refs.swe.id,
      branchId: refs.blr.id,
    });
    expect(e).toMatchObject({
      employeeCode: expect.stringMatching(/^E\d{5}$/),
      workCountry: 'IN',
      payCurrency: 'INR',
      timezone: le.timezone,
      status: 'ACTIVE',
      workEmail: 'priya.s@example.com',
    });
    expect(e.department).toMatchObject({ code: 'ENG' });
    const hist = (await owner.call('get', `/employees/${e.id}/employment-records`).expect(200)).body.data;
    expect(hist).toEqual([
      expect.objectContaining({
        changeReason: 'JOINING',
        effectiveFrom: '2026-01-05',
        effectiveTo: null,
        department: 'Engineering',
      }),
    ]);
    const next = await create({ firstName: 'Next' });
    expect(Number(next.employeeCode.slice(1))).toBe(Number(e.employeeCode.slice(1)) + 1);
  });

  test('status defaults: future joiners are PREBOARDING, a probation date means PROBATION', async () => {
    expect((await create({ firstName: 'Future', dateOfJoining: '2099-01-01' })).status).toBe('PREBOARDING');
    expect((await create({ firstName: 'Prob', probationEndDate: '2026-07-05' })).status).toBe('PROBATION');
  });

  test('duplicate employee code → 409; unknown references → 422; cannot be created as exited', async () => {
    await create({ firstName: 'A', employeeCode: 'DUP-1' });
    expect((await mk({ firstName: 'B', employeeCode: 'dup-1' })).body.code).toBe('employee_code_in_use');
    expect((await mk({ firstName: 'C', departmentId: '0190f7a0-0000-7000-8000-000000000000' })).status).toBe(
      422,
    );
    expect((await mk({ firstName: 'D', status: 'EXITED' })).status).toBe(422);
  });

  test('national IDs: validated per country, encrypted, masked; full value needs employee.sensitive.view', async () => {
    expect(
      (await mk({ firstName: 'Bad', nationalIdType: 'PAN', nationalId: '1234' })).body.errors[0].message,
    ).toMatch(/valid PAN/);
    expect(
      (await mk({ firstName: 'Bad', nationalIdType: 'SSN', nationalId: '123-45-6789' })).body.errors[0]
        .message,
    ).toMatch(/Use one of: PAN/);
    const e = await create({ firstName: 'Ravi', nationalIdType: 'PAN', nationalId: 'abcde1234f' });
    expect(e.nationalId).toEqual({ type: 'PAN', masked: '•••• 234F' });
    const row = await h.db().employee.findUnique({ where: { id: e.id } });
    expect(Buffer.from(row.nationalIdEnc).toString('latin1')).not.toContain('ABCDE1234F');
    expect(row.nationalIdIndex).toHaveLength(64);
    expect((await owner.call('get', `/employees/${e.id}/national-id`).expect(200)).body).toEqual({
      type: 'PAN',
      value: 'ABCDE1234F',
    });
    expect(
      (await mk({ firstName: 'Copy', nationalIdType: 'PAN', nationalId: 'ABCDE 1234 F' })).body.code,
    ).toBe('national_id_in_use');
    const audit = await h.db().auditLog.findFirst({
      where: { tenantId: owner.tenantId, action: 'employee.national_id_viewed', entityId: e.id },
    });
    expect(audit).toBeTruthy();
  });
});

describe('data scopes', () => {
  let lead;
  let report;
  let subReport;
  let other;
  let leadMember;
  beforeAll(async () => {
    lead = await create({ firstName: 'Lena', lastName: 'Lead', departmentId: refs.eng.id });
    report = await create({ firstName: 'Raj', departmentId: refs.eng.id, managerId: lead.id });
    subReport = await create({ firstName: 'Sub', departmentId: refs.eng.id, managerId: report.id });
    other = await create({ firstName: 'Olga', departmentId: refs.sales.id });
    leadMember = await linkedMember('team_leader', lead, 'lead');
  });

  test('Team Leader sees themselves and everyone below them, nobody else', async () => {
    const ids = (await leadMember.call('get', '/employees?limit=200').expect(200)).body.data.map((e) => e.id);
    expect(ids.sort()).toEqual([lead.id, report.id, subReport.id].sort());
    await leadMember.call('get', `/employees/${subReport.id}`).expect(200);
    expect((await leadMember.call('get', `/employees/${other.id}`)).status).toBe(404);
  });

  test('an Employee sees only their own record; /employees/me works', async () => {
    const emp = await linkedMember('employee', other, 'olga');
    const list = (await emp.call('get', '/employees').expect(200)).body.data;
    expect(list.map((e) => e.id)).toEqual([other.id]);
    expect((await emp.call('get', '/employees/me').expect(200)).body.id).toBe(other.id);
    expect((await emp.call('get', `/employees/${lead.id}`)).status).toBe(404);
  });

  test('a Department Manager sees their department only', async () => {
    const dm = await create({ firstName: 'Dora', departmentId: refs.sales.id });
    const m = await linkedMember('department_manager', dm, 'dm');
    const ids = (await m.call('get', '/employees?limit=200').expect(200)).body.data.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([dm.id, other.id]));
    expect(ids).not.toContain(lead.id);
  });

  test('a member with no linked employee record and only OWN scope sees nothing', async () => {
    const m = await h.member(owner, ['employee'], 'unlinked');
    expect((await m.call('get', '/employees').expect(200)).body.data).toEqual([]);
    expect((await m.call('get', '/employees/me')).body.code).toBe('no_employee_record');
  });

  test('self-service: change own phone, but not own name; nobody edits others without permission', async () => {
    const emp = await linkedMember('employee', await create({ firstName: 'Sam' }), 'sam');
    const me = (await emp.call('get', '/employees/me').expect(200)).body;
    await emp.call('patch', `/employees/${me.id}`).send({ phone: '+91 98765 43210' }).expect(200);
    expect((await emp.call('patch', `/employees/${me.id}`).send({ firstName: 'Samuel' })).body.code).toBe(
      'self_service_limited',
    );
    expect((await emp.call('patch', `/employees/${lead.id}`).send({ phone: '+91 90000 00000' })).status).toBe(
      403,
    );
  });
});

describe('employment history and reporting lines', () => {
  test('promotion closes the previous record and updates the current snapshot', async () => {
    const e = await create({ firstName: 'Pro', designationId: refs.swe.id, dateOfJoining: '2025-01-01' });
    await owner
      .call('post', `/employees/${e.id}/employment-records`)
      .send({ effectiveFrom: '2026-04-01', changeReason: 'PROMOTION', designationId: refs.lead.id })
      .expect(201);
    const hist = (await owner.call('get', `/employees/${e.id}/employment-records`).expect(200)).body.data;
    expect(hist.map((r) => [r.changeReason, r.effectiveFrom, r.effectiveTo, r.designation])).toEqual([
      ['PROMOTION', '2026-04-01', null, 'Engineering Lead'],
      ['JOINING', '2025-01-01', '2026-03-31', 'Software Engineer'],
    ]);
    expect((await owner.call('get', `/employees/${e.id}`).expect(200)).body.designation.title).toBe(
      'Engineering Lead',
    );
    expect(
      (
        await owner
          .call('post', `/employees/${e.id}/employment-records`)
          .send({ effectiveFrom: '2026-02-01', changeReason: 'CORRECTION', designationId: refs.swe.id })
      ).status,
    ).toBe(422); // before current
  });

  test('future-dated changes are scheduled, applied on their date by the worker, and can be cancelled', async () => {
    const boss = await create({ firstName: 'Future boss' });
    const e = await create({ firstName: 'Scheduled', departmentId: refs.sales.id });
    const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const change = (body) => owner.call('post', `/employees/${e.id}/employment-records`).send(body);
    await change({
      effectiveFrom: inDays(10),
      changeReason: 'TRANSFER',
      departmentId: refs.eng.id,
      managerId: boss.id,
    }).expect(201);
    let now = (await owner.call('get', `/employees/${e.id}`).expect(200)).body;
    expect(now.department.code).toBe('SALES'); // not yet
    expect(now.manager).toBeNull();
    const hist = (await owner.call('get', `/employees/${e.id}/employment-records`).expect(200)).body.data;
    expect(hist[0]).toMatchObject({ effectiveFrom: inDays(10), scheduled: true, department: 'Engineering' });
    expect(hist[1]).toMatchObject({ effectiveTo: inDays(9), scheduled: false });
    // Only one scheduled change at a time.
    expect(
      (
        await change({
          effectiveFrom: inDays(20),
          changeReason: 'PROMOTION',
          designationId: refs.lead.id,
        }).expect(409)
      ).body.code,
    ).toBe('change_scheduled');
    // Nothing is due today; on the date it is applied once, and re-running changes nothing.
    expect(await asWorker(() => h.services.employees.applyDueChanges())).toMatchObject({ applied: 0 });
    const due = new Date(Date.now() + 10 * 86_400_000 + 3_600_000);
    expect(await asWorker(() => h.services.employees.applyDueChanges(due))).toMatchObject({ applied: 1 });
    expect(await asWorker(() => h.services.employees.applyDueChanges(due))).toMatchObject({ applied: 0 });
    now = (await owner.call('get', `/employees/${e.id}`).expect(200)).body;
    expect(now.department.code).toBe('ENG');
    expect(now.manager.id).toBe(boss.id);

    // Cancelling reopens the earlier record.
    const f = await create({ firstName: 'Cancelled', departmentId: refs.sales.id });
    await owner
      .call('post', `/employees/${f.id}/employment-records`)
      .send({ effectiveFrom: inDays(5), changeReason: 'TRANSFER', departmentId: refs.eng.id })
      .expect(201);
    const [scheduled, joining] = (
      await owner.call('get', `/employees/${f.id}/employment-records`).expect(200)
    ).body.data;
    await owner.call('delete', `/employees/${f.id}/employment-records/${joining.id}`).expect(409);
    await owner.call('delete', `/employees/${f.id}/employment-records/${scheduled.id}`).expect(204);
    const after = (await owner.call('get', `/employees/${f.id}/employment-records`).expect(200)).body.data;
    expect(after).toEqual([expect.objectContaining({ id: joining.id, effectiveTo: null, scheduled: false })]);
  });

  test('changing a manager moves the whole sub-team; loops are refused', async () => {
    const a = await create({ firstName: 'Alpha' });
    const b = await create({ firstName: 'Bravo', managerId: a.id });
    const c = await create({ firstName: 'Charlie', managerId: b.id });
    const z = await create({ firstName: 'Zulu' });
    expect(
      (
        await owner
          .call('post', `/employees/${a.id}/employment-records`)
          .send({ effectiveFrom: '2026-01-05', changeReason: 'MANAGER_CHANGE', managerId: c.id })
      ).body.errors[0].message,
    ).toMatch(/report to themselves/);
    expect(
      (
        await owner
          .call('post', `/employees/${a.id}/employment-records`)
          .send({ effectiveFrom: '2026-01-05', changeReason: 'MANAGER_CHANGE', managerId: a.id })
      ).status,
    ).toBe(422);
    await owner
      .call('post', `/employees/${b.id}/employment-records`)
      .send({ effectiveFrom: '2026-01-05', changeReason: 'MANAGER_CHANGE', managerId: z.id })
      .expect(201);
    const under = async (mgr) =>
      (await h.db().employeeHierarchy.findMany({ where: { ancestorId: mgr, depth: { gt: 0 } } }))
        .map((r) => r.descendantId)
        .sort();
    expect(await under(z.id)).toEqual([b.id, c.id].sort());
    expect(await under(a.id)).toEqual([]);
    const zLead = await linkedMember('team_leader', z, 'zulu');
    expect(
      (await zLead.call('get', '/employees?limit=200').expect(200)).body.data.map((e) => e.id).sort(),
    ).toEqual([z.id, b.id, c.id].sort());
  });

  test('status lifecycle: notice → exit; exit needs reports moved and signs the person out', async () => {
    const boss = await create({ firstName: 'Boss' });
    const sub = await create({ firstName: 'Sub', managerId: boss.id });
    const m = await linkedMember('employee', boss, 'boss');
    await owner
      .call('post', `/employees/${boss.id}/status`)
      .send({ status: 'NOTICE', effectiveDate: '2026-11-25', reason: 'Resigned' })
      .expect(200);
    expect(
      (
        await owner
          .call('post', `/employees/${boss.id}/status`)
          .send({ status: 'EXITED', effectiveDate: '2026-12-31', reason: 'Last day' })
      ).body.code,
    ).toBe('has_reports');
    await owner
      .call('post', `/employees/${sub.id}/employment-records`)
      .send({ effectiveFrom: '2026-01-05', changeReason: 'MANAGER_CHANGE', managerId: null })
      .expect(201);
    const exited = (
      await owner
        .call('post', `/employees/${boss.id}/status`)
        .send({ status: 'EXITED', effectiveDate: '2026-12-31', reason: 'Last day' })
        .expect(200)
    ).body;
    expect(exited).toMatchObject({ status: 'EXITED', exitDate: '2026-12-31' });
    expect((await m.call('get', '/auth/me')).body.code).toBe('session_revoked');
    expect(
      (
        await owner
          .call('post', `/employees/${boss.id}/status`)
          .send({ status: 'ACTIVE', effectiveDate: '2027-01-01', reason: 'Back' })
      ).body.code,
    ).toBe('invalid_transition');
    expect(
      (await owner.call('get', '/employees?limit=200').expect(200)).body.data.map((e) => e.id),
    ).not.toContain(boss.id);
    expect(
      (await owner.call('get', '/employees?limit=200&includeExited=true').expect(200)).body.data.map(
        (e) => e.id,
      ),
    ).toContain(boss.id);
  });
});

describe('emergency contacts and bank accounts', () => {
  test('the person adds their own contacts; colleagues cannot', async () => {
    const e = await create({ firstName: 'Cora' });
    const m = await linkedMember('employee', e, 'cora');
    const c = (
      await m
        .call('post', `/employees/${e.id}/emergency-contacts`)
        .send({ name: 'Mira', relationship: 'Sister', phone: '+91 91234 56789' })
        .expect(201)
    ).body;
    expect(
      (await owner.call('get', `/employees/${e.id}/emergency-contacts`).expect(200)).body.data,
    ).toHaveLength(1);
    const colleague = await linkedMember('employee', await create({ firstName: 'Nosy' }), 'nosy');
    expect(
      (
        await colleague
          .call('post', `/employees/${e.id}/emergency-contacts`)
          .send({ name: 'X', relationship: 'Y', phone: '+91 90000 00000' })
      ).status,
    ).toBe(404);
    await m.call('delete', `/employees/${e.id}/emergency-contacts/${c.id}`).expect(204);
  });

  test('bank accounts are encrypted, shown as last 4 only, and a new account closes the old one', async () => {
    const e = await create({ firstName: 'Bina' });
    const a1 = (
      await owner
        .call('post', `/employees/${e.id}/bank-accounts`)
        .send({
          accountHolder: 'Bina K',
          accountNumber: '1234 5678 9012',
          bankFields: { ifsc: 'HDFC0001234' },
          currency: 'INR',
          effectiveFrom: '2026-01-01',
        })
        .expect(201)
    ).body;
    expect(a1).toMatchObject({ accountNumber: '•••• 9012', isPrimary: true });
    await owner
      .call('post', `/employees/${e.id}/bank-accounts`)
      .send({
        accountHolder: 'Bina K',
        accountNumber: '999988887777',
        currency: 'INR',
        effectiveFrom: '2026-06-01',
      })
      .expect(201);
    const list = (await owner.call('get', `/employees/${e.id}/bank-accounts`).expect(200)).body.data;
    expect(list.map((a) => [a.accountNumber, a.effectiveTo, a.isPrimary])).toEqual([
      ['•••• 7777', null, true],
      ['•••• 9012', '2026-05-31', false],
    ]);
    expect(JSON.stringify(list)).not.toMatch(/123456789012|999988887777/);
    const rows = await h.db().employeeBankAccount.findMany({ where: { employeeId: e.id } });
    expect(rows.every((r) => !Buffer.from(r.accountNumberEnc).toString('latin1').includes('9012'))).toBe(
      true,
    );

    const m = await linkedMember('employee', e, 'bina');
    expect((await m.call('get', `/employees/${e.id}/bank-accounts`).expect(200)).body.data).toHaveLength(2); // own, masked
    const hr = await h.member(owner, ['hr_manager'], 'hrbank');
    expect((await hr.call('get', `/employees/${e.id}/bank-accounts`)).status).toBe(404); // no payroll.bank.view
  });
});

describe('documents (real S3)', () => {
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

  async function upload(c, employeeId, body, bytes) {
    const start = (
      await c
        .call('post', `/employees/${employeeId}/documents/upload-url`)
        .send({
          category: 'ID_PROOF',
          fileName: 'Passport scan.pdf',
          mimeType: 'application/pdf',
          sizeBytes: bytes.length,
          ...body,
        })
        .expect(201)
    ).body;
    const put = await fetch(start.uploadUrl, { method: 'PUT', headers: start.headers, body: bytes });
    expect(put.status).toBe(200);
    await c.call('post', `/employees/${employeeId}/documents/${start.documentId}/complete`).expect(200);
    return start.documentId;
  }

  test('upload → type check → download as attachment; HR verifies; delete removes the file', async () => {
    const e = await create({ firstName: 'Dina' });
    const m = await linkedMember('employee', e, 'dina');
    const before = h.jobs.files.length;
    const id = await upload(m, e.id, {}, PDF);
    expect(h.jobs.files.slice(before)).toEqual([
      { name: 'verify-document', data: { tenantId: owner.tenantId, documentId: id } },
    ]);
    expect((await m.call('get', `/employees/${e.id}/documents/${id}/download-url`)).body.code).toBe(
      'not_ready',
    );

    expect(
      await asWorker(() =>
        verifyDocument({ files: h.services.files, bucket: h.env.S3_BUCKET_DOCUMENTS }, id),
      ),
    ).toBe('CLEAN');
    const { url } = (await m.call('get', `/employees/${e.id}/documents/${id}/download-url`).expect(200)).body;
    const got = await fetch(url);
    expect(got.headers.get('content-disposition')).toMatch(/^attachment; filename="Passport scan.pdf"/);
    expect(Buffer.from(await got.arrayBuffer()).equals(PDF)).toBe(true);

    await owner.call('post', `/employees/${e.id}/documents/${id}/verify`).expect(204);
    expect((await m.call('get', `/employees/${e.id}/documents`).expect(200)).body.data[0]).toMatchObject({
      scanStatus: 'CLEAN',
      verifiedAt: expect.any(String),
    });
    await m.call('delete', `/employees/${e.id}/documents/${id}`).expect(204);
    const row = await h.db().employeeDocument.findUnique({ where: { id } });
    await expect(h.services.files.head(h.env.S3_BUCKET_DOCUMENTS, row.s3Key)).rejects.toThrow();
  });

  test('a file whose bytes do not match its declared type is rejected and deleted', async () => {
    const e = await create({ firstName: 'Evil' });
    const fake = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0x90)]); // Windows executable header
    const id = await upload(owner, e.id, { fileName: 'cv.pdf' }, fake);
    expect(
      await asWorker(() =>
        verifyDocument({ files: h.services.files, bucket: h.env.S3_BUCKET_DOCUMENTS }, id),
      ),
    ).toBe('FAILED');
    expect((await owner.call('get', `/employees/${e.id}/documents/${id}/download-url`)).body.code).toBe(
      'not_ready',
    );
    const row = await h.db().employeeDocument.findUnique({ where: { id } });
    await expect(h.services.files.head(h.env.S3_BUCKET_DOCUMENTS, row.s3Key)).rejects.toThrow();
  });

  test('completing before uploading is refused; disallowed types never get an upload URL; colleagues get 404', async () => {
    const e = await create({ firstName: 'Faye' });
    const start = (
      await owner
        .call('post', `/employees/${e.id}/documents/upload-url`)
        .send({ category: 'OTHER', fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10 })
        .expect(201)
    ).body;
    expect(
      (await owner.call('post', `/employees/${e.id}/documents/${start.documentId}/complete`)).body.code,
    ).toBe('upload_missing');
    expect(
      (
        await owner
          .call('post', `/employees/${e.id}/documents/upload-url`)
          .send({ category: 'OTHER', fileName: 'a.svg', mimeType: 'image/svg+xml', sizeBytes: 10 })
      ).status,
    ).toBe(422);
    const colleague = await linkedMember('employee', await create({ firstName: 'Gus' }), 'gus');
    expect((await colleague.call('get', `/employees/${e.id}/documents`)).status).toBe(404);
  });
});

describe('bulk import and export', () => {
  async function uploadCsv(text) {
    const { uploadId, uploadUrl, headers } = (
      await owner.call('post', '/employees/imports/upload-url').expect(200)
    ).body;
    expect((await fetch(uploadUrl, { method: 'PUT', headers, body: text })).status).toBe(200);
    return uploadId;
  }

  test('rows are created (managers may come later in the file), errors are reported per row, re-runs are safe', async () => {
    const template = (await owner.call('get', '/employees/imports/template').expect(200)).text;
    expect(template.split('\n')[0]).toBe(
      'employeeCode,firstName,lastName,workEmail,phone,dateOfJoining,legalEntity,departmentCode,designation,branchCode,managerEmployeeCode,workMode,employmentType,status,probationEndDate',
    );
    const csv = [
      template.split('\n')[0],
      'IMP-2,Ivy,Report,ivy@example.com,,2026-02-01,,ENG,Software Engineer,BLR,IMP-1,HYBRID,FULL_TIME,ACTIVE,',
      'IMP-1,Ian,Boss,ian@example.com,,2026-01-15,,ENG,Engineering Lead,BLR,,OFFICE,FULL_TIME,ACTIVE,',
      'IMP-3,Bad,Date,,,15/01/2026,,,,,,,,,',
      'IMP-4,No,Dept,,,2026-01-15,,NOPE,,,,,,,',
      'IMP-5,Ghost,Manager,,,2026-01-15,,,,,GHOST-9,,,,',
    ].join('\n');
    const uploadId = await uploadCsv(csv);
    const started = (await owner.call('post', '/employees/imports').send({ uploadId }).expect(202)).body;
    expect(started.status).toBe('QUEUED');
    expect(h.jobs.imports.at(-1)).toEqual({
      name: 'employees',
      data: { tenantId: owner.tenantId, userId: owner.userId, jobId: uploadId },
    });

    const done = await asWorker(() => h.services.imports.process(uploadId));
    expect(done).toMatchObject({ status: 'PARTIAL', totalRows: 5, okRows: 2, errorRows: 3 });
    const { url } = (await owner.call('get', `/employees/imports/${uploadId}/result-url`).expect(200)).body;
    const result = parse(await (await fetch(url)).text(), { columns: true });
    expect(result.map((r) => [r.employeeCode, r.result])).toEqual([
      ['IMP-2', 'created'],
      ['IMP-1', 'created'],
      ['IMP-3', 'error'],
      ['IMP-4', 'error'],
      ['IMP-5', 'error'],
    ]);
    expect(result[3].message).toMatch(/Department "NOPE" not found/);
    expect(result[4].message).toMatch(/Manager "GHOST-9" not found/);

    const ivy = (await owner.call('get', '/employees?q=IMP-2').expect(200)).body.data[0];
    expect(ivy).toMatchObject({
      manager: { employeeCode: 'IMP-1' },
      department: { code: 'ENG' },
      workMode: 'HYBRID',
    });

    expect(
      (await owner.call('post', '/employees/imports').send({ uploadId: await uploadCsv(csv) })).body.code,
    ).toBe('duplicate_import');
    const again = await asWorker(() => h.services.imports.process(uploadId)); // a retried job is a no-op
    expect(again.status).toBe('PARTIAL');
    expect((await owner.call('get', '/employees?q=IMP-1').expect(200)).body.data).toHaveLength(1);
  });

  test('export neutralizes spreadsheet formulas and respects scope', async () => {
    await create({ firstName: '=HYPERLINK("http://evil.example","click")', lastName: '+cmd' });
    const res = await owner.call('get', '/employees/export').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    const rows = parse(res.text, { columns: true });
    const evil = rows.find((r) => r.lastName.includes('cmd'));
    expect(evil.firstName.startsWith("'=")).toBe(true);
    expect(evil.lastName).toBe("'+cmd");
    const emp = await linkedMember('employee', await create({ firstName: 'Exporter' }), 'exp');
    expect((await emp.call('get', '/employees/export')).status).toBe(403);
  });
});

describe('linking sign-in accounts', () => {
  test('inviting with an employee id links the account; one account per employee', async () => {
    const e = await create({ firstName: 'Lina' });
    const roles = (await owner.call('get', '/tenants/roles').expect(200)).body.data;
    const emp = roles.find((r) => r.systemKey === 'employee').id;
    await owner
      .call('post', '/tenants/invitations')
      .send({ email: h.uniqueEmail('lina'), roleIds: [emp], employeeId: e.id })
      .expect(201);
    const second = await h.member(owner, ['employee'], 'second');
    expect(
      (await owner.call('put', `/tenants/members/${second.membershipId}/employee`).send({ employeeId: e.id }))
        .body.code,
    ).toBe('employee_already_linked');
    expect((await owner.call('get', `/employees/${e.id}`).expect(200)).body.member).toMatchObject({
      status: 'INVITED',
    });
  });
});
