// @ts-check
import { currentContext } from '../../lib/context.js';
import { db } from '../../lib/db.js';

/** A filter that matches no rows (used when the caller has no access at all). */
export const NO_ROWS = Object.freeze({ id: '00000000-0000-0000-0000-000000000000' });

/**
 * Prisma `where` for the employees the current caller may see or change with a permission (Phase 3, RBAC-03).
 * Scopes: OWN = their own record; TEAM = everyone who reports to them, directly or indirectly (closure table),
 * plus themselves; DEPARTMENT / BRANCH / LEGAL_ENTITY = same unit as their own record; COMPANY = everyone.
 * With `includeSelf` (self-service reads), people always see their own record even without the permission.
 * @param {string} permission
 * @param {{ includeSelf?: boolean }} [opts]
 * @returns {Promise<object>}
 */
export async function employeeScope(permission, { includeSelf = false } = {}) {
  const c = /** @type {any} */ (currentContext());
  const scope = c.permissions?.get(permission);
  const self = c.employeeId ? { id: c.employeeId } : null;
  const orSelf = (/** @type {object} */ where) => (includeSelf && self ? { OR: [where, self] } : where);
  switch (scope) {
    case 'COMPANY':
      return {};
    case 'OWN':
      return self ?? NO_ROWS;
    case 'TEAM':
      return c.employeeId ? { hierarchyAncestors: { some: { ancestorId: c.employeeId } } } : NO_ROWS;
    case 'DEPARTMENT':
    case 'BRANCH':
    case 'LEGAL_ENTITY': {
      if (!c.employeeId) return NO_ROWS;
      const field = { DEPARTMENT: 'departmentId', BRANCH: 'branchId', LEGAL_ENTITY: 'legalEntityId' }[scope];
      const me = await db().employee.findUnique({ where: { id: c.employeeId }, select: { [field]: true } });
      const value = me?.[field];
      return value ? orSelf({ [field]: value }) : (self ?? NO_ROWS);
    }
    default:
      return includeSelf && self ? self : NO_ROWS;
  }
}

/** True when the caller is the employee themselves. @param {string} employeeId */
export const isSelf = (employeeId) => /** @type {any} */ (currentContext())?.employeeId === employeeId;
