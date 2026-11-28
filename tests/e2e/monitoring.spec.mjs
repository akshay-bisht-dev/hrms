// Full monitoring journey with the real desktop app (Electron, driven by Playwright under a virtual display):
// HR completes the checklist, the employee reads the notice and pairs the app, HR approves the computer, a work
// session takes a screenshot only while it runs, a break stops capture, the employee sees the screenshot and who
// looked at it, and HR reviews it. Needs the local stack (API, worker, frontend, S3) and DISPLAY (xvfb-run).
import { test, expect, _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { waitForEmail, linkIn, totp } from './helpers.mjs';

const PASSWORD = 'violet-tractor-91-lamp';
const SHOTS = process.env.E2E_SCREENSHOTS;
const VIEW = { viewport: { width: 1280, height: 900 }, deviceScaleFactor: SHOTS ? 2 : 1 };
test.use(VIEW);
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};
const ELECTRON = createRequire(path.resolve('apps/agent/package.json'))('electron'); // the agent's own Electron
const AGENT_DIR = path.resolve('apps/agent');

/** Local stack only: moves the checklist's completion into the past so the notice period has passed. */
function backdateActivation(tenantId) {
  const sql = `UPDATE monitoring_activations SET completed_at = NOW(3) - INTERVAL 10 DAY, notice_starts_on = CURDATE() - INTERVAL 10 DAY WHERE tenant_id = '${tenantId}' AND status = 'ACTIVE'`;
  execFileSync(
    'docker',
    ['compose', 'exec', '-T', 'mysql', 'sh', '-c', `mysql -uroot -p"$MYSQL_ROOT_PASSWORD" hrms -e "${sql}"`],
    {
      stdio: 'pipe',
    },
  );
}

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

test.skip(!process.env.DISPLAY, 'Needs a display for the desktop app (run under xvfb-run)');

