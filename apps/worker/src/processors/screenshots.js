// @ts-check
import { z } from 'zod';
import { runWithContext } from '@hrms/backend/lib/context.js';
import { LIVE_TENANT_STATUSES } from './work-sessions.js';

/** Payload schemas per job name in the `screenshots` queue. Unknown job names fail permanently. */
export const ScreenshotJobs = {
  /** Verify an upload (size, WebP signature, hash, decodable), strip metadata, blur, thumbnail. */
  'screenshot-process': z.object({ tenantId: z.uuid(), screenshotId: z.uuid() }).strict(),
  /** Repeatable (daily): fans out retention deletion per live company. */
  'screenshot-retention': z.object({}).strict(),
  'screenshot-retention-tenant': z.object({ tenantId: z.uuid() }).strict(),
};

/**
 * @param {{ screenshots: any, platformDb: () => any, queue: { add: Function }, logger: import('pino').Logger, now?: () => Date }} deps
 */
export function createScreenshotsProcessor({
  screenshots,
  platformDb,
  queue,
  logger,
  now = () => new Date(),
}) {
  return async (/** @type {import('bullmq').Job} */ job) => {
    const schema = ScreenshotJobs[/** @type {keyof typeof ScreenshotJobs} */ (job.name)];
    if (!schema) throw new Error(`Unknown screenshots job: ${job.name}`);
    const data = /** @type {any} */ (schema.parse(job.data));
    const inTenant = (/** @type {() => Promise<any>} */ fn) =>
      runWithContext({ requestId: `job:${job.id}`, tenantId: data.tenantId }, fn);
    switch (job.name) {
      case 'screenshot-process': {
        const out = await inTenant(() => screenshots.process(data.screenshotId));
        if (out.status === 'INVALID') logger.warn({ tenantId: data.tenantId, ...out }, 'Screenshot rejected');
        return out;
      }
      case 'screenshot-retention': {
        const tenants = await platformDb().tenant.findMany({
          where: { status: { in: LIVE_TENANT_STATUSES } },
          select: { id: true },
        });
        const day = now().toISOString().slice(0, 10).replace(/-/g, '');
        for (const t of tenants)
          await queue.add(
            'screenshot-retention-tenant',
            { tenantId: t.id },
            { jobId: `ss-retention-${t.id}-${day}` },
          );
        return { tenants: tenants.length };
      }
      case 'screenshot-retention-tenant': {
        const out = await inTenant(() => screenshots.retentionSweep());
        if (out.deleted || out.expiredSlots)
          logger.info({ tenantId: data.tenantId, ...out }, 'Screenshot retention applied');
        return out;
      }
      default:
        throw new Error(`Unknown screenshots job: ${job.name}`);
    }
  };
}
