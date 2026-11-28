// Integration: monitoring governance, device pairing and tokens, the agent API, and the screenshot pipeline
// (real MySQL, Redis and S3). The agent is played by HTTP calls with a device token, exactly as the desktop app does.
import { createHash } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { runWithContext } from '../src/lib/context.js';
import { db, platformDb } from '../src/lib/db.js';
import { newId } from '@hrms/shared/ids';
import { startHarness } from './helpers/harness.js';

let h;
let owner; // Company Admin, MFA: the only default role with screenshot permissions
let manager; // team_leader linked to `mgr`: a manager, but no screenshot access
let worker; // employee linked to `emp` (India), reports to `mgr`
let outsider; // employee linked to `other` (UAE: no jurisdiction entry → fail closed)
let emp;
let other;
let office;
let activation;
let policy;
let device; // { deviceId, accessToken, refreshToken }
let shot; // screenshot id
const tenantCtx = (fn) =>
  runWithContext({ requestId: 't', tenantId: owner.tenantId }, async () => await fn());
const agent = (token) => ({
  get: (path) => request(h.app).get(`/api/v1/agent${path}`).set('Authorization', `Bearer ${token}`),
  post: (path, body = {}) =>
    request(h.app).post(`/api/v1/agent${path}`).set('Authorization', `Bearer ${token}`).send(body),
});
const webp = (color = '#336699') =>
  sharp({ create: { width: 64, height: 48, channels: 3, background: color } })
    .webp()
    .toBuffer();
const facts = (n = 1) => ({
  os: 'LINUX',
  osVersion: '6.8',
  agentVersion: '0.1.0',
  fingerprintHash: createHash('sha256').update(`machine-${n}-${Date.now()}`).digest('hex'),
  ownership: 'COMPANY_MANAGED',
});
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

beforeAll(async () => {
  h = await startHarness();
  owner = await h.owner('monitor', { mfa: true });
  const le = (await owner.call('get', '/companies/legal-entities').expect(200)).body.data[0];
  const post = async (path, body) => (await owner.call('post', path).send(body).expect(201)).body;
  const person = (firstName, extra = {}) =>
    post('/employees', {
      firstName,
      legalEntityId: le.id,
      dateOfJoining: '2026-01-05',
      timezone: 'Asia/Kolkata',
      ...extra,
    });
  const mgr = await person('Maya');
  emp = await person('Ravi', { managerId: mgr.id });
  other = await person('Omar', { workCountry: 'AE', timezone: 'Asia/Dubai' });
  const link = async (roleKey, employee, tag) => {
    const m = await h.member(owner, [roleKey], tag);
    await owner
      .call('put', `/tenants/members/${m.membershipId}/employee`)
      .send({ employeeId: employee.id })
      .expect(204);
    return m;
  };
  manager = await link('team_leader', mgr, 'mmgr');
  worker = await link('employee', emp, 'mwrk');
  outsider = await link('employee', other, 'mout');
  office = await post('/companies/work-locations', { name: 'Office', type: 'OFFICE' });
});
afterAll(() => h.stop());

