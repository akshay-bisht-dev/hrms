// @ts-check
import { Router } from 'express';
import {
  ChangePasswordBody,
  EmailBody,
  LoginBody,
  MfaConfirmBody,
  MfaDisableBody,
  MfaVerifyBody,
  PasswordConfirmBody,
  RegisterBody,
  ResetPasswordBody,
  TokenBody,
} from '@hrms/shared/schemas/auth';
import { AcceptInviteBody, SwitchTenantBody } from '@hrms/shared/schemas/members';
import { clearSessionCookies, cookieNames, requireCsrf, setSessionCookies } from '../../lib/cookies.js';
import { currentContext } from '../../lib/context.js';
import { validate } from '../../middleware/validate.js';
import { ipRateLimit } from '../../middleware/rate-limit.js';
import { registry, z } from '../../openapi/registry.js';

/** @param {import('express').Request} req */
const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') ?? undefined });
/** @returns {any} */
const who = () => currentContext();

const AccessTokenResponse = registry.register(
  'AccessToken',
  z.object({ accessToken: z.string(), expiresIn: z.number().int(), mfaRequired: z.literal(false) }),
);
const MfaChallengeResponse = registry.register(
  'MfaChallenge',
  z.object({ mfaRequired: z.literal(true), challengeToken: z.string() }),
);
const Accepted = z.object({ message: z.string() });

/** @param {string} path @param {'get'|'post'|'delete'} method @param {string} summary @param {object} [extra] */
const doc = (path, method, summary, extra = {}) =>
  registry.registerPath({
    method,
    path: `/api/v1/auth${path}`,
    tags: ['Auth'],
    summary,
    responses: { 200: { description: 'OK' } },
    ...extra,
  });

doc('/register', 'post', 'Create a user and company. Always 202 (does not reveal existing emails).', {
  request: { body: { content: { 'application/json': { schema: RegisterBody } } } },
  responses: {
    202: { description: 'Check your email', content: { 'application/json': { schema: Accepted } } },
    422: { description: 'Invalid input' },
  },
});
doc('/verify-email', 'post', 'Confirm the email address with the emailed token', {
  request: { body: { content: { 'application/json': { schema: TokenBody } } } },
});
doc('/resend-verification', 'post', 'Send the verification email again. Always 202.', {
  request: { body: { content: { 'application/json': { schema: EmailBody } } } },
});
doc(
  '/login',
  'post',
  'Password step. Returns an access token and sets the refresh cookie, or an MFA challenge.',
  {
    request: { body: { content: { 'application/json': { schema: LoginBody } } } },
    responses: {
      200: {
        description: 'Signed in or MFA required',
        content: { 'application/json': { schema: z.union([AccessTokenResponse, MfaChallengeResponse]) } },
      },
      401: { description: 'Email or password is incorrect' },
      403: { description: 'Email not verified' },
      429: { description: 'Too many attempts' },
    },
  },
);
doc('/mfa/verify', 'post', 'MFA step of sign-in (TOTP or recovery code)', {
  request: { body: { content: { 'application/json': { schema: MfaVerifyBody } } } },
});
doc(
  '/refresh',
  'post',
  'Rotate the refresh cookie and get a new access token. Needs X-CSRF-Token and an allowed Origin.',
);
doc('/logout', 'post', 'End this session. Needs X-CSRF-Token and an allowed Origin.');
doc('/logout-all', 'post', 'End every session of the current user');
doc('/forgot-password', 'post', 'Email a reset link. Always 202.', {
  request: { body: { content: { 'application/json': { schema: EmailBody } } } },
});
doc('/reset-password', 'post', 'Set a new password with the emailed token; signs out all sessions', {
  request: { body: { content: { 'application/json': { schema: ResetPasswordBody } } } },
});
doc('/password', 'post', 'Change password (current password required); signs out other sessions', {
  request: { body: { content: { 'application/json': { schema: ChangePasswordBody } } } },
});
doc('/me', 'get', 'Current user, company, roles, permissions and MFA state');
doc('/sessions', 'get', 'Active sessions of the current user');
doc('/sessions/{id}', 'delete', 'Sign out one session', {
  request: { params: z.object({ id: z.string() }) },
});
doc('/mfa/setup', 'post', 'Start authenticator-app enrolment (password required)', {
  request: { body: { content: { 'application/json': { schema: PasswordConfirmBody } } } },
});
doc('/mfa/confirm', 'post', 'Finish enrolment with a first code; returns recovery codes once', {
  request: { body: { content: { 'application/json': { schema: MfaConfirmBody } } } },
});
doc('/memberships', 'get', 'Companies the current user belongs to');
doc('/switch-tenant', 'post', 'Switch to another company (new session for it; MFA state carries over)', {
  request: { body: { content: { 'application/json': { schema: SwitchTenantBody } } } },
});
doc('/invite-info', 'post', 'Company and email of an invitation, and whether a password must be set');
doc('/accept-invite', 'post', 'Accept an invitation (new people set name and password)', {
  request: { body: { content: { 'application/json': { schema: AcceptInviteBody } } } },
});
doc('/mfa/disable', 'post', 'Turn off two-step verification (not allowed for roles that require it)', {
  request: { body: { content: { 'application/json': { schema: MfaDisableBody } } } },
});

