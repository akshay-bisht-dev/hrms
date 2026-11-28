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
  /** Repeatable (every minute): marks silent sessions disconnected and closes abandoned ones. */
  'work-session-sweep': z.object({}).strict(),
  'work-session-sweep-tenant': z.object({ tenantId: z.uuid() }).strict(),
  'payroll-calculate': z.object({ tenantId: z.uuid(), userId: z.uuid(), runId: z.uuid() }).strict(),
  'payroll-payslips': z.object({ tenantId: z.uuid(), runId: z.uuid() }).strict(),
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
 * Processor for the `work-sessions` queue: the work-session sweeper, attendance roll-up and recalculation, and applying
 * future-dated employment changes. Tenant jobs run inside the tenant's context so the tenant-scoped
 * client applies exactly as for API requests.
 * @param {{ attendance: any, employees: any, leave?: any, payrollRuns?: any, work?: any, platformDb: () => any, queue: { add: Function },
 *           logger: import('pino').Logger, now?: () => Date }} deps
 */
export function createWorkSessionsProcessor({
  attendance,
  employees,
  leave,
  payrollRuns,
  work,
  platformDb,
  queue,
  logger,
  now = () => new Date(),
}) {
  /**
   * One child job per live tenant; the job id makes a repeated fan-out in the same hour (or minute) a no-op.
   * @param {string} child @param {'hour' | 'minute'} [bucket]
   */
  async function fanOut(child, bucket = 'hour') {
    const tenants = await platformDb().tenant.findMany({
      where: { status: { in: LIVE_TENANT_STATUSES } },
      select: { id: true },
    });
    const hour = now()
      .toISOString()
      .slice(0, bucket === 'minute' ? 16 : 13)
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
      case 'work-session-sweep':
        return fanOut('work-session-sweep-tenant', 'minute');
      case 'work-session-sweep-tenant': {
        const out = await inTenant(() => work.sweep());
        if (out.disconnected || out.closed)
          logger.info({ tenantId: data.tenantId, ...out }, 'Work sessions swept');
        return out;
      }
      case 'payroll-calculate': {
        const out = await inTenant(() => payrollRuns.calculate(data.runId), data.userId);
        logger.info(
          { tenantId: data.tenantId, runId: data.runId, employees: out.employees, errors: out.errors },
          'Payroll calculated',
        );
        return out;
      }
      case 'payroll-payslips': {
        const out = await inTenant(() => payrollRuns.generatePayslips(data.runId));
        logger.info({ tenantId: data.tenantId, runId: data.runId, ...out }, 'Payslips generated');
        return out;
      }
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
