import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AuthProvider } from '../src/context/AuthContext';
import { routes } from '../src/routes/router';
import { setAccessToken } from '../src/services/api';

const json = (status, body) =>
  Promise.resolve({
    ok: status < 400,
    status,
    text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
  });
const ME = {
  user: {
    id: 'u1',
    email: 'priya@example.com',
    displayName: 'Priya Sharma',
    emailVerified: true,
    mfaEnabled: false,
  },
  tenant: { id: 't1', name: 'Acme Software', slug: 'acme', status: 'TRIAL' },
  roles: ['Company Admin'],
  permissions: [{ code: 'view_team_screenshots', scope: 'COMPANY' }],
  mfa: { enabled: false, sessionVerified: false, requiredForRole: true },
};

/** Routes fetch calls by path; each handler returns a fetch-like response. */
function mockApi(handlers) {
  global.fetch = jest.fn((url, init = {}) => {
    const key = `${init.method ?? 'GET'} ${url}`;
    const h = handlers[key];
    if (!h) return json(404, { code: 'not_found', title: `no mock for ${key}` });
    return h(init);
  });
}

function renderAt(path) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return router;
}

afterEach(() => {
  delete global.fetch;
  setAccessToken(null);
  document.cookie = 'hrms_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

test('without a session cookie the app does not call refresh at all', async () => {
  mockApi({});
  renderAt('/login');
  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('signed-out visitors are sent to the login page', async () => {
  mockApi({ 'POST /api/v1/auth/refresh': () => json(401, { code: 'no_session', title: 'Sign in' }) });
  const router = renderAt('/settings/security');
  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/login');
});

test('login validates fields before calling the API', async () => {
  mockApi({ 'POST /api/v1/auth/refresh': () => json(401, {}) });
  renderAt('/login');
  await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
  expect(screen.getByLabelText('Work email')).toHaveAttribute('aria-invalid', 'true');
  expect(global.fetch).not.toHaveBeenCalled(); // no session cookie, and invalid input never reaches the API
});

test('wrong password shows the server message', async () => {
  mockApi({
    'POST /api/v1/auth/refresh': () => json(401, {}),
    'POST /api/v1/auth/login': () =>
      json(401, { code: 'invalid_credentials', title: 'Email or password is incorrect' }),
  });
  renderAt('/login');
  await userEvent.type(await screen.findByLabelText('Work email'), 'priya@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect');
});

test('MFA step, then the app with the MFA-required banner', async () => {
  mockApi({
    'POST /api/v1/auth/refresh': () => json(401, {}),
    'POST /api/v1/auth/login': () => json(200, { mfaRequired: true, challengeToken: 'ch1' }),
    'POST /api/v1/auth/mfa/verify': (init) => {
      expect(JSON.parse(init.body)).toEqual({ challengeToken: 'ch1', code: '123456' });
      return json(200, { mfaRequired: false, accessToken: 'at1', expiresIn: 900 });
    },
    'GET /api/v1/auth/me': (init) => {
      expect(init.headers.Authorization).toBe('Bearer at1');
      return json(200, ME);
    },
    'GET /health/ready': () => json(200, { status: 'ok', checks: [] }),
  });
  renderAt('/login');
  await userEvent.type(await screen.findByLabelText('Work email'), 'priya@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'violet-tractor-91-lamp');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await userEvent.type(await screen.findByLabelText('Authentication code'), '123 456');
  await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
  expect(await screen.findByText(/Your role requires two-step verification/)).toBeInTheDocument();
  expect(screen.getByText('Acme Software')).toBeInTheDocument();
});

test('unverified email offers to resend the link', async () => {
  mockApi({
    'POST /api/v1/auth/refresh': () => json(401, {}),
    'POST /api/v1/auth/login': () => json(403, { code: 'email_not_verified', title: 'Verify your email' }),
    'POST /api/v1/auth/resend-verification': () => json(202, { message: 'ok' }),
  });
  renderAt('/login');
  await userEvent.type(await screen.findByLabelText('Work email'), 'new@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'violet-tractor-91-lamp');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Send the link again' }));
  expect(await screen.findByText(/we've sent a new link/)).toBeInTheDocument();
});

test('an expired access token is refreshed once and the request retried', async () => {
  document.cookie = 'hrms_csrf=test-csrf'; // a session cookie exists, so the app tries to restore it
  let meCalls = 0;
  let refreshCalls = 0;
  mockApi({
    'POST /api/v1/auth/refresh': () => {
      refreshCalls += 1;
      return json(200, { mfaRequired: false, accessToken: `at${refreshCalls}`, expiresIn: 900 });
    },
    'GET /api/v1/auth/me': () => {
      meCalls += 1;
      return meCalls === 1 ? json(401, { code: 'invalid_token', title: 'expired' }) : json(200, ME);
    },
    'GET /health/ready': () => json(200, { status: 'ok', checks: [] }),
  });
  renderAt('/');
  await waitFor(() => expect(screen.getByText('Acme Software')).toBeInTheDocument());
  expect(refreshCalls).toBe(2); // session restore + one renewal
  expect(meCalls).toBe(2);
});

test('registration shows the check-your-email state and sends the browser time zone', async () => {
  mockApi({
    'POST /api/v1/auth/refresh': () => json(401, {}),
    'GET /api/v1/reference/countries': () =>
      json(200, {
        data: [
          { code: 'GB', name: 'United Kingdom' },
          { code: 'IN', name: 'India' },
        ],
      }),
    'POST /api/v1/auth/register': (init) => {
      const body = JSON.parse(init.body);
      expect(body).toMatchObject({ email: 'priya@example.com', countryCode: 'IN' });
      expect(typeof body.timezone).toBe('string');
      return json(202, { message: 'ok' });
    },
  });
  renderAt('/register');
  await userEvent.type(await screen.findByLabelText('Your name'), 'Priya Sharma');
  await userEvent.type(screen.getByLabelText('Work email'), 'priya@example.com');
  await userEvent.type(screen.getByLabelText('Password'), 'violet-tractor-91-lamp');
  await userEvent.type(screen.getByLabelText('Company name'), 'Acme Software');
  await waitFor(() =>
    expect(screen.getByLabelText('Country where the company is registered')).not.toBeDisabled(),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
  expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
});
