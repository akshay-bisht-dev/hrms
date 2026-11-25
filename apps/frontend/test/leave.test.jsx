import { jest } from '@jest/globals';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import '../src/i18n';
import { MyLeavePage } from '../src/pages/leave/MyLeavePage';
import { days } from '../src/services/leave';

const json = (status, body) =>
  Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
const STATUS = {
  hasEmployeeRecord: true,
  employee: { id: 'e1', name: 'Ravi', timezone: 'Asia/Kolkata' },
  workDate: '2026-11-25',
};
const BALANCE = {
  leaveType: {
    id: 't1',
    code: 'ANNUAL',
    name: 'Annual leave',
    isPaid: true,
    color: '#2563eb',
    requiresDocumentAfterDays: null,
  },
  policy: { id: 'p1', name: 'Annual', allowHalfDay: true, approvalLevels: 1 },
  balance: '18.33',
  pending: '5.00',
  available: '13.33',
  usedThisYear: '0.00',
  accruedThisYear: '18.33',
};

function renderPage(handlers) {
  global.fetch = jest.fn((url, init = {}) => {
    const h = handlers[`${init.method ?? 'GET'} ${url.split('?')[0]}`];
    return h ? h(init) : json(404, { code: 'not_found', title: url });
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MyLeavePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => delete global.fetch);
const base = {
  'GET /api/v1/attendance/me/status': () => json(200, STATUS),
  'GET /api/v1/leaves/balances/me': () => json(200, { data: [BALANCE] }),
  'GET /api/v1/leaves/requests': () => json(200, { data: [] }),
};

test('day amounts display without trailing zeros', () => {
  expect(days('18.33')).toBe('18.33');
  expect(days('10.00')).toBe('10');
  expect(days('0.50')).toBe('0.5');
  expect(days('0.00')).toBe('0');
});

test('balances show what is available after pending requests', async () => {
  renderPage(base);
  const card = await screen.findByTestId('balance-ANNUAL');
  expect(within(card).getByText('13.33')).toBeInTheDocument();
  expect(within(card).getByText('Balance 18.33 · waiting 5 · used this year 0')).toBeInTheDocument();
});

test('the form previews the day count and shows policy problems before submitting', async () => {
  const previews = [];
  renderPage({
    ...base,
    'POST /api/v1/leaves/requests/preview': (init) => {
      previews.push(JSON.parse(init.body));
      return json(200, {
        quantity: '5.00',
        available: '13.33',
        approvalLevels: 2,
        days: [],
        errors: [{ path: 'body.fromDate', message: 'Apply at least 3 days ahead' }],
      });
    },
  });
  await userEvent.click(await screen.findByRole('button', { name: 'Apply for leave' }));
  expect(await screen.findByText(/This takes 5 days\. Available now: 13\.33\./)).toBeInTheDocument();
  expect(screen.getByText(/needs your manager and then HR/)).toBeInTheDocument();
  expect(screen.getByText('Apply at least 3 days ahead')).toBeInTheDocument();
  expect(previews.at(-1)).toMatchObject({ leaveTypeId: 't1', fromDate: '2026-11-25', toDate: '2026-11-25' });
});

test('without any policy the apply button is not offered', async () => {
  renderPage({ ...base, 'GET /api/v1/leaves/balances/me': () => json(200, { data: [] }) });
  expect(await screen.findByText(/No leave policy applies to you yet/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Apply for leave' })).toBeNull();
});
