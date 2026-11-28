import { apiFetch } from './api';

const base = '/api/v1/work';
const qs = (params) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null));
const post = (path, json = {}) => apiFetch(`${base}${path}`, { method: 'POST', json });

export const workApi = {
  status: () => apiFetch(`${base}/me/status`),
  start: (workLocationId) => post('/sessions', { workLocationId, clientTs: new Date().toISOString() }),
  heartbeat: () => post('/sessions/current/heartbeat', { clientTs: new Date().toISOString() }),
  startBreak: (type) => post('/sessions/current/break/start', { type }),
  endBreak: () => post('/sessions/current/break/end'),
  end: () => post('/sessions/current/end', { clientTs: new Date().toISOString() }),
  sessions: (params) => apiFetch(`${base}/sessions?${qs(params)}`),
  session: (id) => apiFetch(`${base}/sessions/${id}`),
  corrections: (params) => apiFetch(`${base}/corrections?${qs(params)}`),
  requestCorrection: (body) => post('/corrections', body),
  decideCorrection: (id, body) => post(`/corrections/${id}/decision`, body),
  cancelCorrection: (id) => post(`/corrections/${id}/cancel`),
  wfh: (params) => apiFetch(`${base}/wfh-requests?${qs(params)}`),
  requestWfh: (body) => post('/wfh-requests', body),
  decideWfh: (id, body) => post(`/wfh-requests/${id}/decision`, body),
  cancelWfh: (id) => post(`/wfh-requests/${id}/cancel`),
  team: (params = {}) => apiFetch(`${base}/team?${qs(params)}`),
  policies: () => apiFetch(`${base}/policies`),
  createPolicy: (body) => post('/policies', body),
  changePolicy: (id, body) => post(`/policies/${id}/versions`, body),
  retirePolicy: (id) => post(`/policies/${id}/retire`),
};

export const WORK_STATE_TONE = {
  WORKING: 'success',
  ON_BREAK: 'info',
  DISCONNECTED: 'warning',
  FINISHED: 'neutral',
  NOT_STARTED: 'neutral',
};
export const SESSION_TONE = {
  ACTIVE: 'success',
  ON_BREAK: 'info',
  DISCONNECTED: 'warning',
  ENDED: 'neutral',
  AUTO_CLOSED: 'warning',
};
export const SEGMENT_CLASS = {
  WORK: 'bg-emerald-500',
  BREAK: 'bg-sky-400',
  IDLE: 'bg-slate-300',
  DISCONNECTED: 'bg-amber-400',
  REMOVED: 'bg-slate-200',
};

/** 3725 → "1h 02m" (seconds, floored to minutes). */
export const hms = (sec) => {
  const minutes = Math.floor((sec ?? 0) / 60);
  if (!minutes) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
};
