// @ts-check
import { Router } from 'express';
import { z } from 'zod';
import {
  CommentBody,
  ManualTimeBody,
  ProjectBody,
  ProjectMembersBody,
  ProjectPatch,
  TaskAssigneesBody,
  TaskBody,
  TaskListQuery,
  TaskPatch,
  TaskStatusBody,
  TimeEntryQuery,
} from '@hrms/shared/schemas/tasks';
import { IdParams } from '../../lib/crud.js';
import { validate } from '../../middleware/validate.js';
import { registry } from '../../openapi/registry.js';

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
const MemberParams = z.object({ id: z.uuid(), employeeId: z.uuid() }).strict();

const p = docFor('/api/v1/projects', 'Projects');
p('get', '', 'Projects you belong to (all, with project.manage)');
p('post', '', 'Create a project (project.manage)', { request: json(ProjectBody) });
p('patch', '/{id}', 'Change a project (project.manage or its owner)', {
  request: { params: IdParams, ...json(ProjectPatch) },
});
p('post', '/{id}/members', 'Add people to a project', {
  request: { params: IdParams, ...json(ProjectMembersBody) },
});
p('delete', '/{id}/members/{employeeId}', 'Remove someone from a project', {
  request: { params: MemberParams },
});

const t = docFor('/api/v1/tasks', 'Tasks');
t('get', '', 'Tasks: yours, ones you set, your team’s, or a project’s', {
  request: { query: TaskListQuery },
});
t('post', '', 'Create a task (for yourself, or for people you may assign work to)', {
  request: json(TaskBody),
});
t('get', '/timer', 'Your running task timer');
t('post', '/timer/stop', 'Stop your running task timer');
t('get', '/time-entries', 'Your task time between two dates', { request: { query: TimeEntryQuery } });
t('post', '/time-entries', 'Add time by hand for a recent day', { request: json(ManualTimeBody) });
t('delete', '/time-entries/{id}', 'Remove time you entered by hand', byId);
t('get', '/{id}', 'One task with comments, subtasks and what you may do', byId);
t('patch', '/{id}', 'Change a task (reviewers; assignees may update progress)', {
  request: { params: IdParams, ...json(TaskPatch) },
});
t('delete', '/{id}', 'Delete a task with no recorded time', byId);
t('put', '/{id}/assignees', 'Replace who works on the task', {
  request: { params: IdParams, ...json(TaskAssigneesBody) },
});
t('post', '/{id}/status', 'Move the task to another status', {
  request: { params: IdParams, ...json(TaskStatusBody) },
});
t('post', '/{id}/comments', 'Comment on a task', { request: { params: IdParams, ...json(CommentBody) } });
t('post', '/{id}/timer/start', 'Start a timer on the task (inside a running work session)', byId);

/**
 * Projects router. Listing is for members; changes need project.manage or being the owner (checked in the service).
 * @param {{ access: any, tasks: ReturnType<typeof import('./tasks.service.js').createTasksService> }} deps
 */
export function projectsRouter({ access, tasks }) {
  const r = Router();
  const signedIn = access.authenticated();
  r.get('/', signedIn, async (_req, res) => res.json({ data: await tasks.listProjects() }));
  r.post('/', signedIn, validate({ body: ProjectBody }), async (req, res) =>
    res.status(201).json(await tasks.createProject(req.body)),
  );
  r.patch('/:id', signedIn, validate({ params: IdParams, body: ProjectPatch }), async (req, res) =>
    res.json(await tasks.updateProject(req.params.id, req.body)),
  );
  r.post(
    '/:id/members',
    signedIn,
    validate({ params: IdParams, body: ProjectMembersBody }),
    async (req, res) => res.json(await tasks.addMembers(req.params.id, req.body)),
  );
  r.delete('/:id/members/:employeeId', signedIn, validate({ params: MemberParams }), async (req, res) => {
    await tasks.removeMember(req.params.id, req.params.employeeId);
    res.status(204).end();
  });
  return r;
}

/**
 * Tasks router. Every route needs a signed-in member; who may see or change a task is decided per task.
 * @param {{ access: any, tasks: ReturnType<typeof import('./tasks.service.js').createTasksService> }} deps
 */
export function tasksRouter({ access, tasks }) {
  const r = Router();
  const signedIn = access.authenticated();
  r.get('/', signedIn, validate({ query: TaskListQuery }), async (req, res) =>
    res.json({ data: await tasks.listTasks(/** @type {any} */ (req.query)) }),
  );
  r.post('/', signedIn, validate({ body: TaskBody }), async (req, res) =>
    res.status(201).json(await tasks.createTask(req.body)),
  );
  r.get('/timer', signedIn, async (_req, res) =>
    res.set('Cache-Control', 'no-store').json({ timer: await tasks.currentTimer() }),
  );
  r.post('/timer/stop', signedIn, async (_req, res) => res.json(await tasks.stopTimer()));
  r.get('/time-entries', signedIn, validate({ query: TimeEntryQuery }), async (req, res) =>
    res.json({ data: await tasks.myTimeEntries(/** @type {any} */ (req.query)) }),
  );
  r.post('/time-entries', signedIn, validate({ body: ManualTimeBody }), async (req, res) =>
    res.status(201).json(await tasks.addManualTime(req.body)),
  );
  r.delete('/time-entries/:id', signedIn, validate({ params: IdParams }), async (req, res) => {
    await tasks.deleteTimeEntry(req.params.id);
    res.status(204).end();
  });
  r.get('/:id', signedIn, validate({ params: IdParams }), async (req, res) =>
    res.json(await tasks.getTask(req.params.id)),
  );
  r.patch('/:id', signedIn, validate({ params: IdParams, body: TaskPatch }), async (req, res) =>
    res.json(await tasks.updateTask(req.params.id, req.body)),
  );
  r.delete('/:id', signedIn, validate({ params: IdParams }), async (req, res) => {
    await tasks.deleteTask(req.params.id);
    res.status(204).end();
  });
  r.put(
    '/:id/assignees',
    signedIn,
    validate({ params: IdParams, body: TaskAssigneesBody }),
    async (req, res) => res.json(await tasks.setAssignees(req.params.id, req.body)),
  );
  r.post('/:id/status', signedIn, validate({ params: IdParams, body: TaskStatusBody }), async (req, res) =>
    res.json(await tasks.changeStatus(req.params.id, req.body)),
  );
  r.post('/:id/comments', signedIn, validate({ params: IdParams, body: CommentBody }), async (req, res) =>
    res.status(201).json(await tasks.addComment(req.params.id, req.body)),
  );
  r.post('/:id/timer/start', signedIn, validate({ params: IdParams }), async (req, res) =>
    res.json({ timer: await tasks.startTimer(req.params.id) }),
  );
  return r;
}
