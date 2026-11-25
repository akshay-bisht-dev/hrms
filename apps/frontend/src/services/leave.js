import { apiFetch } from './api';

const base = '/api/v1/leaves';
const qs = (params) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null));

export const leaveApi = {
  myBalances: () => apiFetch(`${base}/balances/me`),
  balances: (employeeId) => apiFetch(`${base}/balances/${employeeId}`),
  ledger: (employeeId, leaveTypeId) => apiFetch(`${base}/ledger/${employeeId}?${qs({ leaveTypeId })}`),
  adjust: (body) => apiFetch(`${base}/adjustments`, { method: 'POST', json: body }),
  preview: (body) => apiFetch(`${base}/requests/preview`, { method: 'POST', json: body }),
  apply: (body) => apiFetch(`${base}/requests`, { method: 'POST', json: body }),
  requests: (params) => apiFetch(`${base}/requests?${qs(params)}`),
  decide: (id, body) => apiFetch(`${base}/requests/${id}/decision`, { method: 'POST', json: body }),
  cancel: (id, body = {}) => apiFetch(`${base}/requests/${id}/cancel`, { method: 'POST', json: body }),
  calendar: (params) => apiFetch(`${base}/calendar?${qs(params)}`),
  types: () => apiFetch(`${base}/types?limit=200`),
  policies: () => apiFetch(`${base}/policies?limit=200`),
  createPolicy: (body) => apiFetch(`${base}/policies`, { method: 'POST', json: body }),
  newVersion: (id, body) => apiFetch(`${base}/policies/${id}/versions`, { method: 'POST', json: body }),
  assignments: () => apiFetch(`${base}/policy-assignments`),
  assign: (body) => apiFetch(`${base}/policy-assignments`, { method: 'POST', json: body }),
  unassign: (id) => apiFetch(`${base}/policy-assignments/${id}`, { method: 'DELETE' }),
  starterPack: () => apiFetch(`${base}/starter-pack`, { method: 'POST' }),
  runAccruals: (month) => apiFetch(`${base}/accruals/run`, { method: 'POST', json: { month } }),
  summary: (params) => apiFetch(`${base}/reports/summary?${qs(params)}`),
  summaryCsvPath: (params) => `${base}/reports/summary?${qs({ ...params, format: 'csv' })}`,
};

export const LEAVE_TONE = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};
/** '1.50' → '1.5', '10.00' → '10' (display only; amounts stay strings end to end). */
export const days = (q) => (q === undefined || q === null ? '—' : String(q).replace(/\.?0+$/, '') || '0');
