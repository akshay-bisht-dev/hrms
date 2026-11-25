// Phase 3 ST-01/ST-02 — generated cross-tenant suite.
// Every route with an id in its path is taken from the live route registry and called by tenant B's fully
// privileged (MFA-verified) Company Admin with tenant A's ids. All must answer 404 and leave A's data unchanged.
// A new route with an id parameter and no fixture below makes this suite fail, so coverage cannot silently drop.
import { apiRouter } from '../src/routes/index.js';
import { listRoutes } from '../src/lib/route-registry.js';
import { startHarness } from './helpers/harness.js';

let h;
let A;
let B;
const ids = {};
const week = Array.from({ length: 7 }, (_, day) => ({
  day,
  working: day >= 1 && day <= 5,
  startMin: 540,
  endMin: 1080,
}));

beforeAll(async () => {
  h = await startHarness();
  A = await h.owner('tenantA', { mfa: true });
  B = await h.owner('tenantB', { mfa: true });
  const post = async (path, body) => (await A.call('post', path).send(body).expect(201)).body;
  ids.legalEntity = (await A.call('get', '/companies/legal-entities').expect(200)).body.data[0].id;
  ids.calendar = (
    await post('/companies/holiday-calendars', { name: 'A cal', countryCode: 'IN', year: 2027 })
  ).id;
  ids.holiday = (
    await post(`/companies/holiday-calendars/${ids.calendar}/holidays`, {
      date: '2027-08-15',
      name: 'Independence Day',
    })
  ).id;
  ids.branch = (
    await post('/companies/branches', {
      legalEntityId: ids.legalEntity,
      name: 'A branch',
      code: 'ABR',
      timezone: 'Asia/Kolkata',
    })
  ).id;
  ids.department = (await post('/companies/departments', { name: 'A dept', code: 'ADEPT' })).id;
  ids.designation = (await post('/companies/designations', { title: 'A title' })).id;
  ids.team = (await post('/companies/teams', { name: 'A team', departmentId: ids.department })).id;
  ids.schedule = (
    await post('/companies/work-schedules', {
      name: 'A sched',
      type: 'FIXED',
      weeklyPattern: week,
      dailyMinutes: 480,
    })
  ).id;
  ids.role = (
    await post('/tenants/roles', {
      name: 'A role',
      grants: [{ permissionCode: 'attendance.view', scope: 'OWN' }],
    })
  ).id;
  const member = await h.member(A, ['employee'], 'amember');
  ids.member = member.membershipId;
  ids.invite = (
    await post('/tenants/invitations', { email: h.uniqueEmail('apending'), roleIds: [ids.role] })
  ).id;
  ids.session = (await A.call('get', '/auth/sessions').expect(200)).body.data[0].id;
  const emp = await post('/employees', {
    firstName: 'A person',
    legalEntityId: ids.legalEntity,
    dateOfJoining: '2026-01-05',
    nationalIdType: 'PAN',
    nationalId: 'ABCDE1234F',
  });
  ids.employee = emp.id;
  ids.employmentRecord = (
    await A.call('get', `/employees/${emp.id}/employment-records`).expect(200)
  ).body.data[0].id;
  ids.contact = (
    await post(`/employees/${emp.id}/emergency-contacts`, {
      name: 'A contact',
      relationship: 'Sister',
      phone: '+91 91234 56789',
    })
  ).id;
  await post(`/employees/${emp.id}/bank-accounts`, {
    accountHolder: 'A holder',
    accountNumber: '123456789012',
    currency: 'INR',
    effectiveFrom: '2026-01-01',
  });
  ids.document = (
    await post(`/employees/${emp.id}/documents/upload-url`, {
      category: 'OTHER',
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
    })
  ).documentId;
  const up = (await A.call('post', '/employees/imports/upload-url').expect(200)).body;
  await fetch(up.uploadUrl, {
    method: 'PUT',
    headers: up.headers,
    body: `employeeCode,firstName,dateOfJoining\nA-IMP-${Date.now()},A imported,2026-01-05\n`,
  });
  ids.importJob = (
    await A.call('post', '/employees/imports').send({ uploadId: up.uploadId }).expect(202)
  ).body.id;
  // Attendance: link A's owner to the employee record so A can clock in and ask for a correction.
  const aMembers = (await A.call('get', '/tenants/members').expect(200)).body.data;
  const aOwnerMembership = aMembers.find((m) => m.email === A.email).id;
  await A.call('put', `/tenants/members/${aOwnerMembership}/employee`)
    .send({ employeeId: emp.id })
    .expect(204);
  ids.workLocation = (await post('/companies/work-locations', { name: 'A office', type: 'OFFICE' })).id;
  ids.shift = (
    await post('/attendance/shifts', { name: 'A shift', startTime: '09:00', endTime: '18:00' })
  ).id;
  ids.overtimeRule = (
    await post('/attendance/overtime-rules', {
      name: 'A rule',
      dailyThresholdMin: 480,
      multiplier: '1.5',
      effectiveFrom: '2026-01-01',
    })
  ).id;
  await post('/attendance/shift-assignments', {
    shiftId: ids.shift,
    employeeIds: [emp.id],
    effectiveFrom: '2026-01-05',
  });
  ids.assignment = (await A.call('get', '/attendance/shift-assignments').expect(200)).body.data[0].id;
  await post('/attendance/punches', { type: 'IN', workLocationId: ids.workLocation });
  const yesterday = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  const correction = await post('/attendance/regularizations', {
    workDate: yesterday,
    inTime: '09:00',
    outTime: '18:00',
    reason: 'A forgot to clock in',
  });
  ids.regularization = correction.id;
  ids.day = correction.day.id;
  ids.bRole = (await B.call('get', '/tenants/roles').expect(200)).body.data.find(
    (r) => r.systemKey === 'employee',
  ).id;
});
afterAll(() => h.stop());

