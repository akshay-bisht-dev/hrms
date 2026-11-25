// @ts-check
import { Queue } from 'bullmq';
import { QUEUES, DEFAULT_JOB_OPTIONS } from '@hrms/shared/queues';
import { createLogger } from '@hrms/backend/lib/logger.js';
import { createRedis } from '@hrms/backend/lib/redis.js';
import { loadWorkerConfig } from './config.js';

/**
 * Registers repeatable jobs. `upsertJobScheduler` is idempotent by scheduler id, so running this twice
 * (e.g. during a deploy overlap) never creates duplicate schedules.
 * Later sprints add: stale-session sweeper (every minute), retention sweep (nightly), accruals (monthly) …
 */
export const SCHEDULES = [
  { queue: QUEUES.SYSTEM, id: 'system-heartbeat', every: 60_000, name: 'heartbeat', data: {} },
];

const config = loadWorkerConfig(process.env);
const logger = createLogger({ level: config.LOG_LEVEL, name: 'hrms-scheduler' });
const connection = createRedis(config.queueRedisUrl, { forQueues: true });

for (const s of SCHEDULES) {
  const queue = new Queue(s.queue, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  await queue.upsertJobScheduler(s.id, { every: s.every }, { name: s.name, data: s.data });
  logger.info({ scheduler: s.id, queue: s.queue, everyMs: s.every }, 'Job scheduler registered');
  await queue.close();
}
await connection.quit();
