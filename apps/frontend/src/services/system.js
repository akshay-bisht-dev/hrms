import { apiFetch, ApiError } from './api';

/**
 * Readiness of the backend and its dependencies. A 503 is a valid answer ("degraded"), not a failure to load.
 * @returns {Promise<{ status: 'ok' | 'unavailable', checks: Array<{ name: string, ok: boolean, latencyMs: number, error?: string }> }>}
 */
export async function fetchReadiness() {
  try {
    return await apiFetch('/health/ready');
  } catch (e) {
    if (e instanceof ApiError && e.status === 503 && e.body?.checks) return e.body;
    throw e;
  }
}
