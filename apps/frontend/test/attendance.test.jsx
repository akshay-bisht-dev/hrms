import { jest } from '@jest/globals';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import '../src/i18n';
import { MyAttendancePage } from '../src/pages/attendance/MyAttendancePage';
import { clock, hm, minutesToHm, monthRange } from '../src/services/attendance';

const json = (status, body) =>
  Promise.resolve({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(body)) });

const STATUS = {
  hasEmployeeRecord: true,
  employee: { id: 'e1', name: 'Ravi', timezone: 'Asia/Kolkata' },
  workDate: '2026-11-25',
  clockedIn: false,
  openSince: null,
  openLocationId: null,
  today: null,
  plan: { kind: 'WORKING', startMin: 540, endMin: 1080, expectedMinutes: 480, flexible: false },
  locations: [{ id: 'loc1', name: 'Pune office', type: 'OFFICE' }],
  capture: { ip: false, geo: false },
};

function renderPage(handlers) {
  global.fetch = jest.fn((url, init = {}) => {
    const key = `${init.method ?? 'GET'} ${url.split('?')[0]}`;
    const h = handlers[key];
    return h ? h(init) : json(404, { code: 'not_found', title: key });
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <MyAttendancePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => delete global.fetch);

describe('formatting helpers', () => {
  test('durations, clock times in the employee zone, month ranges', () => {
    expect(hm(0)).toBe('0h');
    expect(hm(480)).toBe('8h');
    expect(hm(125)).toBe('2h 05m');
    expect(minutesToHm(1320)).toBe('22:00');
    expect(minutesToHm(1800)).toBe('06:00'); // next-day end of a night shift
    expect(clock('2026-11-25T03:30:00.000Z', 'Asia/Kolkata', 'en')).toBe('09:00');
    expect(clock('2026-11-25T03:30:00.000Z', 'America/New_York', 'en')).toBe('22:30');
    expect(monthRange('2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('My attendance', () => {
  const base = {
    'GET /api/v1/attendance/me': () => json(200, { data: [] }),
    'GET /api/v1/attendance/regularizations': () => json(200, { data: [] }),
  };

  test('people are told exactly what is recorded; nothing extra by default', async () => {
    renderPage({ ...base, 'GET /api/v1/attendance/me/status': () => json(200, STATUS) });
    expect(
      await screen.findByText(
        'When you clock in or out, your company records the time. Nothing else is collected.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Your hours today: 09:00–18:00.')).toBeInTheDocument();
  });

  test('IP and location capture are disclosed when the company turns them on', async () => {
    renderPage({
      ...base,
      'GET /api/v1/attendance/me/status': () => json(200, { ...STATUS, capture: { ip: true, geo: true } }),
    });
    expect(
      await screen.findByText(/the time, your IP address, and your location \(your browser will ask first\)/),
    ).toBeInTheDocument();
  });

  test('clocking in sends the chosen location and shows the new state', async () => {
    renderPage({
      ...base,
      'GET /api/v1/attendance/me/status': () => json(200, STATUS),
      'POST /api/v1/attendance/punches': (init) => {
        const body = JSON.parse(init.body);
        expect(body).toMatchObject({ type: 'IN', workLocationId: 'loc1' });
        expect(body.geo).toBeUndefined();
        return json(201, { ...STATUS, clockedIn: true, openSince: '2026-11-25T03:35:00.000Z' });
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Clock in' }));
    expect(await screen.findByText('Clocked in since 09:05')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clock out' })).toBeInTheDocument();
  });

  test('without an employee record there is no clock button', async () => {
    renderPage({
      ...base,
      'GET /api/v1/attendance/me/status': () => json(200, { hasEmployeeRecord: false }),
    });
    expect(await screen.findByText(/not linked to an employee record/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clock in' })).toBeNull();
  });

  test('a correction request shows server field errors next to the field', async () => {
    renderPage({
      ...base,
      'GET /api/v1/attendance/me/status': () => json(200, STATUS),
      'POST /api/v1/attendance/regularizations': () =>
        json(422, {
          code: 'validation_failed',
          title: 'Some fields are invalid',
          errors: [{ path: 'body.reason', message: 'Say briefly why the record is wrong' }],
        }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Request a correction' }));
    const form = screen.getByRole('region', { name: 'Request a correction' });
    await userEvent.click(within(form).getByRole('button', { name: 'Send for approval' }));
    expect(await within(form).findByText('Say briefly why the record is wrong')).toBeInTheDocument();
  });
});