describe('governance: off by default, a completed checklist, jurisdiction and notice', () => {
  test('monitoring is off for everyone until the checklist is completed', async () => {
    expect((await worker.call('get', '/monitoring/me').expect(200)).body).toMatchObject({
      enabled: false,
      reason: 'NOT_ACTIVATED',
    });
    await worker.call('get', '/monitoring/activations').expect(403);
    await manager.call('post', '/monitoring/activations').send({}).expect(403);
  });

  test('the checklist cannot be completed until every country step and the legal-advice confirmation are recorded', async () => {
    const roles = (await owner.call('get', '/tenants/roles').expect(200)).body.data;
    const adminRole = roles.find((r) => r.systemKey === 'company_admin').id;
    const j = (await owner.call('get', '/monitoring/jurisdictions').expect(200)).body.data;
    expect(j.find((x) => x.country === 'IN')).toMatchObject({
      screenshots: 'ALLOWED_WITH_STEPS',
      legalReviewed: false,
    });
    expect(j.find((x) => x.country === 'AE')).toMatchObject({ screenshots: 'UNKNOWN' });
    activation = (
      await owner
        .call('post', '/monitoring/activations')
        .send({
          purpose:
            'To verify remote work time for client billing and protect client data on company laptops.',
          scope: { appliesTo: 'COMPANY' },
          lawfulBasis: {
            basis: 'LEGITIMATE_INTEREST',
            explanation: 'Client contracts require proof of time worked on their projects.',
          },
          noticeText:
            'While you run a work session in the desktop app on a company laptop, it takes a screenshot about every 10 minutes. Screenshots are kept for 30 days, viewed only by the HR administrators, and you can see and dispute your own.',
          noticeStartsOn: today(),
          viewerRoleIds: [adminRole],
          retentionDays: 30,
          contacts: {
            privacyContactName: 'Priya Privacy',
            privacyContactEmail: 'privacy@example.com',
            grievanceEmail: 'grievance@example.com',
          },
          reviewDueOn: '2027-03-01',
        })
        .expect(201)
    ).body;
    const fail = await owner.call('post', `/monitoring/activations/${activation.id}/complete`).expect(422);
    const paths = fail.body.errors.map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'body.ownLegalAdviceConfirmed',
        'body.jurisdictionSteps.IN.WRITTEN_NOTICE',
        'body.jurisdictionSteps.IN.PURPOSE_LIMITATION',
      ]),
    );
    // The UAE has no registry entry: it is simply left off, never blocks the others.
    expect(paths.some((p) => p.includes('.AE.'))).toBe(false);
    await owner
      .call('patch', `/monitoring/activations/${activation.id}`)
      .send({
        ownLegalAdviceConfirmed: true,
        jurisdictionSteps: {
          IN: {
            WRITTEN_NOTICE: { done: true, note: 'Emailed 2026-11-20' },
            PURPOSE_LIMITATION: { done: true },
          },
        },
      })
      .expect(200);
    activation = (await owner.call('post', `/monitoring/activations/${activation.id}/complete`).expect(200))
      .body;
    expect(activation).toMatchObject({ status: 'ACTIVE', version: 1 });
    await owner
      .call('patch', `/monitoring/activations/${activation.id}`)
      .send({ retentionDays: 14 })
      .expect(409);
  });

  test('India waits for the notice period; the UAE stays off (fail closed)', async () => {
    const me = (await worker.call('get', '/monitoring/me').expect(200)).body;
    expect(me).toMatchObject({ enabled: false, reason: 'NOTICE_PERIOD' });
    expect((await outsider.call('get', '/monitoring/me').expect(200)).body).toMatchObject({
      enabled: false,
      reason: 'JURISDICTION_UNKNOWN',
      country: 'AE',
    });
    // Pretend the checklist was completed long enough ago for India's notice period to have passed.
    await platformDb().monitoringActivation.update({
      where: { id: activation.id },
      data: {
        completedAt: new Date(Date.now() - 10 * 86_400_000),
        noticeStartsOn: new Date(Date.now() - 10 * 86_400_000),
      },
    });
    expect((await worker.call('get', '/monitoring/me').expect(200)).body.reason).toBe('NO_POLICY');
  });

  test('a policy turns capture on; application activity can never be switched on', async () => {
    const body = {
      name: 'Laptops',
      enabled: true,
      intervalMin: 5,
      jitterPct: 0,
      retentionDays: 30,
      effectiveFrom: today(),
    };
    await owner
      .call('post', '/monitoring/policies')
      .send({ ...body, activityTrackingEnabled: true })
      .expect(422);
    await owner
      .call('post', '/monitoring/policies')
      .send({ ...body, intervalMin: 1 })
      .expect(422);
    await owner
      .call('post', '/monitoring/policies')
      .send({ ...body, retentionDays: 60 })
      .expect(422); // over the checklist's 30
    policy = (await owner.call('post', '/monitoring/policies').send(body).expect(201)).body;
    const me = (await worker.call('get', '/monitoring/me').expect(200)).body;
    expect(me).toMatchObject({ enabled: false, reason: 'ACK_REQUIRED', notice: { retentionDays: 30 } });
    expect(me.notice.text).toMatch(/every 10 minutes/);
  });

  test('the employee acknowledges the notice; pausing stops monitoring for everyone at once', async () => {
    await worker
      .call('post', '/monitoring/me/acknowledge')
      .send({ activationId: '00000000-0000-4000-8000-000000000000' })
      .expect(409);
    const on = (
      await worker
        .call('post', '/monitoring/me/acknowledge')
        .send({ activationId: activation.id })
        .expect(200)
    ).body;
    expect(on).toMatchObject({
      enabled: true,
      reason: 'ON',
      legalReviewed: false,
      policy: { id: policy.id, intervalMin: 5 },
    });
    await owner.call('post', `/monitoring/activations/${activation.id}/pause`).expect(200);
    expect((await worker.call('get', '/monitoring/me').expect(200)).body.reason).toBe('NOT_ACTIVATED');
    await owner.call('post', `/monitoring/activations/${activation.id}/resume`).expect(200);
    expect((await worker.call('get', '/monitoring/me').expect(200)).body.enabled).toBe(true);
  });
});

