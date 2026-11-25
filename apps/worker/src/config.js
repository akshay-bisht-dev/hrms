// @ts-check
import { z } from 'zod';
import { withoutEmpty } from '@hrms/backend/config/env.js';

const Schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  REDIS_URL: z.string().regex(/^rediss?:\/\//),
  REDIS_QUEUE_URL: z
    .string()
    .regex(/^rediss?:\/\//)
    .optional(),
  DATABASE_URL: z.string().regex(/^mysql:\/\//),
  SMTP_URL: z
    .string()
    .regex(/^smtps?:\/\//)
    .default('smtp://127.0.0.1:1025'),
  EMAIL_FROM: z.string().min(3).default('Workforce HRMS <no-reply@hrms.local>'),
  WORKER_NOTIFICATIONS_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
  WORKER_SYSTEM_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(2),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(25000),
});

/** @param {Record<string, string | undefined>} source */
export function loadWorkerConfig(source) {
  const r = Schema.safeParse(withoutEmpty(source));
  if (!r.success) {
    throw new Error(
      'Invalid worker configuration:\n' +
        r.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n'),
    );
  }
  return Object.freeze({ ...r.data, queueRedisUrl: r.data.REDIS_QUEUE_URL ?? r.data.REDIS_URL });
}
