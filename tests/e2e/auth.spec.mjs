import { test, expect } from '@playwright/test';
import { waitForEmail, linkIn, totp } from './helpers.mjs';

test('register → verify email → sign in → turn on MFA → sign out → sign in with a code', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'violet-tractor-91-lamp';

  await page.goto('/register');
  await page.getByLabel('Your name').fill('Priya Sharma');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByLabel('Company name').fill('Acme E2E');
  await expect(page.getByLabel('Country where the company is registered')).toBeEnabled();
  await page.getByLabel('Country where the company is registered').selectOption('IN');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  // The real email, sent by the worker through SMTP to Mailpit.
  const verifyText = await waitForEmail(email, /Confirm your email/);
  await page.goto(linkIn(verifyText, '/verify-email'));
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();

  await page.getByRole('link', { name: 'Go to sign in' }).click();
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Acme E2E')).toBeVisible();
  await expect(page.getByText(/Your role requires two-step verification/)).toBeVisible();

  // A reload keeps the session (refresh cookie), without storing the access token.
  await page.reload();
  await expect(page.getByText('Acme E2E')).toBeVisible();
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })),
  ).not.toMatch(/eyJ/);

  // Turn on two-step verification.
  await page.getByRole('link', { name: 'Set it up' }).click();
  await page.getByRole('button', { name: 'Set up authenticator app' }).click();
  await page.getByLabel('Confirm your password to continue').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
  const secret = (await page.locator('code').textContent()).trim();
  await page.getByLabel('Enter the 6-digit code shown in the app').fill(totp(secret));
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Save your recovery codes' }).getByRole('listitem'),
  ).toHaveCount(10);
  await page.getByRole('button', { name: "I've saved them" }).click();
  await expect(page.getByText(/Two-step verification is on/).first()).toBeVisible();
  await expect(page.getByText(/Your role requires two-step verification/)).toHaveCount(0);
  await waitForEmail(email, /Two-step verification is on/);

  // Sign out, then sign in again with a code.
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Authentication code').fill(totp(secret, 1)); // the enrolment step is already used
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('Acme E2E')).toBeVisible();

  // The session list shows this device.
  await page.getByRole('link', { name: 'Security' }).click();
  await expect(page.getByText('This device')).toBeVisible();
});

test('forgot password → emailed link → new password works, old one does not', async ({ page, request }) => {
  const email = `e2e-reset-${Date.now()}@example.com`;
  const reg = await request.post('/api/v1/auth/register', {
    data: {
      fullName: 'Reset User',
      email,
      password: 'violet-tractor-91-lamp',
      companyName: 'Reset Co',
      countryCode: 'GB',
    },
  });
  expect(reg.status()).toBe(202);
  const verifyText = await waitForEmail(email, /Confirm your email/);
  await page.goto(linkIn(verifyText, '/verify-email'));
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();

  await page.goto('/forgot-password');
  await page.getByLabel('Work email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText(/a reset link is on its way/)).toBeVisible();
  await page.goto(linkIn(await waitForEmail(email, /Reset your password/), '/reset-password'));
  await page.getByLabel('Password').fill('brand-new-violet-77');
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText(/Password changed/)).toBeVisible();

  await page.goto('/login');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill('violet-tractor-91-lamp');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect');
  await page.getByLabel('Password').fill('brand-new-violet-77');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Reset Co')).toBeVisible();
});