describe('devices: pairing, tokens, approval', () => {
  test('a one-time code pairs the desktop app; codes are single-use; new devices wait for approval', async () => {
    await request(h.app)
      .post('/api/v1/devices/register')
      .send({ ...facts(), code: 'ABCD-EFGH' })
      .expect(400);
    const { code } = (await worker.call('post', '/devices/pairing-codes').expect(201)).body;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    device = (
      await request(h.app)
        .post('/api/v1/devices/register')
        .send({ ...facts(1), code })
        .expect(201)
    ).body;
    expect(device).toMatchObject({ status: 'PENDING', expiresInSec: 600 });
    await request(h.app)
      .post('/api/v1/devices/register')
      .send({ ...facts(2), code })
      .expect(400);
    const mine = (await worker.call('get', '/devices/me').expect(200)).body.data;
    expect(mine.map((d) => d.id)).toEqual([device.deviceId]);
  });

  test('device tokens and web tokens are not interchangeable', async () => {
    const me = (await agent(device.accessToken).get('/me').expect(200)).body;
    expect(me.monitoring).toMatchObject({ enabled: true, captureAllowedOnThisDevice: false });
    expect(me.device).toMatchObject({ status: 'PENDING', ownership: 'COMPANY_MANAGED' });
    await agent(worker.token).get('/me').expect(401);
    await request(h.app)
      .get('/api/v1/work/me/status')
      .set('Authorization', `Bearer ${device.accessToken}`)
      .expect(401);
  });

  test('refresh tokens rotate; presenting an old one ends the whole family', async () => {
    const fresh = (
      await request(h.app)
        .post('/api/v1/devices/token/refresh')
        .send({ refreshToken: device.refreshToken })
        .expect(200)
    ).body;
    const reuse = await request(h.app)
      .post('/api/v1/devices/token/refresh')
      .send({ refreshToken: device.refreshToken })
      .expect(401);
    expect(reuse.body.code).toBe('token_reused');
    expect(
      (
        await request(h.app)
          .post('/api/v1/devices/token/refresh')
          .send({ refreshToken: fresh.refreshToken })
          .expect(401)
      ).body.code,
    ).toBe('device_revoked');
    // Pair again (same computer): a new family; the device keeps its identity.
    const { code } = (await worker.call('post', '/devices/pairing-codes').expect(201)).body;
    const known = await tenantCtx(() => db().monitoredDevice.findUnique({ where: { id: device.deviceId } }));
    const again = (
      await request(h.app)
        .post('/api/v1/devices/register')
        .send({ ...facts(1), fingerprintHash: known.fingerprintHash, code })
        .expect(201)
    ).body;
    expect(again.deviceId).toBe(device.deviceId);
    device = again;
  });
});

