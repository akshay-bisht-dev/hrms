// @ts-check
/** Queue names shared by the API (producers) and the worker (consumers). */
export const QUEUES = Object.freeze({
  SYSTEM: 'system',
  PAYROLL: 'payroll',
  IMPORTS: 'imports',
  SCREENSHOTS: 'screenshots',
  RETENTION: 'retention',
  REPORTS: 'reports',
  NOTIFICATIONS: 'notifications',
  WORK_SESSIONS: 'work-sessions',
  BILLING: 'billing',
});

/** Default job options: retries with exponential backoff, bounded history. */
export const DEFAULT_JOB_OPTIONS = Object.freeze({
  attempts: 3,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
});
