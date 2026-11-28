import { apiFetch } from './api';

const qs = (params) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null));
const post = (path, json = {}) => apiFetch(path, { method: 'POST', json });

export const tasksApi = {
  projects: () => apiFetch('/api/v1/projects'),
  createProject: (body) => post('/api/v1/projects', body),
  updateProject: (id, body) => apiFetch(`/api/v1/projects/${id}`, { method: 'PATCH', json: body }),
  addMembers: (id, employeeIds) => post(`/api/v1/projects/${id}/members`, { employeeIds }),
  removeMember: (id, employeeId) =>
    apiFetch(`/api/v1/projects/${id}/members/${employeeId}`, { method: 'DELETE' }),

  list: (params) => apiFetch(`/api/v1/tasks?${qs(params)}`),
  get: (id) => apiFetch(`/api/v1/tasks/${id}`),
  create: (body) => post('/api/v1/tasks', body),
  update: (id, body) => apiFetch(`/api/v1/tasks/${id}`, { method: 'PATCH', json: body }),
  remove: (id) => apiFetch(`/api/v1/tasks/${id}`, { method: 'DELETE' }),
  move: (id, status, comment) =>
    post(`/api/v1/tasks/${id}/status`, { status, ...(comment ? { comment } : {}) }),
  comment: (id, body) => post(`/api/v1/tasks/${id}/comments`, { body }),
  timer: () => apiFetch('/api/v1/tasks/timer'),
  startTimer: (id) => post(`/api/v1/tasks/${id}/timer/start`),
  stopTimer: () => post('/api/v1/tasks/timer/stop'),
  timeEntries: (from, to) => apiFetch(`/api/v1/tasks/time-entries?${qs({ from, to })}`),
  addTime: (body) => post('/api/v1/tasks/time-entries', body),
  removeTime: (id) => apiFetch(`/api/v1/tasks/time-entries/${id}`, { method: 'DELETE' }),

  myReport: (date) => apiFetch(`/api/v1/work-reports/me/${date}`),
  saveReport: (date, notes) =>
    apiFetch(`/api/v1/work-reports/me/${date}`, { method: 'PUT', json: { notes } }),
  submitReport: (date) => post(`/api/v1/work-reports/me/${date}/submit`),
  reports: (params) => apiFetch(`/api/v1/work-reports?${qs(params)}`),
  decideReport: (id, body) => post(`/api/v1/work-reports/${id}/decision`, body),

  myTimesheet: (week) => apiFetch(`/api/v1/timesheets/me?${qs({ week })}`),
  submitTimesheet: (weekStart) => post(`/api/v1/timesheets/me/${weekStart}/submit`),
  timesheets: (params) => apiFetch(`/api/v1/timesheets?${qs(params)}`),
  decideTimesheet: (id, body) => post(`/api/v1/timesheets/${id}/decision`, body),

  board: (params = {}) => apiFetch(`/api/v1/dashboards/team-board?${qs(params)}`),
  remoteWork: (params = {}) => apiFetch(`/api/v1/dashboards/remote-work?${qs(params)}`),
};

export const TASK_TONE = {
  ASSIGNED: 'neutral',
  IN_PROGRESS: 'info',
  ON_HOLD: 'warning',
  UNDER_REVIEW: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};
export const PRIORITY_TONE = { LOW: 'neutral', MEDIUM: 'info', HIGH: 'warning', URGENT: 'danger' };
export const REVIEW_TONE = {
  DRAFT: 'neutral',
  SUBMITTED: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CHANGES_REQUESTED: 'warning',
};
