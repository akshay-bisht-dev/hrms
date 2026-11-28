// Integration: Work Status. HTTP flows use the real clock (start, breaks, end, WFH approval, policies, team status).
// Disconnection, the sweeper and corrections run the same service with a controlled clock, inside the tenant
// context, as the worker does.
import { runWithContext } from '../src/lib/context.js';
import { db } from '../src/lib/db.js';
import { offsetMinutes } from '../src/lib/time.js';
import { createWorkService } from '../src/modules/work/work.service.js';
import { startHarness } from './helpers/harness.js';

let h;
let owner; // Company Admin with MFA, not linked to an employee
let le;
let manager; // team_leader linked to `mgr`
let worker; // employee linked to `emp`, reports to `mgr`
let outsider; // employee linked to `other`, reports to nobody
let mgr;
let emp;
let other;
let timed; // employee for the controlled-clock scenarios, reports to `mgr`
let office;
let home;
const TZ = 'Asia/Kolkata';
const today = () => new Date(Date.now() + offsetMinutes(new Date(), TZ) * 60_000).toISOString().slice(0, 10);
const plusDays = (n) =>
  new Date(Date.now() + offsetMinutes(new Date(), TZ) * 60_000 + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  h = await startHarness();
  owner = await h.owner('work', { mfa: true });
  le = (await owner.call('get', '/companies/legal-entities').expect(200)).body.data[0];
  const post = async (path, body) => (await owner.call('post', path).send(body).expect(201)).body;
  const person = (firstName, extra = {}) =>
    post('/employees', {
      firstName,
      legalEntityId: le.id,
      dateOfJoining: '2026-01-05',
      timezone: TZ,
      ...extra,
    });
  mgr = await person('Maya');
  emp = await person('Ravi', { managerId: mgr.id });
  other = await person('Odin');
  timed = await person('Tara', { managerId: mgr.id });
  const link = async (roleKey, employee, tag) => {
    const m = await h.member(owner, [roleKey], tag);
    await owner
      .call('put', `/tenants/members/${m.membershipId}/employee`)
      .send({ employeeId: employee.id })
      .expect(204);
    return m;
  };
  manager = await link('team_leader', mgr, 'wmgr');
  worker = await link('employee', emp, 'wwrk');
  outsider = await link('employee', other, 'wout');
  office = await post('/companies/work-locations', { name: 'Pune office', type: 'OFFICE' });
  home = await post('/companies/work-locations', { name: 'Home', type: 'WFH' });
});
afterAll(() => h.stop());

