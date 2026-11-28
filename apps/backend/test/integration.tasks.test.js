// Integration: projects, tasks and their status rules, task timers inside work sessions, hand-entered time,
// daily work reports, weekly timesheets (and the lock they put on a week), the manager board and the HR dashboard.
import { offsetMinutes } from '../src/lib/time.js';
import { startHarness } from './helpers/harness.js';

let h;
let owner; // Company Admin with MFA, not linked to an employee
let manager; // team_leader linked to `mgr`
let worker; // employee linked to `emp`, reports to `mgr`
let outsider; // employee linked to `other`
let mgr;
let emp;
let other;
let office;
let project;
let reviewTask; // set by the manager for Ravi, needs approval
let ownTask; // Ravi's own task
const TZ = 'Asia/Kolkata';
const localDay = (n = 0) =>
  new Date(Date.now() + offsetMinutes(new Date(), TZ) * 60_000 + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  h = await startHarness();
  owner = await h.owner('tasks', { mfa: true });
  const le = (await owner.call('get', '/companies/legal-entities').expect(200)).body.data[0];
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
  const link = async (roleKey, employee, tag) => {
    const m = await h.member(owner, [roleKey], tag);
    await owner
      .call('put', `/tenants/members/${m.membershipId}/employee`)
      .send({ employeeId: employee.id })
      .expect(204);
    return m;
  };
  manager = await link('team_leader', mgr, 'tmgr');
  worker = await link('employee', emp, 'twrk');
  outsider = await link('employee', other, 'tout');
  office = await post('/companies/work-locations', { name: 'Office', type: 'OFFICE' });
});
afterAll(() => h.stop());

describe('projects', () => {
  test('only project.manage creates; members see their projects; codes are unique', async () => {
    await worker.call('post', '/projects').send({ code: 'APP', name: 'App' }).expect(403);
    project = (
      await owner
        .call('post', '/projects')
        .send({ code: 'app', name: 'Customer app', ownerEmployeeId: mgr.id, clientName: 'Acme' })
        .expect(201)
    ).body;
    expect(project.code).toBe('APP');
    expect(
      (await owner.call('post', '/projects').send({ code: 'APP', name: 'Again' }).expect(409)).body.code,
    ).toBe('project_code_exists');
    await owner
      .call('post', `/projects/${project.id}/members`)
      .send({ employeeIds: [emp.id] })
      .expect(200);
    expect((await worker.call('get', '/projects').expect(200)).body.data.map((p) => p.id)).toContain(
      project.id,
    );
    expect((await outsider.call('get', '/projects').expect(200)).body.data).toEqual([]);
    // The owner (a manager without project.manage) may change their own project.
    await manager.call('patch', `/projects/${project.id}`).send({ description: 'Mobile app' }).expect(200);
    await outsider.call('patch', `/projects/${project.id}`).send({ description: 'x' }).expect(404);
  });
});

describe('tasks and their status rules', () => {
  test('people create tasks for themselves and give work only to people they manage', async () => {
    ownTask = (await worker.call('post', '/tasks').send({ title: 'Write release notes' }).expect(201)).body;
    expect(ownTask.assignees.map((a) => a.id)).toEqual([emp.id]);
    const res = await worker
      .call('post', '/tasks')
      .send({ title: 'For Odin', assigneeIds: [other.id] })
      .expect(422);
    expect(res.body.errors[0].path).toBe('body.assigneeIds');
    await outsider.call('post', '/tasks').send({ title: 'x', projectId: project.id }).expect(422); // not a member
    reviewTask = (
      await manager
        .call('post', '/tasks')
        .send({
          title: 'Login screen',
          projectId: project.id,
          assigneeIds: [emp.id],
          requiresApproval: true,
          priority: 'HIGH',
          dueDate: localDay(-1),
        })
        .expect(201)
    ).body;
    expect(reviewTask).toMatchObject({ status: 'ASSIGNED', project: { code: 'APP' } });
    await outsider.call('get', `/tasks/${reviewTask.id}`).expect(404);
    const mine = (await worker.call('get', '/tasks?view=mine&open=true').expect(200)).body.data.map(
      (t) => t.id,
    );
    expect(mine).toEqual(expect.arrayContaining([ownTask.id, reviewTask.id]));
    const team = (await manager.call('get', '/tasks?view=team').expect(200)).body.data.map((t) => t.id);
    expect(team).toContain(ownTask.id); // a manager sees their report's own tasks
  });

  test('work goes through review; nobody approves their own; a reviewer approves and can reopen', async () => {
    const move = (who, status, expected = 200) =>
      who.call('post', `/tasks/${reviewTask.id}/status`).send({ status }).expect(expected);
    let t = (await worker.call('get', `/tasks/${reviewTask.id}`).expect(200)).body;
    expect(t.you).toMatchObject({
      isAssignee: true,
      isReviewer: false,
      allowedMoves: ['IN_PROGRESS', 'ON_HOLD'],
    });
    await move(worker, 'IN_PROGRESS');
    expect((await move(worker, 'COMPLETED', 409)).body.code).toBe('needs_review');
    await move(worker, 'UNDER_REVIEW');
    expect((await move(worker, 'COMPLETED', 409)).body.code).toBe('not_reviewer');
    expect((await move(outsider, 'COMPLETED', 404)).body.code).toBeDefined();
    t = (await move(manager, 'COMPLETED')).body;
    expect(t).toMatchObject({ status: 'COMPLETED', progressPct: 100, approvedAt: expect.any(String) });
    t = (
      await manager
        .call('post', `/tasks/${reviewTask.id}/status`)
        .send({ status: 'IN_PROGRESS', comment: 'One more fix' })
        .expect(200)
    ).body;
    expect(t.comments.at(-1)).toMatchObject({ body: 'One more fix', author: { id: mgr.id } });
    // Only reviewers change the task itself; assignees may update progress.
    await worker.call('patch', `/tasks/${reviewTask.id}`).send({ title: 'Renamed' }).expect(403);
    await worker.call('patch', `/tasks/${reviewTask.id}`).send({ progressPct: 40 }).expect(200);
  });
});