describe('screenshots: only when the server agrees', () => {
  const slot = (token, body) => agent(token).post('/screenshots/slots', body);
  let session;

  test('no capture while the device is pending, or without a running session', async () => {
    const base = {
      sessionId: '00000000-0000-4000-8000-000000000001',
      policyId: policy.id,
      policyVersion: 1,
      capturedAt: new Date().toISOString(),
    };
    expect((await slot(device.accessToken, base).expect(409)).body.code).toBe('device_pending');
    await manager.call('post', `/devices/${device.deviceId}/approve`).expect(403); // managers don't manage monitoring
    await owner.call('post', `/devices/${device.deviceId}/approve`).expect(200);
    expect((await slot(device.accessToken, base).expect(409)).body.code).toBe('session_not_active');
  });

  test('the agent starts a session through the same rules as the web app', async () => {
    const started = (
      await agent(device.accessToken).post('/sessions', { workLocationId: office.id }).expect(201)
    ).body;
    session = started.active;
    expect(session.status).toBe('ACTIVE');
    const ev = await tenantCtx(() =>
      db().workSessionEvent.findFirst({ where: { sessionId: session.id, type: 'START' } }),
    );
    expect(ev).toMatchObject({ source: 'DESKTOP_AGENT', deviceId: device.deviceId });
    await agent(device.accessToken).post('/sessions/current/heartbeat').expect(200);
  });

  test('an outdated policy is refused; a valid capture uploads, is verified, stripped and thumbnailed', async () => {
    const body = {
      sessionId: session.id,
      policyId: policy.id,
      policyVersion: 2,
      capturedAt: new Date().toISOString(),
    };
    expect((await slot(device.accessToken, body).expect(409)).body.code).toBe('policy_outdated');
    const s = (await slot(device.accessToken, { ...body, policyVersion: 1 }).expect(201)).body;
    expect(s.upload.url).not.toContain('hrms-screenshots.s3.amazonaws.com/?'); // a signed, single-object URL
    expect(s.upload.url).toMatch(/X-Amz-Expires=60/);
    shot = s.screenshotId;
    const img = await webp();
    const put = await fetch(s.upload.url, {
      method: 'PUT',
      body: img,
      headers: { 'Content-Type': 'image/webp' },
    });
    expect(put.ok).toBe(true);
    await agent(device.accessToken)
      .post(`/screenshots/${shot}/confirm`, {
        sha256: createHash('sha256').update(img).digest('hex'),
        bytes: img.length,
      })
      .expect(200);
    expect(h.jobs.screenshots.at(-1)).toMatchObject({
      name: 'screenshot-process',
      data: { screenshotId: shot },
    });
    expect(await tenantCtx(() => h.services.screenshots.process(shot))).toMatchObject({
      status: 'AVAILABLE',
    });
    // Faster than the interval: refused.
    expect((await slot(device.accessToken, { ...body, policyVersion: 1 }).expect(409)).body.code).toBe(
      'too_soon',
    );
  });

  test('an upload that is not what was confirmed is rejected and removed', async () => {
    // A second company laptop for the same person.
    const { code } = (await worker.call('post', '/devices/pairing-codes').expect(201)).body;
    const d2 = (
      await request(h.app)
        .post('/api/v1/devices/register')
        .send({ ...facts(3), code })
        .expect(201)
    ).body;
    await owner.call('post', `/devices/${d2.deviceId}/approve`).expect(200);
    const s = (
      await slot(d2.accessToken, {
        sessionId: session.id,
        policyId: policy.id,
        policyVersion: 1,
        capturedAt: new Date().toISOString(),
      }).expect(201)
    ).body;
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    await fetch(s.upload.url, { method: 'PUT', body: png, headers: { 'Content-Type': 'image/webp' } });
    await agent(d2.accessToken)
      .post(`/screenshots/${s.screenshotId}/confirm`, {
        sha256: createHash('sha256').update(png).digest('hex'),
        bytes: png.length,
      })
      .expect(200);
    expect(await tenantCtx(() => h.services.screenshots.process(s.screenshotId))).toMatchObject({
      status: 'INVALID',
      why: 'type',
    });
    // Revoking a device stops it at once.
    await owner
      .call('post', `/devices/${d2.deviceId}/revoke`)
      .send({ reason: 'Laptop returned' })
      .expect(200);
    expect((await agent(d2.accessToken).get('/me').expect(401)).body.code).toBe('device_revoked');
  });

  test('skips record a reason only', async () => {
    await agent(device.accessToken)
      .post('/screenshots/skips', {
        sessionId: session.id,
        reason: 'EXCLUDED_APP',
        occurredAt: new Date().toISOString(),
      })
      .expect(201);
    const list = (await worker.call('get', '/screenshots').expect(200)).body;
    expect(list.skipped).toEqual([{ reason: 'EXCLUDED_APP', count: 1 }]);
  });
});

