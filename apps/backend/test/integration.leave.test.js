// Integration: leave types, policies, ledger balances, accruals, requests, approval chains, cancellation,
// attendance ON_LEAVE, policy versions with year-end expiry, scopes and reports. Real MySQL + Redis.
import { parse } from 'csv-parse/sync';
import { runWithContext } from '../src/lib/context.js';
import { db } from '../src/lib/db.js';
import { startHarness } from './helpers/harness.js';

let h;
let owner; // Company Admin (HR) with MFA, not linked to an employee record
let manager; // team_leader linked to `mgr`
let worker; // employee linked to `emp`, reports to `mgr`
let outsider; // employee linked to `other`
let mgr;
let emp;
let other;
let types; // code → leave type
const asTenant = (fn) =>
  runWithContext(
    { requestId: 'test', tenantId: owner.tenantId, userId: owner.userId },
    async () => await fn(),
  );
const svc = () => h.services.leave;
const months = (from, to) => {
  const out = [];
  for (
    let d = new Date(`${from}-01T00:00:00Z`);
    d <= new Date(`${to}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1)
  )
    out.push(d.toISOString().slice(0, 7));
  return out;
};
const balanceOf = async (client, code) =>
  (await client.call('get', '/leaves/balances/me').expect(200)).body.data.find(
    (b) => b.leaveType.code === code,
  );
const apply = (client, body) => client.call('post', '/leaves/requests').send(body);

beforeAll(async () => {
  h = await startHarness();
  owner = await h.owner('lv', { mfa: true });
  const le = (await owner.call('get', '/companies/legal-entities').expect(200)).body.data[0];
  await owner
    .call('patch', `/companies/legal-entities/${le.id}`)
    .send({ weekendDays: [0, 6] })
    .expect(200);
  const post = async (path, body) => (await owner.call('post', path).send(body).expect(201)).body;
  const cal = await post('/companies/holiday-calendars', {
    name: 'Holidays 2026',
    countryCode: 'IN',
    year: 2026,
  });
  await post(`/companies/holiday-calendars/${cal.id}/holidays`, { date: '2026-12-25', name: 'Christmas' });
  const branch = await post('/companies/branches', {
    legalEntityId: le.id,
    name: 'Mumbai',
    code: 'BOM',
    timezone: 'Asia/Kolkata',
    holidayCalendarId: cal.id,
  });
  const person = (firstName, extra = {}) =>
    post('/employees', {
      firstName,
      legalEntityId: le.id,
      dateOfJoining: '2026-01-05',
      branchId: branch.id,
      timezone: 'Asia/Kolkata',
      ...extra,
    });
  mgr = await person('Maya');
  emp = await person('Ravi', { managerId: mgr.id });
  other = await person('=HYPERLINK("x")');
  const link = async (roleKey, employee, tag) => {
    const m = await h.member(owner, [roleKey], tag);
    await owner
      .call('put', `/tenants/members/${m.membershipId}/employee`)
      .send({ employeeId: employee.id })
      .expect(204);
    return m;
  };
  manager = await link('team_leader', mgr, 'lvmgr');
  worker = await link('employee', emp, 'lvwrk');
  outsider = await link('employee', other, 'lvout');
});
afterAll(() => h.stop());

describe('setup', () => {
  test('the starter pack loads three types with company-wide policies, once', async () => {
    expect((await owner.call('post', '/leaves/starter-pack').expect(201)).body.created).toEqual([
      'ANNUAL',
      'SICK',
      'UNPAID',
    ]);
    expect((await owner.call('post', '/leaves/starter-pack').expect(201)).body.created).toEqual([]);
    types = Object.fromEntries(
      (await worker.call('get', '/leaves/types').expect(200)).body.data.map((t) => [t.code, t]),
    );
    expect(types.SICK).toMatchObject({ isPaid: true, requiresDocumentAfterDays: 2 });
    expect(types.UNPAID.isPaid).toBe(false);
  });

  test('configuration needs leave.config.manage', async () => {
    await worker.call('post', '/leaves/types').send({ code: 'X', name: 'X' }).expect(403);
    await manager.call('get', '/leaves/policies').expect(403);
    await manager.call('post', '/leaves/adjustments').send({}).expect(403);
  });

  test('accruals: monthly shares add up exactly, upfront credits once, re-runs post nothing', async () => {
    expect((await balanceOf(worker, 'ANNUAL')).balance).toBe('0.00');
    for (const m of months('2026-01', '2026-11')) await asTenant(() => svc().runAccruals(m));
    const again = await asTenant(() => svc().runAccruals('2026-11'));
    expect(again.credited).toBe(0);
    const annual = await balanceOf(worker, 'ANNUAL');
    expect(annual).toMatchObject({ balance: '18.33', accruedThisYear: '18.33', available: '18.33' }); // 20 × 11/12, exact
    expect((await balanceOf(worker, 'SICK')).balance).toBe('10.00');
    expect(await balanceOf(worker, 'UNPAID')).toMatchObject({ balance: '0.00' });
  });

  test('a person-specific policy beats the company one', async () => {
    const senior = (
      await owner
        .call('post', '/leaves/policies')
        .send({
          leaveTypeId: types.ANNUAL.id,
          name: 'Senior annual leave',
          rules: { accrual: { method: 'ANNUAL_UPFRONT', daysPerYear: '30' } },
          effectiveFrom: '2026-01-01',
        })
        .expect(201)
    ).body;
    await owner
      .call('post', '/leaves/policy-assignments')
      .send({ policyId: senior.id, appliesTo: 'EMPLOYEE', targetId: mgr.id, effectiveFrom: '2026-01-01' })
      .expect(201);
    await owner
      .call('post', '/leaves/policy-assignments')
      .send({ policyId: senior.id, appliesTo: 'COMPANY', targetId: emp.id, effectiveFrom: '2026-01-01' })
      .expect(422);
    expect((await balanceOf(manager, 'ANNUAL')).policy.name).toBe('Senior annual leave');
    expect((await balanceOf(worker, 'ANNUAL')).policy.name).toBe('Annual leave policy');
  });
});

describe('requests', () => {
  let annualReq;
  test('preview counts working days only: weekend and the holiday are skipped; half days', async () => {
    const body = { leaveTypeId: types.ANNUAL.id, fromDate: '2026-12-21', toDate: '2026-12-28' };
    const p = (await worker.call('post', '/leaves/requests/preview').send(body).expect(200)).body;
    expect(p).toMatchObject({ quantity: '5.00', available: '18.33', errors: [] });
    expect(p.days.map((d) => d.date)).toEqual([
      '2026-12-21',
      '2026-12-22',
      '2026-12-23',
      '2026-12-24',
      '2026-12-28',
    ]);
    const half = (
      await worker
        .call('post', '/leaves/requests/preview')
        .send({ ...body, toHalfDay: true })
        .expect(200)
    ).body;
    expect(half.quantity).toBe('4.50');
  });

  test('apply; pending days reduce what is available; overlaps and over-balance are refused', async () => {
    annualReq = (
      await apply(worker, {
        leaveTypeId: types.ANNUAL.id,
        fromDate: '2026-12-21',
        toDate: '2026-12-28',
        reason: 'Family visit',
      }).expect(201)
    ).body;
    expect(annualReq).toMatchObject({ status: 'PENDING', quantity: '5.00', currentStep: 1, canCancel: true });
    expect(await balanceOf(worker, 'ANNUAL')).toMatchObject({
      balance: '18.33',
      pending: '5.00',
      available: '13.33',
    });
    const overlap = await apply(worker, {
      leaveTypeId: types.ANNUAL.id,
      fromDate: '2026-12-24',
      toDate: '2026-12-24',
    }).expect(422);
    expect(overlap.body.errors[0].message).toMatch(/already have leave/);
    const tooMuch = await apply(worker, {
      leaveTypeId: types.ANNUAL.id,
      fromDate: '2027-01-04',
      toDate: '2027-02-05',
    }).expect(422);
    expect(tooMuch.body.errors.map((e) => e.message).join()).toMatch(
      /Not enough balance: 13\.33 days available/,
    );
  });

  test('the manager approves; the ledger is debited; nobody else can decide', async () => {
    await worker
      .call('post', `/leaves/requests/${annualReq.id}/decision`)
      .send({ decision: 'APPROVED' })
      .expect(403);
    await outsider
      .call('post', `/leaves/requests/${annualReq.id}/decision`)
      .send({ decision: 'APPROVED' })
      .expect(404);
    await outsider.call('get', `/leaves/requests/${annualReq.id}`).expect(404);
    const inbox = (await manager.call('get', '/leaves/requests?view=approvals').expect(200)).body.data;
    expect(inbox.map((r) => r.id)).toContain(annualReq.id);
    expect((await outsider.call('get', '/leaves/requests?view=approvals').expect(200)).body.data).toEqual([]);
    const out = (
      await manager
        .call('post', `/leaves/requests/${annualReq.id}/decision`)
        .send({ decision: 'APPROVED', comment: 'Enjoy' })
        .expect(200)
    ).body;
    expect(out).toMatchObject({
      status: 'APPROVED',
      steps: [{ stepNo: 1, status: 'APPROVED', comment: 'Enjoy' }],
    });
    await manager
      .call('post', `/leaves/requests/${annualReq.id}/decision`)
      .send({ decision: 'APPROVED' })
      .expect(409);
    expect(await balanceOf(worker, 'ANNUAL')).toMatchObject({
      balance: '13.33',
      pending: '0.00',
      usedThisYear: '5.00',
    });
  });

  test('longer sick leave needs one of your own documents', async () => {
    const body = { leaveTypeId: types.SICK.id, fromDate: '2026-11-30', toDate: '2026-12-02' };
    const res = await apply(worker, body).expect(422);
    expect(res.body.errors[0]).toMatchObject({ path: 'body.documentId' });
    const upload = (owner_, id) =>
      owner_.call('post', `/employees/${id}/documents/upload-url`).send({
        category: 'MEDICAL',
        fileName: 'certificate.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 100,
      });
    const mine = (await upload(worker, emp.id).expect(201)).body.documentId;
    const theirs = (await upload(outsider, other.id).expect(201)).body.documentId;
    await apply(worker, { ...body, documentId: theirs }).expect(422);
    const ok = (await apply(worker, { ...body, documentId: mine }).expect(201)).body;
    expect(ok).toMatchObject({ quantity: '3.00', documentId: mine });
    expect(
      (await worker.call('post', `/leaves/requests/${ok.id}/cancel`).send({}).expect(200)).body.status,
    ).toBe('CANCELLED');
    await worker.call('post', `/leaves/requests/${ok.id}/cancel`).send({}).expect(409);
  });

  test('two-level approval: manager then HR, never the same person twice; unpaid leave leaves no ledger entry', async () => {
    const r = (
      await apply(worker, {
        leaveTypeId: types.UNPAID.id,
        fromDate: '2026-12-29',
        toDate: '2026-12-30',
      }).expect(201)
    ).body;
    const step1 = (
      await manager
        .call('post', `/leaves/requests/${r.id}/decision`)
        .send({ decision: 'APPROVED' })
        .expect(200)
    ).body;
    expect(step1).toMatchObject({ status: 'PENDING', currentStep: 2 });
    // The team leader also holds leave.request.approve for the team, but already decided step 1.
    await manager
      .call('post', `/leaves/requests/${r.id}/decision`)
      .send({ decision: 'APPROVED' })
      .expect(404);
    expect(
      (await manager.call('get', '/leaves/requests?view=approvals').expect(200)).body.data.map((x) => x.id),
    ).not.toContain(r.id);
    expect(
      (await owner.call('get', '/leaves/requests?view=approvals').expect(200)).body.data.map((x) => x.id),
    ).toContain(r.id);
    const done = (
      await owner.call('post', `/leaves/requests/${r.id}/decision`).send({ decision: 'APPROVED' }).expect(200)
    ).body;
    expect(done.status).toBe('APPROVED');
    expect((await balanceOf(worker, 'UNPAID')).balance).toBe('0.00');
  });

  test('rejecting needs a reason; later steps are skipped', async () => {
    const r = (
      await apply(worker, {
        leaveTypeId: types.UNPAID.id,
        fromDate: '2027-01-11',
        toDate: '2027-01-11',
      }).expect(201)
    ).body;
    await manager
      .call('post', `/leaves/requests/${r.id}/decision`)
      .send({ decision: 'REJECTED' })
      .expect(422);
    const out = (
      await manager
        .call('post', `/leaves/requests/${r.id}/decision`)
        .send({ decision: 'REJECTED', comment: 'Quarter end' })
        .expect(200)
    ).body;
    expect(out.status).toBe('REJECTED');
    expect(out.steps.map((s) => s.status)).toEqual(['REJECTED', 'SKIPPED']);
  });

  test('cancelling approved future leave reverses the debit', async () => {
    const out = (
      await worker
        .call('post', `/leaves/requests/${annualReq.id}/cancel`)
        .send({ reason: 'Trip off' })
        .expect(200)
    ).body;
    expect(out.status).toBe('CANCELLED');
    expect(await balanceOf(worker, 'ANNUAL')).toMatchObject({ balance: '18.33', usedThisYear: '0.00' });
    const ledger = (
      await worker.call('get', `/leaves/ledger/${emp.id}?leaveTypeId=${types.ANNUAL.id}`).expect(200)
    ).body.data;
    expect(ledger.slice(-2).map((e) => [e.entryType, e.quantity, e.balanceAfter])).toEqual([
      ['CONSUMPTION', '-5.00', '13.33'],
      ['REVERSAL', '5.00', '18.33'],
    ]);
  });

  test('approved past leave marks attendance ON_LEAVE; only HR can cancel it once started', async () => {
    const r = (
      await apply(worker, {
        leaveTypeId: types.ANNUAL.id,
        fromDate: '2026-11-23',
        toDate: '2026-11-23',
      }).expect(201)
    ).body;
    await manager
      .call('post', `/leaves/requests/${r.id}/decision`)
      .send({ decision: 'APPROVED' })
      .expect(200);
    const day = async () =>
      (await worker.call('get', '/attendance/me?from=2026-11-23&to=2026-11-23').expect(200)).body.data[0];
    expect(await day()).toMatchObject({ status: 'ON_LEAVE', flags: ['ON_LEAVE'] });
    expect(
      (await worker.call('post', `/leaves/requests/${r.id}/cancel`).send({}).expect(409)).body.code,
    ).toBe('already_started');
    expect(
      (
        await owner
          .call('post', `/leaves/requests/${r.id}/cancel`)
          .send({ reason: 'Came to work' })
          .expect(200)
      ).body.status,
    ).toBe('CANCELLED');
    expect((await day()).status).toBe('ABSENT');
  });
});

describe('ledger, adjustments, versions and year end', () => {
  test('opening balance once, adjustments any time; the ledger cannot be edited', async () => {
    const body = {
      employeeId: other.id,
      leaveTypeId: types.SICK.id,
      entryType: 'OPENING_BALANCE',
      quantity: '3',
      postedOn: '2026-01-05',
      note: 'Migrated',
    };
    await owner.call('post', '/leaves/adjustments').send(body).expect(201);
    expect((await owner.call('post', '/leaves/adjustments').send(body).expect(409)).body.code).toBe(
      'opening_exists',
    );
    const adj = (
      await owner
        .call('post', '/leaves/adjustments')
        .send({ ...body, entryType: 'ADJUSTMENT', quantity: '-0.5', note: 'Typo fix' })
        .expect(201)
    ).body;
    expect(adj.balance).toBe('12.50'); // 10 accrued + 3 opening − 0.5
    await owner
      .call('post', '/leaves/adjustments')
      .send({ ...body, entryType: 'ADJUSTMENT', quantity: '0', note: 'x y z' })
      .expect(422);
    await expect(
      asTenant(() =>
        db().leaveLedgerEntry.updateMany({ where: { employeeId: other.id }, data: { note: 'edited' } }),
      ),
    ).rejects.toThrow(/IMMUTABLE/);
    await expect(
      asTenant(() => db().leaveLedgerEntry.deleteMany({ where: { employeeId: other.id } })),
    ).rejects.toThrow(/IMMUTABLE/);
  });

  test('a new policy version from 1 Jan: the old one ends, assignments follow, the year end expires the excess', async () => {
    const annualPolicy = (await owner.call('get', '/leaves/policies?q=Annual leave policy').expect(200)).body
      .data[0];
    const v2 = (
      await owner
        .call('post', `/leaves/policies/${annualPolicy.id}/versions`)
        .send({
          rules: { accrual: { method: 'MONTHLY', daysPerYear: '24' }, carryForwardMaxDays: '5' },
          effectiveFrom: '2027-01-01',
        })
        .expect(201)
    ).body;
    expect(v2.version).toBe(2);
    expect(
      (await owner.call('get', `/leaves/policies/${annualPolicy.id}`).expect(200)).body.effectiveTo,
    ).toMatch(/^2026-12-31/);
    await owner
      .call('post', `/leaves/policies/${annualPolicy.id}/versions`)
      .send({ rules: { accrual: { method: 'NONE' } }, effectiveFrom: '2026-01-01' })
      .expect(422);
    expect(
      (await owner.call('get', '/leaves/policy-assignments').expect(200)).body.data.filter(
        (a) => a.policy.id === v2.id,
      ),
    ).toHaveLength(1);

    await asTenant(() => svc().runAccruals('2026-12'));
    const jan = await asTenant(() => svc().runAccruals('2027-01'));
    expect(jan.expired).toBeGreaterThan(0);
    const ledger = (
      await owner.call('get', `/leaves/ledger/${other.id}?leaveTypeId=${types.ANNUAL.id}`).expect(200)
    ).body.data;
    expect(ledger.slice(-2).map((e) => [e.entryType, e.quantity, e.postedOn, e.balanceAfter])).toEqual([
      ['EXPIRY', '-15.00', '2026-12-31', '5.00'], // 20 accrued in 2026, 5 carried
      ['ACCRUAL', '2.00', '2027-01-01', '7.00'], // the new version's 24 / 12
    ]);
    expect(
      (await asTenant(() => svc().runAccruals('2027-01'))).credited +
        (await asTenant(() => svc().runAccruals('2027-01'))).expired,
    ).toBe(0);
  });

  test('accrual runs from the API are queued for the worker', async () => {
    await owner.call('post', '/leaves/accruals/run').send({ month: '2026-11' }).expect(202);
    expect(h.jobs.workSessions.at(-1)).toMatchObject({
      name: 'leave-accrual-tenant',
      data: { tenantId: owner.tenantId, month: '2026-11' },
    });
    await owner.call('post', '/leaves/accruals/run').send({ month: '2026-13' }).expect(422);
  });
});

describe('visibility and reports', () => {
  test('balances and ledgers follow leave.request.view scope', async () => {
    await outsider.call('get', `/leaves/balances/${emp.id}`).expect(404);
    await outsider.call('get', `/leaves/ledger/${emp.id}`).expect(404);
    await manager.call('get', `/leaves/balances/${emp.id}`).expect(200);
    await owner.call('get', `/leaves/ledger/${emp.id}`).expect(200);
  });

  test("who's away: the manager sees the team, an employee sees only themselves", async () => {
    await apply(worker, {
      leaveTypeId: types.ANNUAL.id,
      fromDate: '2026-12-14',
      toDate: '2026-12-15',
    }).expect(201);
    const team = (await manager.call('get', '/leaves/calendar?from=2026-12-01&to=2026-12-31').expect(200))
      .body.data;
    expect(team.map((r) => r.employee.id)).toContain(emp.id);
    const self = (await outsider.call('get', '/leaves/calendar?from=2026-12-01&to=2026-12-31').expect(200))
      .body.data;
    expect(self.every((r) => r.employee.id === other.id)).toBe(true);
  });

  test('summary report and a formula-safe CSV', async () => {
    const rep = (await owner.call('get', '/leaves/reports/summary?from=2026-01-01&to=2026-12-31').expect(200))
      .body;
    const ravi = rep.data.find((r) => r.employee.id === emp.id);
    expect(ravi.byType.UNPAID.taken).toBe('2.00');
    expect(ravi.byType.ANNUAL.taken).toBe('0.00'); // the past day was cancelled; December's request is still pending
    const csv = await owner
      .call('get', '/leaves/reports/summary?from=2026-01-01&to=2026-12-31&format=csv')
      .expect(200);
    const rows = parse(csv.text, { columns: true });
    expect(rows.find((r) => r.name.includes('HYPERLINK')).name).toBe(`'=HYPERLINK("x")`);
    expect(Object.keys(rows[0])).toEqual(expect.arrayContaining(['ANNUAL_taken', 'ANNUAL_balance']));
    await worker.call('get', '/leaves/reports/summary?from=2026-01-01&to=2026-12-31').expect(200); // OWN scope
  });
});