/** Maps a route to A's ids and a body that passes validation (so the request reaches the lookup, not a 422). */
function fixtureFor(method, path) {
  const table = [
    [/^\/companies\/legal-entities\/:id$/, { id: ids.legalEntity }, { name: 'Pwned' }],
    [/^\/companies\/branches\/:id$/, { id: ids.branch }, { name: 'Pwned' }],
    [/^\/companies\/departments\/:id$/, { id: ids.department }, { name: 'Pwned' }],
    [/^\/companies\/designations\/:id$/, { id: ids.designation }, { title: 'Pwned' }],
    [/^\/companies\/teams\/:id$/, { id: ids.team }, { name: 'Pwned' }],
    [/^\/companies\/work-schedules\/:id$/, { id: ids.schedule }, { name: 'Pwned' }],
    [/^\/companies\/holiday-calendars\/:id$/, { id: ids.calendar }, { name: 'Pwned' }],
    [/^\/companies\/work-locations\/:id$/, { id: ids.workLocation }, { name: 'Pwned' }],
    [/^\/attendance\/shifts\/:id$/, { id: ids.shift }, { name: 'Pwned' }],
    [/^\/attendance\/overtime-rules\/:id$/, { id: ids.overtimeRule }, { name: 'Pwned' }],
    [/^\/attendance\/shift-assignments\/:id$/, { id: ids.assignment }, undefined],
    [/^\/attendance\/days\/:id$/, { id: ids.day }, undefined],
    [/^\/attendance\/days\/:id\/overtime-decision$/, { id: ids.day }, { decision: 'APPROVED' }],
    [
      /^\/attendance\/employees\/:id\/days$/,
      { id: ids.employee },
      undefined,
      '?from=2026-01-05&to=2026-02-05',
    ],
    [/^\/attendance\/regularizations\/:id(\/cancel)?$/, { id: ids.regularization }, undefined],
    [/^\/attendance\/regularizations\/:id\/decision$/, { id: ids.regularization }, { decision: 'APPROVED' }],
    [
      /^\/companies\/holiday-calendars\/:calendarId\/holidays$/,
      { calendarId: ids.calendar },
      { date: '2027-12-25', name: 'Pwned' },
    ],
    [
      /^\/companies\/holiday-calendars\/:calendarId\/holidays\/:id$/,
      { calendarId: ids.calendar, id: ids.holiday },
      undefined,
    ],
    [/^\/tenants\/invitations\/:id$/, { id: ids.invite }, undefined],
    [/^\/tenants\/members\/:id\/roles$/, { id: ids.member }, { roleIds: [ids.bRole] }],
    [/^\/tenants\/members\/:id(\/(suspend|reactivate|sign-out))?$/, { id: ids.member }, undefined],
    [/^\/tenants\/roles\/:id$/, { id: ids.role }, { name: 'Pwned' }],
    [/^\/auth\/sessions\/:id$/, { id: ids.session }, undefined],
    [/^\/tenants\/members\/:id\/employee$/, { id: ids.member }, { employeeId: null }],
    [/^\/employees\/imports\/:id(\/result-url)?$/, { id: ids.importJob }, undefined],
    [/^\/employees\/:id$/, { id: ids.employee }, { phone: '+91 90000 00000' }],
    [/^\/employees\/:id\/national-id$/, { id: ids.employee }, undefined],
    [
      /^\/employees\/:id\/employment-records$/,
      { id: ids.employee },
      { effectiveFrom: '2026-01-05', changeReason: 'TRANSFER', departmentId: null },
    ],
    [
      /^\/employees\/:id\/employment-records\/:childId$/,
      { id: ids.employee, childId: ids.employmentRecord },
      undefined,
    ],
    [
      /^\/employees\/:id\/status$/,
      { id: ids.employee },
      { status: 'NOTICE', effectiveDate: '2026-11-25', reason: 'Pwned' },
    ],
    [
      /^\/employees\/:id\/emergency-contacts$/,
      { id: ids.employee },
      { name: 'Pwned', relationship: 'X', phone: '+91 90000 00000' },
    ],
    [
      /^\/employees\/:id\/emergency-contacts\/:childId$/,
      { id: ids.employee, childId: ids.contact },
      undefined,
    ],
    [
      /^\/employees\/:id\/bank-accounts$/,
      { id: ids.employee },
      { accountHolder: 'Pwned', accountNumber: '999988887777', currency: 'INR', effectiveFrom: '2026-06-01' },
    ],
    [/^\/employees\/:id\/documents$/, { id: ids.employee }, undefined],
    [
      /^\/employees\/:id\/documents\/upload-url$/,
      { id: ids.employee },
      { category: 'OTHER', fileName: 'p.pdf', mimeType: 'application/pdf', sizeBytes: 10 },
    ],
    [
      /^\/employees\/:id\/documents\/:childId(\/(complete|download-url|verify))?$/,
      { id: ids.employee, childId: ids.document },
      undefined,
    ],
  ];
  const hit = table.find(([re]) => re.test(path));
  if (!hit) return null;
  const [, params, body, query = ''] = hit;
  return {
    url: path.replace(/:(\w+)/g, (_, name) => params[name]) + query,
    body: method === 'GET' || method === 'DELETE' ? undefined : body,
  };
}

