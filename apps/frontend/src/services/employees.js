import { apiFetch, getAccessToken } from './api';

const base = '/api/v1/employees';
export const employeesApi = {
  list: (params) =>
    apiFetch(
      `${base}?${new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null))}`,
    ),
  get: (id) => apiFetch(`${base}/${id}`),
  me: () => apiFetch(`${base}/me`),
  create: (body) => apiFetch(base, { method: 'POST', json: body }),
  update: (id, body) => apiFetch(`${base}/${id}`, { method: 'PATCH', json: body }),
  revealId: (id) => apiFetch(`${base}/${id}/national-id`),
  history: (id) => apiFetch(`${base}/${id}/employment-records`),
  changeJob: (id, body) => apiFetch(`${base}/${id}/employment-records`, { method: 'POST', json: body }),
  changeStatus: (id, body) => apiFetch(`${base}/${id}/status`, { method: 'POST', json: body }),
  contacts: (id) => apiFetch(`${base}/${id}/emergency-contacts`),
  addContact: (id, body) => apiFetch(`${base}/${id}/emergency-contacts`, { method: 'POST', json: body }),
  removeContact: (id, cid) => apiFetch(`${base}/${id}/emergency-contacts/${cid}`, { method: 'DELETE' }),
  bank: (id) => apiFetch(`${base}/${id}/bank-accounts`),
  addBank: (id, body) => apiFetch(`${base}/${id}/bank-accounts`, { method: 'POST', json: body }),
  documents: (id) => apiFetch(`${base}/${id}/documents`),
  verifyDocument: (id, did) => apiFetch(`${base}/${id}/documents/${did}/verify`, { method: 'POST' }),
  deleteDocument: (id, did) => apiFetch(`${base}/${id}/documents/${did}`, { method: 'DELETE' }),
  documentUrl: (id, did) => apiFetch(`${base}/${id}/documents/${did}/download-url`),
  imports: () => apiFetch(`${base}/imports`),
  importStatus: (jobId) => apiFetch(`${base}/imports/${jobId}`),
  importResultUrl: (jobId) => apiFetch(`${base}/imports/${jobId}/result-url`),
};

/** Uploads to the presigned URL the API returned (straight to private storage; the API never sees the bytes). */
async function putToStorage(start, file) {
  const res = await fetch(start.uploadUrl, { method: 'PUT', headers: start.headers, body: file });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}

/** Document upload: ask for a slot → PUT the file → tell the API it's done. */
export async function uploadDocument(employeeId, file, category) {
  const start = await apiFetch(`${base}/${employeeId}/documents/upload-url`, {
    method: 'POST',
    json: { category, fileName: file.name, mimeType: file.type, sizeBytes: file.size },
  });
  await putToStorage(start, file);
  return apiFetch(`${base}/${employeeId}/documents/${start.documentId}/complete`, { method: 'POST' });
}

/** Import: upload the CSV, then start the job. */
export async function startImport(file) {
  const start = await apiFetch(`${base}/imports/upload-url`, { method: 'POST' });
  await putToStorage(start, file);
  return apiFetch(`${base}/imports`, { method: 'POST', json: { uploadId: start.uploadId } });
}

/** Downloads a file the API streams (CSV export / template) with the bearer token, then saves it. */
export async function downloadFromApi(path, fileName) {
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${getAccessToken()}` },
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Opens a short-lived signed download link. */
export function openSignedUrl(url) {
  window.location.assign(url);
}

export const fullName = (e) => [e.preferredName || e.firstName, e.lastName].filter(Boolean).join(' ');
