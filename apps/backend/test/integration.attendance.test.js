// Integration: clock-in/out, daily calculation, corrections, overtime approval, shifts, policy and reports.
// HTTP flows use the real clock. Calculations for fixed past dates insert punches directly and run the
// same service the worker uses, inside the tenant context.
import { parse } from 'csv-parse/sync';
import { runWithContext } from '../src/lib/context.js';
import { db } from '../src/lib/db.js';
import { ymdToDate, zonedTime } from '../src/lib/time.js';
import { newId } from '@hrms/shared/ids';
import { startHarness } from './helpers/harness.js';

let h;
let owner; // Company Admin with MFA
let le;
let manager; // team_leader, linked to employee record `mgr`
let worker; // employee role, linked to `emp`, reports to `mgr`
let outsider; // employee role, linked to `other`, reports to nobody
let mgr;
let emp;
let other;
let shift;
let office;
const TZ = 'Asia/Kolkata';
// A fixed past week (Mon 2026-11-16 … Sun 2026-11-22) inside the default 30-day correction window.
const MON = '2026-11-16';
const TUE = '2026-11-17';
const WED = '2026-11-18';
const THU = '2026-11-19';
const SAT = '2026-11-21'; // a working day: India's default weekend is Sunday only
const SUN = '2026-11-22';
const at = (ymd, hhmm) => zonedTime(ymd, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ);
const asTenant = (fn) =>
  runWithContext(
    { requestId: 'test', tenantId: owner.tenantId, userId: owner.userId },
    async () => await fn(),
  );
const svc = () => h.services.attendance;

