// @ts-check
import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * @typedef {object} Ctx
 * @property {string} requestId
 * @property {string} [tenantId]
 * @property {string} [userId]
 * @property {string} [membershipId]
 * @property {string} [deviceId]
 * @property {Map<string, string>} [permissions] permission code → data scope
 */

/** @type {AsyncLocalStorage<Ctx>} */
const als = new AsyncLocalStorage();

/**
 * Runs `fn` inside a request/job context.
 * Prisma queries are lazy (they execute when awaited), so always `await` them inside `fn`;
 * a query promise returned unawaited runs outside the context and fails closed.
 * @template T
 * @param {Ctx} context
 * @param {() => T} fn
 * @returns {T}
 */
export const runWithContext = (context, fn) => als.run(context, fn);

/** @returns {Ctx | undefined} */
export const currentContext = () => als.getStore();

/**
 * Tenant of the current request or job. Throws when absent so tenant data can never be read unscoped.
 * @returns {string}
 */
export function requireTenantId() {
  const tenantId = als.getStore()?.tenantId;
  if (!tenantId) throw new Error('Tenant context required');
  return tenantId;
}
