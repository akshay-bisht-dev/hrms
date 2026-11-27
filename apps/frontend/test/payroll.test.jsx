import { jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import '../src/i18n';
import { MyPayslipsPage } from '../src/pages/payroll/MyPayslipsPage';
import { money, currentFiscalYear } from '../src/services/payroll';

const json = (status, body) =>
  Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });
afterEach(() => delete global.fetch);

test('amounts are shown from their exact decimal strings, rupees with Indian grouping', () => {
  expect(money('1200000.0000', 'INR')).toBe('₹12,00,000.00');
  expect(money('89653.3300', 'INR')).toBe('₹89,653.33');
  expect(money('0.1000', 'USD', 'en-US')).toBe('$0.10');
  expect(money(null)).toBe('—');
});

test('fiscal year label follows the April–March year', () => {
  expect(currentFiscalYear('2026-11-27')).toBe('2026-27');
  expect(currentFiscalYear('2027-03-31')).toBe('2026-27');
  expect(currentFiscalYear('2027-04-01')).toBe('2027-28');
});

test('my payslips list each month with net pay and a download button; the regime form appears', async () => {
  global.fetch = jest.fn((url) => {
    if (url.startsWith('/api/v1/payroll/payslips/me'))
      return json(200, {
        data: [{ id: 'p1', month: '2026-11', payDate: '2026-11-28', net: '89653.3300', currency: 'INR' }],
      });
    if (url.startsWith('/api/v1/payroll/tax-declarations/me/'))
      return json(200, { fiscalYear: '2026-27', regime: 'NEW', declarations: {}, status: 'DRAFT' });
    return json(404, { title: url });
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MyPayslipsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('November 2026')).toBeInTheDocument();
  expect(screen.getByText('₹89,653.33')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Download payslip for November 2026' })).toBeInTheDocument();
  expect(await screen.findByLabelText('Tax regime')).toHaveValue('NEW');
});
