// @ts-check
import { randomToken, safeEqual } from './crypto.js';
import { ForbiddenError } from './errors.js';

/**
 * Cookie names. With Secure cookies the __Host- prefix pins them to this host and path "/" (no Domain attribute).
 * @param {boolean} secure
 */
export const cookieNames = (secure) => ({
  refresh: secure ? '__Host-hrms_rt' : 'hrms_rt',
  csrf: secure ? '__Host-hrms_csrf' : 'hrms_csrf',
});

/**
 * Sets the HttpOnly refresh cookie and the readable CSRF cookie (double-submit, Phase 3 AUTH-10).
 * @param {import('express').Response} res @param {{ secure: boolean, refreshToken: string, maxAgeSec: number }} o
 */
export function setSessionCookies(res, { secure, refreshToken, maxAgeSec }) {
  const names = cookieNames(secure);
  const base = { secure, sameSite: /** @type {const} */ ('strict'), path: '/', maxAge: maxAgeSec * 1000 };
  res.cookie(names.refresh, refreshToken, { ...base, httpOnly: true });
  res.cookie(names.csrf, randomToken(24), { ...base, httpOnly: false });
}

/** @param {import('express').Response} res @param {boolean} secure */
export function clearSessionCookies(res, secure) {
  const names = cookieNames(secure);
  for (const name of [names.refresh, names.csrf])
    res.clearCookie(name, { secure, sameSite: 'strict', path: '/' });
}

/**
 * For cookie-authenticated endpoints (refresh, logout): Origin must be allowed AND the X-CSRF-Token header
 * must equal the CSRF cookie. SameSite=Strict is the first line; this is the second.
 * @param {{ secure: boolean, allowedOrigins: string[] }} o
 * @returns {import('express').RequestHandler}
 */
export function requireCsrf({ secure, allowedOrigins }) {
  const names = cookieNames(secure);
  return (req, _res, next) => {
    const origin = req.get('origin');
    if (!origin || !allowedOrigins.includes(origin))
      return next(new ForbiddenError('bad_origin', 'Request origin not allowed'));
    const header = req.get('x-csrf-token') ?? '';
    const cookie = req.cookies?.[names.csrf] ?? '';
    if (!header || !cookie || !safeEqual(header, cookie))
      return next(new ForbiddenError('csrf_failed', 'Security check failed. Reload the page.'));
    next();
  };
}
