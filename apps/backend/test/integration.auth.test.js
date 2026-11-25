// Integration: every auth flow over HTTP against real MySQL (seeded hrms_test) and Redis (logical DB 1, flushed).
// Emails are captured from the queue producer so tests can follow verification/reset links.
import express from 'express';
import request from 'supertest';
import { Redis } from 'ioredis';
import { createApp } from '../src/app.js';
import { initDb, closeDb, platformDb } from '../src/lib/db.js';
import { createLogger } from '../src/lib/logger.js';
import { buildServices } from '../src/services.js';
import { requestContext } from '../src/middleware/request-context.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { base32Decode, hotp, totpStep } from '../src/modules/auth/totp.js';
import { testEnv } from './helpers/test-env.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is required for integration tests');
const REDIS_TEST_URL = `${(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379').replace(/\/\d+$/, '')}/1`;

const env = testEnv({
  DATABASE_URL,
  REDIS_URL: REDIS_TEST_URL,
  FRONTEND_URL: 'http://app.test',
  AUTH_IP_LIMIT_PER_MIN: '20',
});
const logger = createLogger({ level: 'silent' });
const ORIGIN = 'http://app.test';
let redis;
let app;
let services;
const emails = [];
const queues = { notifications: { add: async (_name, job) => emails.push(job) } };

beforeAll(async () => {
  initDb(DATABASE_URL);
  redis = new Redis(REDIS_TEST_URL);
  await redis.flushdb();
  services = buildServices({
    env,
    logger,
    redis,
    queues,
    breachCheck: async (pw) => pw === 'breached-password-123',
  });
  app = createApp({ env, logger, readinessChecks: [], services: services.routes });
});
afterAll(async () => {
  await redis.quit();
  await closeDb();
});

// Each scenario uses its own client IP (trust proxy = 1 hop) so per-IP limits don't bleed between tests.
let ipCounter = 10;
const client = () => {
  const ip = `203.0.113.${ipCounter++}`;
  const jar = {};
  const call = (method, path) => {
    const req = request(app)[method](`/api/v1${path}`).set('X-Forwarded-For', ip).set('Origin', ORIGIN);
    const cookie = Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    if (cookie) req.set('Cookie', cookie);
    return req;
  };
  const keep = (res) => {
    for (const c of [].concat(res.headers['set-cookie'] ?? [])) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (v === '' || /Expires=Thu, 01 Jan 1970/.test(c)) delete jar[k];
      else jar[k] = v;
    }
    return res;
  };
  return { ip, jar, call, keep, csrf: () => jar.hrms_csrf };
};

const uniqueEmail = (tag) => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
const lastEmail = (to, template) =>
  [...emails].reverse().find((e) => e.to === to && (!template || e.template === template));
const tokenFrom = (url) => new URL(url).searchParams.get('token');
const PASSWORD = 'violet-tractor-91-lamp';

/** Registers, verifies and returns credentials. */
async function registeredUser(tag = 'user') {
  const c = client();
  const email = uniqueEmail(tag);
  await c
    .call('post', '/auth/register')
    .send({
      fullName: 'Priya Sharma',
      email,
      password: PASSWORD,
      companyName: `Acme ${tag}`,
      countryCode: 'IN',
      timezone: 'Asia/Kolkata',
    })
    .expect(202);
  await c
    .call('post', '/auth/verify-email')
    .send({ token: tokenFrom(lastEmail(email, 'verify-email').data.url) })
    .expect(200);
  return { email, password: PASSWORD };
}

async function login(c, email, password = PASSWORD) {
  const res = c.keep(await c.call('post', '/auth/login').send({ email, password }));
  return res;
}

const currentCode = (secret, offsetSteps = 0) =>
  hotp(base32Decode(secret), totpStep(Date.now()) + offsetSteps);

