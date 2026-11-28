// Shared harness for integration suites: real app + MySQL (DATABASE_URL) + Redis (logical DB 1).
import request from 'supertest';
import { Redis } from 'ioredis';
import { createApp } from '../../src/app.js';
import { initDb, closeDb, platformDb } from '../../src/lib/db.js';
import { createLogger } from '../../src/lib/logger.js';
import { buildServices } from '../../src/services.js';
import { base32Decode, hotp, totpStep } from '../../src/modules/auth/totp.js';
import { testEnv } from './test-env.js';

export const PASSWORD = 'violet-tractor-91-lamp';
const ORIGIN = 'http://app.test';

export async function startHarness() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) throw new Error('DATABASE_URL is required for integration tests');
  const REDIS_TEST_URL = `${(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379').replace(/\/\d+$/, '')}/1`;
  const env = testEnv({
    DATABASE_URL,
    REDIS_URL: REDIS_TEST_URL,
    FRONTEND_URL: ORIGIN,
    S3_ENDPOINT: process.env.S3_ENDPOINT ?? 'http://127.0.0.1:9000',
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? 'local_dev_access_key',
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? 'local_dev_secret_key',
    S3_BUCKET_DOCUMENTS: 'hrms-test-documents',
    S3_BUCKET_REPORTS: 'hrms-test-reports',
  });
  initDb(DATABASE_URL);
  const redis = new Redis(REDIS_TEST_URL);
  await redis.flushdb();
  const jobs = { files: [], imports: [], workSessions: [], screenshots: [] };
  // Fakes that record jobs and enforce BullMQ's rule that custom job ids may not contain ':'.
  const fakeQueue = (record) => ({
    add: async (name, data, opts = {}) => {
      if (opts.jobId && String(opts.jobId).includes(':')) throw new Error('Custom Id cannot contain :');
      record(name, data);
    },
  });
  const emails = [];
  const queues = {
    notifications: fakeQueue((_name, data) => emails.push(data)),
    files: fakeQueue((name, data) => jobs.files.push({ name, data })),
    imports: fakeQueue((name, data) => jobs.imports.push({ name, data })),
    workSessions: fakeQueue((name, data) => jobs.workSessions.push({ name, data })),
    screenshots: fakeQueue((name, data) => jobs.screenshots.push({ name, data })),
  };
  const services = buildServices({
    env,
    logger: createLogger({ level: process.env.TEST_LOG_LEVEL ?? 'silent' }),
    redis,
    queues,
    breachCheck: async () => false,
  });
  const app = createApp({
    env,
    logger: createLogger({ level: process.env.TEST_LOG_LEVEL ?? 'silent' }),
    readinessChecks: [],
    services: services.routes,
  });
  await services.files.ensureBuckets([
    env.S3_BUCKET_DOCUMENTS,
    env.S3_BUCKET_REPORTS,
    env.S3_BUCKET_SCREENSHOTS,
  ]);
  let ip = 1;

  const h = {
    app,
    env,
    redis,
    emails,
    jobs,
    services,
    db: platformDb,
    async stop() {
      await redis.quit();
      await closeDb();
    },
    lastEmail: (to, template) =>
      [...emails].reverse().find((e) => e.to === to && (!template || e.template === template)),
    tokenFrom: (url) => new URL(url).searchParams.get('token'),
    uniqueEmail: (tag) => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`.toLowerCase(),

    /** A browser-like client with its own IP and cookie jar; `token` is sent as the bearer when set. */
    client() {
      const addr = `198.51.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`;
      const jar = {};
      const c = {
        token: null,
        jar,
        call(method, path) {
          const agent = request(app);
          const req = agent[method](`/api/v1${path}`).set('X-Forwarded-For', addr).set('Origin', ORIGIN);
          const cookie = Object.entries(jar)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
          if (cookie) req.set('Cookie', cookie);
          if (c.token) req.set('Authorization', `Bearer ${c.token}`);
          return req;
        },
        keep(res) {
          for (const raw of [].concat(res.headers['set-cookie'] ?? [])) {
            const [k, v] = raw.split(';')[0].split('=');
            if (v === '') delete jar[k];
            else jar[k] = v;
          }
          return res;
        },
        async login(email, password = PASSWORD) {
          const res = c.keep(await c.call('post', '/auth/login').send({ email, password }));
          if (res.body.accessToken) c.token = res.body.accessToken;
          return res;
        },
      };
      return c;
    },

    /** Registers a company owner, verifies the email and returns a signed-in client. */
    async owner(tag = 'owner', { mfa = false } = {}) {
      const email = h.uniqueEmail(tag);
      const c = h.client();
      await c
        .call('post', '/auth/register')
        .send({
          fullName: `Owner ${tag}`,
          email,
          password: PASSWORD,
          companyName: `Co ${tag} ${Date.now()}`,
          countryCode: 'IN',
          timezone: 'Asia/Kolkata',
        })
        .expect(202);
      await c
        .call('post', '/auth/verify-email')
        .send({ token: h.tokenFrom(h.lastEmail(email, 'verify-email').data.url) })
        .expect(200);
      await c.login(email);
      const me = (await c.call('get', '/auth/me').expect(200)).body;
      c.email = email;
      c.tenantId = me.tenant.id;
      c.userId = me.user.id;
      if (mfa) await h.enableMfa(c);
      return c;
    },

    /** Turns on TOTP for the client's user; the client's token becomes MFA-verified. */
    async enableMfa(c) {
      const { secret } = (await c.call('post', '/auth/mfa/setup').send({ password: PASSWORD }).expect(200))
        .body;
      const out = (
        await c
          .call('post', '/auth/mfa/confirm')
          .send({ code: hotp(base32Decode(secret), totpStep(Date.now())) })
          .expect(200)
      ).body;
      c.token = out.accessToken;
      c.mfaSecret = secret;
      return c;
    },

    /** Invites `email` into the owner's company with the given role keys and accepts as a new person; returns a signed-in client. */
    async member(owner, roleKeys, tag = 'member') {
      const roles = (await owner.call('get', '/tenants/roles').expect(200)).body.data;
      const roleIds = roleKeys.map((k) => roles.find((r) => r.systemKey === k).id);
      const email = h.uniqueEmail(tag);
      await owner.call('post', '/tenants/invitations').send({ email, roleIds }).expect(201);
      const token = h.tokenFrom(h.lastEmail(email, 'invitation').data.url);
      const c = h.client();
      await c
        .call('post', '/auth/accept-invite')
        .send({ token, fullName: `Member ${tag}`, password: PASSWORD })
        .expect(200);
      await c.login(email);
      c.email = email;
      const me = (await c.call('get', '/auth/me').expect(200)).body;
      c.userId = me.user.id;
      c.tenantId = me.tenant.id;
      c.membershipId = (await owner.call('get', '/tenants/members').expect(200)).body.data.find(
        (m) => m.email === email,
      ).id;
      return c;
    },
  };
  return h;
}
