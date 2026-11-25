/**
 * Error thrown for non-2xx responses. Carries the RFC 9457 problem body when the server sent one.
 */
export class ApiError extends Error {
  /** @param {number} status @param {{ code?: string, title?: string, requestId?: string, errors?: Array<{path: string, message: string}>, retryAfterSec?: number }} problem */
  constructor(status, problem) {
    super(problem.title ?? `Request failed (${status})`);
    this.status = status;
    this.code = problem.code ?? 'http_error';
    this.requestId = problem.requestId;
    this.errors = problem.errors ?? [];
    this.retryAfterSec = problem.retryAfterSec;
  }

  /** Field errors keyed by the last path segment, e.g. { password: '…' }. */
  fieldErrors() {
    return Object.fromEntries(this.errors.map((e) => [e.path.split('.').pop(), e.message]));
  }
}

// The access token lives only in memory (never localStorage) — Phase 3, AUTH-08.
let accessToken = null;
/** @type {null | (() => Promise<string | null>)} */
let refresher = null;

export const setAccessToken = (t) => {
  accessToken = t;
};
export const getAccessToken = () => accessToken;
/** Registers the function used to renew an expired access token (set by the auth context). */
export const setRefresher = (fn) => {
  refresher = fn;
};

/** Reads a cookie set by the API (only the CSRF cookie is readable by design). @param {string} name */
export function readCookie(name) {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : '';
}

export const csrfToken = () => readCookie('__Host-hrms_csrf') || readCookie('hrms_csrf');

async function parse(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Same-origin JSON fetch (Vite proxy in dev, Nginx in production). Adds the bearer token, and on an expired
 * token refreshes once and retries.
 * @param {string} path
 * @param {RequestInit & { json?: unknown, auth?: boolean, csrf?: boolean, _retried?: boolean }} [options]
 */
export async function apiFetch(
  path,
  { json, headers, auth = true, csrf = false, _retried = false, ...options } = {},
) {
  const res = await fetch(path, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(csrf ? { 'X-CSRF-Token': csrfToken() } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : options.body,
    credentials: 'same-origin',
  });
  const body = await parse(res);
  if (res.status === 401 && auth && !_retried && refresher && body?.code === 'invalid_token') {
    const renewed = await refresher();
    if (renewed) return apiFetch(path, { json, headers, auth, csrf, _retried: true, ...options });
  }
  if (!res.ok) {
    // /health/ready answers 503 with a normal body; callers that want it read error.body.
    const err = new ApiError(res.status, body && typeof body === 'object' ? body : {});
    err.body = body;
    throw err;
  }
  return body;
}
