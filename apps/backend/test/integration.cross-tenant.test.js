// Phase 3 ST-01/ST-02 — generated cross-tenant suite.
// Every route with an id in its path is taken from the live route registry and called by tenant B's fully
// privileged (MFA-verified) Company Admin with tenant A's ids. All must answer 404 and leave A's data unchanged.
// A new route with an id parameter and no fixture below makes this suite fail, so coverage cannot silently drop.
import { apiRouter } from '../src/routes/index.js';
import { listRoutes } from '../src/lib/route-registry.js';
import request from 'supertest';
import { runWithContext } from '../src/lib/context.js';
import { platformDb } from '../src/lib/db.js';
import { newId } from '@hrms/shared/ids';
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
  // Work status: a finished session with a correction request, a WFH request and the default policy.
  // (Before the clock-in below: ending a session clocks out, and A must still be clocked in at the end.)
  await post('/work/sessions', { workLocationId: ids.workLocation });
  const workDay = (await A.call('post', '/work/sessions/current/end').send({}).expect(200)).body;
  const workSession = workDay.today.at(-1);
  ids.workSession = workSession.id;
  ids.workCorrection = (
    await post('/work/corrections', {
      sessionId: workSession.id,
      kind: 'ADD_WORK_TIME',
      fromTs: workSession.startedAt,
      toTs: workSession.endedAt,
      reason: 'A forgot something',
    })
  ).id;
  ids.homeLocation = (await post('/companies/work-locations', { name: 'A home', type: 'WFH' })).id;
  const wfhDay = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  ids.wfhRequest = (
    await post('/work/wfh-requests', { workLocationId: ids.homeLocation, fromDate: wfhDay, toDate: wfhDay })
  ).id;
  ids.workPolicy = (await A.call('get', '/work/policies').expect(200)).body.data[0].id;
  // Tasks: a project with a member, a task with a comment, hand-entered time, a submitted report and timesheet.
  ids.project = (
    await post('/projects', { code: 'APRJ', name: 'A project', ownerEmployeeId: ids.employee })
  ).id;
  ids.task = (await post('/tasks', { title: 'A task', projectId: ids.project })).id;
  const today = workDay.workDate; // A's local date
  ids.timeEntry = (await post('/tasks/time-entries', { taskId: ids.task, date: today, minutes: 30 })).id;
  ids.workReport = (await A.call('post', `/work-reports/me/${today}/submit`).expect(200)).body.id;
  const aSheet = (await A.call('get', '/timesheets/me').expect(200)).body;
  ids.timesheet = (await A.call('post', `/timesheets/me/${aSheet.weekStart}/submit`).expect(200)).body.id;
  // Monitoring: a completed checklist, a policy, a paired device, a screenshot with a dispute, and an incident.
  const aRoles = (await A.call('get', '/tenants/roles').expect(200)).body.data;
  ids.activation = (
    await post('/monitoring/activations', {
      purpose: 'A purpose that is long enough for the checklist to accept it.',
      scope: { appliesTo: 'COMPANY' },
      lawfulBasis: {
        basis: 'LEGITIMATE_INTEREST',
        explanation: 'An explanation long enough to pass validation.',
      },
      noticeText:
        'A notice text that explains monitoring to employees in enough detail to pass the minimum length rule.'.repeat(
          2,
        ),
      noticeStartsOn: today,
      viewerRoleIds: [aRoles.find((r) => r.systemKey === 'company_admin').id],
      retentionDays: 30,
      contacts: {
        privacyContactName: 'A privacy',
        privacyContactEmail: 'a@example.com',
        grievanceEmail: 'a@example.com',
      },
      reviewDueOn: '2030-01-01',
      ownLegalAdviceConfirmed: true,
      jurisdictionSteps: { IN: { WRITTEN_NOTICE: { done: true }, PURPOSE_LIMITATION: { done: true } } },
    })
  ).id;
  await A.call('post', `/monitoring/activations/${ids.activation}/complete`).expect(200);
  ids.screenshotPolicy = (
    await post('/monitoring/policies', { name: 'A policy', enabled: true, effectiveFrom: today })
  ).id;
  const { code } = (await A.call('post', '/devices/pairing-codes').expect(201)).body;
  const aDevice = (
    await request(h.app)
      .post('/api/v1/devices/register')
      .send({
        code,
        os: 'LINUX',
        osVersion: '6',
        agentVersion: '0.1.0',
        fingerprintHash: 'a'.repeat(64),
        ownership: 'COMPANY_MANAGED',
      })
      .expect(201)
  ).body;
  ids.device = aDevice.deviceId;
  ids.screenshot = newId();
  await platformDb().screenshotRecord.create({
    data: {
      id: ids.screenshot,
      tenantId: A.tenantId,
      employeeId: ids.employee,
      sessionId: ids.workSession,
      deviceId: ids.device,
      policyId: ids.screenshotPolicy,
      policyVersion: 1,
      status: 'AVAILABLE',
      capturedAtServer: new Date(),
      retentionUntil: new Date(Date.now() + 86_400_000),
      s3Key: `tenant/${A.tenantId}/x.webp`,
    },
  });
  ids.dispute = (await post(`/screenshots/${ids.screenshot}/disputes`, { reason: 'A dispute reason' })).id;
  ids.incident = (
    await post('/screenshots/privacy-incidents', { description: 'An incident description' })
  ).id;
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
  // Leave: starter types, a policy, an assignment, and a request by A's owner (linked to the employee above).
  await A.call('post', '/leaves/starter-pack').expect(201);
  const leaveTypes = (await A.call('get', '/leaves/types').expect(200)).body.data;
  ids.leaveType = leaveTypes.find((t) => t.code === 'UNPAID').id;
  ids.leavePolicy = (await A.call('get', '/leaves/policies?q=Unpaid').expect(200)).body.data[0].id;
  ids.leaveAssignment = (await A.call('get', '/leaves/policy-assignments').expect(200)).body.data[0].id;
  ids.leaveRequest = (
    await post('/leaves/requests', {
      leaveTypeId: ids.leaveType,
      fromDate: '2030-01-07',
      toDate: '2030-01-07',
      reason: 'A trip',
    })
  ).id;
  // Payroll: India starter, a salary, and one run taken all the way to a finalized run with a payslip.
  const inTenantA = (fn) => runWithContext({ requestId: 'xt', tenantId: A.tenantId, userId: A.userId }, fn);
  ids.payStructure = (await post('/payroll/starter/in', { legalEntityId: ids.legalEntity })).structure.id;
  const payComponents = Object.fromEntries(
    (await A.call('get', '/payroll/components?limit=200').expect(200)).body.data.map((c) => [c.code, c.id]),
  );
  ids.payComponent = payComponents.REIMB;
  await post(`/payroll/employees/${emp.id}/salaries`, {
    structureId: ids.payStructure,
    annualCtc: '600000',
    effectiveFrom: '2026-01-05',
    reason: 'JOINING',
  });
  ids.payRun = (await post('/payroll/runs', { legalEntityId: ids.legalEntity, month: '2026-10' })).id;
  ids.payInput = (
    await post(`/payroll/runs/${ids.payRun}/inputs`, {
      employeeId: emp.id,
      componentId: ids.payComponent,
      amount: '100',
    })
  ).id;
  await A.call('post', `/payroll/runs/${ids.payRun}/lock`).expect(200);
  await A.call('post', `/payroll/runs/${ids.payRun}/calculate`).expect(202);
  await inTenantA(() => h.services.payrollRuns.calculate(ids.payRun));
  ids.payRunEmployee = (
    await A.call('get', `/payroll/runs/${ids.payRun}/employees`).expect(200)
  ).body.data[0].id;
  await A.call('post', `/payroll/runs/${ids.payRun}/review`).send({}).expect(200);
  const aChecker = await h.enableMfa(await h.member(A, ['finance_manager'], 'achecker'));
  await aChecker.call('post', `/payroll/runs/${ids.payRun}/approve`).expect(200);
  await aChecker.call('post', `/payroll/runs/${ids.payRun}/finalize`).expect(200);
  await inTenantA(() => h.services.payrollRuns.generatePayslips(ids.payRun));
  ids.payslip = (await A.call('get', '/payroll/payslips/me').expect(200)).body.data[0].id;
  ids.taxDeclaration = (
    await A.call('put', '/payroll/tax-declarations/me/2026-27')
      .send({ regime: 'NEW', deductions: {} })
      .expect(200)
  ).body.id;
  ids.bEmployee = (
    await B.call('post', '/employees')
      .send({
        firstName: 'B person',
        legalEntityId: (await B.call('get', '/companies/legal-entities').expect(200)).body.data[0].id,
        dateOfJoining: '2026-01-05',
      })
      .expect(201)
  ).body.id;
  // B's owner works there too, so B's requests reach every lookup (and not "no employee record").
  const bMembership = (await B.call('get', '/tenants/members').expect(200)).body.data.find(
    (m) => m.email === B.email,
  ).id;
  await B.call('put', `/tenants/members/${bMembership}/employee`)
    .send({ employeeId: ids.bEmployee })
    .expect(204);
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
    [/^\/work\/sessions\/:id$/, { id: ids.workSession }, undefined],
    [/^\/projects\/:id$/, { id: ids.project }, { name: 'Pwned' }],
    [
      /^\/monitoring\/activations\/:id(\/(complete|pause|resume))?$/,
      { id: ids.activation },
      { retentionDays: 7 },
    ],
    [
      /^\/monitoring\/policies\/:id\/versions$/,
      { id: ids.screenshotPolicy },
      { appliesTo: 'COMPANY', effectiveFrom: '2030-01-01' },
    ],
    [/^\/devices\/(me\/)?:id\/revoke$/, { id: ids.device }, { reason: 'Pwned' }],
    [/^\/devices\/:id\/approve$/, { id: ids.device }, undefined],
    [/^\/screenshots\/:id\/(view-url|download)$/, { id: ids.screenshot }, undefined],
    [/^\/screenshots\/:id\/delete$/, { id: ids.screenshot }, { reason: 'Pwned' }],
    [/^\/screenshots\/:id\/disputes$/, { id: ids.screenshot }, { reason: 'Pwned pwned' }],
    [
      /^\/screenshots\/disputes\/:id\/resolve$/,
      { id: ids.dispute },
      { outcome: 'DELETED', resolution: 'Pwned pwned' },
    ],
    [
      /^\/screenshots\/privacy-incidents\/:id\/resolve$/,
      { id: ids.incident },
      { resolution: 'Pwned pwned', deleteScreenshot: true },
    ],
    [/^\/projects\/:id\/members$/, { id: ids.project }, { employeeIds: [ids.bEmployee] }],
    [/^\/projects\/:id\/members\/:employeeId$/, { id: ids.project, employeeId: ids.employee }, undefined],
    [/^\/tasks\/time-entries\/:id$/, { id: ids.timeEntry }, undefined],
    [/^\/tasks\/:id$/, { id: ids.task }, { progressPct: 99 }],
    [/^\/tasks\/:id\/assignees$/, { id: ids.task }, { assigneeIds: [ids.bEmployee] }],
    [/^\/tasks\/:id\/status$/, { id: ids.task }, { status: 'CANCELLED' }],
    [/^\/tasks\/:id\/comments$/, { id: ids.task }, { body: 'Pwned' }],
    [/^\/tasks\/:id\/timer\/start$/, { id: ids.task }, undefined],
    [/^\/work-reports\/:id(\/decision)?$/, { id: ids.workReport }, { decision: 'APPROVED' }],
    [/^\/timesheets\/:id(\/decision)?$/, { id: ids.timesheet }, { decision: 'APPROVED' }],
    [/^\/work\/corrections\/:id\/cancel$/, { id: ids.workCorrection }, undefined],
    [/^\/work\/corrections\/:id\/decision$/, { id: ids.workCorrection }, { decision: 'APPROVED' }],
    [/^\/work\/wfh-requests\/:id\/cancel$/, { id: ids.wfhRequest }, undefined],
    [/^\/work\/wfh-requests\/:id\/decision$/, { id: ids.wfhRequest }, { decision: 'APPROVED' }],
    [
      /^\/work\/policies\/:id\/versions$/,
      { id: ids.workPolicy },
      { appliesTo: 'COMPANY', effectiveFrom: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) },
    ],
    [/^\/work\/policies\/:id\/retire$/, { id: ids.workPolicy }, undefined],
    [/^\/leaves\/(balances|ledger)\/:id$/, { id: ids.employee }, undefined],
    [/^\/payroll\/legal-entities\/:id\/statutory-keys$/, { id: ids.legalEntity }, undefined],
    [
      /^\/payroll\/legal-entities\/:id\/statutory-settings$/,
      { id: ids.legalEntity },
      { settings: { ptState: 'KA' }, effectiveFrom: '2030-01-01' },
    ],
    [
      /^\/payroll\/legal-entities\/:id\/settings$/,
      { id: ids.legalEntity },
      { paidDaysBasis: 'CALENDAR', lopFromAbsence: false, payDayOfMonth: null },
    ],
    [/^\/payroll\/components\/:id$/, { id: ids.payComponent }, { name: 'Pwned' }],
    [/^\/payroll\/structures\/:id$/, { id: ids.payStructure }, { name: 'Pwned' }],
    [
      /^\/payroll\/structures\/:id\/components$/,
      { id: ids.payStructure },
      { components: [{ componentId: ids.payComponent, sequence: 1 }] },
    ],
    [
      /^\/payroll\/employees\/:id\/salaries$/,
      { id: ids.employee },
      { structureId: ids.payStructure, annualCtc: '1', effectiveFrom: '2030-01-01', reason: 'REVISION' },
    ],
    [/^\/payroll\/runs\/:id\/reject$/, { id: ids.payRun }, { comment: 'Pwned' }],
    [
      /^\/payroll\/runs\/:id\/inputs$/,
      { id: ids.payRun },
      { employeeId: ids.employee, componentId: ids.payComponent, amount: '1' },
    ],
    [/^\/payroll\/runs\/:id\/inputs\/:childId$/, { id: ids.payRun, childId: ids.payInput }, undefined],
    [
      /^\/payroll\/runs\/:id\/employees\/:childId$/,
      { id: ids.payRun, childId: ids.payRunEmployee },
      undefined,
    ],
    [/^\/payroll\/runs\/:id(\/[a-z-]+)?$/, { id: ids.payRun }, {}],
    [/^\/payroll\/payslips\/:id\/download-url$/, { id: ids.payslip }, undefined],
    [/^\/payroll\/tax-declarations\/:id\/review$/, { id: ids.taxDeclaration }, { decision: 'VERIFIED' }],
    [/^\/leaves\/requests\/:id(\/cancel)?$/, { id: ids.leaveRequest }, {}],
    [/^\/leaves\/requests\/:id\/decision$/, { id: ids.leaveRequest }, { decision: 'APPROVED' }],
    [/^\/leaves\/types\/:id$/, { id: ids.leaveType }, { name: 'Pwned' }],
    [/^\/leaves\/policies\/:id$/, { id: ids.leavePolicy }, { name: 'Pwned' }],
    [
      /^\/leaves\/policies\/:id\/versions$/,
      { id: ids.leavePolicy },
      { rules: { accrual: { method: 'NONE' } }, effectiveFrom: '2031-01-01' },
    ],
    [/^\/leaves\/policy-assignments\/:id$/, { id: ids.leaveAssignment }, undefined],
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
  // Self-service routes whose parameter is not an id (they always answer with the caller's own data).
  const SELF = [
    /^\/payroll\/tax-declarations\/me\/:fy$/,
    /^\/work-reports\/me\/:date(\/submit)?$/,
    /^\/timesheets\/me\/:date\/submit$/,
  ];
  // Device routes are covered by their own test below (they take a device token, not a web session).
  const routes = listRoutes(apiRouter(h.services.routes)).filter(
    (r) =>
      r.path.includes(':') && !['public', 'device'].includes(r.access) && !SELF.some((re) => re.test(r.path)),
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
    '/leaves/types',
    '/leaves/policies',
    '/payroll/components?limit=200',
    '/payroll/structures?limit=200',
    '/payroll/runs',
    '/payroll/payslips/me',
    '/payroll/tax-declarations',
    '/leaves/policy-assignments',
    '/leaves/requests?view=approvals',
    '/leaves/requests?view=team',
    '/leaves/calendar?from=2030-01-01&to=2030-01-31',
    '/leaves/reports/summary?from=2030-01-01&to=2030-01-31',
    `/attendance/days?date=${new Date().toISOString().slice(0, 10)}`,
    '/work/me/status',
    '/monitoring/me',
    '/monitoring/activations',
    '/monitoring/policies',
    '/devices',
    '/devices/me',
    '/screenshots',
    '/screenshots/disputes',
    '/screenshots/privacy-incidents',
    '/screenshots/access-logs',
    '/projects',
    '/tasks?view=mine',
    '/tasks?view=team',
    '/tasks?view=created',
    '/tasks/timer',
    `/tasks/time-entries?from=2026-01-01&to=2026-02-28`,
    '/work-reports?view=approvals',
    '/timesheets?view=approvals',
    '/dashboards/team-board',
    '/dashboards/remote-work',
    '/work/policies',
    '/work/team',
    '/work/wfh-requests?view=approvals',
    '/work/corrections?view=approvals',
    `/attendance/reports/summary?from=2026-01-05&to=2026-03-31`,
  ];
  const aIds = Object.entries(ids)
    .filter(([k]) => k !== 'bRole' && k !== 'bEmployee')
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
      '/leaves/policy-assignments',
      { policyId: ids.leavePolicy, appliesTo: 'COMPANY', effectiveFrom: '2030-01-01' },
    ],
    ['/payroll/runs', { legalEntityId: ids.legalEntity, month: '2030-01' }],
    [
      '/payroll/structures',
      { legalEntityId: ids.legalEntity, name: 'X', currency: 'INR', effectiveFrom: '2030-01-01' },
    ],
    [
      '/leaves/policies',
      {
        leaveTypeId: ids.leaveType,
        name: 'X',
        rules: { accrual: { method: 'NONE' } },
        effectiveFrom: '2030-01-01',
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
    [
      '/work/policies',
      { name: 'X', appliesTo: 'EMPLOYEE', targetId: ids.employee, effectiveFrom: '2030-01-01' },
    ],
    ['/projects', { code: 'BPRJ', name: 'X', ownerEmployeeId: ids.employee }],
    ['/tasks', { title: 'X', projectId: ids.project }],
    ['/tasks', { title: 'X', assigneeIds: [ids.employee] }],
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
  expect((await A.call('get', `/leaves/requests/${ids.leaveRequest}`).expect(200)).body.status).toBe(
    'PENDING',
  );
  expect((await A.call('get', `/leaves/types/${ids.leaveType}`).expect(200)).body.code).toBe('UNPAID');
  expect((await A.call('get', `/payroll/runs/${ids.payRun}`).expect(200)).body).toMatchObject({
    status: 'FINALIZED',
  });
  expect((await A.call('get', `/payroll/runs/${ids.payRun}/inputs`).expect(200)).body.data).toHaveLength(1);
  expect(
    (await A.call('get', `/payroll/employees/${ids.employee}/salaries`).expect(200)).body.data,
  ).toHaveLength(1);
  expect((await A.call('get', `/work/sessions/${ids.workSession}`).expect(200)).body.status).toBe('ENDED');
  const aCorrections = (await A.call('get', '/work/corrections').expect(200)).body.data;
  expect(aCorrections.find((c) => c.id === ids.workCorrection).status).toBe('PENDING');
  const aWfh = (await A.call('get', '/work/wfh-requests').expect(200)).body.data;
  expect(aWfh.find((r) => r.id === ids.wfhRequest).status).toBe('PENDING');
  const aPolicies = (await A.call('get', '/work/policies').expect(200)).body.data;
  expect(aPolicies.find((p) => p.id === ids.workPolicy)).toMatchObject({ version: 1, effectiveTo: null });
  expect((await A.call('get', '/monitoring/activations').expect(200)).body.data[0]).toMatchObject({
    id: ids.activation,
    status: 'ACTIVE',
    retentionDays: 30,
  });
  expect(
    (await A.call('get', '/devices').expect(200)).body.data.find((d) => d.id === ids.device).status,
  ).not.toBe('REVOKED');
  expect((await A.call('get', '/screenshots/disputes').expect(200)).body.data[0]).toMatchObject({
    id: ids.dispute,
    status: 'OPEN',
  });
  expect((await platformDb().screenshotRecord.findUnique({ where: { id: ids.screenshot } })).status).toBe(
    'UNDER_DISPUTE',
  );
  const aTask = (await A.call('get', `/tasks/${ids.task}`).expect(200)).body;
  expect(aTask).toMatchObject({ status: 'ASSIGNED', progressPct: 0, title: 'A task' });
  expect(aTask.comments).toEqual([]);
  expect((await A.call('get', `/work-reports/${ids.workReport}`).expect(200)).body.status).toBe('SUBMITTED');
  expect((await A.call('get', `/timesheets/${ids.timesheet}`).expect(200)).body.status).toBe('SUBMITTED');
  // B's HR cannot adjust A's employee's balance either.
  await B.call('post', '/leaves/adjustments')
    .send({
      employeeId: ids.employee,
      leaveTypeId: ids.leaveType,
      quantity: '5',
      postedOn: '2030-01-01',
      note: 'Pwned',
    })
    .expect(404);
});

