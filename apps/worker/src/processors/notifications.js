// @ts-check
import { z } from 'zod';
import { renderEmail, TEMPLATES } from './email-templates.js';

export const EmailJobSchema = z
  .object({
    template: z.enum(/** @type {[string, ...string[]]} */ (Object.keys(TEMPLATES))),
    to: z.email(),
    locale: z.string().max(16).optional(),
    data: z.record(z.string(), z.string().max(2000)),
  })
  .strict();

/**
 * Sends transactional email. The job holds single-use links, so nothing from it is logged except the template.
 * @param {{ transport: { sendMail: (m: object) => Promise<unknown> }, from: string, logger: import('pino').Logger }} deps
 */
export function createNotificationsProcessor({ transport, from, logger }) {
  return async (/** @type {import('bullmq').Job} */ job) => {
    if (job.name !== 'email') throw new Error(`Unknown notifications job: ${job.name}`);
    const { template, to, data } = EmailJobSchema.parse(job.data);
    const { subject, text, html } = renderEmail(template, data);
    await transport.sendMail({ from, to, subject, text, html });
    logger.info({ jobId: job.id, template }, 'Email sent');
    return { sent: true };
  };
}
