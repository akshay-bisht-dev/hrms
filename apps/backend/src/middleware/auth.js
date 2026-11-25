// @ts-check
import { currentContext } from '../lib/context.js';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import { markAccess } from '../lib/route-registry.js';
import { loadAccess, isSensitivePermission } from '../modules/rbac/access.js';

export const REVOKED_SESSION_KEY = (/** @type {string} */ sid) => `sess:revoked:${sid}`;

/**
 * @typedef {object} AuthDeps
 * @property {ReturnType<typeof import('../modules/auth/jwt.js').createJwtService>} jwt
 * @property {() => any} platformDb
 * @property {import('ioredis').Redis} [redis]
 * @property {boolean} mfaEnforce
 */

/**
 * Verifies the bearer access token and loads the caller's tenant access into the request context.
 * A revoked session is rejected immediately even though its access token hasn't expired (Phase 3, AUTH-12).
 * @param {AuthDeps} deps
 * @returns {import('express').RequestHandler}
 */
export function authenticate({ jwt, platformDb, redis }) {
  return async (req, _res, next) => {
    try {
      const header = req.get('authorization') ?? '';
      const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(header);
      if (!match) throw new UnauthorizedError();
      let claims;
      try {
        claims = await jwt.verify(match[1], 'web');
      } catch {
        throw new UnauthorizedError('invalid_token', 'Your session has expired. Sign in again.');
      }
      const { sub, tid, sid } = /** @type {{ sub: string, tid: string, sid: string }} */ (
        /** @type {unknown} */ (claims)
      );
      if (!sub || !tid || !sid)
        throw new UnauthorizedError('invalid_token', 'Your session has expired. Sign in again.');
      if (redis && (await redis.exists(REVOKED_SESSION_KEY(sid)))) {
        throw new UnauthorizedError('session_revoked', 'This session was signed out. Sign in again.');
      }
      const access = await loadAccess({ db: platformDb(), redis, tenantId: tid, userId: sub });
      if (!access || access.status !== 'ACTIVE')
        throw new UnauthorizedError('membership_inactive', 'Your access to this company is not active');
      const ctx = currentContext();
      if (!ctx) throw new Error('Request context missing');
      Object.assign(ctx, {
        userId: sub,
        tenantId: tid,
        sessionId: sid,
        membershipId: access.membershipId,
        permissions: new Map(Object.entries(access.permissions)),
        mfa: claims.mfa === true,
        access,
      });
      next();
    } catch (e) {
      next(e);
    }
  };
}

/**
 * Route access declaration. 'authenticated' needs a valid session; a permission code also needs that grant.
 * Sensitive permissions additionally need an MFA-verified session when enforcement is on (Phase 3, AUTH-07).
 * @param {AuthDeps} deps
 */
export function access(deps) {
  const authn = authenticate(deps);
  return {
    public: () => markAccess((_req, _res, next) => next(), 'public'),
    authenticated: () => markAccess(authn, 'authenticated'),
    /** @param {string} permission */
    permission(permission) {
      return markAccess((req, res, next) => {
        authn(req, res, (err) => {
          if (err) return next(err);
          const ctx = /** @type {any} */ (currentContext());
          const scope = ctx.permissions.get(permission);
          if (!scope) return next(new ForbiddenError());
          if (deps.mfaEnforce && isSensitivePermission(permission) && !ctx.mfa) {
            return next(
              new ForbiddenError('mfa_required', 'Turn on two-step verification to use this feature'),
            );
          }
          /** @type {any} */ (req).scope = scope;
          next();
        });
      }, permission);
    },
  };
}
