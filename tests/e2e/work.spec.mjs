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
    await page.getByLabel('Authentication code').fill(totp(mfaSecret, 1));
    await page.getByRole('button', { name: 'Verify' }).click();
  }
}

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

test('a work-from-home day without the desktop agent: request, approval, session with a break, team status', async ({
  page,
  request,
  browser,
}) => {
  const stamp = Date.now();
  const owner = `e2e-wk-hr-${stamp}@example.com`;
  const company = `Work E2E ${stamp}`;
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
  const { accessToken } = await (
    await request.post('/api/v1/auth/login', { data: { email: owner, password: PASSWORD } })
  ).json();
  const bearer = { Authorization: `Bearer ${accessToken}` };
  const { secret } = await (
    await request.post('/api/v1/auth/mfa/setup', { data: { password: PASSWORD }, headers: bearer })
  ).json();
  const verified = await (
    await request.post('/api/v1/auth/mfa/confirm', { data: { code: totp(secret) }, headers: bearer })
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
  const mayaEmail = `e2e-wk-maya-${stamp}@example.com`;
  const raviEmail = `e2e-wk-ravi-${stamp}@example.com`;
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
  await api('/api/v1/companies/work-locations', { name: 'Pune office', type: 'OFFICE' });
  await api('/api/v1/companies/work-locations', { name: 'Home', type: 'WFH' });

  // Ravi: sees exactly what is recorded; Home needs an approved request first.
  const r = await joinAs(browser, raviEmail, 'Ravi Kumar', company);
  await r.page.getByRole('link', { name: 'My work' }).click();
  await expect(r.page.getByRole('heading', { name: 'My work' })).toBeVisible();
  const disclosure = r.page.getByRole('region', { name: 'What is recorded' });
  await expect(disclosure.getByText('Screenshots or your screen')).toBeVisible();
  await expect(disclosure.getByText('Keystrokes, clipboard or passwords')).toBeVisible();
  await expect(r.page.getByRole('option', { name: 'Home (needs an approved request)' })).toBeDisabled();
  const wfh = r.page.getByRole('region', { name: 'Work from home' });
  await wfh.getByLabel('Reason (optional)').fill('Waiting for a delivery');
  await wfh.getByRole('button', { name: 'Send request' }).click();
  await expect(wfh.getByText('Request sent for 1 day.')).toBeVisible();
  await expect(
    wfh.getByRole('listitem').filter({ hasText: 'Home' }).getByText('Waiting', { exact: true }),
  ).toBeVisible();
  await shot(r.page, 's8-my-work-request');

  // Maya approves it from her inbox.
  const m = await joinAs(browser, mayaEmail, 'Maya Iyer', company);
  await m.page.getByRole('link', { name: 'Approvals' }).click();
  const inbox = m.page.getByRole('region', { name: 'Work-from-home requests' });
  const item = inbox.getByRole('listitem').filter({ hasText: 'Ravi Kumar' });
  await expect(item.getByText('Waiting for a delivery')).toBeVisible();
  await item.getByRole('button', { name: /^Approve/ }).click();
  await expect(inbox.getByText('Nothing is waiting for you.')).toBeVisible();
  // Team status needs two-step verification even for a team leader.
  await expect(m.page.getByRole('link', { name: 'Team status' })).toBeVisible();

  // Ravi works from home: start, a break, back, end. The sidebar shows the signal while the session runs.
  await r.page.reload();
  await expect(
    wfh.getByRole('listitem').filter({ hasText: 'Home' }).getByText('Approved', { exact: true }),
  ).toBeVisible();
  const session = r.page.getByRole('region', { name: 'Work session' });
  await session.getByLabel('Where are you working?').selectOption({ label: 'Home' });
  await session.getByRole('button', { name: 'Start work' }).click();
  await expect(session.getByText('Working', { exact: true })).toBeVisible();
  await expect(r.page.getByRole('link', { name: 'Work session running · signal on' })).toBeVisible();
  await session.getByLabel('Break').selectOption('MEAL');
  await session.getByRole('button', { name: 'Start break' }).click();
  await expect(session.getByText('On a break', { exact: true })).toBeVisible();
  await expect(r.page.getByRole('link', { name: 'On a break · session running' })).toBeVisible();
  await shot(r.page, 's8-my-work-break');
  await session.getByRole('button', { name: 'Back to work' }).click();
  await expect(session.getByText('Working', { exact: true })).toBeVisible();
  // Moving to another page keeps the session; the attendance page shows the clock-in it made.
  await r.page.getByRole('link', { name: 'My attendance' }).click();
  await expect(r.page.getByText(/Clocked in since/)).toBeVisible();
  await r.page.getByRole('link', { name: 'My work' }).click();
  await session.getByRole('button', { name: 'End work' }).click();
  await expect(session.getByText('No session running')).toBeVisible();
  await expect(r.page.getByRole('link', { name: /signal on/ })).toHaveCount(0);
  const today = r.page.getByRole('region', { name: 'Today' });
  await expect(today.getByText(/· Home$/)).toBeVisible();
  await expect(today.getByText('Ended')).toBeVisible();
  // The approval was used by a session, so it can no longer be cancelled.
  await expect(wfh.getByRole('button', { name: 'Cancel request' })).toHaveCount(0);
  await shot(r.page, 's8-my-work-done');

  // HR (two-step verified) sees Ravi as finished, and the default policy.
  await signIn(page, owner, secret);
  await expect(page.getByText(company)).toBeVisible();
  await page.getByRole('link', { name: 'Team status' }).click();
  await expect(page.getByRole('heading', { name: 'Team status' })).toBeVisible();
  const row = page.getByTestId(`team-${ravi.employeeCode}`);
  await expect(row.getByText('Finished')).toBeVisible();
  await expect(page.getByText(/never shows screens, applications, keystrokes or activity/)).toBeVisible();
  await shot(page, 's8-team-status');
  await page.getByRole('link', { name: 'Work policies' }).click();
  await expect(page.getByText('Standard')).toBeVisible();
  await expect(page.getByText('In force')).toBeVisible();
  await shot(page, 's8-work-policies');

  await r.ctx.close();
  await m.ctx.close();
});
