// @ts-check
import { Router } from 'express';
import {
  BreakBody,
  CorrectionBody,
  DecisionBody,
  RequestListQuery,
  SessionListQuery,
  SessionSignalBody,
  StartSessionBody,
  TeamStatusQuery,
  WfhRequestBody,
  WorkPolicyBody,
  WorkPolicyChange,
} from '@hrms/shared/schemas/work';
import { IdParams } from '../../lib/crud.js';
import { validate } from '../../middleware/validate.js';
import { registry } from '../../openapi/registry.js';

const BASE = '/api/v1/work';
const json = (/** @type {any} */ schema) => ({ body: { content: { 'application/json': { schema } } } });
const doc = (
  /** @type {string} */ method,
  /** @type {string} */ path,
  /** @type {string} */ summary,
  extra = {},
) =>
  registry.registerPath({
    method: /** @type {any} */ (method),
    path: `${BASE}${path}`,
    tags: ['Work status'],
    summary,
    responses: { 200: { description: 'OK' } },
    ...extra,
  });
const byId = { request: { params: IdParams } };

doc('get', '/me/status', 'My work page: policy, locations, the running session, today and what is recorded');
doc('post', '/sessions', 'Start a work session (also clocks in)', { request: json(StartSessionBody) });
doc('post', '/sessions/current/heartbeat', 'The My work page is still open', {
  request: json(SessionSignalBody),
});
doc('post', '/sessions/current/break/start', 'Start a break', { request: json(BreakBody) });
doc('post', '/sessions/current/break/end', 'End the break', { request: json(SessionSignalBody) });
doc('post', '/sessions/current/end', 'End the session (also clocks out)', {
  request: json(SessionSignalBody),
});
doc('get', '/sessions', 'Your sessions, or one person in your team-status scope', {
  request: { query: SessionListQuery },
});
doc('get', '/sessions/{id}', 'One session with its timeline, breaks and corrections', byId);
doc('get', '/corrections', 'Your correction requests, or ones waiting for your decision', {
  request: { query: RequestListQuery },
});
doc('post', '/corrections', 'Ask for a correction to a finished session', { request: json(CorrectionBody) });
doc('post', '/corrections/{id}/decision', 'Approve or reject a correction', {
  request: { params: IdParams, ...json(DecisionBody) },
});
doc('post', '/corrections/{id}/cancel', 'Cancel your pending correction', byId);
doc('get', '/wfh-requests', 'Your work-from-home requests, or ones waiting for your decision', {
  request: { query: RequestListQuery },
});
doc('post', '/wfh-requests', 'Ask to work from home or another approved location', {
  request: json(WfhRequestBody),
});
doc('post', '/wfh-requests/{id}/decision', 'Approve or reject a work-from-home request', {
  request: { params: IdParams, ...json(DecisionBody) },
});
doc('post', '/wfh-requests/{id}/cancel', 'Cancel your request (pending, or approved and not yet used)', byId);
doc('get', '/team', "Your team's live work status and today's totals", {
  request: { query: TeamStatusQuery },
});
doc('get', '/policies', 'Work policies, every version');
doc('post', '/policies', 'Create a work policy', { request: json(WorkPolicyBody) });
doc('post', '/policies/{id}/versions', 'Change a policy: creates a new version from a date', {
  request: { params: IdParams, ...json(WorkPolicyChange) },
});
doc('post', '/policies/{id}/retire', 'End a policy from today', byId);

/**
 * Work Status routes. Self-service needs a signed-in member linked to an employee record; deciding requests goes
 * to the direct manager or the matching permission in scope (checked in the service); team status needs
 * view_team_work_status and policies need work.config.manage.
 * @param {{ access: ReturnType<typeof import('../../middleware/auth.js').access>, work: ReturnType<typeof import('./work.service.js').createWorkService> }} deps
 */