test('every id route answers 404 to another tenant (generated from the route registry)', async () => {
  const routes = listRoutes(apiRouter(h.services.routes)).filter(
    (r) => r.path.includes(':') && r.access !== 'public',
  );
  expect(routes.length).toBeGreaterThan(30);
  const unmapped = routes.filter((r) => !fixtureFor(r.method, r.path)).map((r) => `${r.method} ${r.path}`);
  expect(unmapped).toEqual([]); // add a fixture when adding a route

  const failures = [];
  for (const r of routes) {
    const { url, body } = fixtureFor(r.method, r.path);
    const req = B.call(r.method.toLowerCase(), url);
    const res = await (body ? req.send(body) : req);
    if (res.status !== 404) failures.push(`${r.method} ${url} → ${res.status} ${res.body?.code ?? ''}`);
    if (JSON.stringify(res.body ?? {}).includes('A '))
      failures.push(`${r.method} ${url} leaked tenant A data`);
  }
  expect(failures).toEqual([]);
});

test("tenant B's lists never contain tenant A's records", async () => {
  const lists = [
    '/employees?limit=200&includeExited=true',
    '/employees/imports',
    '/companies/legal-entities',
    '/companies/branches',
    '/companies/departments',
    '/companies/designations',
    '/companies/teams',
    '/companies/work-schedules',
    '/companies/holiday-calendars',
    '/tenants/roles',
    '/tenants/members',
    '/tenants/members?status=INVITED',
    '/companies/org-chart',
    '/auth/sessions',
    '/companies/work-locations',
    '/attendance/shifts',
    '/attendance/overtime-rules',
    '/attendance/shift-assignments',
    '/attendance/regularizations?view=approvals',
    '/attendance/overtime',
    `/attendance/days?date=${new Date().toISOString().slice(0, 10)}`,
    `/attendance/reports/summary?from=2026-01-05&to=2026-03-31`,
  ];
  const aIds = Object.entries(ids)
    .filter(([k]) => k !== 'bRole')
    .map(([, v]) => v);
  for (const path of lists) {
    const text = JSON.stringify((await B.call('get', path).expect(200)).body);
    for (const id of aIds) expect({ path, leaked: text.includes(id) }).toEqual({ path, leaked: false });
  }
});

