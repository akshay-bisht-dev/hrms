// Integration: company profile and org structure over HTTP against real MySQL + Redis.
import { startHarness } from './helpers/harness.js';

let h;
let owner;
let legalEntityId;
beforeAll(async () => {
  h = await startHarness();
  owner = await h.owner('org');
  legalEntityId = (await owner.call('get', '/companies/legal-entities').expect(200)).body.data[0].id;
});
afterAll(() => h.stop());

const week = Array.from({ length: 7 }, (_, day) => ({
  day,
  working: day >= 1 && day <= 5,
  startMin: 540,
  endMin: 1080,
}));

describe('company profile', () => {
  test('read and update; registration created one legal entity from the country profile', async () => {
    const cur = (await owner.call('get', '/companies/current').expect(200)).body;
    expect(cur).toMatchObject({ countryCode: 'IN', defaultCurrency: 'INR', status: 'TRIAL' });
    const updated = (
      await owner
        .call('patch', '/companies/current')
        .send({ name: 'Acme Software Pvt Ltd', timezone: 'Asia/Kolkata' })
        .expect(200)
    ).body;
    expect(updated.name).toBe('Acme Software Pvt Ltd');
    expect((await owner.call('patch', '/companies/current').send({ timezone: 'Mars/Base' })).status).toBe(
      422,
    );
    expect((await owner.call('patch', '/companies/current').send({ status: 'ACTIVE' })).status).toBe(422); // not editable here
    const le = (await owner.call('get', `/companies/legal-entities/${legalEntityId}`).expect(200)).body;
    expect(le).toMatchObject({ countryCode: 'IN', currency: 'INR', weekendDays: [0] });
    expect(le.tenantId).toBeUndefined();
  });
});

