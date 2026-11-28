// Integration: payroll configuration, salaries, loss of pay from unpaid leave, runs with maker-checker,
// finalization and immutability, payslips (real S3), bank file, register, variance, tax declarations, scopes.
import { parse } from 'csv-parse/sync';
import { runWithContext } from '../src/lib/context.js';
import { db } from '../src/lib/db.js';
import { startHarness } from './helpers/harness.js';

let h;
let owner; // Company Admin with MFA, not linked to an employee
let maker; // payroll_manager with MFA: creates, calculates, reviews
let checker; // finance_manager with MFA: approves, finalizes
let ravi; // employee linked to `raviEmp`
let asha; // employee linked to `ashaEmp`
let le;
let raviEmp;
let ashaEmp;
let mohanEmp;
let structure;
let components; // code → component
let novRun;
const asTenant = (fn, userId = owner.userId) =>
  runWithContext({ requestId: 'test', tenantId: owner.tenantId, userId }, async () => await fn());
const svc = () => h.services.payrollRuns;
const lines = (detail) => Object.fromEntries(detail.lines.map((l) => [l.code, l.amount]));

beforeAll(async () => {
  h = await startHarness();
  owner = await h.owner('pay', { mfa: true });
  le = (await owner.call('get', '/companies/legal-entities').expect(200)).body.data[0];
  const post = async (path, body) => (await owner.call('post', path).send(body).expect(201)).body;
  const person = (firstName, extra = {}) =>
    post('/employees', {
      firstName,
      legalEntityId: le.id,
      dateOfJoining: '2026-01-05',
      timezone: 'Asia/Kolkata',
      ...extra,
    });
  raviEmp = await person('Ravi');
  ashaEmp = await person('Asha', { gender: 'Female' });
  mohanEmp = await person('Mohan');
  const link = async (roleKey, employee, tag) => {
    const m = await h.member(owner, [roleKey], tag);
    if (employee)
      await owner
        .call('put', `/tenants/members/${m.membershipId}/employee`)
        .send({ employeeId: employee.id })
        .expect(204);
    return m;
  };
  maker = await h.enableMfa(await link('payroll_manager', null, 'paymaker'));
  checker = await h.enableMfa(await link('finance_manager', null, 'paychecker'));
  ravi = await link('employee', raviEmp, 'payravi');
  asha = await link('employee', ashaEmp, 'payasha');
});
afterAll(() => h.stop());

