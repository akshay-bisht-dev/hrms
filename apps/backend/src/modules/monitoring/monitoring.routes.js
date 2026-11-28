// @ts-check
import { Router } from 'express';
import {
  AccessLogQuery,
  AcknowledgeBody,
  ActivationBody,
  ActivationPatch,
  AgentIdleBody,
  AgentStartBody,
  ConfirmBody,
  DeleteScreenshotBody,
  DisputeBody,
  IncidentBody,
  RefreshDeviceBody,
  RegisterDeviceBody,
  ResolveDisputeBody,
  ResolveIncidentBody,
  RevokeDeviceBody,
  ScreenshotListQuery,
  ScreenshotPolicyBody,
  ScreenshotPolicyChange,
  SkipBody,
  SlotBody,
} from '@hrms/shared/schemas/monitoring';
import { BreakBody, SessionSignalBody } from '@hrms/shared/schemas/work';
import { z } from 'zod';
import { IdParams } from '../../lib/crud.js';
import { ipRateLimit } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { registry } from '../../openapi/registry.js';
import { attachmentDisposition } from '../../lib/storage.js';
import { currentContext } from '../../lib/context.js';

const json = (/** @type {any} */ schema) => ({ body: { content: { 'application/json': { schema } } } });
/** @param {string} base @param {string} tag */
const docFor =
  (base, tag) =>
  (/** @type {string} */ method, /** @type {string} */ path, /** @type {string} */ summary, extra = {}) =>
    registry.registerPath({
      method: /** @type {any} */ (method),
      path: `${base}${path}`,
      tags: [tag],
      summary,
      responses: { 200: { description: 'OK' } },
      ...extra,
    });
const byId = { request: { params: IdParams } };
const ThumbQuery = z.object({ thumb: z.enum(['true', 'false']).optional() }).strict();

const m = docFor('/api/v1/monitoring', 'Monitoring');
m('get', '/me', 'Whether monitoring applies to you, why or why not, and the notice');
m('post', '/me/acknowledge', 'Acknowledge the monitoring notice', { request: json(AcknowledgeBody) });
m('get', '/jurisdictions', 'What each work country allows (provisional registry entries are marked)');
m('get', '/activations', 'Monitoring checklist versions');
m('post', '/activations', 'Start a new checklist version (draft)', { request: json(ActivationBody) });
m('patch', '/activations/{id}', 'Change the draft checklist', {
  request: { params: IdParams, ...json(ActivationPatch) },
});
m(
  'post',
  '/activations/{id}/complete',
  'Complete the checklist: monitoring may start (after the notice period)',
  byId,
);
m('post', '/activations/{id}/pause', 'Stop all monitoring now', byId);
m('post', '/activations/{id}/resume', 'Resume monitoring', byId);
m('get', '/policies', 'Screenshot policies, every version');
m('post', '/policies', 'Create a screenshot policy', { request: json(ScreenshotPolicyBody) });
m('post', '/policies/{id}/versions', 'Change a screenshot policy (new version)', {
  request: { params: IdParams, ...json(ScreenshotPolicyChange) },
});

const d = docFor('/api/v1/devices', 'Devices');
d('post', '/pairing-codes', 'A one-time code to connect the desktop app (10 minutes)');
d('post', '/register', 'Desktop app: connect with a pairing code', { request: json(RegisterDeviceBody) });
d('post', '/token/refresh', 'Desktop app: new access token (rotates the refresh token)', {
  request: json(RefreshDeviceBody),
});
d('get', '/me', 'Your connected computers');
d('post', '/me/{id}/revoke', 'Disconnect one of your computers', {
  request: { params: IdParams, ...json(RevokeDeviceBody) },
});
d('get', '', 'All connected computers (manage_monitoring_policy)');
d('post', '/{id}/approve', 'Approve a computer', byId);
d('post', '/{id}/revoke', 'Disconnect a computer', {
  request: { params: IdParams, ...json(RevokeDeviceBody) },
});

