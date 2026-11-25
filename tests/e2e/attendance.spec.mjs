import { test, expect } from '@playwright/test';
import { waitForEmail, linkIn, totp } from './helpers.mjs';

const PASSWORD = 'violet-tractor-91-lamp';
// Set E2E_SCREENSHOTS=<dir> to save documentation screenshots from this run (2× scale).
const SHOTS = process.env.E2E_SCREENSHOTS;
const VIEW = { viewport: { width: 1280, height: 860 }, deviceScaleFactor: SHOTS ? 2 : 1 };
test.use(VIEW);
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

async function signIn(page, email, mfaSecret) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  if (mfaSecret) {
    await page.getByLabel('Authentication code').fill(totp(mfaSecret, 1)); // the enrolment code is already used
    await page.getByRole('button', { name: 'Verify' }).click();
  }
}

/** Accepts an emailed invitation in a fresh browser context and signs in. */
async function joinAs(browser, email, name, company) {
  const ctx = await browser.newContext(VIEW);
  const page = await ctx.newPage();
  await page.goto(linkIn(await waitForEmail(email, /invited to/), '/accept-invite'));
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Choose a password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(page.getByText(`You've joined ${company}`)).toBeVisible();
  await signIn(page, email);
  await expect(page.getByText(company)).toBeVisible();
  return { ctx, page };
}

