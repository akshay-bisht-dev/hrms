// @ts-check
import { z } from 'zod';
import { runWithContext } from '@hrms/backend/lib/context.js';

const Day = z.iso.date();

/** Payload schemas per job name in the `work-sessions` queue. Unknown job names fail permanently. */
export const WorkSessionJobs = {
  /** Repeatable: fans out one roll-up job per live company. */
  'attendance-rollup': z.object({}).strict(),
  'attendance-rollup-tenant': z.object({ tenantId: z.uuid() }).strict(),
  'attendance-recalculate': z
    .object({
      tenantId: z.uuid(),
      userId: z.uuid(),
      from: Day,
      to: Day,
      employeeIds: z.array(z.uuid()).max(500).optional(),
    })
    .strict(),
  /** Repeatable: fans out one "apply future-dated job changes" job per live company. */
  'employment-apply-due': z.object({}).strict(),
  'employment-apply-due-tenant': z.object({ tenantId: z.uuid() }).strict(),
  /** Repeatable (daily): fans out leave accruals for the current month; credits are idempotent per period. */
  'leave-accrual': z.object({}).strict(),
  'leave-accrual-tenant': z
    .object({
      tenantId: z.uuid(),
      month: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .optional(),
    })
    .strict(),
};

/** Companies whose data is still processed (cancelled and suspended ones are left alone). */
export const LIVE_TENANT_STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE'];

/**
 * Processor for the `work-sessions` queue: attendance roll-up and recalculation, and applying
 * future-dated employment changes. Tenant jobs run inside the tenant's context so the tenant-scoped
 * client applies exactly as for API requests.
 * @param {{ attendance: any, employees: any, leave?: any, platformDb: () => any, queue: { add: Function },
 *           logger: import('pino').Logger, now?: () => Date }} deps
 */
export function createWorkSessionsProcessor({
  attendance,
  employees,
  leave,
  platformDb,
  queue,
  logger,
  now = () => new Date(),
}) {
  /** One child job per live tenant; the job id makes a repeated fan-out in the same hour a no-op. @param {string} child */
  async function fanOut(child) {
    const tenants = await platformDb().tenant.findMany({
      where: { status: { in: LIVE_TENANT_STATUSES } },
      select: { id: true },
    });
    const hour = now()
      .toISOString()
      .slice(0, 13)
      .replace(/[^0-9]/g, '');
    for (const t of tenants)
      await queue.add(child, { tenantId: t.id }, { jobId: `${child}-${t.id}-${hour}` });
    return { tenants: tenants.length };
  }

  return async (/** @type {import('bullmq').Job} */ job) => {
    const schema = WorkSessionJobs[/** @type {keyof typeof WorkSessionJobs} */ (job.name)];
    if (!schema) throw new Error(`Unknown work-sessions job: ${job.name}`);
    const data = /** @type {any} */ (schema.parse(job.data));
    const inTenant = (/** @type {() => Promise<any>} */ fn, userId = undefined) =>
      runWithContext({ requestId: `job:${job.id}`, tenantId: data.tenantId, userId }, fn);

    switch (job.name) {
      case 'attendance-rollup':
        return fanOut('attendance-rollup-tenant');
      case 'employment-apply-due':
        return fanOut('employment-apply-due-tenant');
      case 'leave-accrual':
        return fanOut('leave-accrual-tenant');
      case 'leave-accrual-tenant': {
        const month = data.month ?? now().toISOString().slice(0, 7);
        const out = await inTenant(() => leave.runAccruals(month));
        logger.info({ tenantId: data.tenantId, month, ...out }, 'Leave accruals posted');
        return { month, ...out };
      }
      case 'attendance-rollup-tenant': {
        const out = await inTenant(() => attendance.rollup());
        logger.info({ tenantId: data.tenantId, ...out }, 'Attendance rolled up');
        return out;
      }
      case 'attendance-recalculate': {
        const out = await inTenant(
          () => attendance.rollup({ from: data.from, to: data.to, employeeIds: data.employeeIds }),
          data.userId,
        );
        logger.info(
          { tenantId: data.tenantId, from: data.from, to: data.to, ...out },
          'Attendance recalculated',
        );
        return out;
      }
      case 'employment-apply-due-tenant': {
        const out = await inTenant(() => employees.applyDueChanges(now()));
        if (out.applied || out.skipped)
          logger.info({ tenantId: data.tenantId, ...out }, 'Employment changes applied');
        return out;
      }
      default:
        throw new Error(`Unknown work-sessions job: ${job.name}`);
    }
  };
}