/**
 * @param {object} deps
 * @param {ReturnType<typeof import('./auth.service.js').createAuthService>} deps.auth
 * @param {ReturnType<typeof import('../../middleware/auth.js').access>} deps.access
 * @param {Readonly<import('../../config/env.js').Env>} deps.env
 * @param {boolean} deps.secureCookies
 * @param {string[]} deps.allowedOrigins
 * @param {import('ioredis').Redis} [deps.redis]
 */
export function authRouter({ auth, access, env, secureCookies, allowedOrigins, redis }) {
  const r = Router();
  const csrf = requireCsrf({ secure: secureCookies, allowedOrigins });
  const strict = ipRateLimit({ redis, name: 'auth-strict', windowSec: 60, limit: env.AUTH_IP_LIMIT_PER_MIN }); // login, register, MFA
  const email = ipRateLimit({
    redis,
    name: 'auth-email',
    windowSec: 3600,
    limit: env.AUTH_EMAIL_IP_LIMIT_PER_HOUR,
  }); // sends email
  const names = cookieNames(secureCookies);
  const accepted = { message: 'If the details are valid, we have sent an email with the next step.' };

  /** @param {import('express').Response} res @param {{ accessToken: string, refreshToken: string, refreshMaxAgeSec: number }} s */
  const sendSession = (res, s) => {
    setSessionCookies(res, {
      secure: secureCookies,
      refreshToken: s.refreshToken,
      maxAgeSec: s.refreshMaxAgeSec,
    });
    res
      .set('Cache-Control', 'no-store')
      .json({ mfaRequired: false, accessToken: s.accessToken, expiresIn: env.ACCESS_TOKEN_TTL_SEC });
  };

  r.post('/register', access.public(), strict, email, validate({ body: RegisterBody }), async (req, res) => {
    await auth.register(req.body, meta(req));
    res.status(202).json(accepted);
  });
  r.post('/verify-email', access.public(), strict, validate({ body: TokenBody }), async (req, res) => {
    await auth.verifyEmail(req.body.token, meta(req));
    res.json({ message: 'Email confirmed. You can sign in now.' });
  });
  r.post('/resend-verification', access.public(), email, validate({ body: EmailBody }), async (req, res) => {
    await auth.resendVerification(req.body.email);
    res.status(202).json(accepted);
  });
  r.post('/login', access.public(), strict, validate({ body: LoginBody }), async (req, res) => {
    const result = await auth.login(req.body, meta(req));
    if (result.mfaRequired)
      return res
        .set('Cache-Control', 'no-store')
        .json({ mfaRequired: true, challengeToken: result.challengeToken });
    sendSession(res, /** @type {any} */ (result));
  });
  r.post('/mfa/verify', access.public(), strict, validate({ body: MfaVerifyBody }), async (req, res) => {
    sendSession(res, /** @type {any} */ (await auth.verifyMfaChallenge(req.body, meta(req))));
  });
  r.post('/refresh', access.public(), csrf, async (req, res) => {
    try {
      sendSession(res, await auth.refresh(req.cookies?.[names.refresh], meta(req)));
    } catch (err) {
      clearSessionCookies(res, secureCookies);
      throw err;
    }
  });
  r.post('/logout', access.public(), csrf, async (req, res) => {
    await auth.logoutByRefreshToken(req.cookies?.[names.refresh]);
    clearSessionCookies(res, secureCookies);
    res.status(204).end();
  });
  r.post('/logout-all', access.authenticated(), async (_req, res) => {
    const c = who();
    await auth.logoutAll(c.userId, c.sessionId);
    clearSessionCookies(res, secureCookies);
    res.status(204).end();
  });
  r.post('/forgot-password', access.public(), email, validate({ body: EmailBody }), async (req, res) => {
    await auth.forgotPassword(req.body.email);
    res.status(202).json(accepted);
  });
  r.post(
    '/reset-password',
    access.public(),
    strict,
    validate({ body: ResetPasswordBody }),
    async (req, res) => {
      await auth.resetPassword(req.body, meta(req));
      clearSessionCookies(res, secureCookies);
      res.json({ message: 'Your password has been changed. Sign in with your new password.' });
    },
  );
  r.post(
    '/password',
    access.authenticated(),
    strict,
    validate({ body: ChangePasswordBody }),
    async (req, res) => {
      const c = who();
      await auth.changePassword(c.userId, c.sessionId, req.body);
      res.json({ message: 'Password changed. Other sessions were signed out.' });
    },
  );
  r.get('/me', access.authenticated(), async (_req, res) => {
    const c = who();
    res.set('Cache-Control', 'no-store').json(await auth.me(c.userId, c.tenantId, c.mfa));
  });
  r.get('/sessions', access.authenticated(), async (_req, res) => {
    const c = who();
    res.set('Cache-Control', 'no-store').json({ data: await auth.listSessions(c.userId, c.sessionId) });
  });
  r.delete(
    '/sessions/:id',
    access.authenticated(),
    validate({ params: z.object({ id: z.uuid() }) }),
    async (req, res) => {
      await auth.revokeSession(who().userId, req.params.id);
      res.status(204).end();
    },
  );
  r.post(
    '/mfa/setup',
    access.authenticated(),
    strict,
    validate({ body: PasswordConfirmBody }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store').json(await auth.mfaSetup(who().userId, req.body.password));
    },
  );
  r.post(
    '/mfa/confirm',
    access.authenticated(),
    strict,
    validate({ body: MfaConfirmBody }),
    async (req, res) => {
      const c = who();
      const out = await auth.mfaConfirm(
        { userId: c.userId, tenantId: c.tenantId, sessionId: c.sessionId },
        req.body.code,
      );
      res.set('Cache-Control', 'no-store').json({ ...out, expiresIn: env.ACCESS_TOKEN_TTL_SEC });
    },
  );
  r.post(
    '/mfa/disable',
    access.authenticated(),
    strict,
    validate({ body: MfaDisableBody }),
    async (req, res) => {
      const c = who();
      const out = await auth.mfaDisable(
        { userId: c.userId, tenantId: c.tenantId, sessionId: c.sessionId },
        req.body,
      );
      res.set('Cache-Control', 'no-store').json({ ...out, expiresIn: env.ACCESS_TOKEN_TTL_SEC });
    },
  );
  r.get('/memberships', access.authenticated(), async (_req, res) => {
    const c = who();
    res.set('Cache-Control', 'no-store').json({ data: await auth.listMemberships(c.userId, c.tenantId) });
  });
  r.post('/switch-tenant', access.authenticated(), validate({ body: SwitchTenantBody }), async (req, res) => {
    const c = who();
    sendSession(
      res,
      await auth.switchTenant(
        { userId: c.userId, sessionId: c.sessionId, mfa: c.mfa },
        req.body.tenantId,
        meta(req),
      ),
    );
  });
  r.post(
    '/invite-info',
    access.public(),
    strict,
    validate({ body: z.object({ token: z.string().min(20).max(2048) }).strict() }),
    async (req, res) => {
      const info = await auth.inviteInfo(req.body.token);
      res
        .set('Cache-Control', 'no-store')
        .json({ companyName: info.companyName, email: info.email, needsPassword: info.needsPassword });
    },
  );
  r.post(
    '/accept-invite',
    access.public(),
    strict,
    validate({ body: AcceptInviteBody.extend({ token: z.string().min(20).max(2048) }) }),
    async (req, res) => {
      res.json(await auth.acceptInvite(req.body, meta(req)));
    },
  );
  return r;
}
