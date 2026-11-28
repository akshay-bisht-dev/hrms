import { apiFetch, getAccessToken } from './api';

const qs = (params) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null));
const post = (path, json = {}) => apiFetch(path, { method: 'POST', json });

export const monitoringApi = {
  me: () => apiFetch('/api/v1/monitoring/me'),
  acknowledge: (activationId) => post('/api/v1/monitoring/me/acknowledge', { activationId, locale: 'en' }),
  jurisdictions: () => apiFetch('/api/v1/monitoring/jurisdictions'),
  activations: () => apiFetch('/api/v1/monitoring/activations'),
  createDraft: (body) => post('/api/v1/monitoring/activations', body),
  updateDraft: (id, body) =>
    apiFetch(`/api/v1/monitoring/activations/${id}`, { method: 'PATCH', json: body }),
  complete: (id) => post(`/api/v1/monitoring/activations/${id}/complete`),
  pause: (id) => post(`/api/v1/monitoring/activations/${id}/pause`),
  resume: (id) => post(`/api/v1/monitoring/activations/${id}/resume`),
  policies: () => apiFetch('/api/v1/monitoring/policies'),
  createPolicy: (body) => post('/api/v1/monitoring/policies', body),
  changePolicy: (id, body) => post(`/api/v1/monitoring/policies/${id}/versions`, body),

  pairingCode: () => post('/api/v1/devices/pairing-codes'),
  myDevices: () => apiFetch('/api/v1/devices/me'),
  revokeMine: (id, reason) => post(`/api/v1/devices/me/${id}/revoke`, { reason }),
  devices: () => apiFetch('/api/v1/devices'),
  approveDevice: (id) => post(`/api/v1/devices/${id}/approve`),
  revokeDevice: (id, reason) => post(`/api/v1/devices/${id}/revoke`, { reason }),

  screenshots: (params = {}) => apiFetch(`/api/v1/screenshots?${qs(params)}`),
  viewUrl: (id, thumb = false) =>
    apiFetch(`/api/v1/screenshots/${id}/view-url?${qs({ thumb: thumb ? 'true' : '' })}`),
  /** Downloads the watermarked copy as a file (the request is authenticated, so it can't be a plain link). */
  async download(id) {
    const res = await fetch(`/api/v1/screenshots/${id}/download`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getAccessToken()}` },
      credentials: 'include',
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).title ?? 'Download failed');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `screenshot-${id.slice(0, 8)}.webp`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  remove: (id, reason) => post(`/api/v1/screenshots/${id}/delete`, { reason }),
  dispute: (id, reason) => post(`/api/v1/screenshots/${id}/disputes`, { reason }),
  disputes: () => apiFetch('/api/v1/screenshots/disputes'),
  resolveDispute: (id, body) => post(`/api/v1/screenshots/disputes/${id}/resolve`, body),
  reportIncident: (body) => post('/api/v1/screenshots/privacy-incidents', body),
  incidents: () => apiFetch('/api/v1/screenshots/privacy-incidents'),
  resolveIncident: (id, body) => post(`/api/v1/screenshots/privacy-incidents/${id}/resolve`, body),
  accessLog: (screenshotId) => apiFetch(`/api/v1/screenshots/access-logs?${qs({ screenshotId })}`),
};

export const DEVICE_TONE = { PENDING: 'warning', ACTIVE: 'success', REVOKED: 'neutral' };