export function workRouter({ access, work }) {
  const r = Router();
  const signedIn = access.authenticated();
  const team = access.permission('view_team_work_status');
  const config = access.permission('work.config.manage');
  const noStore = (/** @type {any} */ res) => res.set('Cache-Control', 'no-store');

  r.get('/me/status', signedIn, async (_req, res) => noStore(res).json(await work.status()));
  r.post('/sessions', signedIn, validate({ body: StartSessionBody }), async (req, res) =>
    res.status(201).json(await work.start(req.body)),
  );
  r.post('/sessions/current/heartbeat', signedIn, validate({ body: SessionSignalBody }), async (req, res) =>
    noStore(res).json(await work.heartbeat(req.body)),
  );
  r.post('/sessions/current/break/start', signedIn, validate({ body: BreakBody }), async (req, res) =>
    res.json(await work.startBreak(req.body)),
  );
  r.post('/sessions/current/break/end', signedIn, validate({ body: SessionSignalBody }), async (req, res) =>
    res.json(await work.endBreak(req.body)),
  );
  r.post('/sessions/current/end', signedIn, validate({ body: SessionSignalBody }), async (req, res) =>
    res.json(await work.end(req.body)),
  );
  r.get('/sessions', signedIn, validate({ query: SessionListQuery }), async (req, res) =>
    res.json({ data: await work.listSessions(/** @type {any} */ (req.query)) }),
  );
  r.get('/sessions/:id', signedIn, validate({ params: IdParams }), async (req, res) =>
    res.json(await work.getSession(req.params.id)),
  );

  r.get('/corrections', signedIn, validate({ query: RequestListQuery }), async (req, res) =>
    res.json({ data: await work.listCorrections(/** @type {any} */ (req.query)) }),
  );
  r.post('/corrections', signedIn, validate({ body: CorrectionBody }), async (req, res) =>
    res.status(201).json(await work.requestCorrection(req.body)),
  );
  r.post(
    '/corrections/:id/decision',
    signedIn,
    validate({ params: IdParams, body: DecisionBody }),
    async (req, res) => res.json(await work.decideCorrection(req.params.id, req.body)),
  );
  r.post('/corrections/:id/cancel', signedIn, validate({ params: IdParams }), async (req, res) =>
    res.json(await work.cancelCorrection(req.params.id)),
  );

  r.get('/wfh-requests', signedIn, validate({ query: RequestListQuery }), async (req, res) =>
    res.json({ data: await work.listWfh(/** @type {any} */ (req.query)) }),
  );
  r.post('/wfh-requests', signedIn, validate({ body: WfhRequestBody }), async (req, res) =>
    res.status(201).json(await work.requestWfh(req.body)),
  );
  r.post(
    '/wfh-requests/:id/decision',
    signedIn,
    validate({ params: IdParams, body: DecisionBody }),
    async (req, res) => res.json(await work.decideWfh(req.params.id, req.body)),
  );
  r.post('/wfh-requests/:id/cancel', signedIn, validate({ params: IdParams }), async (req, res) =>
    res.json(await work.cancelWfh(req.params.id)),
  );

  r.get('/team', team, validate({ query: TeamStatusQuery }), async (req, res) =>
    noStore(res).json(await work.teamStatus(/** @type {any} */ (req.query))),
  );

  r.get('/policies', config, async (_req, res) => res.json({ data: await work.listPolicies() }));
  r.post('/policies', config, validate({ body: WorkPolicyBody }), async (req, res) =>
    res.status(201).json(await work.createPolicy(req.body)),
  );
  r.post(
    '/policies/:id/versions',
    config,
    validate({ params: IdParams, body: WorkPolicyChange }),
    async (req, res) => res.status(201).json(await work.changePolicy(req.params.id, req.body)),
  );
  r.post('/policies/:id/retire', config, validate({ params: IdParams }), async (req, res) =>
    res.json(await work.retirePolicy(req.params.id)),
  );
  return r;
}
