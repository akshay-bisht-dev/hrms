// @ts-check
import { z } from 'zod';

/** Payload schemas per job name in the `system` queue. Unknown job names fail permanently. */
export const SystemJobs = {
  ping: z.object({ requestedAt: z.iso.datetime() }).strict(),
  heartbeat: z.object({}).strict(),
};

/**
 * Processor for the `system` queue: proves the pipeline end to end and reports worker liveness.
 * @param {{ logger: import('pino').Logger, now?: () => Date }} deps
 * @returns {(job: import('bullmq').Job) => Promise<object>}
 */
export function createSystemProcessor({ logger, now = () => new Date() }) {
  return async (job) => {
    const schema = SystemJobs[/** @type {keyof typeof SystemJobs} */ (job.name)];
    if (!schema) throw new Error(`Unknown system job: ${job.name}`);
    const data = schema.parse(job.data);
    const processedAt = now().toISOString();
    if (job.name === 'ping') {
      logger.debug({ jobId: job.id }, 'ping processed');
      return { pong: true, requestedAt: /** @type {any} */ (data).requestedAt, processedAt };
    }
    return { alive: true, processedAt };
  };
}
