// @ts-check
import { z } from 'zod';
import { runWithContext } from '@hrms/backend/lib/context.js';
import { verifyDocument } from '@hrms/backend/modules/employees/verify-document.js';

/**
 * Jobs that touch tenant data run inside that tenant's context, so the tenant-scoped Prisma client applies
 * exactly as it does for API requests (Phase 4, 01 §5).
 */
export const FilesJobs = {
  'verify-document': z.object({ tenantId: z.uuid(), documentId: z.uuid() }).strict(),
};
export const ImportJobs = {
  employees: z.object({ tenantId: z.uuid(), userId: z.uuid(), jobId: z.uuid() }).strict(),
};

/** @param {{ files: any, bucket: string, logger: import('pino').Logger }} deps */
export function createFilesProcessor({ files, bucket, logger }) {
  return async (/** @type {import('bullmq').Job} */ job) => {
    const schema = FilesJobs[/** @type {keyof typeof FilesJobs} */ (job.name)];
    if (!schema) throw new Error(`Unknown files job: ${job.name}`);
    const { tenantId, documentId } = schema.parse(job.data);
    const result = await runWithContext(
      { requestId: `job:${job.id}`, tenantId },
      async () => await verifyDocument({ files, bucket }, documentId),
    );
    logger.info({ jobId: job.id, documentId, result }, 'Document checked');
    return { result };
  };
}

/** @param {{ imports: ReturnType<typeof import('@hrms/backend/modules/employees/imports.js').createImportsService>, logger: import('pino').Logger }} deps */
export function createImportsProcessor({ imports, logger }) {
  return async (/** @type {import('bullmq').Job} */ job) => {
    const schema = ImportJobs[/** @type {keyof typeof ImportJobs} */ (job.name)];
    if (!schema) throw new Error(`Unknown imports job: ${job.name}`);
    const { tenantId, userId, jobId } = schema.parse(job.data);
    const out = await runWithContext(
      { requestId: `job:${job.id}`, tenantId, userId },
      async () => await imports.process(jobId),
    );
    logger.info({ jobId, status: out?.status, ok: out?.okRows, failed: out?.errorRows }, 'Import finished');
    return out;
  };
}
