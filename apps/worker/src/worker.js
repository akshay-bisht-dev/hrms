// @ts-check
import { Queue, Worker, UnrecoverableError } from 'bullmq';
import { QUEUES, DEFAULT_JOB_OPTIONS } from '@hrms/shared/queues';
import { createLogger } from '@hrms/backend/lib/logger.js';
import { createRedis } from '@hrms/backend/lib/redis.js';
import { loadWorkerConfig } from './config.js';
import nodemailer from 'nodemailer';
import { createSystemProcessor } from './processors/system.js';
import { createNotificationsProcessor } from './processors/notifications.js';
import { createFilesProcessor, createImportsProcessor } from './processors/tenant-jobs.js';
import { createWorkSessionsProcessor } from './processors/work-sessions.js';
import { createAttendanceService } from '@hrms/backend/modules/attendance/attendance.service.js';
import { initDb, closeDb, platformDb } from '@hrms/backend/lib/db.js';
import { createS3, storage } from '@hrms/backend/lib/storage.js';
import { createCipher } from '@hrms/backend/lib/crypto.js';
import { createEmployeesService } from '@hrms/backend/modules/employees/employees.service.js';
import { createImportsService } from '@hrms/backend/modules/employees/imports.js';
import { blindIndexKeyFrom } from '@hrms/backend/services.js';

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

initDb(config.DATABASE_URL);
const files = storage(createS3(config));
const buckets = { documents: config.S3_BUCKET_DOCUMENTS, reports: config.S3_BUCKET_REPORTS };
const employees = createEmployeesService({
  files,
  buckets,
  ...(config.DATA_ENCRYPTION_KEY
    ? {
        cipher: createCipher(Buffer.from(config.DATA_ENCRYPTION_KEY, 'base64')),
        blindIndexKey: blindIndexKeyFrom({ DATA_ENCRYPTION_KEY: config.DATA_ENCRYPTION_KEY }),
      }
    : {}),
});
const imports = createImportsService({ employees, files, buckets });
const attendance = createAttendanceService();
// Fan-out jobs enqueue per-tenant children on the same queue.
const workSessionsQueue = new Queue(QUEUES.WORK_SESSIONS, {
  connection,
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

const workers = [
  new Worker(QUEUES.FILES, guarded(createFilesProcessor({ files, bucket: buckets.documents, logger })), {
    connection,
    concurrency: config.WORKER_FILES_CONCURRENCY,
  }),
  new Worker(QUEUES.IMPORTS, guarded(createImportsProcessor({ imports, logger })), {
    connection,
    concurrency: config.WORKER_IMPORTS_CONCURRENCY,
  }),
  new Worker(
    QUEUES.NOTIFICATIONS,
    guarded(createNotificationsProcessor({ transport, from: config.EMAIL_FROM, logger })),
    {
      connection,
      concurrency: config.WORKER_NOTIFICATIONS_CONCURRENCY,
    },
  ),
  new Worker(
    QUEUES.WORK_SESSIONS,
    guarded(
      createWorkSessionsProcessor({ attendance, employees, platformDb, queue: workSessionsQueue, logger }),
    ),
    { connection, concurrency: config.WORKER_WORK_SESSIONS_CONCURRENCY },
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
  await workSessionsQueue.close().catch(() => {});
  await connection.quit().catch(() => {});
  await closeDb().catch(() => {});
  logger.info('Worker stopped');
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
