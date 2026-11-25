// @ts-check
import { Queue } from 'bullmq';
import { QUEUES, DEFAULT_JOB_OPTIONS } from '@hrms/shared/queues';

/**
 * Producer-side queues used by the API. Email jobs hold single-use links, so they are removed as soon as they finish.
 * @param {import('ioredis').Redis} connection
 */
export function createQueues(connection) {
  const notifications = new Queue(QUEUES.NOTIFICATIONS, {
    connection,
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      attempts: 5,
      removeOnComplete: true,
      removeOnFail: { age: 24 * 3600 },
    },
  });
  const files = new Queue(QUEUES.FILES, {
    connection,
    defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 5 },
  });
  const imports = new Queue(QUEUES.IMPORTS, {
    connection,
    defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 2 },
  });
  const workSessions = new Queue(QUEUES.WORK_SESSIONS, {
    connection,
    defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 3 },
  });
  return {
    notifications,
    files,
    imports,
    workSessions,
    async close() {
      await Promise.all([notifications.close(), files.close(), imports.close(), workSessions.close()]);
    },
  };
}

/**
 * @typedef {{ template: 'verify-email' | 'reset-password' | 'password-changed' | 'account-exists' | 'account-locked' | 'mfa-enabled' | 'mfa-disabled',
 *             to: string, locale?: string, data: Record<string, string> }} EmailJob
 */