describe('task time', () => {
  test('a timer needs a running work session; switching tasks stops the other; breaks and ending stop it', async () => {
    expect((await worker.call('post', `/tasks/${ownTask.id}/timer/start`).expect(409)).body.code).toBe(
      'no_active_session',
    );
    await worker.call('post', '/work/sessions').send({ workLocationId: office.id }).expect(201);
    let timer = (await worker.call('post', `/tasks/${ownTask.id}/timer/start`).expect(200)).body.timer;
    expect(timer).toMatchObject({ taskId: ownTask.id, endedAt: null });
    expect((await worker.call('get', `/tasks/${ownTask.id}`).expect(200)).body.status).toBe('IN_PROGRESS');
    timer = (await worker.call('post', `/tasks/${reviewTask.id}/timer/start`).expect(200)).body.timer;
    expect(timer.taskId).toBe(reviewTask.id);
    const entries = (
      await worker.call('get', `/tasks/time-entries?from=${localDay()}&to=${localDay()}`).expect(200)
    ).body.data;
    expect(entries.filter((e) => !e.endedAt)).toHaveLength(1);
    await outsider.call('post', `/tasks/${ownTask.id}/timer/start`).expect(404);
    await worker.call('post', '/work/sessions/current/break/start').send({}).expect(200);
    expect((await worker.call('get', '/tasks/timer').expect(200)).body.timer).toBeNull();
    expect((await worker.call('post', `/tasks/${ownTask.id}/timer/start`).expect(409)).body.code).toBe(
      'on_break',
    );
    await worker.call('post', '/work/sessions/current/break/end').send({}).expect(200);
    await worker.call('post', `/tasks/${ownTask.id}/timer/start`).expect(200);
    await worker.call('post', '/work/sessions/current/end').send({}).expect(200);
    expect((await worker.call('get', '/tasks/timer').expect(200)).body.timer).toBeNull();
    expect((await worker.call('post', '/tasks/timer/stop').expect(409)).body.code).toBe('no_timer');
  });

  test('time entered by hand: recent days only, own tasks only; timer entries cannot be deleted', async () => {
    const add = (body, expected) =>
      worker
        .call('post', '/tasks/time-entries')
        .send({ taskId: ownTask.id, ...body })
        .expect(expected);
    await add({ date: localDay(1), minutes: 30 }, 422);
    await add({ date: localDay(-20), minutes: 30 }, 422);
    const e = (await add({ date: localDay(), minutes: 45, note: 'Drafting' }, 201)).body;
    expect(e).toMatchObject({ source: 'MANUAL', durationSec: 2700 });
    const extra = (await add({ date: localDay(), minutes: 10 }, 201)).body;
    await worker.call('delete', `/tasks/time-entries/${extra.id}`).expect(204);
    await outsider
      .call('post', '/tasks/time-entries')
      .send({ taskId: ownTask.id, date: localDay(), minutes: 5 })
      .expect(404);
    const timerEntry = (
      await worker.call('get', `/tasks/time-entries?from=${localDay()}&to=${localDay()}`).expect(200)
    ).body.data.find((x) => x.source === 'TIMER');
    expect((await worker.call('delete', `/tasks/time-entries/${timerEntry.id}`).expect(409)).body.code).toBe(
      'not_manual',
    );
    expect(
      (await worker.call('get', `/tasks/${ownTask.id}`).expect(200)).body.actualMin,
    ).toBeGreaterThanOrEqual(45);
  });

  test('a task with recorded time cannot be deleted; a fresh one can', async () => {
    expect((await worker.call('delete', `/tasks/${ownTask.id}`).expect(409)).body.code).toBe('task_has_time');
    const fresh = (await worker.call('post', '/tasks').send({ title: 'Scratch' }).expect(201)).body;
    await worker.call('delete', `/tasks/${fresh.id}`).expect(204);
    await worker.call('get', `/tasks/${fresh.id}`).expect(404);
  });
});

