// @ts-check
import { Redis } from 'ioredis';

/**
 * Redis client. `lazyConnect` keeps imports side-effect free; BullMQ requires maxRetriesPerRequest = null.
 * @param {string} url
 * @param {{ forQueues?: boolean }} [opts]
 */
export function createRedis(url, { forQueues = false } = {}) {
  return new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: forQueues ? null : 2,
    enableReadyCheck: true,
  });
}

/**
 * Tenant-namespaced cache key (Phase 3, TEN-07).
 * @param {string} tenantId
 * @param {...string} parts
 */
export function tenantKey(tenantId, ...parts) {
  if (!tenantId) throw new Error('tenantKey requires a tenant id');
  return ['t', tenantId, ...parts].join(':');
}