const a = docFor('/api/v1/agent', 'Desktop agent');
a('get', '/me', 'Device token: who, what applies, the session and policy');
a('post', '/me/acknowledge', 'Device token: acknowledge the notice in the desktop app', {
  request: json(AcknowledgeBody),
});
a('post', '/sessions', 'Device token: start a work session', { request: json(AgentStartBody) });
a('post', '/sessions/current/heartbeat', 'Device token: the agent is running', {
  request: json(SessionSignalBody),
});
a('post', '/sessions/current/break/start', 'Device token: start a break', { request: json(BreakBody) });
a('post', '/sessions/current/break/end', 'Device token: end the break', { request: json(SessionSignalBody) });
a(
  'post',
  '/sessions/current/idle',
  'Device token: no keyboard or mouse use for the idle threshold (or back)',
  { request: json(AgentIdleBody) },
);
a('post', '/sessions/current/end', 'Device token: end the session', { request: json(SessionSignalBody) });
a('post', '/screenshots/slots', 'Device token: ask to upload a screenshot (server checks every rule)', {
  request: json(SlotBody),
});
a('post', '/screenshots/{id}/confirm', 'Device token: the upload finished', {
  request: { params: IdParams, ...json(ConfirmBody) },
});
a('post', '/screenshots/skips', 'Device token: why a capture was skipped (reason only)', {
  request: json(SkipBody),
});

const s = docFor('/api/v1/screenshots', 'Screenshots');
s('get', '', 'Screenshots of a day (yours, or someone in your viewing scope); metadata only', {
  request: { query: ScreenshotListQuery },
});
s('get', '/{id}/view-url', 'A 60-second link to one screenshot (logged)', {
  request: { params: IdParams, query: ThumbQuery },
});
s('post', '/{id}/download', 'A watermarked copy (download_screenshots; logged)', byId);
s('post', '/{id}/delete', 'Delete a screenshot (logged with the reason)', {
  request: { params: IdParams, ...json(DeleteScreenshotBody) },
});
s('post', '/{id}/disputes', 'Dispute your screenshot (hidden from managers at once)', {
  request: { params: IdParams, ...json(DisputeBody) },
});
s('get', '/disputes', 'Disputes: yours, or all (manage_monitoring_policy)');
s('post', '/disputes/{id}/resolve', 'Resolve a dispute', {
  request: { params: IdParams, ...json(ResolveDisputeBody) },
});
s('post', '/privacy-incidents', 'Report a privacy incident', { request: json(IncidentBody) });
s('get', '/privacy-incidents', 'Privacy incidents: yours, or all (manage_monitoring_policy)');
s('post', '/privacy-incidents/{id}/resolve', 'Resolve a privacy incident', {
  request: { params: IdParams, ...json(ResolveIncidentBody) },
});
s('get', '/access-logs', 'Who viewed, downloaded or deleted screenshots', {
  request: { query: AccessLogQuery },
});

/**
 * @param {{ access: any, governance: any }} deps
 */
export function monitoringRouter({ access, governance }) {
  const r = Router();
  const signedIn = access.authenticated();
  const manage = access.permission('manage_monitoring_policy');
  r.get('/me', signedIn, async (_req, res) =>
    res.set('Cache-Control', 'no-store').json(await governance.myStatus()),
  );
  r.post('/me/acknowledge', signedIn, validate({ body: AcknowledgeBody }), async (req, res) =>
    res.json(await governance.acknowledge(req.body, { ip: req.ip ?? null, channel: 'WEB' })),
  );
  r.get('/jurisdictions', manage, async (_req, res) => res.json({ data: await governance.jurisdictions() }));
  r.get('/activations', manage, async (_req, res) => res.json({ data: await governance.listActivations() }));
  r.post('/activations', manage, validate({ body: ActivationBody }), async (req, res) =>
    res.status(201).json(await governance.createDraft(req.body)),
  );
  r.patch(
    '/activations/:id',
    manage,
    validate({ params: IdParams, body: ActivationPatch }),
    async (req, res) => res.json(await governance.updateDraft(req.params.id, req.body)),
  );
  r.post('/activations/:id/complete', manage, validate({ params: IdParams }), async (req, res) =>
    res.json(await governance.complete(req.params.id)),
  );
  r.post('/activations/:id/pause', manage, validate({ params: IdParams }), async (req, res) =>
    res.json(await governance.setPaused(req.params.id, true)),
  );
  r.post('/activations/:id/resume', manage, validate({ params: IdParams }), async (req, res) =>
    res.json(await governance.setPaused(req.params.id, false)),
  );
  r.get('/policies', manage, async (_req, res) => res.json({ data: await governance.listPolicies() }));
  r.post('/policies', manage, validate({ body: ScreenshotPolicyBody }), async (req, res) =>
    res.status(201).json(await governance.createPolicy(req.body)),
  );
  r.post(
    '/policies/:id/versions',
    manage,
    validate({ params: IdParams, body: ScreenshotPolicyChange }),
    async (req, res) => res.status(201).json(await governance.changePolicy(req.params.id, req.body)),
  );
  return r;
}

