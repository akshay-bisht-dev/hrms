// @ts-check
import { newId } from '@hrms/shared/ids';
import { DEFAULT_ROLES } from '@hrms/shared/roles';
import { appUrl } from '../../config/env.js';
import { audit } from '../../lib/audit.js';
import { hmacHex, randomToken, sha256Hex } from '../../lib/crypto.js';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  TooManyRequestsError,
  UnauthorizedError,
  ValidationError,
} from '../../lib/errors.js';
import { REVOKED_SESSION_KEY } from '../../middleware/auth.js';
import { invalidateAccess, loadAccess } from '../rbac/access.js';
import {
  hashPassword,
  isBreachedPassword,
  needsRehash,
  passwordPolicyProblem,
  verifyAgainstDummy,
  verifyPassword,
} from './password.js';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp.js';

const VERIFY_TTL_SEC = 24 * 3600;
const RESET_TTL_SEC = 30 * 60;
const MFA_CHALLENGE_TTL_SEC = 300;
const MFA_CHALLENGE_MAX_ATTEMPTS = 5;
const LOGIN_FAILS_BEFORE_LOCK = 10;
const LOGIN_FAIL_WINDOW_SEC = 3600;
const LOCK_SEC = 15 * 60;
const RECOVERY_CODES = 10;

const GENERIC_LOGIN_ERROR = () =>
  new UnauthorizedError('invalid_credentials', 'Email or password is incorrect');

/**
 * @typedef {{ ip?: string, userAgent?: string }} Meta
 * @typedef {{ refreshToken: string, refreshMaxAgeSec: number }} CookieResult
 */

/**
 * Authentication flows (Phase 3, AUTH-01 … AUTH-13). Platform-level tables (users, tokens) are accessed with the
 * unscoped client; tenant tables touched during registration are written inside one transaction with explicit tenantId.
 * @param {object} deps
 * @param {Readonly<import('../../config/env.js').Env>} deps.env
 * @param {() => any} deps.platformDb
 * @param {ReturnType<typeof import('./jwt.js').createJwtService>} deps.jwt
 * @param {import('ioredis').Redis} deps.redis
 * @param {{ notifications: import('bullmq').Queue }} deps.queues
 * @param {ReturnType<typeof import('../../lib/crypto.js').createCipher>} deps.cipher
 * @param {import('pino').Logger} deps.logger
 * @param {(password: string) => Promise<boolean>} [deps.breachCheck]
 */
