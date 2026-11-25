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

/** The Monday at least a week from now, and the Wednesday after it ('YYYY-MM-DD'). */
function nextWeek() {
  const d = new Date(Date.now() + 7 * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7));
  const mon = d.toISOString().slice(0, 10);
  const wed = new Date(d.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
  return { mon, wed };
}

test('HR sets up leave; an employee applies; the manager approves; balances, calendar and ledger agree', async ({
  page,
  request,
  browser,
}) => {
  const stamp = Date.now();
  const owner = `e2e-lv-hr-${stamp}@example.com`;
  const company = `Leave E2E ${stamp}`;
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
  const mayaEmail = `e2e-lv-maya-${stamp}@example.com`;
  const raviEmail = `e2e-lv-ravi-${stamp}@example.com`;
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

  // HR: starter leave types and an opening balance, in the UI.
  await signIn(page, owner, secret);
  await expect(page.getByText(company)).toBeVisible();
  await page.getByRole('link', { name: 'Leave', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Leave settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Load starter types' }).click();
  await expect(page.getByText('Added: ANNUAL, SICK, UNPAID.')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Annual leave', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Policies' }).click();
  await expect(page.getByText(/Annual leave policy/)).toBeVisible();
  await shot(page, 's6-policies');

  await page.getByRole('tab', { name: 'Balances' }).click();
  await page.getByRole('button', { name: 'Ravi Kumar' }).click();
  const adjust = page.getByRole('region', { name: 'Opening balance or adjustment' });
  await adjust.getByLabel('Leave type').selectOption({ label: 'Annual leave' });
  await adjust.getByLabel('Entry').selectOption('OPENING_BALANCE');
  await adjust.getByLabel('Days').fill('12');
  await adjust.getByLabel('Date').fill('2026-01-05');
  await adjust.getByLabel('Reason').fill('Balance from the old system');
  await adjust.getByRole('button', { name: 'Post entry' }).click();
  await expect(adjust.getByText(/^Saved\. New balance: [\d.]+ days\.$/)).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Opening balance' })).toBeVisible();

  // Ravi applies for three days next week.
  const { mon, wed } = nextWeek();
  const r = await joinAs(browser, raviEmail, 'Ravi Kumar', company);
  await r.page.getByRole('link', { name: 'My leave' }).click();
  const annual = r.page.getByTestId('balance-ANNUAL');
  await expect(annual).toBeVisible();
  const before = Number(
    await annual
      .locator('.text-2xl')
      .innerText()
      .then((s) => s.split(' ')[0]),
  );
  expect(before).toBeGreaterThanOrEqual(12);
  await expect(r.page.getByRole('link', { name: "Who's away" })).toHaveCount(0); // OWN scope
  await r.page.getByRole('button', { name: 'Apply for leave' }).click();
  const form = r.page.getByRole('region', { name: 'Apply for leave' });
  await form.getByLabel('Leave type').selectOption({ label: 'Annual leave' });
  await form.getByLabel('First day').fill(mon);
  await form.getByLabel('Last day').fill(wed);
  await form.getByLabel('Reason (optional)').fill('Sister’s wedding');
  await expect(form.getByText(/This takes 3 days\./)).toBeVisible();
  await shot(r.page, 's6-apply');
  await form.getByRole('button', { name: 'Send for approval' }).click();
  const mine = r.page.getByRole('listitem').filter({ hasText: 'Annual leave' });
  await expect(mine.getByText('Waiting')).toBeVisible();
  await expect(annual.getByText(/waiting 3/)).toBeVisible();

  // Maya approves from her inbox and sees Ravi in "Who's away".
  const m = await joinAs(browser, mayaEmail, 'Maya Iyer', company);
  await m.page.getByRole('link', { name: 'Approvals' }).click();
  const item = m.page
    .getByRole('region', { name: 'Leave requests' })
    .getByRole('listitem')
    .filter({ hasText: 'Ravi Kumar' });
  await expect(item.getByText('“Sister’s wedding”')).toBeVisible();
  await expect(item.getByText('3 days')).toBeVisible();
  await shot(m.page, 's6-approvals');
  await item.getByRole('button', { name: /^Approve/ }).click();
  await expect(
    m.page.getByRole('region', { name: 'Leave requests' }).getByText('Nothing is waiting for you.'),
  ).toBeVisible();
  await m.page.getByRole('link', { name: "Who's away" }).click();
  await m.page.getByLabel('Month').fill(mon.slice(0, 7));
  await expect(
    m.page.getByRole('listitem').filter({ hasText: 'Ravi Kumar' }).getByText('Approved'),
  ).toBeVisible();

  // Ravi: approved, and the balance went down by exactly three days.
  await r.page.reload();
  await expect(mine.getByText('Approved')).toBeVisible();
  const after = Number(
    await r.page
      .getByTestId('balance-ANNUAL')
      .locator('.text-2xl')
      .innerText()
      .then((s) => s.split(' ')[0]),
  );
  expect(Math.round((before - after) * 100)).toBe(300);
  await shot(r.page, 's6-my-leave');

  // HR: the ledger shows the debit.
  await page.getByRole('tab', { name: 'Balances' }).click();
  await page.getByRole('button', { name: 'Ravi Kumar' }).click();
  await expect(
    page.getByRole('row').filter({ hasText: 'Leave taken' }).getByRole('cell', { name: '-3', exact: true }),
  ).toBeVisible();

  await r.ctx.close();
  await m.ctx.close();
});