test('every registered route is in the API docs', async () => {
  const doc = (await request(h.app).get('/api/docs/openapi.json').expect(200)).body;
  const documented = new Set(
    Object.entries(doc.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`)),
  );
  const missing = listRoutes(apiRouter(h.services.routes))
    .map((r) => `${r.method} /api/v1${r.path.replace(/:(\w+)/g, '{$1}')}`.replace(/\/$/, ''))
    .filter((k) => !documented.has(k));
  expect(missing).toEqual([]);
});

test("a device of tenant B can't touch tenant A's sessions or screenshots", async () => {
  const { code } = (await B.call('post', '/devices/pairing-codes').expect(201)).body;
  const bDevice = (
    await request(h.app)
      .post('/api/v1/devices/register')
      .send({
        code,
        os: 'LINUX',
        osVersion: '6',
        agentVersion: '0.1.0',
        fingerprintHash: 'a'.repeat(64),
        ownership: 'COMPANY_MANAGED',
      })
      .expect(201)
  ).body;
  // The same machine fingerprint in another company is a different device.
  expect(bDevice.deviceId).not.toBe(ids.device);
  const as = (path, body) =>
    request(h.app)
      .post(`/api/v1/agent${path}`)
      .set('Authorization', `Bearer ${bDevice.accessToken}`)
      .send(body);
  await as(`/screenshots/${ids.screenshot}/confirm`, { sha256: 'b'.repeat(64), bytes: 10 }).expect(404);
  await as('/screenshots/skips', {
    sessionId: ids.workSession,
    reason: 'IDLE',
    occurredAt: new Date().toISOString(),
  }).expect(404);
  expect((await as('/me/acknowledge', { activationId: ids.activation, locale: 'en' })).status).toBe(409);
  expect(
    (await platformDb().screenshotRecord.findUnique({ where: { id: ids.screenshot } })).sha256,
  ).toBeNull();
});
