import { apiFetch, csrfToken, setAccessToken } from './api';

const post = (path, json, opts = {}) => apiFetch(`/api/v1/auth${path}`, { method: 'POST', json, ...opts });

export const authApi = {
  register: (body) =>
    post(
      '/register',
      { ...body, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      { auth: false },
    ),
  verifyEmail: (token) => post('/verify-email', { token }, { auth: false }),
  resendVerification: (email) => post('/resend-verification', { email }, { auth: false }),
  login: (body) => post('/login', body, { auth: false }),
  verifyMfa: (body) => post('/mfa/verify', body, { auth: false }),
  forgotPassword: (email) => post('/forgot-password', { email }, { auth: false }),
  resetPassword: (body) => post('/reset-password', body, { auth: false }),
  me: () => apiFetch('/api/v1/auth/me'),
  sessions: () => apiFetch('/api/v1/auth/sessions'),
  revokeSession: (id) => apiFetch(`/api/v1/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  changePassword: (body) => post('/password', body),
  logoutAll: () => post('/logout-all'),
  mfaSetup: (password) => post('/mfa/setup', { password }),
  mfaConfirm: (code) => post('/mfa/confirm', { code }),
  mfaDisable: (body) => post('/mfa/disable', body),
  logout: () => post('/logout', undefined, { auth: false, csrf: true }),
};

export const fetchCountries = () => apiFetch('/api/v1/reference/countries', { auth: false });

let inflight = null;

/**
 * Renews the access token with the refresh cookie. Tabs share one refresh at a time (Web Locks), because a
 * second tab presenting the same, just-rotated cookie would look like token theft and end the session.
 * @returns {Promise<string | null>}
 */
export function refreshSession() {
  if (inflight) return inflight;
  const run = async () => {
    // No CSRF cookie means there is no session cookie either: skip the request instead of earning a 403.
    if (!csrfToken()) {
      setAccessToken(null);
      return null;
    }
    try {
      const { accessToken } = await post('/refresh', undefined, { auth: false, csrf: true });
      setAccessToken(accessToken);
      return accessToken;
    } catch {
      setAccessToken(null);
      return null;
    }
  };
  const locked =
    typeof navigator !== 'undefined' && navigator.locks
      ? () => navigator.locks.request('hrms-refresh', run)
      : run;
  inflight = locked().finally(() => {
    inflight = null;
  });
  return inflight;
}