test('screen monitoring end to end with the desktop app: checklist, notice, pairing, capture only in session, review', async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now();
  const owner = `e2e-mon-hr-${stamp}@example.com`;
  const company = `Monitoring E2E ${stamp}`;
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
  const api = async (p, data, method = 'post') => {
    const res = await request[method](p, { data, headers });
    expect(res.ok(), `${p} → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  };
  const me = await (await request.get('/api/v1/auth/me', { headers })).json();
  const legalEntity = (await (await request.get('/api/v1/companies/legal-entities', { headers })).json())
    .data[0];
  const roles = (await (await request.get('/api/v1/tenants/roles', { headers })).json()).data;
  const raviEmail = `e2e-mon-ravi-${stamp}@example.com`;
  const ravi = await api('/api/v1/employees', {
    firstName: 'Ravi',
    lastName: 'Kumar',
    workEmail: raviEmail,
    legalEntityId: legalEntity.id,
    dateOfJoining: '2026-01-05',
  });
  await api('/api/v1/tenants/invitations', {
    email: raviEmail,
    roleIds: [roles.find((r) => r.systemKey === 'employee').id],
    employeeId: ravi.id,
  });
  await api('/api/v1/companies/work-locations', { name: 'Pune office', type: 'OFFICE' });

  // HR completes the checklist in the web app (only India needs steps here).
  await signIn(page, owner, secret);
  await page.getByRole('link', { name: 'Monitoring', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Screen monitoring' })).toBeVisible();
  const form = page.getByRole('region', { name: 'Monitoring checklist' });
  await form
    .getByLabel('Purpose (written for employees)')
    .fill('To verify time worked on client projects from company laptops.');
  await form.getByLabel('Why this basis applies').fill('Client contracts require proof of time worked.');
  await form
    .getByLabel('Notice shown to employees')
    .fill(
      'While your work session runs in the desktop app on a company laptop, a screenshot is taken about every 5 minutes. They are kept for 30 days and only HR administrators can see them; you can see and dispute your own.',
    );
  await form.getByLabel('Company Admin').check();
  await form.getByLabel('Privacy contact', { exact: true }).fill('Priya Privacy');
  await form.getByLabel('Privacy contact email').fill('privacy@example.com');
  await form.getByLabel('Complaints email').fill('grievance@example.com');
  await form.getByLabel('Written notice given to employees').check();
  await form.getByLabel('Use limited to the stated purpose').check();
  await form.getByRole('button', { name: 'Complete the checklist' }).click();
  await expect(form.getByRole('alert').getByText(/Confirm that you took legal advice/)).toBeVisible(); // refused without it
  await form.getByLabel(/We took our own legal advice/).check();
  await form.getByRole('button', { name: 'Complete the checklist' }).click();
  await expect(page.getByText(/Completed\. Monitoring can start after the notice period/)).toBeVisible();
  await shot(page, 's10-checklist');
  await page.getByRole('tab', { name: 'Screenshot policies' }).click();
  const pol = page.getByRole('region', { name: 'New screenshot policy' });
  await pol.getByLabel('Every (minutes)').fill('5');
  await pol.getByRole('button', { name: 'Create policy' }).click();
  await expect(page.getByText(/every 5 min/)).toBeVisible();
  backdateActivation(me.tenant.id);

  // Ravi reads the notice and gets a pairing code.
  const ctx = await browser.newContext(VIEW);
  const r = await ctx.newPage();
  await r.goto(linkIn(await waitForEmail(raviEmail, /invited to/), '/accept-invite'));
  await r.getByLabel('Your name').fill('Ravi Kumar');
  await r.getByLabel('Choose a password').fill(PASSWORD);
  await r.getByRole('button', { name: 'Accept invitation' }).click();
  await signIn(r, raviEmail);
  await r.getByRole('link', { name: 'My work' }).click();
  const mon = r.getByRole('region', { name: 'Screen monitoring' });
  await expect(mon.getByText('Please read: monitoring notice')).toBeVisible();
  await expect(mon.getByText('Off for you')).toBeVisible();
  await mon.getByRole('button', { name: 'I have read and understood this notice' }).click();
  await expect(mon.getByText('On for you')).toBeVisible();
  await mon.getByRole('button', { name: 'Connect the desktop app' }).click();
  const code = (await mon.getByTestId('pairing-code').innerText()).trim();
  await shot(r, 's10-my-work-monitoring');

  // The desktop app pairs; the computer waits for HR's approval.
  const userData = mkdtempSync(path.join(tmpdir(), 'hrms-agent-'));
  const env = {
    ...process.env,
    HRMS_API_URL: 'http://localhost:3000',
    HRMS_AGENT_FIRST_CAPTURE_MS: '3000',
    HRMS_AGENT_USER_DATA: userData,
    HRMS_AGENT_CI_NO_OS_SANDBOX: '1',
  };
  delete env.NODE_OPTIONS;
  const desktop = await electron.launch({ executablePath: ELECTRON, args: ['--no-sandbox', AGENT_DIR], env });
  try {
    const w = await desktop.firstWindow();
    await w.getByLabel('Pairing code').fill(code);
    await w.getByRole('button', { name: 'Connect' }).click();
    await expect(w.getByText(/administrator still has to approve this computer/)).toBeVisible();
    await expect(w.getByTestId('monitoring-banner')).toHaveText(/OFF/);

    await page.getByRole('tab', { name: 'Computers' }).click();
    await page.getByTestId(`device-${ravi.employeeCode}`).getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByTestId(`device-${ravi.employeeCode}`).getByText('Connected')).toBeVisible();

    // Start work in the desktop app: monitoring turns on, the first screenshot follows.
    await w.getByLabel('Where are you working?').selectOption({ label: 'Pune office' });
    await w.getByRole('button', { name: 'Start work' }).click();
    await expect(w.getByTestId('monitoring-banner')).toHaveText(/ON/, { timeout: 15_000 });
    await expect(w.getByText(/Last screenshot: (?!—)/)).toBeVisible({ timeout: 30_000 });
    if (SHOTS) await w.screenshot({ path: `${SHOTS}/s10-agent-on.png` });
    // A break stops capture at once.
    await w.getByRole('button', { name: 'Take a break' }).click();
    await expect(w.getByTestId('monitoring-banner')).toHaveText(/OFF/);
    await w.getByRole('button', { name: 'Back to work' }).click();
    await w.getByRole('button', { name: 'End work' }).click();
    await expect(w.getByTestId('monitoring-banner')).toHaveText(/OFF/);
    await expect(w.getByText('No work session')).toBeVisible();
  } finally {
    await desktop.close();
    rmSync(userData, { recursive: true, force: true });
  }

  // HR reviews the screenshot (a 60-second link; the view is logged).
  await page.getByRole('link', { name: 'Screenshot review' }).click();
  await page.getByLabel('Person').selectOption({ label: `Ravi Kumar · ${ravi.employeeCode}` });
  const gallery = page.getByRole('region', { name: 'Screenshots' });
  await expect(gallery.getByText('1 screenshot')).toBeVisible({ timeout: 30_000 });
  await gallery.getByRole('button', { name: /View screenshot taken at/ }).click();
  await expect(gallery.getByRole('img', { name: /Screenshot at/ }).last()).toBeVisible();
  await shot(page, 's10-review');

  // Ravi sees the same screenshot and that someone else looked at it; he disputes it.
  await r.getByRole('link', { name: 'See my screenshots and who viewed them' }).click();
  const mine = r.getByRole('region', { name: 'Screenshots' });
  await expect(mine.getByText('1 screenshot')).toBeVisible();
  await mine.getByRole('button', { name: /View screenshot taken at/ }).click();
  await expect(mine.getByText(/Viewed · .* · someone else/).first()).toBeVisible();
  await mine.getByLabel('Reason').fill('A personal chat window was open');
  await mine.getByRole('button', { name: 'Dispute' }).click();
  await expect(mine.getByText('Under review')).toBeVisible();
  await shot(r, 's10-my-screenshots');
  await ctx.close();
});