describe('configuration', () => {
  test('the India pack is available, with its rule version pinned and marked as not yet expert-reviewed', async () => {
    const keys = (await maker.call('get', `/payroll/legal-entities/${le.id}/statutory-keys`).expect(200))
      .body;
    expect(keys).toMatchObject({ countryCode: 'IN', pack: { code: 'IN', ruleVersion: 1, reviewed: false } });
    expect(keys.keys.map((k) => k.key)).toEqual(
      expect.arrayContaining(['IN.PF.EE', 'IN.ESI.EE', 'IN.PT', 'IN.TDS']),
    );
  });

  test('the India starter creates components once and a structure in the right order', async () => {
    const out = (await maker.call('post', '/payroll/starter/in').send({ legalEntityId: le.id }).expect(201))
      .body;
    expect(out.createdComponents).toEqual([
      'BASIC',
      'HRA',
      'PF_ER',
      'SPECIAL',
      'BONUS',
      'REIMB',
      'PF_EE',
      'ESI_EE',
      'ESI_ER',
      'PT',
      'TDS',
    ]);
    structure = out.structure;
    expect(structure.components.map((c) => c.code)).toEqual(out.createdComponents);
    const again = (await maker.call('post', '/payroll/starter/in').send({ legalEntityId: le.id }).expect(201))
      .body;
    expect(again.createdComponents).toEqual([]);
    components = Object.fromEntries(
      (await maker.call('get', '/payroll/components?limit=200').expect(200)).body.data.map((c) => [
        c.code,
        c,
      ]),
    );
  });

  test('components and structures are checked: formulas, order, statutory items', async () => {
    await maker
      .call('post', '/payroll/components')
      .send({ code: 'BAD', name: 'Bad', kind: 'EARNING', calcType: 'FORMULA', formula: 'BASIC +' })
      .expect(422);
    await maker
      .call('post', '/payroll/components')
      .send({ code: 'BAD2', name: 'Bad', kind: 'DEDUCTION', calcType: 'STATUTORY', statutoryKey: 'XX.TAX' })
      .expect(422);
    await maker
      .call('post', '/payroll/components')
      .send({ code: 'BAD3', name: 'Bad', kind: 'EARNING', calcType: 'FIXED' })
      .expect(422);
    // SPECIAL before BASIC: refers to a component that comes later.
    const s = (
      await maker
        .call('post', '/payroll/structures')
        .send({ legalEntityId: le.id, name: 'Wrong order', currency: 'INR', effectiveFrom: '2026-01-01' })
        .expect(201)
    ).body;
    const res = await maker
      .call('put', `/payroll/structures/${s.id}/components`)
      .send({
        components: [
          { componentId: components.SPECIAL.id, sequence: 1 },
          { componentId: components.BASIC.id, sequence: 2 },
          { componentId: components.HRA.id, sequence: 3 },
          { componentId: components.PF_ER.id, sequence: 4 },
        ],
      })
      .expect(422);
    expect(res.body.errors.map((e) => e.message).join(' ')).toMatch(
      /SPECIAL uses BASIC, which must come before it/,
    );
  });

  test('statutory settings from a date; unknown PT state refused; payroll settings', async () => {
    await maker
      .call('put', `/payroll/legal-entities/${le.id}/statutory-settings`)
      .send({ settings: { ptState: 'XX' }, effectiveFrom: '2025-04-01' })
      .expect(422);
    const st = (
      await maker
        .call('put', `/payroll/legal-entities/${le.id}/statutory-settings`)
        .send({
          settings: { ptState: 'KA' },
          registrationNumbers: { pf: 'KABNG1234567000' },
          effectiveFrom: '2025-04-01',
        })
        .expect(200)
    ).body;
    expect(st.settings).toMatchObject({
      ptState: 'KA',
      pfEnabled: true,
      pfWageCodes: ['BASIC'],
      pfOnActualWages: false,
    });
    expect(st.ptStates.map((p) => p.code)).toEqual(['KA', 'MH']);
    const ps = (
      await maker
        .call('put', `/payroll/legal-entities/${le.id}/settings`)
        .send({ paidDaysBasis: 'CALENDAR', lopFromAbsence: false, payDayOfMonth: 28 })
        .expect(200)
    ).body;
    expect(ps.payDayOfMonth).toBe(28);
  });

  test('a salary preview shows the monthly breakdown', async () => {
    const p = (
      await maker
        .call('get', `/payroll/salary-preview?structureId=${structure.id}&annualCtc=1200000`)
        .expect(200)
    ).body;
    expect(p.totals).toMatchObject({ gross: '98200.0000', net: '96200.0000', employerCost: '100000.0000' });
  });
});

describe('salaries', () => {
  test('set from a date; overlapping dates refused; employees cannot see salaries', async () => {
    await maker
      .call('post', `/payroll/employees/${raviEmp.id}/salaries`)
      .send({
        structureId: structure.id,
        annualCtc: '1200000',
        effectiveFrom: '2026-01-05',
        reason: 'JOINING',
      })
      .expect(201);
    await maker
      .call('post', `/payroll/employees/${raviEmp.id}/salaries`)
      .send({
        structureId: structure.id,
        annualCtc: '1300000',
        effectiveFrom: '2026-01-05',
        reason: 'REVISION',
      })
      .expect(409);
    await owner
      .call('post', `/payroll/employees/${ashaEmp.id}/salaries`)
      .send({
        structureId: structure.id,
        annualCtc: '264000',
        effectiveFrom: '2026-01-05',
        reason: 'JOINING',
      })
      .expect(201);
    expect(
      (await checker.call('get', `/payroll/employees/${raviEmp.id}/salaries`).expect(200)).body.data[0],
    ).toMatchObject({ annualCtc: '1200000.0000' });
    await ravi.call('get', `/payroll/employees/${raviEmp.id}/salaries`).expect(403);
    await checker
      .call('post', `/payroll/employees/${raviEmp.id}/salaries`)
      .send({ structureId: structure.id, annualCtc: '1', effectiveFrom: '2026-06-01', reason: 'REVISION' })
      .expect(403);
  });

  test('two days of approved unpaid leave in November become loss of pay', async () => {
    const lwp = (
      await owner
        .call('post', '/leaves/types')
        .send({ code: 'LWP', name: 'Leave without pay', isPaid: false })
        .expect(201)
    ).body;
    const policy = (
      await owner
        .call('post', '/leaves/policies')
        .send({
          leaveTypeId: lwp.id,
          name: 'LWP',
          rules: { accrual: { method: 'NONE' } },
          effectiveFrom: '2026-01-01',
        })
        .expect(201)
    ).body;
    await owner
      .call('post', '/leaves/policy-assignments')
      .send({ policyId: policy.id, appliesTo: 'COMPANY', effectiveFrom: '2026-01-01' })
      .expect(201);
    const req = (
      await ravi
        .call('post', '/leaves/requests')
        .send({ leaveTypeId: lwp.id, fromDate: '2026-11-16', toDate: '2026-11-17' })
        .expect(201)
    ).body;
    await owner
      .call('post', `/leaves/requests/${req.id}/decision`)
      .send({ decision: 'APPROVED' })
      .expect(200);
  });
});

