import { jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SystemStatusPage } from '../src/pages/SystemStatusPage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SystemStatusPage />
    </QueryClientProvider>,
  );
}

const respond = (status, body) =>
  Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });

afterEach(() => {
  delete global.fetch;
});

test('shows a loading state, then all services operational', async () => {
  global.fetch = jest.fn(() =>
    respond(200, {
      status: 'ok',
      checks: [
        { name: 'mysql', ok: true, latencyMs: 3 },
        { name: 'redis', ok: true, latencyMs: 1 },
      ],
    }),
  );
  renderPage();
  expect(screen.getByRole('status')).toHaveTextContent('Checking services');
  expect(await screen.findByText('All systems operational')).toBeInTheDocument();
  expect(screen.getByText('Database (MySQL)')).toBeInTheDocument();
  expect(screen.getAllByText('Operational')).toHaveLength(2);
  expect(global.fetch).toHaveBeenCalledWith(
    '/health/ready',
    expect.objectContaining({ credentials: 'same-origin' }),
  );
});

test('a 503 readiness answer is shown as degraded, with the reason in words', async () => {
  global.fetch = jest.fn(() =>
    respond(503, {
      status: 'unavailable',
      checks: [{ name: 'mysql', ok: false, latencyMs: 1000, error: 'timeout' }],
    }),
  );
  renderPage();
  expect(await screen.findByText('Some services are unavailable')).toBeInTheDocument();
  expect(screen.getByText('Unavailable · Timed out')).toBeInTheDocument();
});

test('network failure shows an error with a retry action', async () => {
  global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));
  renderPage();
  // The page retries once (about 1 s) before showing the error.
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Couldn't reach the API"), {
    timeout: 5000,
  });
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});