describe('registration and email verification', () => {
  test('register creates user, company, legal entity, 9 default roles and an active Company Admin membership', async () => {
    const c = client();
    const email = uniqueEmail('reg');
    const res = await c.call('post', '/auth/register').send({
      fullName: 'Priya Sharma',
      email,
      password: PASSWORD,
      companyName: 'Acme Software',
      countryCode: 'in',
    });
    expect(res.status).toBe(202);
    const user = await platformDb().user.findUnique({ where: { email } });
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    const m = await platformDb().tenantMembership.findFirst({
      where: { userId: user.id },
      include: { tenant: true, membershipRoles: { include: { role: true } } },
    });
    expect(m.status).toBe('ACTIVE');
    expect(m.tenant.status).toBe('TRIAL');
    expect(m.membershipRoles.map((r) => r.role.systemKey)).toEqual(['company_admin']);
    expect(await platformDb().role.count({ where: { tenantId: m.tenantId } })).toBe(9);
    expect(await platformDb().legalEntity.count({ where: { tenantId: m.tenantId } })).toBe(1);
    expect(lastEmail(email, 'verify-email').data.url).toMatch(/^http:\/\/app\.test\/verify-email\?token=/);
  });

  test('registering an existing email answers the same and emails the owner instead', async () => {
    const { email } = await registeredUser('dup');
    const c = client();
    const res = await c.call('post', '/auth/register').send({
      fullName: 'Someone Else',
      email,
      password: PASSWORD,
      companyName: 'Other Co',
      countryCode: 'IN',
    });
    expect(res.status).toBe(202);
    expect(lastEmail(email).template).toBe('account-exists');
    const user = await platformDb().user.findUnique({ where: { email } });
    expect(await platformDb().tenantMembership.count({ where: { userId: user.id } })).toBe(1);
  });

  test('weak, email-based and breached passwords are rejected; unknown keys are rejected', async () => {
    const c = client();
    const base = { fullName: 'P', companyName: 'Acme', countryCode: 'IN' };
    expect(
      (await c.call('post', '/auth/register').send({ ...base, email: uniqueEmail('w'), password: 'short' }))
        .status,
    ).toBe(422);
    const r2 = await c
      .call('post', '/auth/register')
      .send({ ...base, email: 'priyasharma@example.com', password: 'priyasharma-2026' });
    expect(r2.body.errors[0].message).toMatch(/email/);
    const r3 = await c
      .call('post', '/auth/register')
      .send({ ...base, email: uniqueEmail('b'), password: 'breached-password-123' });
    expect(r3.body.errors[0].message).toMatch(/breach/);
    const r4 = await c
      .call('post', '/auth/register')
      .send({ ...base, email: uniqueEmail('k'), password: PASSWORD, isAdmin: true });
    expect(r4.status).toBe(422);
  });

  test('cannot sign in before verifying; verification link works once', async () => {
    const c = client();
    const email = uniqueEmail('unverified');
    await c
      .call('post', '/auth/register')
      .send({ fullName: 'P', email, password: PASSWORD, companyName: 'Acme', countryCode: 'IN' })
      .expect(202);
    const before = await login(c, email);
    expect(before.status).toBe(403);
    expect(before.body.code).toBe('email_not_verified');
    const token = tokenFrom(lastEmail(email, 'verify-email').data.url);
    await c.call('post', '/auth/verify-email').send({ token }).expect(200);
    expect((await c.call('post', '/auth/verify-email').send({ token })).status).toBe(400);
    expect((await login(c, email)).status).toBe(200);
  });
});