/**
 * @param {{ access: any, devices: any, redis?: any, registerLimitPerMin?: number }} deps
 */
export function devicesRouter({ access, devices, redis, registerLimitPerMin = 20 }) {
  const r = Router();
  const signedIn = access.authenticated();
  const manage = access.permission('manage_monitoring_policy');
  // Pairing codes are short, so registration is rate-limited per IP; refresh tokens are long and random.
  const limit = redis
    ? ipRateLimit({ redis, name: 'device-register', windowSec: 60, limit: registerLimitPerMin })
    : (/** @type {any} */ _req, /** @type {any} */ _res, /** @type {any} */ next) => next();
  r.post('/pairing-codes', signedIn, async (_req, res) =>
    res.status(201).json(await devices.createPairingCode()),
  );
  r.post('/register', access.public(), limit, validate({ body: RegisterDeviceBody }), async (req, res) =>
    res
      .status(201)
      .set('Cache-Control', 'no-store')
      .json(await devices.register(req.body, { ip: req.ip ?? null })),
  );
  r.post('/token/refresh', access.public(), limit, validate({ body: RefreshDeviceBody }), async (req, res) =>
    res.set('Cache-Control', 'no-store').json(await devices.refresh(req.body.refreshToken)),
  );
  r.get('/me', signedIn, async (_req, res) => res.json({ data: await devices.mine() }));
  r.post(
    '/me/:id/revoke',
    signedIn,
    validate({ params: IdParams, body: RevokeDeviceBody }),
    async (req, res) => res.json(await devices.revoke(req.params.id, req.body.reason, { asAdmin: false })),
  );
  r.get('/', manage, async (_req, res) => res.json({ data: await devices.list() }));
  r.post('/:id/approve', manage, validate({ params: IdParams }), async (req, res) =>
    res.json(await devices.approve(req.params.id)),
  );
  r.post('/:id/revoke', manage, validate({ params: IdParams, body: RevokeDeviceBody }), async (req, res) =>
    res.json(await devices.revoke(req.params.id, req.body.reason, { asAdmin: true })),
  );
  return r;
}

/**
 * The desktop agent's API: every route needs a device token (deviceAccess). Sessions go through the same
 * work-session service as the web app, so the rules and the event log are identical.
 * @param {{ device: () => any, governance: any, work: any, screenshots: any }} deps
 */
