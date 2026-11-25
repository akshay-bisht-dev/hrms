// @ts-check
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { TooManyRequestsError } from '../lib/errors.js';

/**
 * Per-IP limiter backed by Redis so limits hold across API instances (Phase 3, APP-11).
 * Falls back to in-memory only when no Redis is given (unit tests).
 * @param {{ redis?: import('ioredis').Redis, name: string, windowSec: number, limit: number }} o
 */
export function ipRateLimit({ redis, name, windowSec, limit }) {
  return rateLimit({
    windowMs: windowSec * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => `${name}:${ipKeyGenerator(req.ip ?? 'unknown')}`,
    store: redis
      ? new RedisStore({
          prefix: 'rl:',
          sendCommand: (/** @type {string[]} */ ...args) => /** @type {any} */ (redis).call(...args),
        })
      : undefined,
    handler: (_req, _res, next, options) =>
      next(new TooManyRequestsError(Math.ceil(options.windowMs / 1000))),
  });
}
