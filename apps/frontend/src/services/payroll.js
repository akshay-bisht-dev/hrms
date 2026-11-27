import { apiFetch } from './api';

const base = '/api/v1/payroll';
const qs = (params) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null));

export const payrollApi = {
  statutoryKeys: (leId) => apiFetch(`${base}/legal-entities/${leId}/statutory-keys`),
  statutorySettings: (leId) => apiFetch(`${base}/legal-entities/${leId}/statutory-settings`),
  saveStatutorySettings: (leId, body) =>
    apiFetch(`${base}/legal-entities/${leId}/statutory-settings`, { method: 'PUT', json: body }),
  settings: (leId) => apiFetch(`${base}/legal-entities/${leId}/settings`),
  saveSettings: (leId, body) =>
    apiFetch(`${base}/legal-entities/${leId}/settings`, { method: 'PUT', json: body }),
  indiaStarter: (legalEntityId) =>
    apiFetch(`${base}/starter/in`, { method: 'POST', json: { legalEntityId } }),
  components: () => apiFetch(`${base}/components?limit=200`),
  structures: () => apiFetch(`${base}/structures?limit=200`),
  structure: (id) => apiFetch(`${base}/structures/${id}/components`),
  createStructure: (body) => apiFetch(`${base}/structures`, { method: 'POST', json: body }),
  setStructureComponents: (id, components) =>
    apiFetch(`${base}/structures/${id}/components`, { method: 'PUT', json: { components } }),
  salaries: (employeeId) => apiFetch(`${base}/employees/${employeeId}/salaries`),
  setSalary: (employeeId, body) =>
    apiFetch(`${base}/employees/${employeeId}/salaries`, { method: 'POST', json: body }),
  preview: (structureId, annualCtc) => apiFetch(`${base}/salary-preview?${qs({ structureId, annualCtc })}`),
  runs: (params = {}) => apiFetch(`${base}/runs?${qs(params)}`),
  createRun: (body) => apiFetch(`${base}/runs`, { method: 'POST', json: body }),
  run: (id) => apiFetch(`${base}/runs/${id}`),
  action: (id, action, body) =>
    apiFetch(`${base}/runs/${id}/${action}`, { method: 'POST', json: body ?? {} }),
  inputs: (id) => apiFetch(`${base}/runs/${id}/inputs`),
  addInput: (id, body) => apiFetch(`${base}/runs/${id}/inputs`, { method: 'POST', json: body }),
  removeInput: (id, inputId) => apiFetch(`${base}/runs/${id}/inputs/${inputId}`, { method: 'DELETE' }),
  runEmployees: (id) => apiFetch(`${base}/runs/${id}/employees`),
  runEmployee: (id, reId) => apiFetch(`${base}/runs/${id}/employees/${reId}`),
  variance: (id) => apiFetch(`${base}/runs/${id}/variance`),
  registerPath: (id) => `${base}/runs/${id}/register`,
  bankFilePath: (id) => `${base}/runs/${id}/bank-file`,
  myPayslips: () => apiFetch(`${base}/payslips/me`),
  payslipUrl: (id) => apiFetch(`${base}/payslips/${id}/download-url`),
  myDeclaration: (fy) => apiFetch(`${base}/tax-declarations/me/${fy}`),
  saveMyDeclaration: (fy, body) =>
    apiFetch(`${base}/tax-declarations/me/${fy}`, { method: 'PUT', json: body }),
  declarations: (status) => apiFetch(`${base}/tax-declarations?${qs({ status })}`),
  reviewDeclaration: (id, decision) =>
    apiFetch(`${base}/tax-declarations/${id}/review`, { method: 'POST', json: { decision } }),
};

/**
 * Formats a decimal-string amount for display. Intl.NumberFormat formats the string exactly (no float conversion
 * in modern engines); the value is never used for arithmetic here.
 */
export function money(value, currency = 'INR', locale = undefined) {
  if (value === null || value === undefined || value === '') return '—';
  try {
    return new Intl.NumberFormat(locale ?? (currency === 'INR' ? 'en-IN' : undefined), {
      style: 'currency',
      currency,
    }).format(String(value));
  } catch {
    return `${currency} ${value}`;
  }
}

export const RUN_TONE = {
  DRAFT: 'neutral',
  INPUTS_LOCKED: 'info',
  CALCULATING: 'info',
  CALCULATED: 'warning',
  REVIEWED: 'warning',
  APPROVED: 'success',
  FINALIZED: 'success',
  PAID: 'success',
  CANCELLED: 'neutral',
};
export const STEPS = ['DRAFT', 'INPUTS_LOCKED', 'CALCULATED', 'REVIEWED', 'APPROVED', 'FINALIZED', 'PAID'];

/** The current Indian fiscal year label for today, e.g. '2026-27'. */
export function currentFiscalYear(today = new Date().toISOString().slice(0, 10), startMonth = 4) {
  const y = Number(today.slice(0, 4));
  const start = Number(today.slice(5, 7)) >= startMonth ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