export function agentRouter({ device, governance, work, screenshots }) {
  const r = Router();
  r.get('/me', device(), async (_req, res) => {
    const c = /** @type {any} */ (currentContext());
    const [status, monitoring] = await Promise.all([work.status(), governance.monitoringFor(c.employeeId)]);
    const d = c.device;
    res.set('Cache-Control', 'no-store').json({
      device: { id: d.id, status: d.status, ownership: d.ownership },
      work: status,
      // What the agent may do on this computer, decided by the server.
      monitoring: {
        ...monitoring,
        captureAllowedOnThisDevice:
          monitoring.enabled &&
          d.status === 'ACTIVE' &&
          (monitoring.scope?.companyDevicesOnly === false || d.ownership === 'COMPANY_MANAGED'),
      },
    });
  });
  r.post('/me/acknowledge', device(), validate({ body: AcknowledgeBody }), async (req, res) =>
    res.json(await governance.acknowledge(req.body, { ip: req.ip ?? null, channel: 'DESKTOP_AGENT' })),
  );
  r.post('/sessions', device(), validate({ body: AgentStartBody }), async (req, res) =>
    res.status(201).json(await work.start(req.body)),
  );
  r.post('/sessions/current/heartbeat', device(), validate({ body: SessionSignalBody }), async (req, res) =>
    res.set('Cache-Control', 'no-store').json(await work.heartbeat(req.body)),
  );
  r.post('/sessions/current/break/start', device(), validate({ body: BreakBody }), async (req, res) =>
    res.json(await work.startBreak(req.body)),
  );
  r.post('/sessions/current/break/end', device(), validate({ body: SessionSignalBody }), async (req, res) =>
    res.json(await work.endBreak(req.body)),
  );
  r.post('/sessions/current/idle', device(), validate({ body: AgentIdleBody }), async (req, res) => {
    await work.recordIdle(/** @type {any} */ (currentContext()).employeeId, req.body.state);
    res.json({ ok: true });
  });
  r.post('/sessions/current/end', device(), validate({ body: SessionSignalBody }), async (req, res) =>
    res.json(await work.end(req.body)),
  );
  r.post('/screenshots/slots', device(), validate({ body: SlotBody }), async (req, res) =>
    res
      .status(201)
      .set('Cache-Control', 'no-store')
      .json(await screenshots.slot(req.body)),
  );
  r.post(
    '/screenshots/:id/confirm',
    device(),
    validate({ params: IdParams, body: ConfirmBody }),
    async (req, res) => res.json(await screenshots.confirm(req.params.id, req.body)),
  );
  r.post('/screenshots/skips', device(), validate({ body: SkipBody }), async (req, res) =>
    res.status(201).json(await screenshots.skip(req.body)),
  );
  return r;
}

/** @param {{ access: any, screenshots: any }} deps */
export function screenshotsRouter({ access, screenshots }) {
  const r = Router();
  const signedIn = access.authenticated();
  r.get('/', signedIn, validate({ query: ScreenshotListQuery }), async (req, res) =>
    res.set('Cache-Control', 'no-store').json(await screenshots.list(/** @type {any} */ (req.query))),
  );
  r.get('/disputes', signedIn, async (_req, res) => res.json({ data: await screenshots.listDisputes() }));
  r.get('/privacy-incidents', signedIn, async (_req, res) =>
    res.json({ data: await screenshots.listIncidents() }),
  );
  r.get('/access-logs', signedIn, validate({ query: AccessLogQuery }), async (req, res) =>
    res.json({ data: await screenshots.accessLog(/** @type {any} */ (req.query)) }),
  );
  r.post('/privacy-incidents', signedIn, validate({ body: IncidentBody }), async (req, res) =>
    res.status(201).json(await screenshots.reportIncident(req.body)),
  );
  r.post(
    '/privacy-incidents/:id/resolve',
    signedIn,
    validate({ params: IdParams, body: ResolveIncidentBody }),
    async (req, res) => res.json(await screenshots.resolveIncident(req.params.id, req.body)),
  );
  r.post(
    '/disputes/:id/resolve',
    signedIn,
    validate({ params: IdParams, body: ResolveDisputeBody }),
    async (req, res) => res.json(await screenshots.resolveDispute(req.params.id, req.body)),
  );
  r.get('/:id/view-url', signedIn, validate({ params: IdParams, query: ThumbQuery }), async (req, res) =>
    res
      .set('Cache-Control', 'no-store')
      .json(
        await screenshots.viewUrl(req.params.id, { thumb: /** @type {any} */ (req.query).thumb === 'true' }),
      ),
  );
  r.post('/:id/download', signedIn, validate({ params: IdParams }), async (req, res) => {
    const out = await screenshots.download(req.params.id);
    res
      .set({
        'Content-Type': 'image/webp',
        'Content-Disposition': attachmentDisposition(out.fileName),
        'Cache-Control': 'no-store',
      })
      .send(out.body);
  });
  r.post(
    '/:id/delete',
    signedIn,
    validate({ params: IdParams, body: DeleteScreenshotBody }),
    async (req, res) => res.json(await screenshots.remove(req.params.id, req.body.reason)),
  );
  r.post('/:id/disputes', signedIn, validate({ params: IdParams, body: DisputeBody }), async (req, res) =>
    res.status(201).json(await screenshots.dispute(req.params.id, req.body)),
  );
  return r;
}