describe('a payroll run from draft to paid', () => {
  test('create, one run per month, inputs only for input components', async () => {
    novRun = (
      await maker.call('post', '/payroll/runs').send({ legalEntityId: le.id, month: '2026-11' }).expect(201)
    ).body;
    expect(novRun).toMatchObject({
      status: 'DRAFT',
      currency: 'INR',
      period: { startDate: '2026-11-01', endDate: '2026-11-30', payDate: '2026-11-28' },
    });
    await maker.call('post', '/payroll/runs').send({ legalEntityId: le.id, month: '2026-11' }).expect(409);
    await maker
      .call('post', `/payroll/runs/${novRun.id}/inputs`)
      .send({ employeeId: ashaEmp.id, componentId: components.BASIC.id, amount: '100' })
      .expect(422);
    await maker
      .call('post', `/payroll/runs/${novRun.id}/inputs`)
      .send({ employeeId: ashaEmp.id, componentId: components.REIMB.id, amount: '2500', note: 'Internet' })
      .expect(201);
    await ravi.call('get', '/payroll/runs').expect(403);
  });

  test('lock, calculate in the worker, results with loss of pay, ESI, PT and traces', async () => {
    expect((await maker.call('post', `/payroll/runs/${novRun.id}/lock`).expect(200)).body.status).toBe(
      'INPUTS_LOCKED',
    );
    await maker
      .call('post', `/payroll/runs/${novRun.id}/inputs`)
      .send({ employeeId: ashaEmp.id, componentId: components.REIMB.id, amount: '1' })
      .expect(409);
    expect((await maker.call('post', `/payroll/runs/${novRun.id}/calculate`).expect(202)).body.status).toBe(
      'CALCULATING',
    );
    expect(h.jobs.workSessions.at(-1)).toMatchObject({
      name: 'payroll-calculate',
      data: { runId: novRun.id },
    });
    const totals = await asTenant(() => svc().calculate(novRun.id), maker.userId);
    expect(totals).toMatchObject({ employees: 3, calculated: 2, excluded: 1, errors: 0 });
    const run = (await maker.call('get', `/payroll/runs/${novRun.id}`).expect(200)).body;
    expect(run).toMatchObject({
      status: 'CALCULATED',
      counts: { OK: 2, EXCLUDED: 1 },
      ruleVersionsPinned: { pack: 'IN', ruleVersion: 1, reviewed: false },
    });
    const rows = Object.fromEntries(
      (await maker.call('get', `/payroll/runs/${novRun.id}/employees`).expect(200)).body.data.map((r) => [
        r.employee.id,
        r,
      ]),
    );
    // Ravi: 2 unpaid days of 30 → 28/30. BASIC 46,666.67; HRA 23,333.33; SPECIAL 23,200 × 28/30 = 21,653.33; gross 91,653.33.
    expect(rows[raviEmp.id]).toMatchObject({
      status: 'OK',
      paidDays: '28',
      lopDays: '2',
      gross: '91653.3300',
      net: '89653.3300',
    });
    // Asha: monthly 22,000 → gross 20,680; ESI 156; no PT (below 25,000); reimbursement 2,500 on top.
    expect(rows[ashaEmp.id]).toMatchObject({ status: 'OK', gross: '20680.0000', net: '21704.0000' });
    expect(rows[mohanEmp.id]).toMatchObject({
      status: 'EXCLUDED',
      errors: [{ message: 'No salary in force at the end of the period' }],
    });
    const detail = (
      await maker.call('get', `/payroll/runs/${novRun.id}/employees/${rows[raviEmp.id].id}`).expect(200)
    ).body;
    expect(lines(detail)).toMatchObject({
      BASIC: '46666.6700',
      PF_EE: '1800.0000',
      PT: '200.0000',
      TDS: '0.0000',
    });
    expect(detail.lines.find((l) => l.code === 'BASIC').trace).toMatchObject({ factor: '28/30' });
  });

  test('leave inside a locked payroll period cannot be decided', async () => {
    const lwp = (await ravi.call('get', '/leaves/types').expect(200)).body.data.find((t) => t.code === 'LWP');
    const req = (
      await ravi
        .call('post', '/leaves/requests')
        .send({ leaveTypeId: lwp.id, fromDate: '2026-11-24', toDate: '2026-11-24' })
        .expect(201)
    ).body;
    expect(
      (
        await owner
          .call('post', `/leaves/requests/${req.id}/decision`)
          .send({ decision: 'APPROVED' })
          .expect(409)
      ).body.code,
    ).toBe('period_locked');
    await ravi.call('post', `/leaves/requests/${req.id}/cancel`).send({}).expect(200);
  });

  test('maker-checker: the reviewer cannot approve; rejection sends it back', async () => {
    await maker.call('post', `/payroll/runs/${novRun.id}/approve`).expect(403); // no approve permission
    await owner.call('post', `/payroll/runs/${novRun.id}/review`).send({}).expect(200);
    const same = await owner.call('post', `/payroll/runs/${novRun.id}/approve`).expect(403);
    expect(same.body.code).toBe('same_person');
    await checker.call('post', `/payroll/runs/${novRun.id}/reject`).send({ comment: 'x' }).expect(422);
    expect(
      (
        await checker
          .call('post', `/payroll/runs/${novRun.id}/reject`)
          .send({ comment: 'Check the bonus' })
          .expect(200)
      ).body.status,
    ).toBe('CALCULATED');
    await maker
      .call('post', `/payroll/runs/${novRun.id}/review`)
      .send({ comment: 'Looks right' })
      .expect(200);
    const approved = (await checker.call('post', `/payroll/runs/${novRun.id}/approve`).expect(200)).body;
    expect(approved).toMatchObject({
      status: 'APPROVED',
      reviewedBy: maker.userId,
      approvedBy: checker.userId,
    });
    await checker.call('post', `/payroll/runs/${novRun.id}/approve`).expect(409);
  });

  test('finalize freezes everything; payslips are generated into private storage', async () => {
    const fin = (await checker.call('post', `/payroll/runs/${novRun.id}/finalize`).expect(200)).body;
    expect(fin.status).toBe('FINALIZED');
    expect(fin.finalHash).toMatch(/^[0-9a-f]{64}$/);
    expect(h.jobs.workSessions.at(-1)).toMatchObject({
      name: 'payroll-payslips',
      data: { runId: novRun.id },
    });
    expect(await asTenant(() => svc().generatePayslips(novRun.id))).toEqual({ created: 2 });
    expect(await asTenant(() => svc().generatePayslips(novRun.id))).toEqual({ created: 0 }); // idempotent

    await maker.call('post', `/payroll/runs/${novRun.id}/unlock`).expect(409);
    await maker.call('post', `/payroll/runs/${novRun.id}/cancel`).expect(409);
    await expect(
      asTenant(() => db().payrollRunEmployee.updateMany({ where: { runId: novRun.id }, data: { net: '1' } })),
    ).rejects.toThrow(/IMMUTABLE/);
    await expect(
      asTenant(() =>
        db().payrollLine.updateMany({ where: { runEmployee: { runId: novRun.id } }, data: { amount: '1' } }),
      ),
    ).rejects.toThrow(/IMMUTABLE/);
    await expect(
      asTenant(() => db().payrollRun.update({ where: { id: novRun.id }, data: { status: 'DRAFT' } })),
    ).rejects.toThrow(/IMMUTABLE/);
    await expect(
      asTenant(() => db().payslip.deleteMany({ where: { runEmployee: { runId: novRun.id } } })),
    ).rejects.toThrow(/IMMUTABLE/);
  });

  test('employees download their own payslip; others cannot; payroll can', async () => {
    const mine = (await ravi.call('get', '/payroll/payslips/me').expect(200)).body.data;
    expect(mine).toEqual([
      expect.objectContaining({
        month: '2026-11',
        net: '89653.3300',
        currency: 'INR',
        payDate: '2026-11-28',
      }),
    ]);
    const { url } = (await ravi.call('get', `/payroll/payslips/${mine[0].id}/download-url`).expect(200)).body;
    const pdf = Buffer.from(await (await fetch(url)).arrayBuffer());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    await asha.call('get', `/payroll/payslips/${mine[0].id}/download-url`).expect(404);
    await maker.call('get', `/payroll/payslips/${mine[0].id}/download-url`).expect(200);
  });

  test('register and bank file', async () => {
    const reg = await maker.call('get', `/payroll/runs/${novRun.id}/register`).expect(200);
    const rows = parse(reg.text, { columns: true });
    expect(rows.find((r) => r.name === 'Ravi')).toMatchObject({
      BASIC: '46666.6700',
      net: '89653.3300',
      lopDays: '2',
    });
    await owner
      .call('post', `/employees/${raviEmp.id}/bank-accounts`)
      .send({
        accountHolder: 'Ravi',
        accountNumber: '123456789012',
        currency: 'INR',
        bankFields: { ifsc: 'HDFC0001234' },
        effectiveFrom: '2026-01-05',
      })
      .expect(201);
    await ravi.call('get', `/payroll/runs/${novRun.id}/bank-file`).expect(403);
    const bank = await checker.call('get', `/payroll/runs/${novRun.id}/bank-file`).expect(200);
    const b = parse(bank.text, { columns: true });
    expect(b).toEqual([
      expect.objectContaining({
        accountNumber: '123456789012',
        bankCode: 'HDFC0001234',
        amount: '89653.3300',
        currency: 'INR',
      }),
    ]);
    expect(bank.headers['x-missing-bank-accounts']).toBe(ashaEmp.employeeCode); // reported, not silently dropped
  });

  test('mark paid; the next month uses this one for year-to-date and variance', async () => {
    expect((await checker.call('post', `/payroll/runs/${novRun.id}/mark-paid`).expect(200)).body.status).toBe(
      'PAID',
    );
    const dec = (
      await maker.call('post', '/payroll/runs').send({ legalEntityId: le.id, month: '2026-12' }).expect(201)
    ).body;
    await maker.call('post', `/payroll/runs/${dec.id}/lock`).expect(200);
    await maker.call('post', `/payroll/runs/${dec.id}/calculate`).expect(202);
    await asTenant(() => svc().calculate(dec.id), maker.userId);
    const v = (await maker.call('get', `/payroll/runs/${dec.id}/variance`).expect(200)).body;
    expect(v.previousRun).toMatchObject({ id: novRun.id, month: '2026-11' });
    expect(v.data.find((r) => r.employee.id === raviEmp.id)).toMatchObject({
      previousNet: '89653.3300',
      net: '96200.0000',
      change: '6546.6700',
    });
    const raviDec = (await maker.call('get', `/payroll/runs/${dec.id}/employees`).expect(200)).body.data.find(
      (r) => r.employee.id === raviEmp.id,
    );
    const tds = (
      await maker.call('get', `/payroll/runs/${dec.id}/employees/${raviDec.id}`).expect(200)
    ).body.lines.find((l) => l.code === 'TDS');
    expect(tds.trace).toMatchObject({ monthsRemaining: 4, projectedTaxableGross: '484453.33' }); // 91,653.33 paid + 98,200 × 4
    expect((await maker.call('post', `/payroll/runs/${dec.id}/cancel`).expect(200)).body.status).toBe(
      'CANCELLED',
    );
  });
});

describe('tax declarations', () => {
  test('the employee submits; payroll verifies; only verified deductions are used', async () => {
    await ravi
      .call('put', '/payroll/tax-declarations/me/2026-27')
      .send({ regime: 'OLD', deductions: { '80C': '150000' } })
      .expect(200);
    expect((await ravi.call('get', '/payroll/tax-declarations/me/2026-27').expect(200)).body).toMatchObject({
      regime: 'OLD',
      status: 'SUBMITTED',
    });
    const list = (await maker.call('get', '/payroll/tax-declarations?status=SUBMITTED').expect(200)).body
      .data;
    const mine = list.find((d) => d.employeeId === raviEmp.id);
    await ravi
      .call('post', `/payroll/tax-declarations/${mine.id}/review`)
      .send({ decision: 'VERIFIED' })
      .expect(403);
    await maker
      .call('post', `/payroll/tax-declarations/${mine.id}/review`)
      .send({ decision: 'VERIFIED' })
      .expect(200);
    await ravi
      .call('put', '/payroll/tax-declarations/me/2026-27')
      .send({ regime: 'NEW', deductions: {} })
      .expect(409);
  });
});
