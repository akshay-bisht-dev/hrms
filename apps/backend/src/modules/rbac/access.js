// @ts-check
import { DATA_SCOPES, PERMISSIONS } from '@hrms/shared/permissions';
import { tenantKey } from '../../lib/redis.js';

const SENSITIVE = new Set(PERMISSIONS.filter((p) => p.sensitive).map((p) => p.code));
const ACCESS_TTL_SEC = 60; // permission changes apply within a minute (Phase 3, AUTH-12)

/** @param {string} code */
export const isSensitivePermission = (code) => SENSITIVE.has(code);

/**
 * Merges role grants: for each permission the broadest scope wins.
 * @param {Array<{ permissionCode: string, scope: string }>} grants
 * @returns {Record<string, string>}
 */
export function mergeGrants(grants) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const { permissionCode, scope } of grants) {
    const prev = out[permissionCode];
    if (!prev || DATA_SCOPES.indexOf(scope) > DATA_SCOPES.indexOf(prev)) out[permissionCode] = scope;
  }
  return out;
}

/**
 * @typedef {{ membershipId: string, status: string, roles: string[], permissions: Record<string, string>,
 *             holdsSensitive: boolean, mfaEnrolled: boolean }} Access
 */

/**
 * Loads a user's access in a tenant from MySQL, cached briefly in Redis.
 * Always resolved server-side from membership records — never from anything the client sends.
 * @param {{ db: any, redis?: import('ioredis').Redis, tenantId: string, userId: string }} args
 * @returns {Promise<Access | null>}
 */
export async function loadAccess({ db, redis, tenantId, userId }) {
  const key = tenantKey(tenantId, 'access', userId);
  if (redis) {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit);
  }
  const membership = await db.tenantMembership.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    include: { membershipRoles: { include: { role: { include: { rolePermissions: true } } } } },
  });
  if (!membership) return null;
  const grants = membership.membershipRoles.flatMap((mr) => mr.role.rolePermissions);
  const permissions = mergeGrants(grants);
  const mfaEnrolled = (await db.mfaFactor.count({ where: { userId, confirmedAt: { not: null } } })) > 0;
  /** @type {Access} */
  const access = {
    membershipId: membership.id,
    status: membership.status,
    roles: membership.membershipRoles.map((mr) => mr.role.name),
    permissions,
    holdsSensitive: Object.keys(permissions).some(isSensitivePermission),
    mfaEnrolled,
  };
  if (redis) await redis.set(key, JSON.stringify(access), 'EX', ACCESS_TTL_SEC);
  return access;
}

/** @param {import('ioredis').Redis | undefined} redis @param {string} tenantId @param {string} userId */
export async function invalidateAccess(redis, tenantId, userId) {
  if (redis) await redis.del(tenantKey(tenantId, 'access', userId));
}
