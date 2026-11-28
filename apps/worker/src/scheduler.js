// @ts-check
import { Queue } from 'bullmq';
import { QUEUES, DEFAULT_JOB_OPTIONS } from '@hrms/shared/queues';
import { createLogger } from '@hrms/backend/lib/logger.js';
import { createRedis } from '@hrms/backend/lib/redis.js';
import { loadWorkerConfig } from './config.js';

/**
 * Registers repeatable jobs. `upsertJobScheduler` is idempotent by scheduler id, so running this twice
 * (e.g. during a deploy overlap) never creates duplicate schedules.
 * Later sprints add: retention sweep (nightly) …
 */
export const SCHEDULES = [
  { queue: QUEUES.SYSTEM, id: 'system-heartbeat', every: 60_000, name: 'heartbeat', data: {} },
  // Marks work sessions without a heartbeat as disconnected and closes abandoned ones at their last heartbeat.
  {
    queue: QUEUES.WORK_SESSIONS,
    id: 'work-session-sweep',
    every: 60_000,
    name: 'work-session-sweep',
    data: {},
  },
  // Closes finished days (absent, missing clock-out) and refreshes the last two days in every company.
  {
    queue: QUEUES.WORK_SESSIONS,
    id: 'attendance-rollup',
    every: 30 * 60_000,
    name: 'attendance-rollup',
    data: {},
  },
  // Applies future-dated transfers, promotions and manager changes on their date (each employee's time zone).
  {
    queue: QUEUES.WORK_SESSIONS,
    id: 'employment-apply-due',
    every: 60 * 60_000,
    name: 'employment-apply-due',
    data: {},
  },
  // Leave accruals and year-end expiry for the current month (idempotent per period key), every 6 hours.
  {
    queue: QUEUES.WORK_SESSIONS,
    id: 'leave-accrual',
    every: 6 * 60 * 60_000,
    name: 'leave-accrual',
    data: {},
  },
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
