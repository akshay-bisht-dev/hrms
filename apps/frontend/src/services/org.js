import { apiFetch } from './api';

export const orgApi = {
  company: () => apiFetch('/api/v1/companies/current'),
  updateCompany: (body) => apiFetch('/api/v1/companies/current', { method: 'PATCH', json: body }),
  list: (path) => apiFetch(`/api/v1/companies/${path}?limit=200`),
  holidays: (calendarId) => apiFetch(`/api/v1/companies/holiday-calendars/${calendarId}/holidays`),
  addHoliday: (calendarId, body) =>
    apiFetch(`/api/v1/companies/holiday-calendars/${calendarId}/holidays`, { method: 'POST', json: body }),
  removeHoliday: (calendarId, id) =>
    apiFetch(`/api/v1/companies/holiday-calendars/${calendarId}/holidays/${id}`, { method: 'DELETE' }),
  members: (status) => apiFetch(`/api/v1/tenants/members${status ? `?status=${status}` : ''}`),
  invite: (body) => apiFetch('/api/v1/tenants/invitations', { method: 'POST', json: body }),
  cancelInvite: (id) => apiFetch(`/api/v1/tenants/invitations/${id}`, { method: 'DELETE' }),
  setRoles: (id, roleIds) =>
    apiFetch(`/api/v1/tenants/members/${id}/roles`, { method: 'PUT', json: { roleIds } }),
  memberAction: (id, action) =>
    action === 'remove'
      ? apiFetch(`/api/v1/tenants/members/${id}`, { method: 'DELETE' })
      : apiFetch(`/api/v1/tenants/members/${id}/${action}`, { method: 'POST' }),
  roles: () => apiFetch('/api/v1/tenants/roles'),
  permissions: () => apiFetch('/api/v1/tenants/permissions'),
  createRole: (body) => apiFetch('/api/v1/tenants/roles', { method: 'POST', json: body }),
  updateRole: (id, body) => apiFetch(`/api/v1/tenants/roles/${id}`, { method: 'PATCH', json: body }),
  deleteRole: (id) => apiFetch(`/api/v1/tenants/roles/${id}`, { method: 'DELETE' }),
};

/** "09:30" → 570 */
export const toMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};
/** 570 → "09:30" */
export const fromMinutes = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/** "0, 6" → [0, 6] */
export const toDayList = (s) =>
  String(s)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map(Number);
