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
  return {
    notifications,
    async close() {
      await notifications.close();
    },
  };
}

/**
 * @typedef {{ template: 'verify-email' | 'reset-password' | 'password-changed' | 'account-exists' | 'account-locked' | 'mfa-enabled' | 'mfa-disabled',
 *             to: string, locale?: string, data: Record<string, string> }} EmailJob
 */
