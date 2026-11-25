// @ts-check
import { Router } from 'express';
import { registry, z } from '../../openapi/registry.js';

/**
 * @typedef {{ name: string, check: () => Promise<unknown> }} ReadinessCheck
 */

const CheckResult = z.object({
  name: z.string(),
  ok: z.boolean(),
  latencyMs: z.number(),
  error: z.string().optional(),
});
const ReadyResponse = registry.register(
  'ReadyResponse',
  z.object({ status: z.enum(['ok', 'unavailable']), checks: z.array(CheckResult) }),
);
const LiveResponse = registry.register(
  'LiveResponse',
  z.object({ status: z.literal('ok'), uptimeSec: z.number() }),
);

registry.registerPath({
  method: 'get',
  path: '/health/live',
  tags: ['System'],
  summary: 'Process liveness (no dependency checks)',
  responses: { 200: { description: 'Alive', content: { 'application/json': { schema: LiveResponse } } } },
});
registry.registerPath({
  method: 'get',
  path: '/health/ready',
  tags: ['System'],
  summary: 'Readiness: database and Redis reachable',
  responses: {
    200: { description: 'Ready', content: { 'application/json': { schema: ReadyResponse } } },
    503: { description: 'Not ready', content: { 'application/json': { schema: ReadyResponse } } },
  },
});

/**
 * Runs a promise with a timeout.
 * @template T @param {Promise<T>} promise @param {number} ms @returns {Promise<T>}
 */
function withTimeout(promise, ms) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * @param {{ checks: ReadinessCheck[], timeoutMs?: number, onFailure?: (name: string, err: unknown) => void }} opts
 * @returns {import('express').Router}
 */
export function healthRouter({ checks, timeoutMs = 1000, onFailure }) {
  const router = Router();
  router.get('/live', (_req, res) => {
    res.json({ status: 'ok', uptimeSec: Math.round(process.uptime()) });
  });
  router.get('/ready', async (_req, res) => {
    const results = await Promise.all(
      checks.map(async ({ name, check }) => {
        const started = performance.now();
        try {
          await withTimeout(check(), timeoutMs);
          return { name, ok: true, latencyMs: Math.round(performance.now() - started) };
        } catch (e) {
          // Details are logged by the caller's logger, not returned: this endpoint is reachable from the load balancer.
          onFailure?.(name, e);
          const timedOut = String(/** @type {Error} */ (e)?.message).startsWith('timed out');
          return {
            name,
            ok: false,
            latencyMs: Math.round(performance.now() - started),
            error: timedOut ? 'timeout' : 'unreachable',
          };
        }
      }),
    );
    const ok = results.every((r) => r.ok);
    res
      .status(ok ? 200 : 503)
      .set('Cache-Control', 'no-store')
      .json({ status: ok ? 'ok' : 'unavailable', checks: results });
  });
  return router;
}