describe('daily work report', () => {
  let report;
  test('built from the record; notes are saved; submission freezes it', async () => {
    let r = (await worker.call('get', `/work-reports/me/${localDay()}`).expect(200)).body;
    expect(r).toMatchObject({ status: 'DRAFT', canEdit: true });
    expect(r.summary.sessions.length).toBeGreaterThan(0);
    expect(r.summary.tasks.map((t) => t.taskId)).toContain(ownTask.id);
    expect(r.summary.taskSec).toBeGreaterThanOrEqual(2700);
    r = (
      await worker
        .call('put', `/work-reports/me/${localDay()}`)
        .send({ notes: 'Release notes drafted' })
        .expect(200)
    ).body;
    expect(r.notes).toBe('Release notes drafted');
    await worker.call('post', `/work-reports/me/${localDay(1)}/submit`).expect(422);
    report = (await worker.call('post', `/work-reports/me/${localDay()}/submit`).expect(200)).body;
    expect(report).toMatchObject({ status: 'SUBMITTED', canEdit: false });
    expect(
      (await worker.call('put', `/work-reports/me/${localDay()}`).send({ notes: 'x' }).expect(409)).body.code,
    ).toBe('report_locked');
  });

  test('the manager reviews; nobody reviews their own; changes requested reopens it', async () => {
    const id = report.id;
    await worker.call('post', `/work-reports/${id}/decision`).send({ decision: 'APPROVED' }).expect(403);
    await outsider.call('post', `/work-reports/${id}/decision`).send({ decision: 'APPROVED' }).expect(404);
    await outsider.call('get', `/work-reports/${id}`).expect(404);
    const inbox = (await manager.call('get', '/work-reports?view=approvals&status=SUBMITTED').expect(200))
      .body.data;
    expect(inbox.map((x) => x.id)).toEqual([id]);
    await manager
      .call('post', `/work-reports/${id}/decision`)
      .send({ decision: 'CHANGES_REQUESTED' })
      .expect(422);
    await manager
      .call('post', `/work-reports/${id}/decision`)
      .send({ decision: 'CHANGES_REQUESTED', comment: 'Add the blockers' })
      .expect(200);
    const back = (await worker.call('get', `/work-reports/me/${localDay()}`).expect(200)).body;
    expect(back).toMatchObject({
      status: 'CHANGES_REQUESTED',
      canEdit: true,
      reviewComment: 'Add the blockers',
    });
    await worker
      .call('put', `/work-reports/me/${localDay()}`)
      .send({ notes: 'Drafted. Blocked on copy review.' })
      .expect(200);
    await worker.call('post', `/work-reports/me/${localDay()}/submit`).expect(200);
    const done = (
      await manager.call('post', `/work-reports/${id}/decision`).send({ decision: 'APPROVED' }).expect(200)
    ).body;
    expect(done.status).toBe('APPROVED');
    await manager.call('post', `/work-reports/${id}/decision`).send({ decision: 'APPROVED' }).expect(409);
  });
});