describe('login, tokens and sessions', () => {
  test('wrong password and unknown email get identical answers', async () => {
    const { email } = await registeredUser('uniform');
    const c = client();
    const a = await login(c, email, 'wrong-password-123');
    const b = await login(c, uniqueEmail('nobody'), 'wrong-password-123');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect({ code: a.body.code, title: a.body.title }).toEqual({ code: b.body.code, title: b.body.title });
  });

  test('successful login: access token in body, HttpOnly SameSite=Strict refresh cookie, readable CSRF cookie', async () => {
    const { email } = await registeredUser('login');
    const c = client();
    const res = await login(c, email);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mfaRequired: false, expiresIn: 900 });
    expect(res.headers['cache-control']).toBe('no-store');
    const cookies = [].concat(res.headers['set-cookie']);
    expect(cookies.find((x) => x.startsWith('hrms_rt='))).toMatch(/HttpOnly; SameSite=Strict/);
    expect(cookies.find((x) => x.startsWith('hrms_csrf='))).not.toMatch(/HttpOnly/);
    expect(JSON.stringify(res.body)).not.toContain(c.jar.hrms_rt); // refresh token never in the body

    const me = await c
      .call('get', '/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
    expect(me.body.user.email).toBe(email);
    expect(me.body.roles).toEqual(['Company Admin']);
    expect(me.body.permissions.map((p) => p.code)).toContain('view_team_screenshots');
    expect(me.body.mfa).toEqual({ enabled: false, sessionVerified: false, requiredForRole: true });
  });

  test('requests without, with garbage, or with tampered tokens are rejected', async () => {
    const { email } = await registeredUser('tamper');
    const c = client();
    const { body } = await login(c, email);
    expect((await c.call('get', '/auth/me')).status).toBe(401);
    expect((await c.call('get', '/auth/me').set('Authorization', 'Bearer abc.def.ghi')).status).toBe(401);
    const [h, p, s] = body.accessToken.split('.');
    const claims = JSON.parse(Buffer.from(p, 'base64url'));
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...claims, tid: '00000000-0000-7000-8000-000000000000' })).toString('base64url')}.${s}`;
    expect((await c.call('get', '/auth/me').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
  });

  test('refresh rotates; CSRF and Origin are required', async () => {
    const { email } = await registeredUser('refresh');
    const c = client();
    await login(c, email);
    const first = c.jar.hrms_rt;
    expect((await c.call('post', '/auth/refresh')).body.code).toBe('csrf_failed');
    expect(
      (await c.call('post', '/auth/refresh').set('Origin', 'https://evil.test').set('X-CSRF-Token', c.csrf()))
        .body.code,
    ).toBe('bad_origin');
    const ok = c.keep(await c.call('post', '/auth/refresh').set('X-CSRF-Token', c.csrf()));
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    expect(c.jar.hrms_rt).not.toBe(first);
  });

  test('reusing a rotated refresh token revokes the whole session (theft detection)', async () => {
    const { email } = await registeredUser('reuse');
    const c = client();
    await login(c, email);
    const stolen = c.jar.hrms_rt;
    const rotated = c.keep(await c.call('post', '/auth/refresh').set('X-CSRF-Token', c.csrf()));
    const access = rotated.body.accessToken;
    const legit = c.jar.hrms_rt;

    c.jar.hrms_rt = stolen; // attacker replays the old token
    const replay = await c.call('post', '/auth/refresh').set('X-CSRF-Token', c.csrf());
    expect(replay.status).toBe(401);

    c.jar.hrms_rt = legit; // the legitimate client is signed out too
    expect((await c.call('post', '/auth/refresh').set('X-CSRF-Token', c.csrf())).status).toBe(401);
    const me = await c.call('get', '/auth/me').set('Authorization', `Bearer ${access}`);
    expect(me.status).toBe(401);
    expect(me.body.code).toBe('session_revoked');
    const audit = await platformDb().auditLog.findFirst({
      where: { action: 'auth.refresh_reuse_detected' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
  });

  test('sessions list and revoking one session signs out only that session', async () => {
    const { email } = await registeredUser('sessions');
    const laptop = client();
    const phone = client();
    const a = (await login(laptop, email)).body.accessToken;
    const b = (await login(phone, email)).body.accessToken;
    const list = await laptop.call('get', '/auth/sessions').set('Authorization', `Bearer ${a}`).expect(200);
    expect(list.body.data).toHaveLength(2);
    const other = list.body.data.find((s) => !s.current);
    await laptop.call('delete', `/auth/sessions/${other.id}`).set('Authorization', `Bearer ${a}`).expect(204);
    expect((await phone.call('get', '/auth/me').set('Authorization', `Bearer ${b}`)).body.code).toBe(
      'session_revoked',
    );
    await laptop.call('get', '/auth/me').set('Authorization', `Bearer ${a}`).expect(200);
  });

  test("a user cannot revoke someone else's session", async () => {
    const u1 = await registeredUser('own1');
    const u2 = await registeredUser('own2');
    const c1 = client();
    const c2 = client();
    const t1 = (await login(c1, u1.email)).body.accessToken;
    const t2 = (await login(c2, u2.email)).body.accessToken;
    const sid2 = (await c2.call('get', '/auth/sessions').set('Authorization', `Bearer ${t2}`)).body.data[0]
      .id;
    expect(
      (await c1.call('delete', `/auth/sessions/${sid2}`).set('Authorization', `Bearer ${t1}`)).status,
    ).toBe(404);
    await c2.call('get', '/auth/me').set('Authorization', `Bearer ${t2}`).expect(200);
  });

  test('logout ends the session; logout-all ends every session', async () => {
    const { email } = await registeredUser('logout');
    const c = client();
    const t = (await login(c, email)).body.accessToken;
    c.keep(await c.call('post', '/auth/logout').set('X-CSRF-Token', c.csrf()).expect(204));
    expect((await c.call('get', '/auth/me').set('Authorization', `Bearer ${t}`)).status).toBe(401);
    expect(c.jar.hrms_rt).toBeUndefined();

    const x = client();
    const y = client();
    const tx = (await login(x, email)).body.accessToken;
    const ty = (await login(y, email)).body.accessToken;
    await x.call('post', '/auth/logout-all').set('Authorization', `Bearer ${tx}`).expect(204);
    expect((await y.call('get', '/auth/me').set('Authorization', `Bearer ${ty}`)).status).toBe(401);
  });
});

describe('throttling', () => {
  test('10 wrong passwords lock the account for 15 minutes, even for the right password', async () => {
    const { email } = await registeredUser('lock');
    const c = client();
    for (let i = 0; i < 10; i++) await login(c, email, `wrong-password-${i}`);
    const locked = await login(client(), email); // correct password, different IP
    expect(locked.status).toBe(429);
    expect(lastEmail(email).template).toBe('account-locked');
  });

  test('unknown emails lock the same way (no account enumeration)', async () => {
    const ghost = uniqueEmail('ghost');
    for (let i = 0; i < 10; i++) await login(client(), ghost, `wrong-password-${i}`);
    expect((await login(client(), ghost, 'any-password-123')).status).toBe(429);
  });

  test('per-IP limit on sign-in endpoints', async () => {
    const c = client();
    let last;
    for (let i = 0; i < env.AUTH_IP_LIMIT_PER_MIN + 1; i++)
      last = await login(c, uniqueEmail('ip'), 'wrong-password-123');
    expect(last.status).toBe(429);
    expect(last.headers['ratelimit-policy'] ?? last.headers.ratelimit).toBeDefined();
  });
});

describe('password reset and change', () => {
  test('forgot-password is uniform; reset signs out all sessions and works once', async () => {
    const { email } = await registeredUser('reset');
    const c = client();
    const t = (await login(c, email)).body.accessToken;
    const before = emails.length;
    await c
      .call('post', '/auth/forgot-password')
      .send({ email: uniqueEmail('nobody') })
      .expect(202);
    expect(emails.length).toBe(before);
    await c.call('post', '/auth/forgot-password').send({ email }).expect(202);
    const token = tokenFrom(lastEmail(email, 'reset-password').data.url);
    await c
      .call('post', '/auth/reset-password')
      .send({ token, password: 'new-violet-tractor-92' })
      .expect(200);
    expect((await c.call('get', '/auth/me').set('Authorization', `Bearer ${t}`)).status).toBe(401);
    expect(
      (await c.call('post', '/auth/reset-password').send({ token, password: 'another-violet-93' })).status,
    ).toBe(400);
    expect((await login(client(), email, PASSWORD)).status).toBe(401);
    expect((await login(client(), email, 'new-violet-tractor-92')).status).toBe(200);
    expect(lastEmail(email).template).toBe('password-changed');
  });

  test('change password needs the current password and signs out other sessions only', async () => {
    const { email } = await registeredUser('change');
    const a = client();
    const b = client();
    const ta = (await login(a, email)).body.accessToken;
    const tb = (await login(b, email)).body.accessToken;
    const bad = await a
      .call('post', '/auth/password')
      .set('Authorization', `Bearer ${ta}`)
      .send({ currentPassword: 'nope-nope-nope', newPassword: 'changed-violet-94' });
    expect(bad.status).toBe(422);
    await a
      .call('post', '/auth/password')
      .set('Authorization', `Bearer ${ta}`)
      .send({ currentPassword: PASSWORD, newPassword: 'changed-violet-94' })
      .expect(200);
    await a.call('get', '/auth/me').set('Authorization', `Bearer ${ta}`).expect(200);
    expect((await b.call('get', '/auth/me').set('Authorization', `Bearer ${tb}`)).status).toBe(401);
  });
});

describe('two-step verification (TOTP)', () => {
  test('full lifecycle: setup, confirm, MFA login, replay blocked, recovery code once, disable blocked for admin', async () => {
    const { email } = await registeredUser('mfa');
    const c = client();
    let token = (await login(c, email)).body.accessToken;
    const auth = (t) => ({ Authorization: `Bearer ${t}` });

    expect(
      (await c.call('post', '/auth/mfa/setup').set(auth(token)).send({ password: 'wrong-password' })).status,
    ).toBe(422);
    const setup = await c
      .call('post', '/auth/mfa/setup')
      .set(auth(token))
      .send({ password: PASSWORD })
      .expect(200);
    expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const { secret } = setup.body;
    const stored = await platformDb().mfaFactor.findFirst({ where: { user: { email } } });
    expect(Buffer.from(stored.secretEnc).toString()).not.toContain(secret); // encrypted at rest

    expect((await c.call('post', '/auth/mfa/confirm').set(auth(token)).send({ code: '000000' })).status).toBe(
      422,
    );
    const confirm = await c
      .call('post', '/auth/mfa/confirm')
      .set(auth(token))
      .send({ code: currentCode(secret) })
      .expect(200);
    expect(confirm.body.recoveryCodes).toHaveLength(10);
    token = confirm.body.accessToken;
    const me = await c.call('get', '/auth/me').set(auth(token)).expect(200);
    expect(me.body.mfa).toMatchObject({ enabled: true, sessionVerified: true });

    // Sign-in now asks for a code.
    const d = client();
    const step1 = await login(d, email);
    expect(step1.body).toMatchObject({ mfaRequired: true });
    expect(step1.headers['set-cookie']).toBeUndefined();
    const code = currentCode(secret, 1); // next step: the confirm step is already used
    const step2 = d.keep(
      await d.call('post', '/auth/mfa/verify').send({ challengeToken: step1.body.challengeToken, code }),
    );
    expect(step2.status).toBe(200);
    expect(d.jar.hrms_rt).toBeTruthy();

    // The same code can't be used again, even with a fresh challenge.
    const e = client();
    const again = await login(e, email);
    expect(
      (await e.call('post', '/auth/mfa/verify').send({ challengeToken: again.body.challengeToken, code }))
        .body.code,
    ).toBe('invalid_code');

    // Recovery code works exactly once.
    const recovery = confirm.body.recoveryCodes[0];
    const r1 = await login(client(), email);
    const f = client();
    await f
      .call('post', '/auth/mfa/verify')
      .send({ challengeToken: r1.body.challengeToken, recoveryCode: recovery })
      .expect(200);
    const r2 = await login(client(), email);
    expect(
      (
        await client()
          .call('post', '/auth/mfa/verify')
          .send({ challengeToken: r2.body.challengeToken, recoveryCode: recovery })
      ).status,
    ).toBe(401);

    // Refreshing keeps the MFA-verified state of the session.
    const refreshed = d.keep(await d.call('post', '/auth/refresh').set('X-CSRF-Token', d.csrf()));
    const meAfter = await d.call('get', '/auth/me').set(auth(refreshed.body.accessToken)).expect(200);
    expect(meAfter.body.mfa.sessionVerified).toBe(true);

    // Company Admin holds sensitive permissions, so MFA can't be turned off.
    const off = await c
      .call('post', '/auth/mfa/disable')
      .set(auth(token))
      .send({ password: PASSWORD, code: currentCode(secret, 1) });
    expect(off.body.code).toBe('mfa_required_for_role');
  });

  test('MFA challenge allows only 5 attempts', async () => {
    const { email } = await registeredUser('mfa-brute');
    const c = client();
    const token = (await login(c, email)).body.accessToken;
    const { secret } = (
      await c
        .call('post', '/auth/mfa/setup')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: PASSWORD })
    ).body;
    await c
      .call('post', '/auth/mfa/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: currentCode(secret) })
      .expect(200);
    const challenge = (await login(client(), email)).body.challengeToken;
    const d = client();
    for (let i = 0; i < 5; i++)
      await d.call('post', '/auth/mfa/verify').send({ challengeToken: challenge, code: '000000' });
    expect(
      (
        await d
          .call('post', '/auth/mfa/verify')
          .send({ challengeToken: challenge, code: currentCode(secret, 1) })
      ).status,
    ).toBe(429);
  });
});

describe('permission checks (authorize)', () => {
  let probe;
  beforeAll(() => {
    // A probe app using the real access middleware, as module routes will from Sprint 3 on.
    probe = express();
    probe.set('trust proxy', 1);
    probe.use(requestContext);
    probe.get('/sensitive', services.access.permission('view_team_screenshots'), (req, res) =>
      res.json({ scope: req.scope }),
    );
    probe.get('/ordinary', services.access.permission('employee.profile.view'), (req, res) =>
      res.json({ scope: req.scope }),
    );
    probe.get('/recruiting', services.access.permission('recruitment.manage'), (req, res) =>
      res.json({ scope: req.scope }),
    );
    probe.use(errorHandler(logger));
  });

  test('sensitive permission needs an MFA-verified session; ordinary permission does not', async () => {
    const { email } = await registeredUser('perm');
    const c = client();
    const token = (await login(c, email)).body.accessToken;
    const ordinary = await request(probe)
      .get('/ordinary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(ordinary.body.scope).toBe('COMPANY');
    const sensitive = await request(probe).get('/sensitive').set('Authorization', `Bearer ${token}`);
    expect(sensitive.status).toBe(403);
    expect(sensitive.body.code).toBe('mfa_required');

    const { secret } = (
      await c
        .call('post', '/auth/mfa/setup')
        .set('Authorization', `Bearer ${token}`)
        .send({ password: PASSWORD })
    ).body;
    const upgraded = (
      await c
        .call('post', '/auth/mfa/confirm')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: currentCode(secret) })
    ).body.accessToken;
    await request(probe).get('/sensitive').set('Authorization', `Bearer ${upgraded}`).expect(200);
  });

  test('a member without the permission gets 403', async () => {
    const { email } = await registeredUser('noperm');
    const user = await platformDb().user.findUnique({ where: { email } });
    const m = await platformDb().tenantMembership.findFirst({ where: { userId: user.id } });
    const employeeRole = await platformDb().role.findFirst({
      where: { tenantId: m.tenantId, systemKey: 'employee' },
    });
    await platformDb().membershipRole.deleteMany({ where: { membershipId: m.id } });
    await platformDb().membershipRole.create({
      data: { tenantId: m.tenantId, membershipId: m.id, roleId: employeeRole.id },
    });
    const token = (await login(client(), email)).body.accessToken;
    const own = await request(probe).get('/ordinary').set('Authorization', `Bearer ${token}`).expect(200);
    expect(own.body.scope).toBe('OWN');
    expect((await request(probe).get('/recruiting').set('Authorization', `Bearer ${token}`)).status).toBe(
      403,
    );
    expect((await request(probe).get('/sensitive').set('Authorization', `Bearer ${token}`)).body.code).toBe(
      'forbidden',
    );
  });

  test('a suspended membership is rejected within the cache window', async () => {
    const { email } = await registeredUser('suspend');
    const token = (await login(client(), email)).body.accessToken;
    const user = await platformDb().user.findUnique({ where: { email } });
    const m = await platformDb().tenantMembership.findFirst({ where: { userId: user.id } });
    await platformDb().tenantMembership.update({ where: { id: m.id }, data: { status: 'SUSPENDED' } });
    await redis.del(`t:${m.tenantId}:access:${user.id}`); // what the membership service does on change (Sprint 3)
    expect((await request(probe).get('/ordinary').set('Authorization', `Bearer ${token}`)).body.code).toBe(
      'membership_inactive',
    );
  });
});

describe('reference data', () => {
  test('countries are public', async () => {
    const res = await client().call('get', '/reference/countries').expect(200);
    expect(res.body.data.map((c) => c.code)).toEqual(expect.arrayContaining(['IN', 'GB']));
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
  });
});
