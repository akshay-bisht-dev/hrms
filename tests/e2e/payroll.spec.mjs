import { test, expect } from '@playwright/test';
import { waitForEmail, linkIn, totp } from './helpers.mjs';

const PASSWORD = 'violet-tractor-91-lamp';
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

/** Signs in through the API and turns on two-step verification; returns MFA-verified bearer headers. */
async function apiWithMfa(request, email) {
  const step = async (res, what) => {
    expect(res.ok(), `${what} → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  };
  const { accessToken } = await step(
    await request.post('/api/v1/auth/login', { data: { email, password: PASSWORD } }),
    'login',
  );
  const bearer = { Authorization: `Bearer ${accessToken}` };
  const { secret } = await step(
    await request.post('/api/v1/auth/mfa/setup', { data: { password: PASSWORD }, headers: bearer }),
    'mfa setup',
  );
  const verified = await step(
    await request.post('/api/v1/auth/mfa/confirm', { data: { code: totp(secret) }, headers: bearer }),
    'mfa confirm',
  );
  return { headers: { Authorization: `Bearer ${verified.accessToken}` }, secret };
}

test('HR sets up India payroll and runs a month; a second person approves; the employee downloads the payslip', async ({
  page,
  request,
  browser,
}) => {
  const stamp = Date.now();
  const owner = `e2e-pay-hr-${stamp}@example.com`;
  const company = `Payroll E2E ${stamp}`;
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
  const hr = await apiWithMfa(request, owner);
  const api = async (path, data, headers = hr.headers) => {
    const res = await request.post(path, { data, headers });
    expect(res.ok(), `${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  };
  const legalEntity = (
    await (await request.get('/api/v1/companies/legal-entities', { headers: hr.headers })).json()
  ).data[0];
  const roles = (await (await request.get('/api/v1/tenants/roles', { headers: hr.headers })).json()).data;
  const roleId = (key) => roles.find((r) => r.systemKey === key).id;
  const raviEmail = `e2e-pay-ravi-${stamp}@example.com`;
  const checkerEmail = `e2e-pay-fin-${stamp}@example.com`;
  const ravi = await api('/api/v1/employees', {
    firstName: 'Ravi',
    lastName: 'Kumar',
    workEmail: raviEmail,
    legalEntityId: legalEntity.id,
    dateOfJoining: '2026-01-05',
  });
  await api('/api/v1/tenants/invitations', {
    email: raviEmail,
    roleIds: [roleId('employee')],
    employeeId: ravi.id,
  });
  await api('/api/v1/tenants/invitations', { email: checkerEmail, roleIds: [roleId('finance_manager')] });

  // HR: India starter structure and Karnataka PT, in the UI.
  await signIn(page, owner, hr.secret);
  await expect(page.getByText(company)).toBeVisible();
  await page.getByRole('link', { name: 'Payroll', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Payroll settings' })).toBeVisible();
  await page.getByRole('tab', { name: 'Structures' }).click();
  await page.getByRole('button', { name: 'Load India starter' }).click();
  await expect(page.getByText('Loaded. 11 new components.')).toBeVisible();
  await expect(page.getByText('Special allowance')).toBeVisible();
  await shot(page, 's7-structure');
  await page.getByRole('tab', { name: 'Statutory' }).click();
  await expect(page.getByText(/not yet been reviewed by an in-country payroll expert/)).toBeVisible();
  await page.getByLabel('Professional Tax state').selectOption('KA');
  await page.getByLabel('Applies from').fill('2025-04-01');
  await page.getByRole('button', { name: 'Save statutory settings' }).click();
  await expect(page.getByText('Changes saved.')).toBeVisible();

  // Salary with a live breakdown.
  await page.getByRole('link', { name: 'Employees' }).click();
  await page.getByRole('link', { name: 'Ravi Kumar' }).click();
  await page.getByRole('tab', { name: 'Salary' }).click();
  await page.getByLabel('Annual CTC').fill('1200000');
  await page.getByLabel('From', { exact: true }).fill('2026-01-05');
  await page.getByLabel('Reason').selectOption('JOINING');
  const month = new Date().toISOString().slice(0, 7);
  const expectedNet = month.endsWith('-02') ? '₹96,100.00' : '₹96,200.00'; // Karnataka PT is ₹300 in February
  await expect(page.getByRole('row').filter({ hasText: 'Net pay (full month)' })).toContainText(expectedNet);
  await shot(page, 's7-salary');
  await page.getByRole('button', { name: 'Save salary' }).click();
  await expect(page.getByText('₹12,00,000.00 a year')).toBeVisible();

  // A run for this month: lock, calculate in the worker, review.
  await page.getByRole('link', { name: 'Payroll runs' }).click();
  await page.getByLabel('Month').fill(month);
  await page.getByRole('button', { name: 'New run' }).click();
  await expect(page.getByRole('heading', { name: `Payroll for ${month}` })).toBeVisible();
  await page.getByRole('button', { name: 'Lock inputs' }).click();
  await page.getByRole('button', { name: 'Calculate' }).click();
  const raviRow = page.getByRole('row').filter({ hasText: 'Ravi Kumar' });
  await expect(raviRow).toContainText(expectedNet, { timeout: 20_000 });
  await expect(page.getByText(/Calculated with the IN statutory rules, version 1/)).toBeVisible();
  await raviRow.getByRole('button', { name: 'Ravi Kumar' }).click();
  await expect(raviRow.getByRole('cell', { name: 'Provident Fund', exact: true })).toBeVisible();
  await shot(page, 's7-run');
  await page.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(page.getByText('The person who reviewed this run cannot approve it.')).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('You reviewed this run, so someone else has to approve it')).toBeVisible();

  // The finance manager approves and finalizes (maker-checker).
  const ctxF = await browser.newContext(VIEW);
  const fin = await ctxF.newPage();
  await fin.goto(linkIn(await waitForEmail(checkerEmail, /invited to/), '/accept-invite'));
  await fin.getByLabel('Your name').fill('Farah Finance');
  await fin.getByLabel('Choose a password').fill(PASSWORD);
  await fin.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(fin.getByText(`You've joined ${company}`)).toBeVisible();
  await ctxF.close();
  const checker = await apiWithMfa(request, checkerEmail);
  const runId = page.url().split('/').pop();
  await api(`/api/v1/payroll/runs/${runId}/approve`, {}, checker.headers);
  await api(`/api/v1/payroll/runs/${runId}/finalize`, {}, checker.headers);
  await page.reload();
  await expect(page.getByText('Finalized', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bank file (CSV)' })).toBeVisible();

  // Ravi downloads his payslip (generated by the worker after finalizing).
  const ctx = await browser.newContext(VIEW);
  const emp = await ctx.newPage();
  await emp.goto(linkIn(await waitForEmail(raviEmail, /invited to/), '/accept-invite'));
  await emp.getByLabel('Your name').fill('Ravi Kumar');
  await emp.getByLabel('Choose a password').fill(PASSWORD);
  await emp.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(emp.getByText(`You've joined ${company}`)).toBeVisible();
  await signIn(emp, raviEmail);
  await emp.getByRole('link', { name: 'My payslips' }).click();
  await expect(emp.getByRole('link', { name: 'Payroll runs' })).toHaveCount(0);
  await expect(async () => {
    await emp.reload();
    await expect(emp.getByText(expectedNet)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await shot(emp, 's7-payslips');
  const download = emp.waitForEvent('download');
  await emp.getByRole('button', { name: /Download payslip for/ }).click();
  expect((await download).suggestedFilename()).toBe(`payslip-${month}.pdf`);
  await ctx.close();
});