test('HR sets up attendance; an employee clocks in and out and asks for a correction; the manager approves; HR reports', async ({
  page,
  request,
  browser,
}) => {
  const stamp = Date.now();
  const owner = `e2e-att-hr-${stamp}@example.com`;
  const company = `Attendance E2E ${stamp}`;
  expect(
    (
      await request.post('/api/v1/auth/register', {
        data: {
          fullName: 'Hana HR',
          email: owner,
          password: PASSWORD,
          companyName: company,
          countryCode: 'IN',
        },
      })
    ).status(),
  ).toBe(202);
  await page.goto(linkIn(await waitForEmail(owner, /Confirm your email/), '/verify-email'));
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();

  // People and roles through the API (their UI is covered by employees.spec and company.spec).
  const { accessToken } = await (
    await request.post('/api/v1/auth/login', { data: { email: owner, password: PASSWORD } })
  ).json();
  // Inviting a Team Leader (a role with a sensitive permission) needs the inviter to use two-step verification.
  const { secret } = await (
    await request.post('/api/v1/auth/mfa/setup', {
      data: { password: PASSWORD },
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  ).json();
  const verified = await (
    await request.post('/api/v1/auth/mfa/confirm', {
      data: { code: totp(secret) },
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  ).json();
  const headers = { Authorization: `Bearer ${verified.accessToken}` };
  const api = async (path, data) => {
    const res = await request.post(path, { data, headers });
    expect(res.ok(), `${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  };
  const legalEntity = (await (await request.get('/api/v1/companies/legal-entities', { headers })).json())
    .data[0];
  const roles = (await (await request.get('/api/v1/tenants/roles', { headers })).json()).data;
  const roleId = (key) => roles.find((r) => r.systemKey === key).id;
  const mayaEmail = `e2e-att-maya-${stamp}@example.com`;
  const raviEmail = `e2e-att-ravi-${stamp}@example.com`;
  const maya = await api('/api/v1/employees', {
    firstName: 'Maya',
    lastName: 'Iyer',
    workEmail: mayaEmail,
    legalEntityId: legalEntity.id,
    dateOfJoining: '2026-01-05',
  });
  const ravi = await api('/api/v1/employees', {
    firstName: 'Ravi',
    lastName: 'Kumar',
    workEmail: raviEmail,
    legalEntityId: legalEntity.id,
    dateOfJoining: '2026-01-05',
    managerId: maya.id,
  });
  await api('/api/v1/tenants/invitations', {
    email: mayaEmail,
    roleIds: [roleId('team_leader')],
    employeeId: maya.id,
  });
  await api('/api/v1/tenants/invitations', {
    email: raviEmail,
    roleIds: [roleId('employee')],
    employeeId: ravi.id,
  });

  // HR: shift, assignment, work location and policy through the settings UI.
  await signIn(page, owner, secret);
  await expect(page.getByText(company)).toBeVisible();
  await page.getByRole('link', { name: 'Attendance', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Attendance settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByLabel('Name').fill('General');
  await page.getByLabel('Start').fill('09:00');
  await page.getByLabel('End', { exact: true }).fill('18:00');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('cell', { name: '09:00–18:00' })).toBeVisible();

  await page.getByRole('tab', { name: 'Shift assignments' }).click();
  await page.getByLabel('Shift', { exact: true }).selectOption({ label: 'General (09:00–18:00)' });
  await page.getByLabel('From').fill('2026-01-05');
  await page.getByRole('checkbox', { name: /Ravi Kumar/ }).check();
  await page.getByRole('checkbox', { name: /Maya Iyer/ }).check();
  await page.getByRole('button', { name: 'Assign to 2 people' }).click();
  await expect(page.getByText('Shift assigned to 2 people.')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Ravi Kumar', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Work locations' }).click();
  await page.getByRole('button', { name: 'Add' }).click();
  await page.getByLabel('Name').fill('Pune office');
  await page.getByLabel('Type').selectOption('OFFICE');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('cell', { name: 'Pune office', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Policy' }).click();
  await expect(page.getByText('Using built-in defaults')).toBeVisible();
  await page.getByLabel('Record the IP address when people clock in or out').check();
  await page.getByRole('button', { name: 'Save policy' }).click();
  await expect(page.getByText('Using the company default')).toBeVisible();
  await shot(page, 's5-policy');

  // Ravi clocks in at the office and out again; the screen says exactly what is recorded.
  const r = await joinAs(browser, raviEmail, 'Ravi Kumar', company);
  await r.page.getByRole('link', { name: 'My attendance' }).click();
  await expect(r.page.getByText('Your hours today: 09:00–18:00.')).toBeVisible();
  await expect(
    r.page.getByText(
      'When you clock in or out, your company records the time and your IP address. Nothing else is collected.',
    ),
  ).toBeVisible();
  await expect(r.page.getByRole('link', { name: 'Team attendance' })).toHaveCount(0); // OWN scope
  await r.page.getByLabel('Where are you working?').selectOption({ label: 'Pune office' });
  await r.page.getByRole('button', { name: 'Clock in' }).click();
  await expect(r.page.getByText(/Clocked in since \d\d:\d\d/)).toBeVisible();
  await r.page.getByRole('button', { name: 'Clock out' }).click();
  await expect(r.page.getByText('You are clocked out')).toBeVisible();
  await expect(r.page.getByRole('row').filter({ hasText: 'In progress' }).first()).toBeVisible();

  // He forgot to clock in two days ago and asks for a correction.
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  await r.page.getByRole('button', { name: 'Request a correction' }).click();
  const form = r.page.getByRole('region', { name: 'Request a correction' });
  await form.getByLabel('Day', { exact: true }).fill(twoDaysAgo);
  await form.getByLabel('Clock-in time').fill('09:00');
  await form.getByLabel('Clock-out time').fill('18:00');
  await form.getByLabel('Reason').fill('Badge reader at the gate was down');
  await form.getByRole('button', { name: 'Send for approval' }).click();
  const myRequest = r.page.getByRole('listitem').filter({ hasText: 'Badge reader at the gate was down' });
  await expect(myRequest.getByText('Waiting')).toBeVisible();

  // Maya, his manager, approves it.
  const m = await joinAs(browser, mayaEmail, 'Maya Iyer', company);
  await m.page.getByRole('link', { name: 'Approvals' }).click();
  const item = m.page.getByRole('listitem').filter({ hasText: 'Ravi Kumar' });
  await expect(item.getByText('“Badge reader at the gate was down”')).toBeVisible();
  await expect(item.getByRole('button', { name: /Reject/ })).toBeDisabled(); // a note is needed to reject
  await item.getByPlaceholder('Note (needed to reject)').fill('Checked with security');
  await shot(m.page, 's5-approvals');
  await item.getByRole('button', { name: /^Approve/ }).click();
  await expect(
    m.page.getByRole('region', { name: 'Attendance corrections' }).getByText('Nothing is waiting for you.'),
  ).toBeVisible();
  await m.page.getByRole('link', { name: 'Team attendance' }).click();
  await m.page.getByLabel('Day', { exact: true }).fill(twoDaysAgo);
  await expect(m.page.getByRole('row').filter({ hasText: 'Ravi Kumar' }).getByText('Present')).toBeVisible();

  // Ravi sees the corrected day and the decision.
  await r.page.reload();
  await expect(myRequest.getByText('Approved')).toBeVisible();
  await expect(myRequest.getByText('Note: Checked with security')).toBeVisible();
  const corrected = r.page.getByTestId(`day-${twoDaysAgo}`);
  await expect(corrected.getByText('Corrected')).toBeVisible();
  await expect(corrected.getByText('8h / 8h')).toBeVisible();
  await shot(r.page, 's5-my-attendance');

  // HR: the report shows the corrected day and downloads as CSV.
  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByRole('heading', { name: 'Attendance report' })).toBeVisible();
  await page.getByLabel('From', { exact: true }).fill(twoDaysAgo);
  const raviRow = page.getByRole('row').filter({ hasText: 'Ravi Kumar' });
  await expect(raviRow).toBeVisible();
  await expect(raviRow.getByRole('cell').nth(1)).toHaveText('1');
  await shot(page, 's5-report');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^attendance-.*\.csv$/);

  await r.ctx.close();
  await m.ctx.close();
});