export function createAuthService({ env, platformDb, jwt, redis, queues, cipher, logger, breachCheck }) {
  const db = () => platformDb();
  const pepper = env.JWT_REFRESH_PEPPER;
  const hashToken = (/** @type {string} */ t) => hmacHex(pepper, t);
  const emailKey = (/** @type {string} */ email) => sha256Hex(`login:${email}`);
  const checkBreach =
    breachCheck ?? (env.PASSWORD_BREACH_CHECK === 'hibp' ? isBreachedPassword : async () => false);

  /** @param {import('../../lib/queues.js').EmailJob} job */
  const sendEmail = (job) => queues.notifications.add('email', job);

  /** @param {string} password @param {{ email?: string, companyName?: string }} ctx */
  async function assertAcceptablePassword(password, ctx) {
    const problem = passwordPolicyProblem(password, ctx);
    if (problem) throw new ValidationError([{ path: 'body.password', message: problem }]);
    let breached = false;
    try {
      breached = await checkBreach(password);
    } catch (err) {
      logger.warn({ err }, 'Breached-password check unavailable; continuing');
    }
    if (breached) {
      throw new ValidationError([
        {
          path: 'body.password',
          message: 'This password has appeared in a data breach. Choose a different one.',
        },
      ]);
    }
  }

  /** @param {string} userId @param {'EMAIL_VERIFY'|'PASSWORD_RESET'} purpose @param {number} ttlSec */
  async function createOneTimeToken(userId, purpose, ttlSec) {
    const token = randomToken(32);
    await db().authToken.deleteMany({ where: { userId, purpose, usedAt: null } }); // one live token per purpose
    await db().authToken.create({
      data: {
        id: newId(),
        userId,
        purpose,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + ttlSec * 1000),
      },
    });
    return token;
  }

  /** Atomically consumes a one-time token. @param {string} token @param {'EMAIL_VERIFY'|'PASSWORD_RESET'} purpose */
  async function consumeOneTimeToken(token, purpose) {
    const row = await db().authToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt < new Date()) return null;
    const { count } = await db().authToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return count === 1 ? row : null;
  }

  // ── Sessions (refresh-token families) ────────────────────────────────────────

  /**
   * Starts a session: a new refresh-token family plus an access token.
   * @param {{ userId: string, tenantId: string, mfa: boolean, meta: Meta }} a
   */
  async function startSession({ userId, tenantId, mfa, meta }) {
    const familyId = newId();
    const refreshToken = randomToken(32);
    const now = Date.now();
    await db().refreshToken.create({
      data: {
        id: newId(),
        userId,
        tenantId,
        familyId,
        tokenHash: hashToken(refreshToken),
        userAgent: meta.userAgent?.slice(0, 255) ?? null,
        ipAddress: meta.ip?.slice(0, 45) ?? null,
        expiresAt: new Date(now + env.REFRESH_ABSOLUTE_TTL_SEC * 1000),
        idleExpiresAt: new Date(now + env.REFRESH_IDLE_TTL_SEC * 1000),
      },
    });
    // The family remembers whether it was MFA-verified, so refreshed access tokens keep that claim.
    if (mfa) await redis.set(`sess:mfa:${familyId}`, '1', 'EX', env.REFRESH_ABSOLUTE_TTL_SEC);
    const accessToken = await issueAccessToken({ userId, tenantId, sessionId: familyId, mfa });
    return { accessToken, refreshToken, sessionId: familyId, refreshMaxAgeSec: env.REFRESH_ABSOLUTE_TTL_SEC };
  }

  /** @param {{ userId: string, tenantId: string, sessionId: string, mfa: boolean }} a */
  function issueAccessToken({ userId, tenantId, sessionId, mfa }) {
    return jwt.sign(
      { tid: tenantId, sid: sessionId, mfa },
      { subject: userId, audience: 'web', ttlSec: env.ACCESS_TOKEN_TTL_SEC },
    );
  }

  /** @param {string} familyId @param {string} reason */
  async function revokeFamily(familyId, reason) {
    await db().refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
    // Access tokens are stateless; this marker rejects them until they would have expired anyway.
    await redis.set(REVOKED_SESSION_KEY(familyId), reason, 'EX', env.ACCESS_TOKEN_TTL_SEC + 60);
    await redis.del(`sess:mfa:${familyId}`);
  }

  /** @param {string} userId @param {string} reason @param {string} [exceptFamilyId] */
  async function revokeAllSessions(userId, reason, exceptFamilyId) {
    const rows = await db().refreshToken.findMany({
      where: { userId, revokedAt: null, ...(exceptFamilyId ? { familyId: { not: exceptFamilyId } } : {}) },
      select: { familyId: true },
      distinct: ['familyId'],
    });
    for (const { familyId } of rows) await revokeFamily(familyId, reason);
    return rows.length;
  }

  /** @param {any} user */
  const publicUser = (user, mfaEnabled = false) => ({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    locale: user.locale,
    timezone: user.timezone,
    emailVerified: Boolean(user.emailVerifiedAt),
    mfaEnabled,
  });

  /** @param {string} userId */
  const hasConfirmedMfa = async (userId) =>
    (await db().mfaFactor.count({ where: { userId, confirmedAt: { not: null } } })) > 0;

  return {
    // ── Registration & verification ─────────────────────────────────────────────

    /**
     * Creates the user, the company (tenant), its first legal entity, the default roles and a Company Admin membership.
     * Responds identically whether or not the email is already registered (Phase 3, AUTH-03).
     * @param {import('zod').infer<typeof import('@hrms/shared/schemas/auth').RegisterBody>} input @param {Meta} meta
     */
    async register(input, meta) {
      const existing = await db().user.findUnique({ where: { email: input.email } });
      if (existing) {
        await sendEmail({
          template: 'account-exists',
          to: input.email,
          data: { loginUrl: `${appUrl(env)}/login`, resetUrl: `${appUrl(env)}/forgot-password` },
        });
        return;
      }
      const country = await db().countryProfile.findUnique({ where: { code: input.countryCode } });
      if (!country)
        throw new ValidationError([
          { path: 'body.countryCode', message: 'This country is not supported yet' },
        ]);
      await assertAcceptablePassword(input.password, { email: input.email, companyName: input.companyName });

      const passwordHash = await hashPassword(input.password);
      const plan = await db().plan.findUnique({ where: { code: 'growth' } });
      const timezone = input.timezone ?? 'UTC';
      const userId = newId();
      const tenantId = newId();
      const slugBase =
        input.companyName
          .toLowerCase()
          .normalize('NFKD')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40) || 'company';
      const slug = `${slugBase}-${randomToken(4)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, 'x')
        .slice(0, 5)}`;

      await db().$transaction(async (/** @type {any} */ tx) => {
        await tx.user.create({
          data: { id: userId, email: input.email, passwordHash, displayName: input.fullName, timezone },
        });
        await tx.tenant.create({
          data: {
            id: tenantId,
            slug,
            name: input.companyName,
            status: 'TRIAL',
            region: env.CELL_REGION,
            countryCode: country.code,
            defaultCurrency: country.defaultCurrency,
            defaultLocale: country.defaultLocale,
            timezone,
            planId: plan?.id ?? null,
            trialEndsAt: new Date(Date.now() + env.TRIAL_DAYS * 86400_000),
          },
        });
        await tx.legalEntity.create({
          data: {
            id: newId(),
            tenantId,
            name: input.companyName,
            countryCode: country.code,
            currency: country.defaultCurrency,
            weekendDays: country.weekendDays,
            timezone,
          },
        });
        let adminRoleId = '';
        for (const role of DEFAULT_ROLES) {
          const roleId = newId();
          if (role.key === 'company_admin') adminRoleId = roleId;
          await tx.role.create({
            data: {
              id: roleId,
              tenantId,
              name: role.name,
              description: role.description,
              isSystem: true,
              systemKey: role.key,
            },
          });
          await tx.rolePermission.createMany({
            data: role.grants.map(([permissionCode, scope]) => ({ tenantId, roleId, permissionCode, scope })),
          });
        }
        const membershipId = newId();
        await tx.tenantMembership.create({
          data: { id: membershipId, tenantId, userId, status: 'ACTIVE', joinedAt: new Date() },
        });
        await tx.membershipRole.create({ data: { tenantId, membershipId, roleId: adminRoleId } });
        await audit(tx, {
          tenantId,
          actorUserId: userId,
          action: 'tenant.registered',
          entityType: 'Tenant',
          entityId: tenantId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      });

      const token = await createOneTimeToken(userId, 'EMAIL_VERIFY', VERIFY_TTL_SEC);
      await sendEmail({
        template: 'verify-email',
        to: input.email,
        data: { name: input.fullName, url: `${appUrl(env)}/verify-email?token=${token}` },
      });
    },

    /** @param {string} token @param {Meta} meta */
    async verifyEmail(token, meta) {
      const row = await consumeOneTimeToken(token, 'EMAIL_VERIFY');
      if (!row)
        throw new AppError(400, 'invalid_token', 'This link is invalid or has expired. Request a new one.');
      await db().user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } });
      await audit(db(), {
        tenantId: null,
        actorUserId: row.userId,
        action: 'user.email_verified',
        entityType: 'User',
        entityId: row.userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    },

    /** Always succeeds from the caller's view. @param {string} email */
    async resendVerification(email) {
      const user = await db().user.findUnique({ where: { email } });
      if (!user || user.emailVerifiedAt) return;
      const token = await createOneTimeToken(user.id, 'EMAIL_VERIFY', VERIFY_TTL_SEC);
      await sendEmail({
        template: 'verify-email',
        to: user.email,
        data: { name: user.displayName, url: `${appUrl(env)}/verify-email?token=${token}` },
      });
    },

    // ── Login ───────────────────────────────────────────────────────────────────

    /**
     * Password step. Lockout counters are keyed by a hash of the email, so known and unknown accounts behave the same.
     * @param {{ email: string, password: string }} input @param {Meta} meta
     */
    async login({ email, password }, meta) {
      const k = emailKey(email);
      const lockTtl = await redis.ttl(`auth:lock:${k}`);
      if (lockTtl > 0) throw new TooManyRequestsError(lockTtl);

      const user = await db().user.findUnique({ where: { email } });
      const ok =
        user?.passwordHash && user.status === 'ACTIVE'
          ? await verifyPassword(user.passwordHash, password)
          : await verifyAgainstDummy();
      if (!ok || !user) {
        const fails = await redis.incr(`auth:fail:${k}`);
        if (fails === 1) await redis.expire(`auth:fail:${k}`, LOGIN_FAIL_WINDOW_SEC);
        if (fails >= LOGIN_FAILS_BEFORE_LOCK) {
          await redis.set(`auth:lock:${k}`, '1', 'EX', LOCK_SEC);
          await redis.del(`auth:fail:${k}`);
          if (user) {
            await db().user.update({
              where: { id: user.id },
              data: {
                failedLoginCount: { increment: 1 },
                lockedUntil: new Date(Date.now() + LOCK_SEC * 1000),
              },
            });
            await sendEmail({
              template: 'account-locked',
              to: user.email,
              data: {
                name: user.displayName,
                minutes: String(LOCK_SEC / 60),
                resetUrl: `${appUrl(env)}/forgot-password`,
              },
            });
          }
        } else if (user) {
          await db().user.update({ where: { id: user.id }, data: { failedLoginCount: { increment: 1 } } });
        }
        if (user)
          await audit(db(), {
            tenantId: null,
            actorUserId: user.id,
            action: 'auth.login_failed',
            entityType: 'User',
            entityId: user.id,
            ip: meta.ip,
            userAgent: meta.userAgent,
          });
        throw GENERIC_LOGIN_ERROR();
      }

      await redis.del(`auth:fail:${k}`);
      if (!user.emailVerifiedAt)
        throw new ForbiddenError(
          'email_not_verified',
          'Verify your email address to sign in. We can send the link again.',
        );
      if (needsRehash(user.passwordHash))
        await db().user.update({
          where: { id: user.id },
          data: { passwordHash: await hashPassword(password) },
        });

      const membership = await db().tenantMembership.findFirst({
        where: {
          userId: user.id,
          status: 'ACTIVE',
          tenant: { status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } },
        },
        orderBy: { joinedAt: 'asc' },
      });
      if (!membership)
        throw new ForbiddenError('no_active_membership', 'Your account is not linked to an active company');

      if (await hasConfirmedMfa(user.id)) {
        const challengeToken = await jwt.sign(
          { tid: membership.tenantId, purpose: 'mfa' },
          { subject: user.id, audience: 'mfa-challenge', ttlSec: MFA_CHALLENGE_TTL_SEC },
        );
        return { mfaRequired: true, challengeToken };
      }
      return this.completeLogin(user, membership.tenantId, false, meta);
    },

    /** @param {any} user @param {string} tenantId @param {boolean} mfa @param {Meta} meta */
    async completeLogin(user, tenantId, mfa, meta) {
      await db().user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null },
      });
      const session = await startSession({ userId: user.id, tenantId, mfa, meta });
      await audit(db(), {
        tenantId,
        actorUserId: user.id,
        action: 'auth.login',
        entityType: 'Session',
        entityId: session.sessionId,
        changes: { mfa },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return { mfaRequired: false, ...session };
    },

    /**
     * MFA step of login: TOTP (with replay protection) or a single-use recovery code.
     * @param {{ challengeToken: string, code?: string, recoveryCode?: string }} input @param {Meta} meta
     */
    async verifyMfaChallenge({ challengeToken, code, recoveryCode }, meta) {
      let claims;
      try {
        claims = await jwt.verify(challengeToken, 'mfa-challenge');
      } catch {
        throw new UnauthorizedError('challenge_expired', 'Your sign-in took too long. Start again.');
      }
      const jti = String(claims.jti);
      const attempts = await redis.incr(`mfa:attempts:${jti}`);
      if (attempts === 1) await redis.expire(`mfa:attempts:${jti}`, MFA_CHALLENGE_TTL_SEC);
      if (attempts > MFA_CHALLENGE_MAX_ATTEMPTS) throw new TooManyRequestsError(MFA_CHALLENGE_TTL_SEC);

      const userId = String(claims.sub);
      const user = await db().user.findUnique({ where: { id: userId } });
      if (!user || user.status !== 'ACTIVE')
        throw new UnauthorizedError('challenge_expired', 'Start signing in again.');

      let verified = false;
      if (code) {
        const factor = await db().mfaFactor.findFirst({
          where: { userId, type: 'TOTP', confirmedAt: { not: null } },
        });
        if (factor) {
          const secret = cipher.decrypt(factor.secretEnc, userId);
          const result = verifyTotp({ secret, code, lastUsedStep: factor.lastUsedStep });
          if (result.ok) {
            // Conditional update closes the race where the same code is submitted twice concurrently.
            const { count } = await db().mfaFactor.updateMany({
              where: {
                id: factor.id,
                OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(result.step) } }],
              },
              data: { lastUsedStep: BigInt(result.step) },
            });
            verified = count === 1;
          }
        }
      } else if (recoveryCode) {
        const { count } = await db().recoveryCode.updateMany({
          where: { userId, codeHash: hashToken(recoveryCode), usedAt: null },
          data: { usedAt: new Date() },
        });
        verified = count === 1;
        if (verified)
          await audit(db(), {
            tenantId: null,
            actorUserId: userId,
            action: 'auth.recovery_code_used',
            entityType: 'User',
            entityId: userId,
            ip: meta.ip,
            userAgent: meta.userAgent,
          });
      }
      if (!verified)
        throw new UnauthorizedError(
          'invalid_code',
          "That code didn't work. Check your authenticator app and try again.",
        );

      // A challenge can complete only once.
      const firstUse = await redis.set(`mfa:used:${jti}`, '1', 'EX', MFA_CHALLENGE_TTL_SEC, 'NX');
      if (!firstUse) throw new UnauthorizedError('challenge_expired', 'Start signing in again.');
      return this.completeLogin(user, String(claims.tid), true, meta);
    },

    // ── Refresh & logout ────────────────────────────────────────────────────────

    /**
     * Rotates the refresh token. Presenting an already-rotated token revokes the whole family (theft detection, AUTH-09).
     * @param {string | undefined} refreshToken @param {Meta} meta
     */
    async refresh(refreshToken, meta) {
      if (!refreshToken) throw new UnauthorizedError('no_session', 'Sign in to continue');
      const tokenHash = hashToken(refreshToken);
      const now = new Date();
      const result = await db().$transaction(async (/** @type {any} */ tx) => {
        const rows =
          await tx.$queryRaw`SELECT id FROM refresh_tokens WHERE token_hash = ${tokenHash} FOR UPDATE`;
        if (!rows.length) return { error: 'no_session' };
        const row = await tx.refreshToken.findUnique({ where: { id: rows[0].id } });
        if (row.revokedAt) return { error: 'no_session' };
        if (row.rotatedAt) return { error: 'reuse', row };
        if (row.expiresAt <= now || row.idleExpiresAt <= now) return { error: 'expired', row };
        const membership = await tx.tenantMembership.findUnique({
          where: { tenantId_userId: { tenantId: row.tenantId, userId: row.userId } },
        });
        if (!membership || membership.status !== 'ACTIVE') return { error: 'inactive', row };
        const next = randomToken(32);
        await tx.refreshToken.update({ where: { id: row.id }, data: { rotatedAt: now } });
        await tx.refreshToken.create({
          data: {
            id: newId(),
            userId: row.userId,
            tenantId: row.tenantId,
            familyId: row.familyId,
            tokenHash: hashToken(next),
            userAgent: meta.userAgent?.slice(0, 255) ?? row.userAgent,
            ipAddress: meta.ip?.slice(0, 45) ?? row.ipAddress,
            expiresAt: row.expiresAt, // absolute lifetime is fixed when the session starts
            idleExpiresAt: new Date(
              Math.min(now.getTime() + env.REFRESH_IDLE_TTL_SEC * 1000, row.expiresAt.getTime()),
            ),
          },
        });
        return { row, next };
      });

      if (result.error) {
        if (result.row)
          await revokeFamily(result.row.familyId, result.error === 'reuse' ? 'reuse_detected' : result.error);
        if (result.error === 'reuse') {
          logger.warn(
            { userId: result.row.userId, familyId: result.row.familyId },
            'Refresh token reuse detected; session revoked',
          );
          await audit(db(), {
            tenantId: result.row.tenantId,
            actorUserId: result.row.userId,
            action: 'auth.refresh_reuse_detected',
            entityType: 'Session',
            entityId: result.row.familyId,
            ip: meta.ip,
            userAgent: meta.userAgent,
          });
        }
        throw new UnauthorizedError('no_session', 'Your session has ended. Sign in again.');
      }
      const { row, next } = result;
      const mfa = (await redis.exists(`sess:mfa:${row.familyId}`)) === 1;
      const accessToken = await issueAccessToken({
        userId: row.userId,
        tenantId: row.tenantId,
        sessionId: row.familyId,
        mfa,
      });
      return {
        accessToken,
        refreshToken: next,
        refreshMaxAgeSec: Math.max(1, Math.floor((row.expiresAt.getTime() - now.getTime()) / 1000)),
      };
    },

    /** Ends the session identified by a refresh cookie (works even when the access token has expired). @param {string | undefined} refreshToken */
    async logoutByRefreshToken(refreshToken) {
      if (!refreshToken) return;
      const row = await db().refreshToken.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
      if (row) await revokeFamily(row.familyId, 'logout');
    },

    /** @param {string} userId @param {string} currentSessionId */
    async logoutAll(userId, currentSessionId) {
      const n = await revokeAllSessions(userId, 'logout_all');
      await audit(db(), {
        actorUserId: userId,
        action: 'auth.logout_all',
        entityType: 'Session',
        entityId: currentSessionId,
        changes: { sessions: n },
      });
    },

    // ── Password reset & change ─────────────────────────────────────────────────

    /** Always succeeds from the caller's view. @param {string} email */
    async forgotPassword(email) {
      const user = await db().user.findUnique({ where: { email } });
      if (!user || user.status !== 'ACTIVE') return;
      const token = await createOneTimeToken(user.id, 'PASSWORD_RESET', RESET_TTL_SEC);
      await sendEmail({
        template: 'reset-password',
        to: user.email,
        data: {
          name: user.displayName,
          url: `${appUrl(env)}/reset-password?token=${token}`,
          minutes: String(RESET_TTL_SEC / 60),
        },
      });
    },

    /** Resets the password and signs out every session (AUTH-11). @param {{ token: string, password: string }} input @param {Meta} meta */
    async resetPassword({ token, password }, meta) {
      const row = await db().authToken.findUnique({ where: { tokenHash: hashToken(token) } });
      if (!row || row.purpose !== 'PASSWORD_RESET' || row.usedAt || row.expiresAt < new Date()) {
        throw new AppError(400, 'invalid_token', 'This link is invalid or has expired. Request a new one.');
      }
      const user = await db().user.findUnique({ where: { id: row.userId } });
      await assertAcceptablePassword(password, { email: user.email });
      const consumed = await consumeOneTimeToken(token, 'PASSWORD_RESET');
      if (!consumed)
        throw new AppError(400, 'invalid_token', 'This link is invalid or has expired. Request a new one.');
      // A reset proves control of the mailbox, so it also confirms the email address.
      await db().user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(password),
          emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await redis.del(`auth:lock:${emailKey(user.email)}`, `auth:fail:${emailKey(user.email)}`);
      await revokeAllSessions(user.id, 'password_reset');
      await audit(db(), {
        tenantId: null,
        actorUserId: user.id,
        action: 'auth.password_reset',
        entityType: 'User',
        entityId: user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      await sendEmail({
        template: 'password-changed',
        to: user.email,
        data: { name: user.displayName, resetUrl: `${appUrl(env)}/forgot-password` },
      });
    },

    /** Changes the password and signs out other sessions. @param {string} userId @param {string} sessionId @param {{ currentPassword: string, newPassword: string }} input */
    async changePassword(userId, sessionId, { currentPassword, newPassword }) {
      const user = await db().user.findUnique({ where: { id: userId } });
      if (!(await verifyPassword(user.passwordHash, currentPassword))) {
        throw new ValidationError([
          { path: 'body.currentPassword', message: 'Your current password is incorrect' },
        ]);
      }
      await assertAcceptablePassword(newPassword, { email: user.email });
      await db().user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(newPassword) },
      });
      const n = await revokeAllSessions(userId, 'password_changed', sessionId);
      await audit(db(), {
        actorUserId: userId,
        action: 'auth.password_changed',
        entityType: 'User',
        entityId: userId,
        changes: { otherSessionsRevoked: n },
      });
      await sendEmail({
        template: 'password-changed',
        to: user.email,
        data: { name: user.displayName, resetUrl: `${appUrl(env)}/forgot-password` },
      });
    },

    // ── Current user & sessions ─────────────────────────────────────────────────

    /** @param {string} userId @param {string} tenantId @param {boolean} sessionMfa */
    async me(userId, tenantId, sessionMfa) {
      const [user, tenant, access] = await Promise.all([
        db().user.findUnique({ where: { id: userId } }),
        db().tenant.findUnique({ where: { id: tenantId } }),
        loadAccess({ db: db(), redis, tenantId, userId }),
      ]);
      if (!user || !tenant || !access) throw new UnauthorizedError();
      return {
        user: publicUser(user, access.mfaEnrolled),
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          status: tenant.status,
          trialEndsAt: tenant.trialEndsAt,
          countryCode: tenant.countryCode,
        },
        roles: access.roles,
        permissions: Object.entries(access.permissions).map(([code, scope]) => ({ code, scope })),
        mfa: {
          enabled: access.mfaEnrolled,
          sessionVerified: sessionMfa,
          requiredForRole: Boolean(env.MFA_ENFORCE_FOR_SENSITIVE ?? true) && access.holdsSensitive,
        },
      };
    },

    /** Active sessions = refresh-token families whose newest token is live. @param {string} userId @param {string} currentSessionId */
    async listSessions(userId, currentSessionId) {
      const now = new Date();
      const live = await db().refreshToken.findMany({
        where: {
          userId,
          revokedAt: null,
          rotatedAt: null,
          expiresAt: { gt: now },
          idleExpiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
      });
      const firsts = await db().refreshToken.groupBy({
        by: ['familyId'],
        where: { familyId: { in: live.map((r) => r.familyId) } },
        _min: { createdAt: true },
      });
      const started = new Map(firsts.map((f) => [f.familyId, f._min.createdAt]));
      return live.map((r) => ({
        id: r.familyId,
        current: r.familyId === currentSessionId,
        startedAt: started.get(r.familyId),
        lastActiveAt: r.createdAt,
        userAgent: r.userAgent,
        ipAddress: r.ipAddress,
      }));
    },

    /** @param {string} userId @param {string} sessionId */
    async revokeSession(userId, sessionId) {
      const owned = await db().refreshToken.findFirst({ where: { userId, familyId: sessionId } });
      if (!owned) throw new AppError(404, 'not_found', 'Not found');
      await revokeFamily(sessionId, 'revoked_by_user');
      await audit(db(), {
        actorUserId: userId,
        action: 'auth.session_revoked',
        entityType: 'Session',
        entityId: sessionId,
      });
    },

    // ── Companies (tenants) a user belongs to ───────────────────────────────────

    /** Signs a user out of one company (used when a member is suspended, removed or force-signed-out). @param {string} userId @param {string} tenantId @param {string} reason */
    async revokeUserSessionsInTenant(userId, tenantId, reason) {
      const rows = await db().refreshToken.findMany({
        where: { userId, tenantId, revokedAt: null },
        select: { familyId: true },
        distinct: ['familyId'],
      });
      for (const { familyId } of rows) await revokeFamily(familyId, reason);
      await invalidateAccess(redis, tenantId, userId);
      return rows.length;
    },

    /** Active companies of the user, for the company switcher. @param {string} userId @param {string} currentTenantId */
    async listMemberships(userId, currentTenantId) {
      const rows = await db().tenantMembership.findMany({
        where: { userId, status: 'ACTIVE', tenant: { status: { in: ['TRIAL', 'ACTIVE', 'PAST_DUE'] } } },
        include: { tenant: true },
        orderBy: { joinedAt: 'asc' },
      });
      return rows.map((m) => ({
        tenantId: m.tenantId,
        name: m.tenant.name,
        slug: m.tenant.slug,
        current: m.tenantId === currentTenantId,
      }));
    },

    /**
     * Moves the user to another company: a new session for that company replaces the current one.
     * The MFA-verified state carries over because it belongs to the person, not the company.
     * @param {{ userId: string, sessionId: string, mfa: boolean }} who @param {string} targetTenantId @param {Meta} meta
     */
    async switchTenant({ userId, sessionId, mfa }, targetTenantId, meta) {
      const m = await db().tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId: targetTenantId, userId } },
        include: { tenant: true },
      });
      if (!m || m.status !== 'ACTIVE' || !['TRIAL', 'ACTIVE', 'PAST_DUE'].includes(m.tenant.status))
        throw new AppError(404, 'not_found', 'Not found');
      const session = await startSession({ userId, tenantId: targetTenantId, mfa, meta });
      await revokeFamily(sessionId, 'switched_tenant');
      await audit(db(), {
        tenantId: targetTenantId,
        actorUserId: userId,
        action: 'auth.switched_tenant',
        entityType: 'Session',
        entityId: session.sessionId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return session;
    },

    // ── Invitations ─────────────────────────────────────────────────────────────

    /** Signed, self-describing invite token (7 days). Single use: accepting moves the membership out of INVITED. @param {{ userId: string, tenantId: string, membershipId: string }} a */
    signInviteToken({ userId, tenantId, membershipId }) {
      return jwt.sign(
        { tid: tenantId, mid: membershipId },
        { subject: userId, audience: 'invite', ttlSec: 7 * 86400 },
      );
    },

    /** @param {string} token */
    async inviteInfo(token) {
      const claims = await jwt.verify(token, 'invite').catch(() => null);
      if (!claims)
        throw new AppError(
          400,
          'invalid_invite',
          'This invitation is invalid or has expired. Ask for a new one.',
        );
      const m = await db().tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId: String(claims.tid), userId: String(claims.sub) } },
        include: { tenant: true, user: true },
      });
      if (!m || m.id !== claims.mid || m.status !== 'INVITED')
        throw new AppError(
          400,
          'invalid_invite',
          'This invitation is invalid or has expired. Ask for a new one.',
        );
      return {
        membership: m,
        companyName: m.tenant.name,
        email: m.user.email,
        needsPassword: !m.user.passwordHash,
      };
    },

    /**
     * Accepts an invitation. New people set their name and password here; existing users just sign in afterwards.
     * The token proves control of the mailbox, so it also confirms the email address.
     * @param {{ token: string, fullName?: string, password?: string }} input @param {Meta} meta
     */
    async acceptInvite({ token, fullName, password }, meta) {
      const { membership: m, needsPassword } = await this.inviteInfo(token);
      const data = { emailVerifiedAt: m.user.emailVerifiedAt ?? new Date() };
      if (needsPassword) {
        if (!fullName || !password) {
          throw new ValidationError([
            ...(!fullName ? [{ path: 'body.fullName', message: 'Enter your name' }] : []),
            ...(!password ? [{ path: 'body.password', message: 'Choose a password' }] : []),
          ]);
        }
        await assertAcceptablePassword(password, { email: m.user.email });
        Object.assign(data, { displayName: fullName, passwordHash: await hashPassword(password) });
      }
      const { count } = await db().tenantMembership.updateMany({
        where: { id: m.id, status: 'INVITED' },
        data: { status: 'ACTIVE', joinedAt: new Date() },
      });
      if (count !== 1) throw new AppError(400, 'invalid_invite', 'This invitation has already been used.');
      await db().user.update({ where: { id: m.userId }, data });
      await invalidateAccess(redis, m.tenantId, m.userId);
      await audit(db(), {
        tenantId: m.tenantId,
        actorUserId: m.userId,
        action: 'member.invite_accepted',
        entityType: 'TenantMembership',
        entityId: m.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return { email: m.user.email, companyName: m.tenant.name };
    },

    // ── MFA management ──────────────────────────────────────────────────────────

    /** Starts TOTP enrolment after re-checking the password (AUTH-13). @param {string} userId @param {string} password */
    async mfaSetup(userId, password) {
      const user = await db().user.findUnique({ where: { id: userId } });
      if (!(await verifyPassword(user.passwordHash, password)))
        throw new ValidationError([{ path: 'body.password', message: 'Your password is incorrect' }]);
      if (await hasConfirmedMfa(userId))
        throw new ConflictError('mfa_already_enabled', 'Two-step verification is already on');
      await db().mfaFactor.deleteMany({ where: { userId, confirmedAt: null } });
      const secret = generateTotpSecret();
      await db().mfaFactor.create({
        data: {
          id: newId(),
          userId,
          type: 'TOTP',
          secretEnc: cipher.encrypt(secret, userId),
          label: 'Authenticator app',
        },
      });
      return { secret, otpauthUri: otpauthUri({ issuer: env.MFA_ISSUER, account: user.email, secret }) };
    },

    /**
     * Confirms enrolment with a first code, returns one-time recovery codes, signs out other sessions and
     * upgrades the current session to MFA-verified.
     * @param {{ userId: string, tenantId: string, sessionId: string }} who @param {string} code
     */
    async mfaConfirm({ userId, tenantId, sessionId }, code) {
      const factor = await db().mfaFactor.findFirst({
        where: { userId, type: 'TOTP', confirmedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (!factor) throw new ConflictError('mfa_setup_missing', 'Start the setup again');
      const result = verifyTotp({ secret: cipher.decrypt(factor.secretEnc, userId), code });
      if (!result.ok)
        throw new ValidationError([
          {
            path: 'body.code',
            message: "That code didn't work. Check the time on your phone and try again.",
          },
        ]);
      const codes = Array.from({ length: RECOVERY_CODES }, () =>
        randomToken(12)
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .padEnd(10, '0')
          .slice(0, 10),
      );
      await db().$transaction(async (/** @type {any} */ tx) => {
        await tx.mfaFactor.update({
          where: { id: factor.id },
          data: { confirmedAt: new Date(), lastUsedStep: BigInt(result.step) },
        });
        await tx.recoveryCode.deleteMany({ where: { userId } });
        await tx.recoveryCode.createMany({
          data: codes.map((c) => ({ id: newId(), userId, codeHash: hashToken(c) })),
        });
      });
      await revokeAllSessions(userId, 'mfa_enabled', sessionId);
      await redis.set(`sess:mfa:${sessionId}`, '1', 'EX', env.REFRESH_ABSOLUTE_TTL_SEC);
      await invalidateAccess(redis, tenantId, userId);
      const user = await db().user.findUnique({ where: { id: userId } });
      await audit(db(), {
        actorUserId: userId,
        action: 'auth.mfa_enabled',
        entityType: 'User',
        entityId: userId,
      });
      await sendEmail({ template: 'mfa-enabled', to: user.email, data: { name: user.displayName } });
      const accessToken = await issueAccessToken({ userId, tenantId, sessionId, mfa: true });
      return { accessToken, recoveryCodes: codes.map((c) => `${c.slice(0, 5)}-${c.slice(5)}`) };
    },

    /** @param {{ userId: string, tenantId: string, sessionId: string }} who @param {{ password: string, code: string }} input */
    async mfaDisable({ userId, tenantId, sessionId }, { password, code }) {
      const user = await db().user.findUnique({ where: { id: userId } });
      if (!(await verifyPassword(user.passwordHash, password)))
        throw new ValidationError([{ path: 'body.password', message: 'Your password is incorrect' }]);
      const access = await loadAccess({ db: db(), redis, tenantId, userId });
      if ((env.MFA_ENFORCE_FOR_SENSITIVE ?? true) && access?.holdsSensitive) {
        throw new ConflictError(
          'mfa_required_for_role',
          'Your role requires two-step verification, so it cannot be turned off',
        );
      }
      const factor = await db().mfaFactor.findFirst({ where: { userId, confirmedAt: { not: null } } });
      if (!factor) throw new ConflictError('mfa_not_enabled', 'Two-step verification is not on');
      const result = verifyTotp({
        secret: cipher.decrypt(factor.secretEnc, userId),
        code,
        lastUsedStep: factor.lastUsedStep,
      });
      if (!result.ok) throw new ValidationError([{ path: 'body.code', message: "That code didn't work" }]);
      await db().$transaction([
        db().mfaFactor.deleteMany({ where: { userId } }),
        db().recoveryCode.deleteMany({ where: { userId } }),
      ]);
      await redis.del(`sess:mfa:${sessionId}`);
      await invalidateAccess(redis, tenantId, userId);
      await audit(db(), {
        actorUserId: userId,
        action: 'auth.mfa_disabled',
        entityType: 'User',
        entityId: userId,
      });
      await sendEmail({ template: 'mfa-disabled', to: user.email, data: { name: user.displayName } });
      return { accessToken: await issueAccessToken({ userId, tenantId, sessionId, mfa: false }) };
    },
  };
}
