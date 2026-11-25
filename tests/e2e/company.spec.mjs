import { test, expect } from '@playwright/test';
import { waitForEmail, linkIn } from './helpers.mjs';

const PASSWORD = 'violet-tractor-91-lamp';

async function signIn(page, email) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('owner sets up the org, invites an employee, the employee joins with read-only access', async ({
  page,
  request,
  browser,
}) => {
  const owner = `e2e-owner-${Date.now()}@example.com`;
  const company = `Org E2E ${Date.now()}`;
  expect(
    (
      await request.post('/api/v1/auth/register', {
        data: {
          fullName: 'Olivia Owner',
          email: owner,
          password: PASSWORD,
          companyName: company,
          countryCode: 'GB',
        },
      })
    ).status(),
  ).toBe(202);
  await page.goto(linkIn(await waitForEmail(owner, /Confirm your email/), '/verify-email'));
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
  await signIn(page, owner);
  await expect(page.getByText(company)).toBeVisible();

  // Organization: add a department and a sub-department, then a team.
  await page.getByRole('link', { name: 'Organization' }).click();
  await page.getByRole('tab', { name: 'Departments' }).click();
  const depts = page.getByRole('region', { name: 'Departments' });
  await depts.getByRole('button', { name: 'Add' }).click();
  await depts.getByLabel('Department name').fill('Engineering');
  await depts.getByLabel('Code').fill('eng');
  await depts.getByRole('button', { name: 'Create' }).click();
  await expect(depts.getByRole('cell', { name: 'ENG', exact: true })).toBeVisible();
  await depts.getByRole('button', { name: 'Add' }).click();
  await depts.getByLabel('Department name').fill('Platform');
  await depts.getByLabel('Code').fill('PLAT');
  await depts.getByLabel('Parent department').selectOption({ label: 'Engineering · ENG' });
  await depts.getByRole('button', { name: 'Create' }).click();
  await expect(depts.getByRole('row', { name: /Platform PLAT Engineering · ENG/ })).toBeVisible();
  // Duplicate code shows the server's message on the form.
  await depts.getByRole('button', { name: 'Add' }).click();
  await depts.getByLabel('Department name').fill('Again');
  await depts.getByLabel('Code').fill('ENG');
  await depts.getByRole('button', { name: 'Create' }).click();
  await expect(depts.getByRole('alert')).toHaveText('A record with these values already exists');
  await depts.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('tab', { name: 'Branches' }).click();
  const branches = page.getByRole('region', { name: 'Branches' });
  await branches.getByRole('button', { name: 'Add' }).click();
  await branches.getByLabel('Branch name').fill('London HQ');
  await branches.getByLabel('Code').fill('LON');
  await branches.getByLabel('Legal entity').selectOption({ index: 1 });
  await branches.getByLabel('City').fill('London');
  await branches.getByLabel('Time zone').selectOption('Europe/London');
  await branches.getByRole('button', { name: 'Create' }).click();
  await expect(branches.getByRole('row', { name: /London HQ LON London Europe\/London/ })).toBeVisible();

  // Members: invite an employee.
  const employee = `e2e-emp-${Date.now()}@example.com`;
  await page.getByRole('link', { name: 'Members' }).click();
  await page.getByRole('button', { name: 'Invite someone' }).click();
  await page.getByLabel('Email address').fill(employee);
  await page.getByRole('checkbox', { name: 'Employee', exact: true }).check();
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(`Invitation sent to ${employee}.`)).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: employee }).getByText('Invited')).toBeVisible();

  // The employee accepts in a separate browser session.
  const ctx = await browser.newContext();
  const emp = await ctx.newPage();
  await emp.goto(linkIn(await waitForEmail(employee, /invited to/), '/accept-invite'));
  await expect(emp.getByRole('heading', { name: `Join ${company}` })).toBeVisible();
  await emp.getByLabel('Your name').fill('Ethan Employee');
  await emp.getByLabel('Choose a password').fill(PASSWORD);
  await emp.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(emp.getByText(`You've joined ${company}`)).toBeVisible();
  await signIn(emp, employee);
  await expect(emp.getByText(company)).toBeVisible();
  await expect(emp.getByRole('link', { name: 'Members' })).toHaveCount(0);
  await emp.getByRole('link', { name: 'Organization' }).click();
  await emp.getByRole('tab', { name: 'Departments' }).click();
  await expect(emp.getByRole('cell', { name: 'Engineering', exact: true })).toBeVisible();
  await expect(
    emp.getByRole('region', { name: 'Departments' }).getByRole('button', { name: 'Add' }),
  ).toHaveCount(0);
  await ctx.close();

  // The owner sees the employee as active now.
  await page.reload();
  await expect(page.getByRole('listitem').filter({ hasText: employee }).getByText('Active')).toBeVisible();
});
