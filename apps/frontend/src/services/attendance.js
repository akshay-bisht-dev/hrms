import { apiFetch } from './api';

const base = '/api/v1/attendance';
const qs = (params) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null));

export const attendanceApi = {
  status: () => apiFetch(`${base}/me/status`),
  punch: (body) => apiFetch(`${base}/punches`, { method: 'POST', json: body }),
  myDays: (from, to) => apiFetch(`${base}/me?${qs({ from, to })}`),
  employeeDays: (id, from, to) => apiFetch(`${base}/employees/${id}/days?${qs({ from, to })}`),
  team: (params) => apiFetch(`${base}/days?${qs(params)}`),
  corrections: (params) => apiFetch(`${base}/regularizations?${qs(params)}`),
  requestCorrection: (body) => apiFetch(`${base}/regularizations`, { method: 'POST', json: body }),
  decideCorrection: (id, body) =>
    apiFetch(`${base}/regularizations/${id}/decision`, { method: 'POST', json: body }),
  cancelCorrection: (id) => apiFetch(`${base}/regularizations/${id}/cancel`, { method: 'POST' }),
  overtime: (params = {}) => apiFetch(`${base}/overtime?${qs(params)}`),
  decideOvertime: (dayId, body) =>
    apiFetch(`${base}/days/${dayId}/overtime-decision`, { method: 'POST', json: body }),
  shifts: () => apiFetch(`${base}/shifts?limit=200`),
  assignments: (params = {}) => apiFetch(`${base}/shift-assignments?${qs(params)}`),
  assign: (body) => apiFetch(`${base}/shift-assignments`, { method: 'POST', json: body }),
  unassign: (id) => apiFetch(`${base}/shift-assignments/${id}`, { method: 'DELETE' }),
  policy: (legalEntityId) => apiFetch(`${base}/policy?${qs({ legalEntityId })}`),
  savePolicy: (body) => apiFetch(`${base}/policy`, { method: 'PUT', json: body }),
  recalculate: (body) => apiFetch(`${base}/recalculate`, { method: 'POST', json: body }),
  summary: (params) => apiFetch(`${base}/reports/summary?${qs(params)}`),
  summaryCsvPath: (params) => `${base}/reports/summary?${qs({ ...params, format: 'csv' })}`,
};

export const DAY_TONE = {
  PRESENT: 'success',
  WFH: 'info',
  HALF_DAY: 'warning',
  ABSENT: 'danger',
  ON_LEAVE: 'info',
  HOLIDAY: 'neutral',
  WEEKEND: 'neutral',
  PENDING: 'neutral',
  NOT_RECORDED: 'neutral',
};
export const REQUEST_TONE = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

/** 'YYYY-MM-DD' of an instant in a time zone. */
export function ymdIn(date, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}
export const addDaysYmd = (ymd, n) =>
  new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const monthRange = (ymd) => {
  const [y, m] = ymd.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ymd.slice(0, 7)}-01`, to: `${ymd.slice(0, 7)}-${String(last).padStart(2, '0')}` };
};
/** 125 → "2h 05m" */
export const hm = (minutes) => {
  if (!minutes) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
};
/** Clock time of an instant in the employee's zone, e.g. "09:05". */
export const clock = (iso, timeZone, locale) =>
  iso
    ? new Intl.DateTimeFormat(locale, {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(iso))
    : '—';
export const minutesToHm = (m) =>
  m === null || m === undefined
    ? '—'
    : `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