beforeAll(async () => {
  h = await startHarness();
  owner = await h.owner('att', { mfa: true });
  le = (await owner.call('get', '/companies/legal-entities').expect(200)).body.data[0];
  const post = async (path, body) => (await owner.call('post', path).send(body).expect(201)).body;
  const cal = await post('/companies/holiday-calendars', { name: 'IN 2026', countryCode: 'IN', year: 2026 });
  await post(`/companies/holiday-calendars/${cal.id}/holidays`, { date: TUE, name: 'Festival' });
  const branch = await post('/companies/branches', {
    legalEntityId: le.id,
    name: 'Pune',
    code: 'PUN',
    timezone: TZ,
    holidayCalendarId: cal.id,
  });
  const person = (firstName, extra = {}) =>
    post('/employees', {
      firstName,
      legalEntityId: le.id,
      dateOfJoining: '2026-01-05',
      branchId: branch.id,
      timezone: TZ,
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
  manager = await link('team_leader', mgr, 'mgr');
  worker = await link('employee', emp, 'wrk');
  outsider = await link('employee', other, 'out');
  office = await post('/companies/work-locations', { name: 'Pune office', type: 'OFFICE' });
  shift = await post('/attendance/shifts', {
    name: 'General',
    startTime: '09:00',
    endTime: '18:00',
    breakMinutes: 60,
    graceLateMin: 10,
    graceEarlyMin: 10,
  });
  await post('/attendance/shift-assignments', {
    shiftId: shift.id,
    employeeIds: [emp.id, mgr.id],
    effectiveFrom: '2026-01-05',
  });
  await post('/attendance/overtime-rules', {
    name: 'Daily over 8h',
    dailyThresholdMin: 480,
    multiplier: '1.5',
    requiresApproval: true,
    effectiveFrom: '2026-01-01',
  });
});
afterAll(() => h.stop());

/** Inserts a past punch the way the API would have stored it. */
const insertPunch = (employeeId, workDate, type, ts, source = 'WEB') =>
  asTenant(() =>
    db().attendancePunch.create({
      data: { id: newId(), employeeId, workDate: ymdToDate(workDate), type, serverTs: ts, source },
    }),
  );

describe('clock in and out', () => {
  test('a sign-in without an employee record is told so', async () => {
    expect((await owner.call('get', '/attendance/me/status').expect(200)).body).toEqual({
      hasEmployeeRecord: false,
    });
    const res = await owner.call('post', '/attendance/punches').send({ type: 'IN' }).expect(409);
    expect(res.body.code).toBe('no_employee_record');
  });

  test('in → out with a work location; double actions are refused; nothing extra is captured by default', async () => {
    let s = (await worker.call('get', '/attendance/me/status').expect(200)).body;
    expect(s).toMatchObject({
      hasEmployeeRecord: true,
      clockedIn: false,
      capture: { ip: false, geo: false },
    });
    expect(s.locations.map((l) => l.id)).toContain(office.id);
    expect(
      (await worker.call('post', '/attendance/punches').send({ type: 'OUT' }).expect(409)).body.code,
    ).toBe('not_clocked_in');
    s = (
      await worker
        .call('post', '/attendance/punches')
        .send({ type: 'IN', workLocationId: office.id, geo: { lat: 18.5, lng: 73.8 } })
        .expect(201)
    ).body;
    expect(s.clockedIn).toBe(true);
    expect(s.openLocationId).toBe(office.id);
    expect(
      (await worker.call('post', '/attendance/punches').send({ type: 'IN' }).expect(409)).body.code,
    ).toBe('already_clocked_in');
    s = (await worker.call('post', '/attendance/punches').send({ type: 'OUT' }).expect(201)).body;
    expect(s.clockedIn).toBe(false);
    expect(s.today).toMatchObject({ status: expect.any(String), workLocationId: office.id });
    const stored = await asTenant(() =>
      db().attendancePunch.findMany({ where: { employeeId: emp.id, source: 'WEB' } }),
    );
    expect(stored).toHaveLength(2);
    expect(stored.every((p) => p.ipAddress === null && p.geo === null)).toBe(true);
    const mine = (await worker.call('get', `/attendance/me?from=${s.workDate}&to=${s.workDate}`).expect(200))
      .body.data;
    expect(mine[0].punches.map((p) => p.type)).toEqual(['IN', 'OUT']);
  });

  test('IP address and location are stored only after the company turns them on', async () => {
    await owner
      .call('put', '/attendance/policy')
      .send({
        presentPercent: 75,
        halfDayPercent: 50,
        autoDeductBreak: true,
        captureIp: true,
        captureGeo: true,
        regularizationWindowDays: 30,
      })
      .expect(200);
    const s = (await outsider.call('get', '/attendance/me/status').expect(200)).body;
    expect(s.capture).toEqual({ ip: true, geo: true });
    await outsider
      .call('post', '/attendance/punches')
      .send({ type: 'IN', geo: { lat: 18.52, lng: 73.85, accuracyM: 20 } })
      .expect(201);
    await outsider.call('post', '/attendance/punches').send({ type: 'OUT' }).expect(201);
    const p = await asTenant(() =>
      db().attendancePunch.findFirst({ where: { employeeId: other.id, type: 'IN' } }),
    );
    expect(p.ipAddress).toMatch(/^198\.51\./);
    expect(p.geo).toEqual({ lat: 18.52, lng: 73.85, accuracyM: 20 });
    await owner
      .call('put', '/attendance/policy')
      .send({
        presentPercent: 75,
        halfDayPercent: 50,
        autoDeductBreak: true,
        captureIp: false,
        captureGeo: false,
        regularizationWindowDays: 30,
      })
      .expect(200);
  });

  test('locations that need approval, or are inactive, cannot be chosen', async () => {
    const home = (
      await owner
        .call('post', '/companies/work-locations')
        .send({ name: 'Home', type: 'WFH', requiresApproval: true })
        .expect(201)
    ).body;
    const closed = (
      await owner
        .call('post', '/companies/work-locations')
        .send({ name: 'Old site', type: 'OFFICE', isActive: false })
        .expect(201)
    ).body;
    const s = (await worker.call('get', '/attendance/me/status').expect(200)).body;
    expect(s.locations.map((l) => l.id)).not.toContain(home.id);
    for (const loc of [home, closed])
      await worker
        .call('post', '/attendance/punches')
        .send({ type: 'IN', workLocationId: loc.id })
        .expect(422);
  });

  test('punches are evidence: the database refuses edits', async () => {
    await expect(
      asTenant(() =>
        db().attendancePunch.updateMany({ where: { employeeId: emp.id }, data: { type: 'IN' } }),
      ),
    ).rejects.toThrow(/IMMUTABLE/);
  });
});

describe('daily calculation for a fixed week', () => {
  beforeAll(async () => {
    await insertPunch(emp.id, MON, 'IN', at(MON, '09:20'));
    await insertPunch(emp.id, MON, 'OUT', at(MON, '20:00'));
    await insertPunch(emp.id, THU, 'IN', at(THU, '09:00'));
    await insertPunch(emp.id, THU, 'OUT', at(THU, '13:00'));
    await insertPunch(emp.id, SUN, 'IN', at(SUN, '10:00'));
    await insertPunch(emp.id, SUN, 'OUT', at(SUN, '12:00'));
    const out = await asTenant(() => svc().rollup({ from: MON, to: '2026-11-22', employeeIds: [emp.id] }));
    expect(out).toEqual({ employees: 1, days: 7 });
  });
  const days = async () =>
    Object.fromEntries(
      (await worker.call('get', `/attendance/me?from=${MON}&to=2026-11-22`).expect(200)).body.data.map(
        (d) => [d.workDate, d],
      ),
    );

  test('late arrival, overtime, holiday, absence, half day and weekend work', async () => {
    const d = await days();
    // 09:20–20:00 = 640 min, less the unpunched 60-minute break = 580; 20 min late (grace 10); 100 min over 8 h.
    expect(d[MON]).toMatchObject({
      status: 'PRESENT',
      workedMinutes: 580,
      lateMinutes: 20,
      overtimeMinutes: 100,
      overtimeStatus: 'PENDING',
      expectedMinutes: 480,
      flags: ['LATE', 'OVERTIME'],
    });
    expect(d[TUE]).toMatchObject({ status: 'HOLIDAY', workedMinutes: 0 });
    expect(d[WED]).toMatchObject({ status: 'ABSENT', workedMinutes: 0 });
    expect(d[THU]).toMatchObject({ status: 'HALF_DAY', workedMinutes: 240, earlyLeaveMinutes: 300 });
    expect(d[SAT]).toMatchObject({ status: 'ABSENT' });
    expect(d[SUN]).toMatchObject({ status: 'WEEKEND', workedMinutes: 120, overtimeMinutes: 120 });
    expect(d[SUN].flags).toEqual(['OVERTIME', 'WORKED_ON_REST_DAY']);
    expect(d[MON].punches).toHaveLength(2);
  });

  test('re-running the roll-up changes nothing (idempotent)', async () => {
    const before = await days();
    await asTenant(() => svc().rollup({ from: MON, to: '2026-11-22', employeeIds: [emp.id] }));
    const after = await days();
    for (const k of Object.keys(before)) {
      const { computedAt: _a, ...b } = before[k];
      const { computedAt: _b, ...a } = after[k];
      expect(a).toEqual(b);
    }
  });

  test('overtime goes to the direct manager; never to the person themselves or an outsider', async () => {
    const pending = (await manager.call('get', '/attendance/overtime').expect(200)).body.data;
    const mon = pending.find((p) => p.workDate === MON);
    expect(mon).toMatchObject({ overtimeMinutes: 100, employee: { id: emp.id } });
    expect((await outsider.call('get', '/attendance/overtime').expect(200)).body.data).toEqual([]);
    await worker
      .call('post', `/attendance/days/${mon.id}/overtime-decision`)
      .send({ decision: 'APPROVED' })
      .expect(403);
    await outsider
      .call('post', `/attendance/days/${mon.id}/overtime-decision`)
      .send({ decision: 'APPROVED' })
      .expect(404);
    await manager
      .call('post', `/attendance/days/${mon.id}/overtime-decision`)
      .send({ decision: 'REJECTED' })
      .expect(422);
    const decided = (
      await manager
        .call('post', `/attendance/days/${mon.id}/overtime-decision`)
        .send({ decision: 'APPROVED' })
        .expect(200)
    ).body;
    expect(decided.overtimeStatus).toBe('APPROVED');
    await manager
      .call('post', `/attendance/days/${mon.id}/overtime-decision`)
      .send({ decision: 'APPROVED' })
      .expect(409);
    // The decision survives a recalculation that gives the same minutes.
    await asTenant(() => svc().rollup({ from: MON, to: MON, employeeIds: [emp.id] }));
    expect((await days())[MON].overtimeStatus).toBe('APPROVED');
  });

  test('a locked day cannot change, even by a direct database update', async () => {
    const day = (await days())[WED];
    await asTenant(() => db().attendanceDay.update({ where: { id: day.id }, data: { isLocked: true } }));
    await expect(
      asTenant(() => db().attendanceDay.update({ where: { id: day.id }, data: { workedMinutes: 999 } })),
    ).rejects.toThrow(/IMMUTABLE/);
    const res = await worker
      .call('post', '/attendance/regularizations')
      .send({ workDate: WED, inTime: '09:00', outTime: '18:00', reason: 'Was at a client' })
      .expect(409);
    expect(res.body.code).toBe('day_locked');
    await asTenant(() => db().attendanceDay.update({ where: { id: day.id }, data: { isLocked: false } }));
  });
});

describe('corrections', () => {
  let request;
  test('validation: future days, beyond the window, rejection without a reason', async () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    await worker
      .call('post', '/attendance/regularizations')
      .send({ workDate: future, inTime: '09:00', reason: 'Too early' })
      .expect(422);
    await worker
      .call('post', '/attendance/regularizations')
      .send({ workDate: '2026-02-02', inTime: '09:00', reason: 'Long ago' })
      .expect(422);
    await worker
      .call('post', '/attendance/regularizations')
      .send({ workDate: WED, outTime: '08:00', inTime: '09:00', reason: 'Backwards' })
      .expect(422);
  });

  test('the employee asks; it waits for the manager; duplicates are refused', async () => {
    request = (
      await worker
        .call('post', '/attendance/regularizations')
        .send({ workDate: WED, inTime: '09:00', outTime: '18:00', reason: 'Badge reader was down' })
        .expect(201)
    ).body;
    expect(request).toMatchObject({ status: 'PENDING', workDate: WED, canCancel: true, canDecide: false });
    await worker
      .call('post', '/attendance/regularizations')
      .send({ workDate: WED, inTime: '09:05', reason: 'Again' })
      .expect(409);
    const inbox = (
      await manager.call('get', '/attendance/regularizations?view=approvals&status=PENDING').expect(200)
    ).body.data;
    expect(inbox.map((r) => r.id)).toContain(request.id);
    expect(
      (await outsider.call('get', '/attendance/regularizations?view=approvals').expect(200)).body.data,
    ).toEqual([]);
    await outsider.call('get', `/attendance/regularizations/${request.id}`).expect(404);
    await worker
      .call('post', `/attendance/regularizations/${request.id}/decision`)
      .send({ decision: 'APPROVED' })
      .expect(403);
    await outsider
      .call('post', `/attendance/regularizations/${request.id}/decision`)
      .send({ decision: 'APPROVED' })
      .expect(404);
  });

  test('approval adds correction punches, keeps the originals and recalculates the day', async () => {
    const out = (
      await manager
        .call('post', `/attendance/regularizations/${request.id}/decision`)
        .send({ decision: 'APPROVED', comment: 'Confirmed with security' })
        .expect(200)
    ).body;
    expect(out).toMatchObject({ status: 'APPROVED', decisionComment: 'Confirmed with security' });
    const wed = (await worker.call('get', `/attendance/me?from=${WED}&to=${WED}`).expect(200)).body.data[0];
    expect(wed).toMatchObject({
      status: 'PRESENT',
      workedMinutes: 480,
      lateMinutes: 0,
      flags: ['CORRECTED'],
    });
    expect(wed.punches.map((p) => [p.type, p.source])).toEqual([
      ['IN', 'CORRECTION'],
      ['OUT', 'CORRECTION'],
    ]);
    await manager
      .call('post', `/attendance/regularizations/${request.id}/decision`)
      .send({ decision: 'REJECTED', comment: 'Late' })
      .expect(409);
  });

  test('HR with the approval permission can decide; the owner can cancel only their own pending request', async () => {
    const r = (
      await worker
        .call('post', '/attendance/regularizations')
        .send({ workDate: THU, outTime: '18:00', reason: 'Forgot to clock out after the meeting' })
        .expect(201)
    ).body;
    await outsider.call('post', `/attendance/regularizations/${r.id}/cancel`).expect(404);
    expect(
      (await worker.call('post', `/attendance/regularizations/${r.id}/cancel`).expect(200)).body.status,
    ).toBe('CANCELLED');
    await worker.call('post', `/attendance/regularizations/${r.id}/cancel`).expect(409);
    const r2 = (
      await worker
        .call('post', '/attendance/regularizations')
        .send({ workDate: THU, outTime: '18:00', reason: 'Forgot to clock out after the meeting' })
        .expect(201)
    ).body;
    await owner
      .call('post', `/attendance/regularizations/${r2.id}/decision`)
      .send({ decision: 'REJECTED' })
      .expect(422);
    expect(
      (
        await owner
          .call('post', `/attendance/regularizations/${r2.id}/decision`)
          .send({ decision: 'REJECTED', comment: 'Meeting ended at 13:00' })
          .expect(200)
      ).body.status,
    ).toBe('REJECTED');
    const thu = (await worker.call('get', `/attendance/me?from=${THU}&to=${THU}`).expect(200)).body.data[0];
    expect(thu.status).toBe('HALF_DAY');
    const mine = (await worker.call('get', '/attendance/regularizations').expect(200)).body.data;
    expect(mine.map((m) => m.status).sort()).toEqual(['APPROVED', 'CANCELLED', 'REJECTED']);
  });
});

describe('scopes, shifts, policy and reports', () => {
  test('team views follow attendance.view scope', async () => {
    const team = (await manager.call('get', `/attendance/days?date=${MON}`).expect(200)).body;
    expect(team.data.map((r) => r.employee.id).sort()).toEqual([emp.id, mgr.id].sort());
    expect(team.counts).toMatchObject({ PRESENT: 1, total: 2, NOT_RECORDED: 1 });
    const self = (await worker.call('get', `/attendance/days?date=${MON}`).expect(200)).body;
    expect(self.data.map((r) => r.employee.id)).toEqual([emp.id]);
    await worker.call('get', `/attendance/employees/${other.id}/days?from=${MON}&to=${MON}`).expect(404);
    await manager.call('get', `/attendance/employees/${emp.id}/days?from=${MON}&to=${MON}`).expect(200);
    await outsider.call('get', `/attendance/employees/${emp.id}/days?from=${MON}&to=${MON}`).expect(404);
    const onlyAbsent = (
      await owner.call('get', `/attendance/days?date=${WED}&status=NOT_RECORDED`).expect(200)
    ).body;
    expect(onlyAbsent.data.map((r) => r.employee.id)).not.toContain(emp.id);
    await worker.call('get', `/attendance/days?date=${MON}&limit=1000`).expect(422);
  });

  test('settings need attendance.manage', async () => {
    await manager
      .call('post', '/attendance/shifts')
      .send({ name: 'X', startTime: '08:00', endTime: '16:00' })
      .expect(403);
    await manager.call('get', '/attendance/overtime-rules').expect(403);
    await worker.call('put', '/attendance/policy').send({}).expect(403);
    await worker.call('post', '/attendance/recalculate').send({ from: MON, to: MON }).expect(403);
  });

  test('shift rules: night shifts, overlapping assignments, validation', async () => {
    const night = (
      await owner
        .call('post', '/attendance/shifts')
        .send({ name: 'Night', startTime: '22:00', endTime: '06:00', breakMinutes: 30 })
        .expect(201)
    ).body;
    expect(night).toMatchObject({ startMin: 1320, endMin: 360, crossesMidnight: true });
    await owner
      .call('post', '/attendance/shifts')
      .send({ name: 'Bad', startTime: '09:00', endTime: '09:00' })
      .expect(422);
    await owner
      .call('post', '/attendance/shifts')
      .send({ name: 'Bad2', startTime: '09:00', endTime: '10:00', breakMinutes: 60 })
      .expect(422);
    // Moving Ravi to nights from 1 Dec closes the General assignment on 30 Nov.
    await owner
      .call('post', '/attendance/shift-assignments')
      .send({ shiftId: night.id, employeeIds: [emp.id], effectiveFrom: '2026-12-01' })
      .expect(201);
    const list = (await owner.call('get', `/attendance/shift-assignments?employeeId=${emp.id}`).expect(200))
      .body.data;
    expect(list.map((a) => [a.shift.name, a.effectiveFrom, a.effectiveTo])).toEqual([
      ['Night', '2026-12-01', null],
      ['General', '2026-01-05', '2026-11-30'],
    ]);
    const res = await owner
      .call('post', '/attendance/shift-assignments')
      .send({ shiftId: shift.id, employeeIds: [emp.id], effectiveFrom: '2026-11-20' })
      .expect(409);
    expect(res.body.code).toBe('assignment_overlap');
  });

  test('policy validation and the database check constraint', async () => {
    const body = {
      presentPercent: 60,
      halfDayPercent: 70,
      autoDeductBreak: true,
      captureIp: false,
      captureGeo: false,
      regularizationWindowDays: 30,
    };
    await owner.call('put', '/attendance/policy').send(body).expect(422);
    await expect(
      asTenant(() =>
        db().attendancePolicy.updateMany({
          where: { scopeKey: 'default' },
          data: { halfDayPercent: 90, presentPercent: 80 },
        }),
      ),
    ).rejects.toThrow();
    const entity = (
      await owner
        .call('put', '/attendance/policy')
        .send({ ...body, legalEntityId: le.id, halfDayPercent: 40 })
        .expect(200)
    ).body;
    expect(entity).toMatchObject({ source: 'LEGAL_ENTITY', presentPercent: 60, halfDayPercent: 40 });
    expect((await owner.call('get', '/attendance/policy').expect(200)).body.source).toBe('COMPANY');
  });

  test('recalculation is queued for the worker', async () => {
    await owner.call('post', '/attendance/recalculate').send({ from: MON, to: '2026-11-22' }).expect(202);
    expect(h.jobs.workSessions.at(-1)).toMatchObject({
      name: 'attendance-recalculate',
      data: { tenantId: owner.tenantId, from: MON, to: '2026-11-22' },
    });
    await owner
      .call('post', '/attendance/recalculate')
      .send({ from: '2026-01-01', to: '2026-11-22' })
      .expect(422);
  });

  test('summary report totals and a formula-safe CSV', async () => {
    const rep = (
      await manager.call('get', `/attendance/reports/summary?from=${MON}&to=2026-11-22`).expect(200)
    ).body;
    const ravi = rep.data.find((r) => r.employee.id === emp.id);
    expect(ravi).toMatchObject({
      present: 2,
      halfDay: 1,
      holiday: 1,
      weekend: 1,
      absent: 2, // Friday and Saturday
      lateDays: 1,
      workedMinutes: 580 + 480 + 240 + 120,
      overtimeApprovedMinutes: 100,
      overtimePendingMinutes: 120,
    });
    expect(rep.data.map((r) => r.employee.id)).not.toContain(other.id);
    const csv = await owner
      .call('get', `/attendance/reports/summary?from=${MON}&to=2026-11-22&format=csv`)
      .expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const rows = parse(csv.text, { columns: true });
    expect(rows.find((r) => r.name.includes('HYPERLINK')).name).toBe(`'=HYPERLINK("x")`);
    expect(rows.find((r) => r.name === 'Ravi')).toMatchObject({
      workedHours: '23.67',
      overtimeApprovedHours: '1.67',
    });
  });
});
