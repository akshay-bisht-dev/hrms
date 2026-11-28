// @ts-check
import { randomUUID } from 'node:crypto';
import { runWithContext } from '../lib/context.js';

const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Assigns a request ID (reusing a safe incoming X-Request-Id) and opens the AsyncLocalStorage context
 * that the rest of the request runs in.
 * @type {import('express').RequestHandler}
 */
export function requestContext(req, res, next) {
  const incoming = req.get('x-request-id');
  const requestId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', requestId);
  // @ts-ignore — attached for pino-http and handlers
  req.id = requestId;
  // Client IP and user agent are kept for access logs that must record them (screenshot views).
  runWithContext({ requestId, ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null }, () => next());
}
