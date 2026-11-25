// @ts-check
import pino from 'pino';

/** Paths that must never reach logs (Phase 3, LOG-01). */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.secret',
  '*.accountNumber',
  '*.nationalId',
];

/**
 * @param {{ level?: string, name?: string }} [opts]
 * @returns {import('pino').Logger}
 */
export function createLogger({ level = 'info', name = 'hrms-api' } = {}) {
  return pino({
    name,
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: { service: name },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