describe('weekly timesheet', () => {
  let sheet;
  test('built from sessions and task time; submitting locks the week', async () => {
    sheet = (await worker.call('get', '/timesheets/me').expect(200)).body;
    expect(sheet).toMatchObject({ status: 'DRAFT', canSubmit: true, sessionRunning: false });
    expect(sheet.breakdown.days).toHaveLength(7);
    expect(sheet.breakdown.taskSec).toBeGreaterThanOrEqual(2700);
    const notStart = sheet.weekStart === localDay() ? localDay(1) : localDay();
    if (notStart !== sheet.weekStart)
      expect(
        (await worker.call('post', `/timesheets/me/${notStart}/submit`).expect(422)).body.errors[0].path,
      ).toBe('params.date');
    sheet = (await worker.call('post', `/timesheets/me/${sheet.weekStart}/submit`).expect(200)).body;
    expect(sheet).toMatchObject({ status: 'SUBMITTED', canSubmit: false });
    const locked = await worker
      .call('post', '/tasks/time-entries')
      .send({ taskId: ownTask.id, date: localDay(), minutes: 5 })
      .expect(409);
    expect(locked.body.code).toBe('timesheet_locked');
    const session = (await worker.call('get', '/work/me/status').expect(200)).body.today.at(-1);
    const correction = await worker
      .call('post', '/work/corrections')
      .send({
        sessionId: session.id,
        kind: 'ADD_WORK_TIME',
        fromTs: session.startedAt,
        toTs: session.endedAt,
        reason: 'Testing the lock',
      })
      .expect(409);
    expect(correction.body.code).toBe('timesheet_locked');
  });

  test('changes requested unlocks the week; approval locks it for good', async () => {
    const list = (await manager.call('get', '/timesheets?view=approvals&status=SUBMITTED').expect(200)).body
      .data;
    const id = list.find((x) => x.weekStart === sheet.weekStart).id;
    await worker.call('post', `/timesheets/${id}/decision`).send({ decision: 'APPROVED' }).expect(403);
    await outsider.call('get', `/timesheets/${id}`).expect(404);
    await manager
      .call('post', `/timesheets/${id}/decision`)
      .send({ decision: 'CHANGES_REQUESTED', comment: 'Add Friday' })
      .expect(200);
    await worker
      .call('post', '/tasks/time-entries')
      .send({ taskId: ownTask.id, date: localDay(), minutes: 5 })
      .expect(201);
    const again = (await worker.call('post', `/timesheets/me/${sheet.weekStart}/submit`).expect(200)).body;
    expect(again.totalSec).toBeGreaterThanOrEqual(0);
    expect(again.breakdown.taskSec).toBeGreaterThanOrEqual(2700 + 300);
    const approved = (
      await manager.call('post', `/timesheets/${id}/decision`).send({ decision: 'APPROVED' }).expect(200)
    ).body;
    expect(approved.status).toBe('APPROVED');
    await worker
      .call('post', '/tasks/time-entries')
      .send({ taskId: ownTask.id, date: localDay(), minutes: 5 })
      .expect(409);
  });
});

describe('dashboards', () => {
  test('the manager board needs team-status access with two-step verification', async () => {
    await worker.call('get', '/dashboards/team-board').expect(403);
    expect((await manager.call('get', '/dashboards/team-board').expect(403)).body.code).toBe('mfa_required');
    const board = (await owner.call('get', '/dashboards/team-board').expect(200)).body;
    const ravi = board.data.find((r) => r.employee.id === emp.id);
    expect(ravi.tasks.open).toBeGreaterThanOrEqual(2);
    expect(ravi.tasks.overdue).toBeGreaterThanOrEqual(1); // the login screen was due yesterday
    expect(board.waitingForYou).toEqual(
      expect.objectContaining({
        wfhRequests: expect.any(Number),
        timesheets: expect.any(Number),
        taskReviews: expect.any(Number),
      }),
    );
  });

  test('the HR remote-work dashboard is aggregates only', async () => {
    await worker.call('get', '/dashboards/remote-work').expect(403);
    const d = (await owner.call('get', '/dashboards/remote-work').expect(200)).body;
    expect(d.headcount).toBeGreaterThanOrEqual(3);
    expect(d.period.sessions).toBeGreaterThanOrEqual(1);
    expect(d.daily).toHaveLength(7);
    const text = JSON.stringify(d);
    for (const name of ['Ravi', 'Maya', 'Odin', emp.id]) expect(text).not.toContain(name);
    await owner.call('get', '/dashboards/remote-work?from=2026-01-01&to=2026-12-31').expect(422);
  });
});

describe('editing keeps what was not sent', () => {
  test('renaming a shift keeps its grace minutes (regression: PATCH used to reset defaulted fields)', async () => {
    const shift = (
      await owner
        .call('post', '/attendance/shifts')
        .send({
          name: 'Early',
          startTime: '07:00',
          endTime: '15:00',
          graceLateMin: 15,
          graceEarlyMin: 5,
          breakMinutes: 30,
        })
        .expect(201)
    ).body;
    await owner.call('patch', `/attendance/shifts/${shift.id}`).send({ name: 'Early bird' }).expect(200);
    const after = (await owner.call('get', `/attendance/shifts/${shift.id}`).expect(200)).body;
    expect(after).toMatchObject({ name: 'Early bird', graceLateMin: 15, graceEarlyMin: 5, breakMinutes: 30 });
  });

  test('renaming a project keeps its status and billing flag', async () => {
    await owner
      .call('patch', `/projects/${project.id}`)
      .send({ status: 'ON_HOLD', isBillable: true })
      .expect(200);
    const renamed = (
      await owner.call('patch', `/projects/${project.id}`).send({ name: 'Customer app v2' }).expect(200)
    ).body;
    expect(renamed).toMatchObject({ name: 'Customer app v2', status: 'ON_HOLD', isBillable: true });
  });
});