describe('my work: start, heartbeat, breaks, end', () => {
  test('a sign-in without an employee record sees only the disclosure', async () => {
    const s = (await owner.call('get', '/work/me/status').expect(200)).body;
    expect(s.hasEmployeeRecord).toBe(false);
    expect(s.disclosure.notRecorded).toEqual(expect.arrayContaining([expect.stringMatching(/Screenshots/)]));
    expect(
      (await owner.call('post', '/work/sessions').send({ workLocationId: office.id }).expect(409)).body.code,
    ).toBe('no_employee_record');
  });

  test('status shows the default policy, what is recorded, and which locations need approval', async () => {
    const s = (await worker.call('get', '/work/me/status').expect(200)).body;
    expect(s.policy).toMatchObject({
      name: 'Standard',
      version: 1,
      heartbeatTimeoutSec: 180,
      wfhRequiresApproval: true,
    });
    expect(s.heartbeatIntervalSec).toBe(60);
    expect(s.disclosure.recorded.length).toBeGreaterThan(0);
    expect(s.active).toBeNull();
    const byId = Object.fromEntries(s.locations.map((l) => [l.id, l]));
    expect(byId[office.id]).toMatchObject({ needsApproval: false, available: true });
    expect(byId[home.id]).toMatchObject({ needsApproval: true, available: false });
  });

  test('a full session: start clocks in, breaks, end clocks out; wrong-order actions are refused', async () => {
    expect(
      (await worker.call('post', '/work/sessions').send({ workLocationId: home.id }).expect(409)).body.code,
    ).toBe('wfh_not_approved');
    let s = (await worker.call('post', '/work/sessions').send({ workLocationId: office.id }).expect(201))
      .body;
    expect(s.active).toMatchObject({ status: 'ACTIVE', location: { id: office.id } });
    expect((await worker.call('get', '/attendance/me/status').expect(200)).body.clockedIn).toBe(true);
    expect(
      (await worker.call('post', '/work/sessions').send({ workLocationId: office.id }).expect(409)).body.code,
    ).toBe('session_active');
    // The attendance page cannot clock out underneath a running session.
    expect(
      (await worker.call('post', '/attendance/punches').send({ type: 'OUT' }).expect(409)).body.code,
    ).toBe('work_session_open');
    const hb = (await worker.call('post', '/work/sessions/current/heartbeat').send({}).expect(200)).body;
    expect(hb).toMatchObject({ status: 'ACTIVE', reconnected: false, nextHeartbeatSec: 60 });
    expect(
      (await worker.call('post', '/work/sessions/current/break/end').send({}).expect(409)).body.code,
    ).toBe('not_on_break');
    s = (await worker.call('post', '/work/sessions/current/break/start').send({ type: 'MEAL' }).expect(200))
      .body;
    expect(s.active).toMatchObject({ status: 'ON_BREAK', openBreak: { type: 'MEAL' } });
    expect(
      (await worker.call('post', '/work/sessions/current/break/start').send({}).expect(409)).body.code,
    ).toBe('already_on_break');
    s = (await worker.call('post', '/work/sessions/current/break/end').send({}).expect(200)).body;
    expect(s.active.status).toBe('ACTIVE');
    s = (await worker.call('post', '/work/sessions/current/end').send({}).expect(200)).body;
    expect(s.active).toBeNull();
    expect(s.today.at(-1)).toMatchObject({ status: 'ENDED', needsReview: false });
    expect((await worker.call('get', '/attendance/me/status').expect(200)).body.clockedIn).toBe(false);
    expect(
      (await worker.call('post', '/work/sessions/current/heartbeat').send({}).expect(409)).body.code,
    ).toBe('no_active_session');

    const detail = (await worker.call('get', `/work/sessions/${s.today.at(-1).id}`).expect(200)).body;
    expect(detail.events.map((e) => e.type)).toEqual(['START', 'BREAK_START', 'BREAK_END', 'END']);
    expect(detail.breaks).toEqual([
      expect.objectContaining({ type: 'MEAL', durationSec: expect.any(Number) }),
    ]);
    expect(detail.segments.length).toBeGreaterThan(0);
  });

  test('two starts at the same moment leave exactly one running session', async () => {
    const results = await Promise.all(
      [1, 2, 3].map(() => outsider.call('post', '/work/sessions').send({ workLocationId: office.id })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const rows = await runWithContext(
      { requestId: 't', tenantId: owner.tenantId },
      async () => await db().workSession.findMany({ where: { employeeId: other.id, endedAt: null } }),
    );
    expect(rows).toHaveLength(1);
    await outsider.call('post', '/work/sessions/current/end').send({}).expect(200);
  });

  test('the event log cannot be edited or deleted', async () => {
    await runWithContext({ requestId: 't', tenantId: owner.tenantId }, async () => {
      const e = await db().workSessionEvent.findFirst({ where: { session: { employeeId: emp.id } } });
      await expect(
        db().workSessionEvent.update({ where: { id: e.id }, data: { type: 'END' } }),
      ).rejects.toThrow();
      await expect(db().workSessionEvent.delete({ where: { id: e.id } })).rejects.toThrow();
    });
  });
});

describe('work from home', () => {
  let request;
  test('a request goes to the manager; nobody else (and not the requester) can decide it', async () => {
    expect(
      (
        await worker
          .call('post', '/work/wfh-requests')
          .send({ workLocationId: office.id, fromDate: today(), toDate: today() })
          .expect(409)
      ).body.code,
    ).toBe('no_request_needed');
    request = (
      await worker
        .call('post', '/work/wfh-requests')
        .send({ workLocationId: home.id, fromDate: today(), toDate: plusDays(2), reason: 'Plumber visit' })
        .expect(201)
    ).body;
    expect(request).toMatchObject({ status: 'PENDING', days: expect.arrayContaining([today()]) });
    expect(
      (
        await worker
          .call('post', '/work/wfh-requests')
          .send({ workLocationId: home.id, fromDate: plusDays(1), toDate: plusDays(1) })
          .expect(409)
      ).body.code,
    ).toBe('wfh_overlap');
    await worker
      .call('post', `/work/wfh-requests/${request.id}/decision`)
      .send({ decision: 'APPROVED' })
      .expect(403);
    await outsider
      .call('post', `/work/wfh-requests/${request.id}/decision`)
      .send({ decision: 'APPROVED' })
      .expect(404);
    expect((await outsider.call('get', '/work/wfh-requests?view=approvals').expect(200)).body.data).toEqual(
      [],
    );
    const inbox = (await manager.call('get', '/work/wfh-requests?view=approvals&status=PENDING').expect(200))
      .body.data;
    expect(inbox.map((r) => r.id)).toEqual([request.id]);
    await manager
      .call('post', `/work/wfh-requests/${request.id}/decision`)
      .send({ decision: 'REJECTED' })
      .expect(422); // a rejection needs a reason
    const decided = (
      await manager
        .call('post', `/work/wfh-requests/${request.id}/decision`)
        .send({ decision: 'APPROVED' })
        .expect(200)
    ).body;
    expect(decided).toMatchObject({ status: 'APPROVED', decidedAt: expect.any(String) });
    await manager
      .call('post', `/work/wfh-requests/${request.id}/decision`)
      .send({ decision: 'APPROVED' })
      .expect(409);
  });

  test('an approved day unlocks the home location; a used approval cannot be cancelled', async () => {
    const s = (await worker.call('get', '/work/me/status').expect(200)).body;
    expect(s.locations.find((l) => l.id === home.id)).toMatchObject({
      available: true,
      wfhRequestId: request.id,
    });
    const started = (
      await worker.call('post', '/work/sessions').send({ workLocationId: home.id }).expect(201)
    ).body;
    expect(started.active.wfhRequestId).toBe(request.id);
    await worker.call('post', '/work/sessions/current/end').send({}).expect(200);
    expect((await worker.call('post', `/work/wfh-requests/${request.id}/cancel`).expect(409)).body.code).toBe(
      'wfh_in_use',
    );
    // Attendance records the day as worked from home.
    const day = (await worker.call('get', '/attendance/me/status').expect(200)).body.today;
    expect(day.workLocationId).toBeDefined();
  });

  test('a per-person policy limits work-from-home days per month', async () => {
    await owner
      .call('post', '/work/policies')
      .send({
        name: 'Odin',
        appliesTo: 'EMPLOYEE',
        targetId: other.id,
        wfhMaxDaysPerMonth: 2,
        effectiveFrom: today(),
      })
      .expect(201);
    const start = `${plusDays(40).slice(0, 7)}-01`;
    const end = `${start.slice(0, 8)}05`;
    const res = await outsider
      .call('post', '/work/wfh-requests')
      .send({ workLocationId: home.id, fromDate: start, toDate: end });
    expect([res.status, res.body.code]).toEqual([409, 'wfh_monthly_limit']);
    const ok = await outsider
      .call('post', '/work/wfh-requests')
      .send({ workLocationId: home.id, fromDate: start, toDate: end, weekdays: [1] }); // at most one Monday in 5 days
    expect(ok.status).toBe(201);
    await outsider.call('post', `/work/wfh-requests/${ok.body.id}/cancel`).expect(200);
  });
});

describe('policies', () => {
  test('only work.config.manage holders see and change policies', async () => {
    await worker.call('get', '/work/policies').expect(403);
    await manager
      .call('post', '/work/policies')
      .send({ name: 'X', appliesTo: 'COMPANY', effectiveFrom: today() })
      .expect(403);
  });

  test('a change makes a new version; the old one ends; only the latest can change; past dates are refused', async () => {
    const list = (await owner.call('get', '/work/policies').expect(200)).body.data;
    const v1 = list.find((p) => p.name === 'Standard');
    expect(
      (
        await owner
          .call('post', `/work/policies/${v1.id}/versions`)
          .send({ appliesTo: 'COMPANY', effectiveFrom: '2020-01-01' })
          .expect(422)
      ).body.errors[0].path,
    ).toBe('body.effectiveFrom');
    const v2 = (
      await owner
        .call('post', `/work/policies/${v1.id}/versions`)
        .send({ appliesTo: 'COMPANY', effectiveFrom: plusDays(1), maxBreakMinutes: 60 })
        .expect(201)
    ).body;
    expect(v2).toMatchObject({
      name: 'Standard',
      version: 2,
      maxBreakMinutes: 60,
      effectiveFrom: plusDays(1),
    });
    const after = (await owner.call('get', '/work/policies').expect(200)).body.data;
    expect(after.find((p) => p.id === v1.id)).toMatchObject({
      effectiveTo: today(),
      inForce: expect.any(Boolean),
    });
    expect(
      (
        await owner
          .call('post', `/work/policies/${v1.id}/versions`)
          .send({ appliesTo: 'COMPANY', effectiveFrom: plusDays(2) })
          .expect(409)
      ).body.code,
    ).toBe('not_latest_version');
  });

  test('the last company-wide policy cannot be retired; a person cannot start outside allowed hours', async () => {
    const list = (await owner.call('get', '/work/policies').expect(200)).body.data;
    const latest = list.find((p) => p.name === 'Standard' && p.version === 2);
    expect((await owner.call('post', `/work/policies/${latest.id}/retire`).expect(409)).body.code).toBe(
      'last_company_policy',
    );
    // A one-hour window three hours from now (local time) for Odin only.
    const nowMin = Math.floor((Date.now() / 60_000 + offsetMinutes(new Date(), TZ)) % 1440);
    const startMin = (nowMin + 180) % 1380;
    const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const odin = list.find((p) => p.name === 'Odin');
    await owner
      .call('post', `/work/policies/${odin.id}/versions`)
      .send({
        appliesTo: 'EMPLOYEE',
        targetId: other.id,
        allowedStart: hhmm(startMin),
        allowedEnd: hhmm(startMin + 60),
        effectiveFrom: today(),
      })
      .expect(201);
    expect(
      (await outsider.call('post', '/work/sessions').send({ workLocationId: office.id }).expect(409)).body
        .code,
    ).toBe('outside_allowed_hours');
  });
});

describe('disconnection, the sweeper and corrections (controlled clock)', () => {
  const base = Date.now() - 8 * 3_600_000; // eight hours ago, so corrections are never in the future
  let clock = base;
  const min = (m) => new Date(base + m * 60_000);
  let work;
  const as = (who, fn) =>
    runWithContext(
      {
        requestId: 'test',
        tenantId: owner.tenantId,
        userId: who.userId,
        employeeId: who.employeeId,
        permissions: new Map(),
        mfa: false,
      },
      async () => await fn(),
    );
  const tara = { userId: '11111111-1111-4111-8111-111111111111', employeeId: null };
  const maya = { userId: null, employeeId: null };
  const system = { userId: undefined, employeeId: undefined };
  const at = async (m, who, fn) => {
    clock = base + m * 60_000;
    return as(who, fn);
  };

  beforeAll(() => {
    work = createWorkService({ attendance: h.services.attendance, now: () => new Date(clock) });
    tara.employeeId = timed.id;
    maya.userId = manager.userId;
    maya.employeeId = mgr.id;
  });

  test('a silent gap is disconnected, then a heartbeat reconnects; totals come from the event log', async () => {
    await at(0, tara, () => work.start({ workLocationId: office.id }));
    for (let m = 1; m <= 10; m++) await at(m, tara, () => work.heartbeat({}));
    // Nothing from minute 10 to 20 (laptop closed). The sweeper notices after the 3-minute timeout.
    let swept = await at(14, system, () => work.sweep());
    expect(swept).toMatchObject({ disconnected: 1, closed: 0 });
    const live = await at(15, tara, () => work.status());
    expect(live.active.status).toBe('DISCONNECTED');
    const hb = await at(20, tara, () => work.heartbeat({}));
    expect(hb).toMatchObject({ status: 'ACTIVE', reconnected: true });
    for (let m = 21; m <= 25; m++) await at(m, tara, () => work.heartbeat({}));
    const done = await at(25, tara, () => work.end({}));
    const s = done.today.at(-1);
    expect(s).toMatchObject({ status: 'ENDED', workedSec: 15 * 60, disconnectedSec: 10 * 60, breakSec: 0 });
    // Heartbeats are thinned: not one stored event per heartbeat.
    const events = await as(tara, () =>
      db().workSessionEvent.count({ where: { sessionId: s.id, type: 'HEARTBEAT' } }),
    );
    expect(events).toBeLessThan(15);
    expect(events).toBeGreaterThan(3);
  });

  test('an abandoned session is closed at its last heartbeat, flagged, and clocked out at that time', async () => {
    await at(30, tara, () => work.start({ workLocationId: office.id }));
    for (let m = 31; m <= 35; m++) await at(m, tara, () => work.heartbeat({}));
    await at(60, system, () => work.sweep()); // disconnected
    const swept = await at(35 + 121, system, () => work.sweep()); // past the 120-minute resume window
    expect(swept.closed).toBe(1);
    const status = await at(160, tara, () => work.status());
    expect(status.active).toBeNull();
    const s = status.today.find((x) => x.status === 'AUTO_CLOSED');
    expect(s).toMatchObject({
      needsReview: true,
      closeReason: 'NO_HEARTBEAT',
      workedSec: 5 * 60,
      disconnectedSec: 0,
    });
    expect(new Date(s.endedAt).getTime()).toBe(min(35).getTime());
    const out = await as(tara, () =>
      db().attendancePunch.findFirst({
        where: { employeeId: timed.id, type: 'OUT' },
        orderBy: { serverTs: 'desc' },
      }),
    );
    expect(out).toMatchObject({ source: 'SYSTEM', serverTs: min(35) });
    // A heartbeat after the close gets a clear answer.
    await expect(at(161, tara, () => work.heartbeat({}))).rejects.toMatchObject({
      code: 'no_active_session',
    });
  });

  test('a missing check-out is corrected by the manager; the event log only grows', async () => {
    const s = (await at(170, tara, () => work.status())).today.find((x) => x.status === 'AUTO_CLOSED');
    await expect(
      at(170, tara, () =>
        work.requestCorrection({
          sessionId: s.id,
          kind: 'MISSING_CHECKOUT',
          fromTs: min(40).toISOString(),
          toTs: min(65).toISOString(),
          reason: 'Kept working offline',
        }),
      ),
    ).rejects.toMatchObject({ status: 422 });
    const c = await at(170, tara, () =>
      work.requestCorrection({
        sessionId: s.id,
        kind: 'MISSING_CHECKOUT',
        fromTs: s.endedAt.toISOString(),
        toTs: min(65).toISOString(),
        reason: 'Kept working offline',
      }),
    );
    expect(c.status).toBe('PENDING');
    await expect(
      at(171, tara, () => work.decideCorrection(c.id, { decision: 'APPROVED' })),
    ).rejects.toMatchObject({ status: 403 });
    const before = await as(tara, () =>
      db().workSessionEvent.findMany({ where: { sessionId: s.id }, orderBy: { serverTs: 'asc' } }),
    );
    const inbox = await at(172, maya, () => work.listCorrections({ view: 'approvals', status: 'PENDING' }));
    expect(inbox.map((x) => x.id)).toEqual([c.id]);
    await at(172, maya, () => work.decideCorrection(c.id, { decision: 'APPROVED' }));
    await expect(
      at(173, maya, () => work.decideCorrection(c.id, { decision: 'APPROVED' })),
    ).rejects.toMatchObject({
      code: 'already_decided',
    });
    const fixed = await at(174, tara, () => work.getSession(s.id));
    expect(fixed).toMatchObject({ workedSec: 35 * 60, needsReview: false });
    expect(new Date(fixed.endedAt).getTime()).toBe(min(65).getTime());
    const after = await as(tara, () =>
      db().workSessionEvent.findMany({ where: { sessionId: s.id }, orderBy: { serverTs: 'asc' } }),
    );
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(before.length).map((e) => e.type)).toEqual(['CORRECTION_APPLIED']);
  });

  test('a disputed disconnection, once approved, counts as work', async () => {
    const s = (await at(180, tara, () => work.status())).today.find((x) => x.disconnectedSec > 0);
    const c = await at(180, tara, () =>
      work.requestCorrection({
        sessionId: s.id,
        kind: 'DISCONNECT_DISPUTE',
        fromTs: min(10).toISOString(),
        toTs: min(20).toISOString(),
        reason: 'Wi-Fi dropped, I was on a call',
      }),
    );
    await at(181, maya, () => work.decideCorrection(c.id, { decision: 'APPROVED' }));
    const fixed = await at(182, tara, () => work.getSession(s.id));
    expect(fixed).toMatchObject({ workedSec: 25 * 60, disconnectedSec: 0 });
  });
});

describe('team status and session visibility', () => {
  test('team status is a sensitive permission: needs the grant and two-step verification', async () => {
    await worker.call('get', '/work/team').expect(403);
    expect((await manager.call('get', '/work/team').expect(403)).body.code).toBe('mfa_required');
  });

  test('an admin sees who is working now, with status only', async () => {
    await worker.call('post', '/work/sessions').send({ workLocationId: office.id }).expect(201);
    const t = (await owner.call('get', '/work/team').expect(200)).body;
    const ravi = t.data.find((r) => r.employee.id === emp.id);
    expect(ravi).toMatchObject({ state: 'WORKING', session: { location: { name: 'Pune office' } } });
    expect(Object.keys(ravi).sort()).toEqual(['employee', 'session', 'state', 'today']);
    expect(t.counts.WORKING).toBeGreaterThanOrEqual(1);
    const working = (await owner.call('get', '/work/team?status=WORKING').expect(200)).body.data;
    expect(working.every((r) => r.state === 'WORKING')).toBe(true);
    await worker.call('post', '/work/sessions/current/end').send({}).expect(200);
  });

  test("people see their own sessions; others' only with the permission in scope", async () => {
    const mine = (
      await worker.call('get', `/work/sessions?from=${plusDays(-1)}&to=${plusDays(1)}`).expect(200)
    ).body.data;
    expect(mine.length).toBeGreaterThan(0);
    await outsider.call('get', `/work/sessions/${mine[0].id}`).expect(404);
    await outsider
      .call('get', `/work/sessions?from=${today()}&to=${today()}&employeeId=${emp.id}`)
      .expect(403);
    await owner.call('get', `/work/sessions/${mine[0].id}`).expect(200);
    const forRavi = (
      await owner.call('get', `/work/sessions?from=${today()}&to=${today()}&employeeId=${emp.id}`).expect(200)
    ).body.data;
    expect(forRavi.map((s) => s.id)).toContain(mine[0].id);
  });
});
