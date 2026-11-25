// @ts-check
import { newId } from '@hrms/shared/ids';
import { PERMISSIONS } from '@hrms/shared/permissions';
import { appUrl } from '../../config/env.js';
import { audit } from '../../lib/audit.js';
import { currentContext } from '../../lib/context.js';
import { db } from '../../lib/db.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { invalidateAccess, isSensitivePermission } from '../rbac/access.js';

const COMPANY_ADMIN = 'company_admin';

/** @returns {any} */
const ctx = () => currentContext();

/**
 * Members, invitations and roles of the current company (Phase 3, RBAC-02 … RBAC-05).
 * Guard rails: nobody changes their own roles or status; sensitive grants need roles.manage on an MFA-verified
 * session; the last active Company Admin can't be demoted, suspended or removed; every change is audited and
 * sensitive grants are emailed to all Company Admins.
 * @param {{ env: Readonly<import('../../config/env.js').Env>, auth: ReturnType<typeof import('../auth/auth.service.js').createAuthService>,
 *           redis: import('ioredis').Redis, queues: { notifications: import('bullmq').Queue },
 *           employees?: { linkMember: (membershipId: string, employeeId: string | null) => Promise<void> } }} deps
 */
export function createMembersService({ env, auth, redis, queues, employees }) {
  const mailAdmins = async (template, data) => {
    const admins = await db().tenantMembership.findMany({
      where: { status: 'ACTIVE', membershipRoles: { some: { role: { systemKey: COMPANY_ADMIN } } } },
      include: { user: true },
    });
    for (const a of admins)
      await queues.notifications.add('email', {
        template,
        to: a.user.email,
        data: { ...data, name: a.user.displayName },
      });
  };

  /** @param {string[]} roleIds */
  async function loadRoles(roleIds) {
    const roles = await db().role.findMany({
      where: { id: { in: roleIds } },
      include: { rolePermissions: true },
    });
    if (roles.length !== new Set(roleIds).size)
      throw new ValidationError([{ path: 'body.roleIds', message: 'One or more roles do not exist' }]);
    return roles;
  }

  /** Assigning roles that carry sensitive permissions needs roles.manage on an MFA-verified session. @param {any[]} roles */
  function assertMayGrant(roles) {
    const sensitive = roles.some((r) =>
      r.rolePermissions.some((g) => isSensitivePermission(g.permissionCode)),
    );
    if (!sensitive) return false;
    const c = ctx();
    if (!c.permissions.has('roles.manage'))
      throw new ForbiddenError('sensitive_role', 'Only a Company Admin can give roles with sensitive access');
    if ((env.MFA_ENFORCE_FOR_SENSITIVE ?? true) && !c.mfa)
      throw new ForbiddenError('mfa_required', 'Turn on two-step verification to use this feature');
    return true;
  }

  /** @param {string} membershipId */
  async function memberOr404(membershipId) {
    const m = await db().tenantMembership.findUnique({
      where: { id: membershipId },
      include: { user: true, membershipRoles: { include: { role: true } } },
    });
    if (!m) throw new NotFoundError();
    return m;
  }

  /** @param {any} m */
  const assertNotSelf = (m) => {
    if (m.userId === ctx().userId)
      throw new ForbiddenError('self_change', "You can't change your own access. Ask another Company Admin.");
  };

  /** Fails if the change would leave the company without an active Company Admin. @param {string} membershipId */
  async function assertAnotherAdminRemains(membershipId) {
    const others = await db().tenantMembership.count({
      where: {
        id: { not: membershipId },
        status: 'ACTIVE',
        membershipRoles: { some: { role: { systemKey: COMPANY_ADMIN } } },
      },
    });
    if (others === 0)
      throw new ConflictError('last_admin', 'The company needs at least one active Company Admin');
  }

  /** @param {any} m */
  const isAdmin = (m) => m.membershipRoles.some((mr) => mr.role.systemKey === COMPANY_ADMIN);

  /** @param {any} m */
  const memberDto = (m, mfaUsers = new Set()) => ({
    id: m.id,
    userId: m.userId,
    email: m.user.email,
    displayName: m.user.displayName,
    status: m.status,
    invitedAt: m.invitedAt,
    joinedAt: m.joinedAt,
    lastLoginAt: m.user.lastLoginAt,
    mfaEnabled: mfaUsers.has(m.userId),
    roles: m.membershipRoles.map((mr) => ({
      id: mr.role.id,
      name: mr.role.name,
      systemKey: mr.role.systemKey,
    })),
  });

  return {
    /** @param {{ status?: string, q?: string }} filter */
    async listMembers({ status, q }) {
      const rows = await db().tenantMembership.findMany({
        where: {
          ...(status ? { status } : { status: { not: 'REMOVED' } }),
          ...(q ? { user: { OR: [{ email: { contains: q } }, { displayName: { contains: q } }] } } : {}),
        },
        include: { user: true, membershipRoles: { include: { role: true } } },
        orderBy: [{ status: 'asc' }, { joinedAt: 'asc' }],
        take: 500,
      });
      const factors = await db().mfaFactor.findMany({
        where: { userId: { in: rows.map((r) => r.userId) }, confirmedAt: { not: null } },
        select: { userId: true },
      });
      const mfaUsers = new Set(factors.map((f) => f.userId));
      return rows.map((m) => memberDto(m, mfaUsers));
    },

    /** @param {{ email: string, roleIds: string[], employeeId?: string }} input */
    async invite({ email, roleIds, employeeId }) {
      const c = ctx();
      const roles = await loadRoles(roleIds);
      const sensitive = assertMayGrant(roles);
      let user = await db().user.findUnique({ where: { email } });
      let membership = user
        ? await db().tenantMembership.findUnique({
            where: { tenantId_userId: { tenantId: c.tenantId, userId: user.id } },
          })
        : null;
      if (membership && membership.status !== 'INVITED') {
        throw new ConflictError(
          'already_member',
          membership.status === 'ACTIVE'
            ? 'This person is already a member'
            : 'This person was a member before. Reactivate them instead.',
        );
      }
      await db().$transaction(async (/** @type {any} */ tx) => {
        if (!user) {
          user = await tx.user.create({
            data: { id: newId(), email, displayName: email.split('@')[0], passwordHash: null },
          });
        }
        if (!membership) {
          membership = await tx.tenantMembership.create({
            data: { id: newId(), userId: user.id, status: 'INVITED', invitedAt: new Date() },
          });
        } else {
          await tx.tenantMembership.update({ where: { id: membership.id }, data: { invitedAt: new Date() } });
          await tx.membershipRole.deleteMany({ where: { membershipId: membership.id } });
        }
        await tx.membershipRole.createMany({
          data: roles.map((r) => ({ membershipId: membership.id, roleId: r.id, grantedBy: c.userId })),
        });
      });
      if (employeeId && employees) await employees.linkMember(membership.id, employeeId);
      const token = await auth.signInviteToken({
        userId: user.id,
        tenantId: c.tenantId,
        membershipId: membership.id,
      });
      const company = await db().tenant.findUnique({ where: { id: c.tenantId } });
      const inviter = await db().user.findUnique({ where: { id: c.userId } });
      await queues.notifications.add('email', {
        template: 'invitation',
        to: email,
        data: {
          company: company.name,
          inviter: inviter.displayName,
          url: `${appUrl(env)}/accept-invite?token=${token}`,
        },
      });
      await audit(db(), {
        action: 'member.invited',
        entityType: 'TenantMembership',
        entityId: membership.id,
        changes: { email, roles: roles.map((r) => r.name) },
      });
      if (sensitive)
        await mailAdmins('sensitive-access-granted', {
          person: email,
          roles: roles.map((r) => r.name).join(', '),
          company: company.name,
          by: inviter.displayName,
        });
      return { id: membership.id, status: 'INVITED' };
    },

    /** @param {string} membershipId */
    async cancelInvite(membershipId) {
      const m = await memberOr404(membershipId);
      if (m.status !== 'INVITED')
        throw new ConflictError('not_invited', 'Only pending invitations can be cancelled');
      await db().tenantMembership.delete({ where: { id: m.id } }); // cascades membership_roles
      await audit(db(), {
        action: 'member.invite_cancelled',
        entityType: 'TenantMembership',
        entityId: m.id,
        changes: { email: m.user.email },
      });
    },

    /** @param {string} membershipId @param {string[]} roleIds */
    async setRoles(membershipId, roleIds) {
      const m = await memberOr404(membershipId);
      assertNotSelf(m);
      const roles = await loadRoles(roleIds);
      const sensitive = assertMayGrant(roles);
      if (isAdmin(m) && !roles.some((r) => r.systemKey === COMPANY_ADMIN) && m.status === 'ACTIVE')
        await assertAnotherAdminRemains(m.id);
      const before = m.membershipRoles.map((mr) => mr.role.name);
      await db().$transaction([
        db().membershipRole.deleteMany({ where: { membershipId: m.id } }),
        db().membershipRole.createMany({
          data: roles.map((r) => ({ membershipId: m.id, roleId: r.id, grantedBy: ctx().userId })),
        }),
      ]);
      await invalidateAccess(redis, m.tenantId, m.userId);
      await audit(db(), {
        action: 'member.roles_changed',
        entityType: 'TenantMembership',
        entityId: m.id,
        changes: { before, after: roles.map((r) => r.name) },
      });
      if (sensitive) {
        const company = await db().tenant.findUnique({ where: { id: m.tenantId } });
        const by = await db().user.findUnique({ where: { id: ctx().userId } });
        await mailAdmins('sensitive-access-granted', {
          person: m.user.email,
          roles: roles.map((r) => r.name).join(', '),
          company: company.name,
          by: by.displayName,
        });
      }
    },

    /** @param {string} membershipId @param {'SUSPENDED'|'ACTIVE'|'REMOVED'} status */
    async setStatus(membershipId, status) {
      const m = await memberOr404(membershipId);
      assertNotSelf(m);
      if (m.status === 'INVITED') throw new ConflictError('invited', 'Cancel the invitation instead');
      if (status !== 'ACTIVE' && isAdmin(m) && m.status === 'ACTIVE') await assertAnotherAdminRemains(m.id);
      await db().tenantMembership.update({ where: { id: m.id }, data: { status } });
      let sessions = 0;
      if (status !== 'ACTIVE')
        sessions = await auth.revokeUserSessionsInTenant(
          m.userId,
          m.tenantId,
          `member_${status.toLowerCase()}`,
        );
      else await invalidateAccess(redis, m.tenantId, m.userId);
      await audit(db(), {
        action: `member.${status.toLowerCase()}`,
        entityType: 'TenantMembership',
        entityId: m.id,
        changes: { from: m.status, to: status, sessionsRevoked: sessions },
      });
    },

    /** Signs a member out of this company everywhere (Phase 3, AUTH-12). @param {string} membershipId */
    async forceSignOut(membershipId) {
      const m = await memberOr404(membershipId);
      const n = await auth.revokeUserSessionsInTenant(m.userId, m.tenantId, 'admin_sign_out');
      await audit(db(), {
        action: 'member.signed_out',
        entityType: 'TenantMembership',
        entityId: m.id,
        changes: { sessionsRevoked: n },
      });
      return n;
    },

    // ── Roles ──────────────────────────────────────────────────────────────────

    async listRoles() {
      const roles = await db().role.findMany({
        include: { rolePermissions: true, _count: { select: { membershipRoles: true } } },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      });
      return roles.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        systemKey: r.systemKey,
        locked: r.systemKey === COMPANY_ADMIN,
        memberCount: r._count.membershipRoles,
        grants: r.rolePermissions.map((g) => ({ permissionCode: g.permissionCode, scope: g.scope })),
        sensitive: r.rolePermissions.some((g) => isSensitivePermission(g.permissionCode)),
      }));
    },

    permissionCatalog: () =>
      PERMISSIONS.map((p) => ({
        code: p.code,
        module: p.module,
        description: p.description,
        sensitive: p.sensitive,
      })),

    /** @param {{ name: string, description?: string | null, grants: Array<{ permissionCode: string, scope: string }> }} input */
    async createRole(input) {
      const id = newId();
      await db().$transaction(async (/** @type {any} */ tx) => {
        await tx.role.create({
          data: { id, name: input.name, description: input.description ?? null, isSystem: false },
        });
        if (input.grants.length)
          await tx.rolePermission.createMany({ data: input.grants.map((g) => ({ roleId: id, ...g })) });
      });
      await audit(db(), { action: 'role.created', entityType: 'Role', entityId: id, changes: input });
      return id;
    },

    /** @param {string} id @param {{ name?: string, description?: string | null, grants?: Array<{ permissionCode: string, scope: string }> }} input */
    async updateRole(id, input) {
      const role = await db().role.findUnique({
        where: { id },
        include: { membershipRoles: { include: { membership: true } } },
      });
      if (!role) throw new NotFoundError();
      if (role.systemKey === COMPANY_ADMIN)
        throw new ConflictError(
          'role_locked',
          'The Company Admin role always has full access and cannot be changed',
        );
      const affected = role.membershipRoles.map((mr) => mr.membership);
      if (input.grants && affected.some((m) => m.userId === ctx().userId)) {
        throw new ForbiddenError(
          'self_change',
          "You can't change the permissions of a role you hold. Ask another Company Admin.",
        );
      }
      await db().$transaction(async (/** @type {any} */ tx) => {
        await tx.role.update({
          where: { id },
          data: {
            ...(input.name ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
          },
        });
        if (input.grants) {
          await tx.rolePermission.deleteMany({ where: { roleId: id } });
          if (input.grants.length)
            await tx.rolePermission.createMany({ data: input.grants.map((g) => ({ roleId: id, ...g })) });
        }
      });
      for (const m of affected) await invalidateAccess(redis, m.tenantId, m.userId);
      await audit(db(), { action: 'role.updated', entityType: 'Role', entityId: id, changes: input });
      if (input.grants?.some((g) => isSensitivePermission(g.permissionCode)) && affected.length) {
        const company = await db().tenant.findUnique({ where: { id: role.tenantId } });
        const by = await db().user.findUnique({ where: { id: ctx().userId } });
        await mailAdmins('sensitive-access-granted', {
          person: `${affected.length} member(s) with the role ${role.name}`,
          roles: role.name,
          company: company.name,
          by: by.displayName,
        });
      }
    },

    /** @param {string} id */
    async deleteRole(id) {
      const role = await db().role.findUnique({
        where: { id },
        include: { _count: { select: { membershipRoles: true } } },
      });
      if (!role) throw new NotFoundError();
      if (role.isSystem) throw new ConflictError('role_locked', 'Built-in roles cannot be deleted');
      if (role._count.membershipRoles > 0)
        throw new AppError(409, 'in_use', 'Move the members to another role first');
      await db().role.delete({ where: { id } });
      await audit(db(), {
        action: 'role.deleted',
        entityType: 'Role',
        entityId: id,
        changes: { name: role.name },
      });
    },
  };
}
