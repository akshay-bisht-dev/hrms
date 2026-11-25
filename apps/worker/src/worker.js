// @ts-check
import { Worker, UnrecoverableError } from 'bullmq';
import { QUEUES } from '@hrms/shared/queues';
import { createLogger } from '@hrms/backend/lib/logger.js';
import { createRedis } from '@hrms/backend/lib/redis.js';
import { loadWorkerConfig } from './config.js';
import nodemailer from 'nodemailer';
import { createSystemProcessor } from './processors/system.js';
import { createNotificationsProcessor } from './processors/notifications.js';

const config = loadWorkerConfig(process.env);
const logger = createLogger({ level: config.LOG_LEVEL, name: 'hrms-worker' });
const connection = createRedis(config.queueRedisUrl, { forQueues: true });

/**
 * Wraps a processor so schema failures are permanent (no pointless retries) and every failure is logged.
 * @param {(job: import('bullmq').Job) => Promise<unknown>} fn
 */
const guarded = (fn) => async (/** @type {import('bullmq').Job} */ job) => {
  try {
    return await fn(job);
  } catch (err) {
    if (
      /** @type {any} */ (err)?.name === 'ZodError' ||
      /^Unknown .* (job|template)/.test(String(/** @type {any} */ (err)?.message))
    ) {
      throw new UnrecoverableError(String(/** @type {any} */ (err).message));
    }
    throw err;
  }
};

// Production uses Amazon SES through its SMTP interface (SMTP_URL from Secrets Manager); locally Mailpit.
const transport = nodemailer.createTransport(config.SMTP_URL);

const workers = [
  new Worker(
    QUEUES.NOTIFICATIONS,
    guarded(createNotificationsProcessor({ transport, from: config.EMAIL_FROM, logger })),
    {
      connection,
      concurrency: config.WORKER_NOTIFICATIONS_CONCURRENCY,
    },
  ),
  new Worker(QUEUES.SYSTEM, guarded(createSystemProcessor({ logger })), {
    connection,
    concurrency: config.WORKER_SYSTEM_CONCURRENCY,
  }),
];

for (const w of workers) {
  w.on('failed', (job, err) =>
    logger.error(
      { queue: w.name, jobId: job?.id, job: job?.name, attempts: job?.attemptsMade, err },
      'Job failed',
    ),
  );
  w.on('error', (err) => logger.error({ queue: w.name, err }, 'Worker error'));
}
logger.info({ queues: workers.map((w) => w.name) }, 'Worker started');

let stopping = false;
/** @param {string} signal */
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Worker shutting down: finishing active jobs');
  const force = setTimeout(() => process.exit(1), config.SHUTDOWN_TIMEOUT_MS);
  force.unref();
  await Promise.allSettled(workers.map((w) => w.close()));
  await connection.quit().catch(() => {});
  logger.info('Worker stopped');
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