describe('org structure CRUD', () => {
  test('branches: create, duplicate code → 409, list/search, update, delete', async () => {
    const b = (
      await owner
        .call('post', '/companies/branches')
        .send({
          legalEntityId,
          name: 'Bengaluru HQ',
          code: 'blr',
          timezone: 'Asia/Kolkata',
          address: { city: 'Bengaluru', countryCode: 'in' },
        })
        .expect(201)
    ).body;
    expect(b.code).toBe('BLR');
    expect(
      (
        await owner
          .call('post', '/companies/branches')
          .send({ legalEntityId, name: 'Other', code: 'BLR', timezone: 'UTC' })
      ).body.code,
    ).toBe('duplicate');
    const found = (await owner.call('get', '/companies/branches?q=Bengal').expect(200)).body.data;
    expect(found.map((x) => x.id)).toContain(b.id);
    await owner
      .call('patch', `/companies/branches/${b.id}`)
      .send({ name: 'Bengaluru Head Office' })
      .expect(200);
    await owner.call('delete', `/companies/branches/${b.id}`).expect(204);
    await owner.call('get', `/companies/branches/${b.id}`).expect(404);
  });

  test('a branch cannot point at a legal entity that does not exist (or belongs to someone else)', async () => {
    const res = await owner.call('post', '/companies/branches').send({
      legalEntityId: '0190f7a0-0000-7000-8000-000000000000',
      name: 'Ghost',
      code: 'GHOST',
      timezone: 'UTC',
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('invalid_reference');
  });

  test('deleting a legal entity that branches use returns 409 in_use', async () => {
    await owner
      .call('post', '/companies/branches')
      .send({ legalEntityId, name: 'Pune', code: 'PUNE', timezone: 'Asia/Kolkata' })
      .expect(201);
    const res = await owner.call('delete', `/companies/legal-entities/${legalEntityId}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('in_use');
  });

  test('departments form a tree and cycles are rejected', async () => {
    const eng = (
      await owner
        .call('post', '/companies/departments')
        .send({ name: 'Engineering', code: 'ENG' })
        .expect(201)
    ).body;
    const plat = (
      await owner
        .call('post', '/companies/departments')
        .send({ name: 'Platform', code: 'PLAT', parentId: eng.id })
        .expect(201)
    ).body;
    const infra = (
      await owner
        .call('post', '/companies/departments')
        .send({ name: 'Infrastructure', code: 'INFRA', parentId: plat.id })
        .expect(201)
    ).body;
    const cyc = await owner.call('patch', `/companies/departments/${eng.id}`).send({ parentId: infra.id });
    expect(cyc.status).toBe(422);
    expect(cyc.body.errors[0].message).toMatch(/sub-departments/);
    expect(
      (await owner.call('patch', `/companies/departments/${eng.id}`).send({ parentId: eng.id })).status,
    ).toBe(422);
    expect((await owner.call('delete', `/companies/departments/${eng.id}`)).body.code).toBe('in_use'); // has children

    await owner.call('post', '/companies/teams').send({ name: 'SRE', departmentId: infra.id }).expect(201);
    const chart = (await owner.call('get', '/companies/org-chart').expect(200)).body;
    const engNode = chart.departments.find((d) => d.id === eng.id);
    expect(engNode.children[0].children[0]).toMatchObject({
      name: 'Infrastructure',
      teams: [{ name: 'SRE' }],
    });
  });

  test('designations, teams and work schedules', async () => {
    await owner
      .call('post', '/companies/designations')
      .send({ title: 'Software Engineer', level: 3 })
      .expect(201);
    expect(
      (await owner.call('post', '/companies/designations').send({ title: 'Software Engineer' })).status,
    ).toBe(409);
    const ws = await owner
      .call('post', '/companies/work-schedules')
      .send({ name: 'Standard 9–6', type: 'FIXED', weeklyPattern: week, dailyMinutes: 480 })
      .expect(201);
    expect(ws.body.weeklyPattern).toHaveLength(7);
    const bad = await owner.call('post', '/companies/work-schedules').send({
      name: 'Broken',
      type: 'FIXED',
      weeklyPattern: week.map((d) => ({ ...d, endMin: 300 })),
      dailyMinutes: 480,
    });
    expect(bad.status).toBe(422);
    const patched = await owner
      .call('patch', `/companies/work-schedules/${ws.body.id}`)
      .send({ graceMinutes: 15 })
      .expect(200);
    expect(patched.body.graceMinutes).toBe(15);
  });

  test('holiday calendars: dates must fall in the calendar year; branches can use a calendar', async () => {
    const cal = (
      await owner
        .call('post', '/companies/holiday-calendars')
        .send({ name: 'India 2027', countryCode: 'IN', year: 2027 })
        .expect(201)
    ).body;
    await owner
      .call('post', `/companies/holiday-calendars/${cal.id}/holidays`)
      .send({ date: '2027-01-26', name: 'Republic Day' })
      .expect(201);
    const wrongYear = await owner
      .call('post', `/companies/holiday-calendars/${cal.id}/holidays`)
      .send({ date: '2026-12-25', name: 'Christmas' });
    expect(wrongYear.status).toBe(422);
    expect(
      (
        await owner
          .call('post', `/companies/holiday-calendars/${cal.id}/holidays`)
          .send({ date: '2027-01-26', name: 'Republic Day' })
      ).status,
    ).toBe(409);
    const list = (await owner.call('get', `/companies/holiday-calendars/${cal.id}/holidays`).expect(200)).body
      .data;
    expect(list).toEqual([
      expect.objectContaining({ date: '2027-01-26', name: 'Republic Day', isOptional: false }),
    ]);
    await owner
      .call('post', '/companies/branches')
      .send({
        legalEntityId,
        holidayCalendarId: cal.id,
        name: 'Chennai',
        code: 'MAA',
        timezone: 'Asia/Kolkata',
      })
      .expect(201);
    expect((await owner.call('delete', `/companies/holiday-calendars/${cal.id}`)).body.code).toBe('in_use');
    await owner.call('delete', `/companies/holiday-calendars/${cal.id}/holidays/${list[0].id}`).expect(204);
  });

  test('pagination returns a cursor and the next page', async () => {
    for (let i = 0; i < 3; i++)
      await owner
        .call('post', '/companies/designations')
        .send({ title: `Page Title ${i}` })
        .expect(201);
    const p1 = (await owner.call('get', '/companies/designations?limit=2').expect(200)).body;
    expect(p1.data).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = (
      await owner.call('get', `/companies/designations?limit=2&cursor=${p1.nextCursor}`).expect(200)
    ).body;
    expect(p2.data[0].id).not.toBe(p1.data[1].id);
    expect((await owner.call('get', '/companies/designations?limit=500')).status).toBe(422);
  });

  test('every change is audited', async () => {
    const rows = await h.db().auditLog.findMany({
      where: {
        tenantId: owner.tenantId,
        action: { in: ['branch.created', 'department.created', 'holiday.created', 'tenant.updated'] },
      },
    });
    expect(new Set(rows.map((r) => r.action))).toEqual(
      new Set(['branch.created', 'department.created', 'holiday.created', 'tenant.updated']),
    );
    expect(rows.every((r) => r.actorUserId === owner.userId)).toBe(true);
  });
});

describe('permissions on org structure', () => {
  test('an Employee can read the org structure but not change it', async () => {
    const emp = await h.member(owner, ['employee'], 'emp');
    await emp.call('get', '/companies/departments').expect(200);
    await emp.call('get', '/companies/org-chart').expect(200);
    expect((await emp.call('post', '/companies/designations').send({ title: 'Sneaky' })).status).toBe(403);
    expect((await emp.call('patch', '/companies/current').send({ name: 'Hacked' })).status).toBe(403);
  });
  test('an HR Executive cannot edit the company profile; signed-out callers get 401', async () => {
    const hrx = await h.member(owner, ['hr_executive'], 'hrx');
    expect(
      (
        await hrx
          .call('post', '/companies/branches')
          .send({ legalEntityId, name: 'X', code: 'X1', timezone: 'UTC' })
      ).status,
    ).toBe(403);
    const anon = h.client();
    expect((await anon.call('get', '/companies/departments')).status).toBe(401);
  });
});
