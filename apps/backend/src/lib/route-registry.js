// @ts-check
/**
 * Every /api/v1 route is declared through defineRoute with an explicit access rule
 * ('public', 'authenticated' or a permission code). assertRoutesDeclared() runs at startup and in tests:
 * a route added any other way fails the build (Phase 3, RBAC-01 "deny by default").
 */

const ACCESS = Symbol.for('hrms.access');

/**
 * Tags a middleware as the access declaration of its route.
 * @template {Function} F @param {F} fn @param {string} access @returns {F}
 */
export function markAccess(fn, access) {
  Object.defineProperty(fn, ACCESS, { value: access });
  return fn;
}

/**
 * @param {import('express').Router} router
 * @returns {Array<{ method: string, path: string, access: string | undefined }>}
 */
export function listRoutes(router) {
  /** @type {any[]} */
  const stack = /** @type {any} */ (router).stack ?? [];
  const out = [];
  for (const layer of stack) {
    if (layer.route) {
      const first = layer.route.stack[0]?.handle;
      for (const method of Object.keys(layer.route.methods)) {
        out.push({ method: method.toUpperCase(), path: layer.route.path, access: first?.[ACCESS] });
      }
    } else if (layer.handle?.stack) {
      out.push(
        ...listRoutes(layer.handle).map((r) => ({
          ...r,
          path: `${layer.handle.__mountpath ?? ''}${r.path}`,
        })),
      );
    }
  }
  return out;
}

/** @param {import('express').Router} router */
export function assertRoutesDeclared(router) {
  const undeclared = listRoutes(router).filter((r) => !r.access);
  if (undeclared.length) {
    throw new Error(
      `Routes without an access declaration:\n${undeclared.map((r) => `  ${r.method} ${r.path}`).join('\n')}`,
    );
  }
}