test("tenant B cannot create records that point at tenant A's records", async () => {
  const cases = [
    ['/companies/branches', { legalEntityId: ids.legalEntity, name: 'X', code: 'XB1', timezone: 'UTC' }],
    [
      '/companies/branches',
      {
        legalEntityId: (await B.call('get', '/companies/legal-entities')).body.data[0].id,
        holidayCalendarId: ids.calendar,
        name: 'X',
        code: 'XB2',
        timezone: 'UTC',
      },
    ],
    ['/companies/departments', { name: 'X', code: 'XD1', parentId: ids.department }],
    ['/companies/teams', { name: 'X team', departmentId: ids.department }],
    ['/tenants/invitations', { email: h.uniqueEmail('x'), roleIds: [ids.role] }],
    [
      '/attendance/shift-assignments',
      { shiftId: ids.shift, employeeIds: [ids.employee], effectiveFrom: '2026-02-01' },
    ],
    [
      '/attendance/shift-assignments',
      {
        shiftId: (
          await B.call('post', '/attendance/shifts').send({
            name: 'B shift',
            startTime: '08:00',
            endTime: '16:00',
          })
        ).body.id,
        employeeIds: [ids.employee],
        effectiveFrom: '2026-02-01',
      },
    ],
    [
      '/attendance/overtime-rules',
      {
        name: 'X',
        legalEntityId: ids.legalEntity,
        dailyThresholdMin: 60,
        multiplier: '2',
        effectiveFrom: '2026-01-01',
      },
    ],
  ];
  for (const [path, body] of cases) {
    const res = await B.call('post', path).send(body);
    expect({ path, status: res.status }).toEqual({ path, status: 422 });
  }
  const res = await B.call('post', '/auth/switch-tenant').send({ tenantId: A.tenantId });
  expect(res.status).toBe(404);
});

test("tenant A's data is unchanged after all of that", async () => {
  expect((await A.call('get', `/companies/branches/${ids.branch}`).expect(200)).body.name).toBe('A branch');
  expect((await A.call('get', `/companies/departments/${ids.department}`).expect(200)).body.name).toBe(
    'A dept',
  );
  expect(
    (await A.call('get', `/companies/holiday-calendars/${ids.calendar}/holidays`).expect(200)).body.data,
  ).toHaveLength(1);
  const members = (await A.call('get', '/tenants/members').expect(200)).body.data;
  expect(members.find((m) => m.id === ids.member)).toMatchObject({
    status: 'ACTIVE',
    roles: [expect.objectContaining({ systemKey: 'employee' })],
  });
  expect(
    (await A.call('get', '/tenants/members?status=INVITED').expect(200)).body.data.map((m) => m.id),
  ).toContain(ids.invite);
  expect((await A.call('get', '/auth/sessions').expect(200)).body.data.map((s) => s.id)).toContain(
    ids.session,
  );
  expect((await A.call('get', `/employees/${ids.employee}`).expect(200)).body).toMatchObject({
    firstName: 'A person',
    status: 'ACTIVE',
    phone: null,
  });
  expect(
    (await A.call('get', `/employees/${ids.employee}/emergency-contacts`).expect(200)).body.data,
  ).toHaveLength(1);
  expect(
    (await A.call('get', `/employees/${ids.employee}/bank-accounts`).expect(200)).body.data,
  ).toHaveLength(1);
  expect(
    (await A.call('get', `/employees/${ids.employee}/documents`).expect(200)).body.data.map((d) => d.id),
  ).toEqual([ids.document]);
  expect((await A.call('get', `/attendance/shifts/${ids.shift}`).expect(200)).body.name).toBe('A shift');
  expect(
    (await A.call('get', `/attendance/regularizations/${ids.regularization}`).expect(200)).body.status,
  ).toBe('PENDING');
  expect((await A.call('get', '/attendance/shift-assignments').expect(200)).body.data).toHaveLength(1);
  expect((await A.call('get', '/attendance/me/status').expect(200)).body.clockedIn).toBe(true);
});