describe('viewing, disputes, deletion and retention', () => {
  test('people see their own; managers without the permission see nothing; every view is logged', async () => {
    const mine = (await worker.call('get', '/screenshots').expect(200)).body.data;
    expect(mine.map((x) => x.id)).toContain(shot);
    const view = (await worker.call('get', `/screenshots/${shot}/view-url`).expect(200)).body;
    expect(view.expiresInSec).toBe(60);
    const img = await fetch(view.url);
    expect(img.headers.get('content-type')).toBe('image/webp');
    const meta = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
    expect(meta.exif).toBeUndefined(); // re-encoded without metadata
    await manager.call('get', `/screenshots?employeeId=${emp.id}`).expect(403);
    await manager.call('get', `/screenshots/${shot}/view-url`).expect(404);
    await outsider.call('get', `/screenshots/${shot}/view-url`).expect(404);
    await owner.call('get', `/screenshots/${shot}/view-url`).expect(200);
    const log = (await worker.call('get', `/screenshots/access-logs?screenshotId=${shot}`).expect(200)).body
      .data;
    expect(log.filter((l) => l.action === 'VIEW').map((l) => l.actorUserId)).toEqual(
      expect.arrayContaining([worker.userId, owner.userId]),
    );
    await outsider.call('get', `/screenshots/access-logs?screenshotId=${shot}`).expect(404);
  });

  test('downloads need the permission and are watermarked', async () => {
    await worker.call('post', `/screenshots/${shot}/download`).expect(403);
    const res = await owner
      .call('post', `/screenshots/${shot}/download`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    const original = await (
      await fetch((await owner.call('get', `/screenshots/${shot}/view-url`).expect(200)).body.url)
    ).arrayBuffer();
    expect(Buffer.compare(res.body, Buffer.from(original))).not.toBe(0);
  });

  test('a dispute hides the screenshot until someone else reviews it', async () => {
    await worker
      .call('post', `/screenshots/${shot}/disputes`)
      .send({ reason: 'A personal message was on screen' })
      .expect(201);
    await worker.call('post', `/screenshots/${shot}/disputes`).send({ reason: 'again again' }).expect(409);
    const disputes = (await owner.call('get', '/screenshots/disputes').expect(200)).body.data;
    const d = disputes.find((x) => x.screenshotId === shot);
    expect(d.status).toBe('OPEN');
    await worker
      .call('post', `/screenshots/disputes/${d.id}/resolve`)
      .send({ outcome: 'RESTORED', resolution: 'Restoring my own' })
      .expect(403);
    await owner
      .call('post', `/screenshots/disputes/${d.id}/resolve`)
      .send({ outcome: 'RESTORED', resolution: 'Only the code editor is visible' })
      .expect(200);
    expect(
      (await worker.call('get', '/screenshots').expect(200)).body.data.find((x) => x.id === shot).status,
    ).toBe('AVAILABLE');
  });

  test('people cannot delete unless the policy allows; an administrator deletes with a reason, logged', async () => {
    expect(
      (await worker.call('post', `/screenshots/${shot}/delete`).send({ reason: 'mine' }).expect(403)).body
        .code,
    ).toBe('delete_not_allowed');
    await owner.call('post', `/screenshots/${shot}/delete`).send({ reason: 'Privacy request' }).expect(200);
    await worker.call('get', `/screenshots/${shot}/view-url`).expect(404);
    const log = (await worker.call('get', `/screenshots/access-logs?screenshotId=${shot}`).expect(200)).body
      .data;
    expect(log[0]).toMatchObject({ action: 'DELETE', reason: 'Privacy request', actorUserId: owner.userId });
    const row = await tenantCtx(() => db().screenshotRecord.findUnique({ where: { id: shot } }));
    expect(row).toMatchObject({ status: 'DELETED', s3Key: null, thumbKey: null });
    await tenantCtx(() =>
      expect(db().screenshotAccessLog.deleteMany({ where: { screenshotId: shot } })).rejects.toThrow(),
    );
  });

  test('privacy incidents are reported by anyone and resolved by someone else', async () => {
    const i = (
      await worker
        .call('post', '/screenshots/privacy-incidents')
        .send({ description: 'The app kept running after I ended work' })
        .expect(201)
    ).body;
    expect((await outsider.call('get', '/screenshots/privacy-incidents').expect(200)).body.data).toEqual([]);
    await owner
      .call('post', `/screenshots/privacy-incidents/${i.id}/resolve`)
      .send({ resolution: 'Checked: the session had ended; nothing was captured after.' })
      .expect(200);
  });

  test('retention deletes the image but keeps a tombstone', async () => {
    // An image captured 40 days ago whose retention ended 10 days ago.
    const r = await tenantCtx(async () =>
      db().screenshotRecord.create({
        data: {
          id: newId(),
          employeeId: emp.id,
          sessionId: (await db().workSession.findFirst({ where: { employeeId: emp.id } })).id,
          deviceId: device.deviceId,
          policyId: policy.id,
          policyVersion: 1,
          status: 'AVAILABLE',
          capturedAtServer: new Date(Date.now() - 40 * 86_400_000),
          retentionUntil: new Date(Date.now() - 10 * 86_400_000),
          s3Key: 'tenant/x/old.webp',
        },
      }),
    );
    const out = await tenantCtx(() => h.services.screenshots.retentionSweep());
    expect(out.deleted).toBeGreaterThanOrEqual(1);
    expect(await tenantCtx(() => db().screenshotRecord.findUnique({ where: { id: r.id } }))).toMatchObject({
      status: 'DELETED',
      deleteReason: 'RETENTION',
    });
  });

  test('the agent ends the session; ending stops capture', async () => {
    await agent(device.accessToken).post('/sessions/current/end').expect(200);
    const body = {
      sessionId: '00000000-0000-4000-8000-000000000001',
      policyId: policy.id,
      policyVersion: 1,
      capturedAt: new Date().toISOString(),
    };
    expect((await agent(device.accessToken).post('/screenshots/slots', body).expect(409)).body.code).toBe(
      'session_not_active',
    );
  });
});
