// @ts-check
import { Router } from 'express';
import { z } from 'zod';
import { InviteBody, LinkEmployeeBody, MemberRolesBody, RoleBody } from '@hrms/shared/schemas/members';
import { IdParams } from '../../lib/crud.js';
import { validate } from '../../middleware/validate.js';
import { registry } from '../../openapi/registry.js';

const BASE = '/api/v1/tenants';
const doc = (method, path, summary, extra = {}) =>
  registry.registerPath({
    method,
    path: `${BASE}${path}`,
    tags: ['Members & roles'],
    summary,
    responses: { 200: { description: 'OK' } },
    ...extra,
  });
const body = (schema) => ({ body: { content: { 'application/json': { schema } } } });

doc('get', '/members', 'Members of the company (not removed ones unless ?status=REMOVED)');
doc('post', '/invitations', 'Invite someone by email with one or more roles', { request: body(InviteBody) });
doc('delete', '/invitations/{id}', 'Cancel a pending invitation', { request: { params: IdParams } });
doc('put', '/members/{id}/roles', "Replace a member's roles (not your own)", {
  request: { params: IdParams, ...body(MemberRolesBody) },
});
doc('post', '/members/{id}/suspend', 'Suspend a member and sign them out of this company', {
  request: { params: IdParams },
});
doc('post', '/members/{id}/reactivate', 'Reactivate a suspended or removed member', {
  request: { params: IdParams },
});
doc('delete', '/members/{id}', 'Remove a member and sign them out of this company', {
  request: { params: IdParams },
});
doc('post', '/members/{id}/sign-out', 'Sign a member out of this company on every device', {
  request: { params: IdParams },
});
doc(
  'put',
  '/members/{id}/employee',
  "Link a member's sign-in to an employee record (used by own/team scopes)",
  { request: { params: IdParams, ...body(LinkEmployeeBody) } },
);
doc('get', '/roles', 'Roles with their permissions and member counts');
doc('get', '/permissions', 'Permission catalog (codes, modules, sensitive flags)');
doc('post', '/roles', 'Create a custom role', { request: body(RoleBody) });
doc('patch', '/roles/{id}', 'Rename a role or replace its permissions (Company Admin is locked)', {
  request: { params: IdParams, ...body(RoleBody.partial()) },
});
doc('delete', '/roles/{id}', 'Delete a custom role with no members', { request: { params: IdParams } });

/**
 * @param {{ access: ReturnType<typeof import('../../middleware/auth.js').access>, members: ReturnType<typeof import('./members.service.js').createMembersService>,
 *           employees: ReturnType<typeof import('../employees/employees.service.js').createEmployeesService> }} deps
 */
export function membersRouter({ access, members, employees }) {
  const r = Router();
  const invite = access.permission('members.invite');
  const manageRoles = access.permission('roles.manage');
  const ListMembersQuery = z
    .object({
      status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED']).optional(),
      q: z.string().trim().max(100).optional(),
    })
    .strict();

  r.get('/members', invite, validate({ query: ListMembersQuery }), async (req, res) => {
    res.json({ data: await members.listMembers(/** @type {any} */ (req.query)) });
  });
  r.post('/invitations', invite, validate({ body: InviteBody }), async (req, res) => {
    res.status(201).json(await members.invite(req.body));
  });
  r.delete('/invitations/:id', invite, validate({ params: IdParams }), async (req, res) => {
    await members.cancelInvite(req.params.id);
    res.status(204).end();
  });
  r.put(
    '/members/:id/roles',
    manageRoles,
    validate({ params: IdParams, body: MemberRolesBody }),
    async (req, res) => {
      await members.setRoles(req.params.id, req.body.roleIds);
      res.status(204).end();
    },
  );
  r.post('/members/:id/suspend', manageRoles, validate({ params: IdParams }), async (req, res) => {
    await members.setStatus(req.params.id, 'SUSPENDED');
    res.status(204).end();
  });
  r.post('/members/:id/reactivate', manageRoles, validate({ params: IdParams }), async (req, res) => {
    await members.setStatus(req.params.id, 'ACTIVE');
    res.status(204).end();
  });
  r.delete('/members/:id', manageRoles, validate({ params: IdParams }), async (req, res) => {
    await members.setStatus(req.params.id, 'REMOVED');
    res.status(204).end();
  });
  r.post('/members/:id/sign-out', manageRoles, validate({ params: IdParams }), async (req, res) => {
    res.json({ sessionsEnded: await members.forceSignOut(req.params.id) });
  });

  r.put(
    '/members/:id/employee',
    manageRoles,
    validate({ params: IdParams, body: LinkEmployeeBody }),
    async (req, res) => {
      await employees.linkMember(req.params.id, req.body.employeeId);
      res.status(204).end();
    },
  );

  r.get('/roles', invite, async (_req, res) => res.json({ data: await members.listRoles() }));
  r.get('/permissions', invite, async (_req, res) => res.json({ data: members.permissionCatalog() }));
  r.post('/roles', manageRoles, validate({ body: RoleBody }), async (req, res) => {
    res.status(201).json({ id: await members.createRole(req.body) });
  });
  r.patch(
    '/roles/:id',
    manageRoles,
    validate({ params: IdParams, body: RoleBody.partial().strict() }),
    async (req, res) => {
      await members.updateRole(req.params.id, req.body);
      res.status(204).end();
    },
  );
  r.delete('/roles/:id', manageRoles, validate({ params: IdParams }), async (req, res) => {
    await members.deleteRole(req.params.id);
    res.status(204).end();
  });
  return r;
}
