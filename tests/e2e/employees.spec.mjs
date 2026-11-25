import { test, expect } from '@playwright/test';
import { waitForEmail, linkIn } from './helpers.mjs';

const PASSWORD = 'violet-tractor-91-lamp';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

async function signIn(page, email) {
  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('HR adds an employee, promotes them, files a document, imports a CSV; the employee signs in to their own profile', async ({
  page,
  request,
  browser,
}) => {
  const owner = `e2e-hr-${Date.now()}@example.com`;
  const company = `People E2E ${Date.now()}`;
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

  // Reference data through the API (the org UI is covered by company.spec).
  const { accessToken } = await (
    await request.post('/api/v1/auth/login', { data: { email: owner, password: PASSWORD } })
  ).json();
  const api = (path, data) =>
    request.post(path, { data, headers: { Authorization: `Bearer ${accessToken}` } });
  await api('/api/v1/companies/departments', { name: 'Engineering', code: 'ENG' });
  await api('/api/v1/companies/designations', { title: 'Software Engineer' });
  await api('/api/v1/companies/designations', { title: 'Senior Engineer' });

  await signIn(page, owner);
  await expect(page.getByText(company)).toBeVisible();

  // Add an employee.
  const workEmail = `e2e-dev-${Date.now()}@example.com`;
  await page.getByRole('link', { name: 'Employees' }).click();
  await expect(page.getByText('No employees yet')).toBeVisible();
  await page.getByRole('link', { name: 'Add employee' }).click();
  await page.getByLabel('First name').fill('Devika');
  await page.getByLabel('Last name').fill('Rao');
  await page.getByLabel('Work email').fill(workEmail);
  await page.getByLabel('Joining date').fill('2026-01-05');
  await page.getByLabel('Department').selectOption({ label: 'Engineering · ENG' });
  await page.getByLabel('Designation').selectOption({ label: 'Software Engineer' });
  await page.getByLabel('Work mode').selectOption('HYBRID');
  await page.getByRole('button', { name: 'Create employee' }).click();
  await expect(page.getByRole('heading', { name: 'Devika Rao' })).toBeVisible();
  await expect(page.getByText('Employee created.')).toBeVisible();
  await expect(page.getByText(/E00001 · Software Engineer · Engineering/)).toBeVisible();

  // Promotion, recorded with history.
  await page.getByRole('tab', { name: 'Job & history' }).click();
  await page.getByLabel('Designation').selectOption({ label: 'Senior Engineer' });
  await page.getByLabel('Effective from').first().fill(new Date().toISOString().slice(0, 10));
  await page.getByRole('button', { name: 'Save change' }).click();
  await expect(page.getByText('Change recorded.')).toBeVisible();
  await expect(page.getByText(/Promotion · .* · Current/)).toBeVisible();
  await expect(page.getByText(/E00001 · Senior Engineer/)).toBeVisible();

  // A document goes to private storage and is type-checked by the worker.
  await page.getByRole('tab', { name: 'Documents' }).click();
  await page.getByLabel('Category').selectOption('CONTRACT');
  await page
    .getByLabel(/File \(PDF/)
    .setInputFiles({ name: 'offer-letter.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.getByRole('button', { name: 'Upload' }).click();
  const docRow = page.getByRole('listitem').filter({ hasText: 'offer-letter.pdf' });
  await expect(docRow.getByText('Ready')).toBeVisible({ timeout: 15_000 });
  await docRow.getByRole('button', { name: 'Mark verified' }).click();
  await expect(docRow.getByText('Verified')).toBeVisible();

  // Bulk import through the worker.
  await page.getByRole('link', { name: 'Employees' }).click();
  await page.getByRole('link', { name: 'Import CSV' }).click();
  const csv = [
    'employeeCode,firstName,lastName,workEmail,phone,dateOfJoining,legalEntity,departmentCode,designation,branchCode,managerEmployeeCode,workMode,employmentType,status,probationEndDate',
    'IMP-100,Kiran,Lead,,,2026-02-01,,ENG,Senior Engineer,,E00001,OFFICE,FULL_TIME,ACTIVE,',
    'IMP-101,Bad,Row,,,2026-13-45,,,,,,,,,',
  ].join('\n');
  await page
    .getByLabel(/CSV file/)
    .setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Upload and import' }).click();
  await expect(page.getByText('Done with errors')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('1 imported or skipped · 1 with errors · 2 rows')).toBeVisible();
  await page.getByRole('link', { name: 'Employees' }).click();
  await expect(page.getByRole('link', { name: 'Kiran Lead' })).toBeVisible();

  // Invite Devika to sign in, linked to her record.
  await page.getByRole('link', { name: 'Devika Rao' }).click();
  await page.getByRole('button', { name: 'Invite to sign in' }).click();
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(`${workEmail} · invited`)).toBeVisible(); // the profile now shows the linked, pending account

  const ctx = await browser.newContext();
  const emp = await ctx.newPage();
  await emp.goto(linkIn(await waitForEmail(workEmail, /invited to/), '/accept-invite'));
  await emp.getByLabel('Your name').fill('Devika Rao');
  await emp.getByLabel('Choose a password').fill(PASSWORD);
  await emp.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(emp.getByText(`You've joined ${company}`)).toBeVisible();
  await signIn(emp, workEmail);
  await emp.getByRole('link', { name: 'My profile' }).click();
  await expect(emp.getByRole('heading', { name: 'Devika Rao' })).toBeVisible();
  await expect(emp.getByText(/can change your preferred name, personal email and phone/)).toBeVisible();
  await emp.getByLabel('Phone').fill('+91 98765 43210');
  await emp.getByRole('button', { name: 'Save changes' }).click();
  await expect(emp.getByText('Saved.')).toBeVisible();
  await emp.getByRole('tab', { name: 'Documents' }).click();
  await expect(emp.getByRole('listitem').filter({ hasText: 'offer-letter.pdf' })).toBeVisible();
  await emp.getByRole('link', { name: 'Employees' }).click();
  await expect(emp.getByRole('link', { name: 'Devika Rao' })).toBeVisible();
  await expect(emp.getByRole('link', { name: 'Kiran Lead' })).toHaveCount(0); // OWN scope
  await ctx.close();
});
