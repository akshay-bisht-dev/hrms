import { createWorkSessionsProcessor, LIVE_TENANT_STATUSES } from '../src/processors/work-sessions.js';
import { currentContext } from '@hrms/backend/lib/context.js';

const T1 = '01a21400-0000-7000-8000-000000000001';
const T2 = '01a21400-0000-7000-8000-000000000002';
const U = '01a21400-0000-7000-8000-0000000000aa';

function setup() {
  const added = [];
  const calls = [];
  const deps = {
    platformDb: () => ({
      tenant: {
        findMany: async ({ where }) => {
          calls.push(['tenants', where.status.in]);
          return [{ id: T1 }, { id: T2 }];
        },
      },
    }),
    queue: { add: async (name, data, opts) => added.push({ name, data, jobId: opts.jobId }) },
    attendance: {
      rollup: async (opts) => {
        calls.push(['rollup', currentContext().tenantId, currentContext().userId ?? null, opts ?? null]);
        return { employees: 3, days: 9 };
      },
    },
    payrollRuns: {
      calculate: async (runId) => {
        calls.push(['calculate', currentContext().tenantId, currentContext().userId, runId]);
        return { employees: 3, errors: 0 };
      },
      generatePayslips: async (runId) => {
        calls.push(['payslips', currentContext().tenantId, runId]);
        return { created: 3 };
      },
    },
    leave: {
      runAccruals: async (month) => {
        calls.push(['accrual', currentContext().tenantId, month]);
        return { employees: 2, credited: 2, expired: 0 };
      },
    },
    employees: {
      applyDueChanges: async () => {
        calls.push(['apply', currentContext().tenantId]);
        return { applied: 1, skipped: 0 };
      },
    },
    work: {
      sweep: async () => {
        calls.push(['sweep', currentContext().tenantId]);
        return { checked: 4, disconnected: 1, closed: 1 };
      },
    },
    logger: { info() {} },
    now: () => new Date('2026-11-25T10:42:00Z'),
  };
  return { process: createWorkSessionsProcessor(deps), added, calls };
}
const job = (name, data = {}) => ({ id: '1', name, data });

test('the repeatable roll-up fans out one job per live company, deduplicated per hour', async () => {
  const { process, added, calls } = setup();
  expect(await process(job('attendance-rollup'))).toEqual({ tenants: 2 });
  expect(calls[0]).toEqual(['tenants', LIVE_TENANT_STATUSES]);
  expect(LIVE_TENANT_STATUSES).not.toContain('SUSPENDED');
  expect(added).toEqual([
    {
      name: 'attendance-rollup-tenant',
      data: { tenantId: T1 },
      jobId: `attendance-rollup-tenant-${T1}-2026112510`,
    },
    {
      name: 'attendance-rollup-tenant',
      data: { tenantId: T2 },
      jobId: `attendance-rollup-tenant-${T2}-2026112510`,
    },
  ]);
  expect(added.every((a) => !a.jobId.includes(':'))).toBe(true); // BullMQ rejects ':' in custom ids
});

test('tenant jobs run inside that tenant context', async () => {
  const { process, calls } = setup();
  await process(job('attendance-rollup-tenant', { tenantId: T1 }));
  await process(
    job('attendance-recalculate', { tenantId: T2, userId: U, from: '2026-11-01', to: '2026-11-07' }),
  );
  await process(job('employment-apply-due-tenant', { tenantId: T1 }));
  expect(await process(job('leave-accrual-tenant', { tenantId: T2 }))).toMatchObject({
    month: '2026-11',
    credited: 2,
  });
  await process(job('leave-accrual-tenant', { tenantId: T1, month: '2026-10' }));
  const R = '01a21400-0000-7000-8000-0000000000bb';
  await process(job('payroll-calculate', { tenantId: T1, userId: U, runId: R }));
  expect(await process(job('payroll-payslips', { tenantId: T2, runId: R }))).toEqual({ created: 3 });
  expect(calls).toEqual([
    ['rollup', T1, null, null],
    ['rollup', T2, U, { from: '2026-11-01', to: '2026-11-07', employeeIds: undefined }],
    ['apply', T1],
    ['accrual', T2, '2026-11'],
    ['accrual', T1, '2026-10'],
    ['calculate', T1, U, R],
    ['payslips', T2, R],
  ]);
});

test('bad payloads and unknown jobs are rejected', async () => {
  const { process } = setup();
  await expect(process(job('attendance-rollup-tenant', { tenantId: 'nope' }))).rejects.toThrow();
  await expect(
    process(job('attendance-recalculate', { tenantId: T1, userId: U, from: 'x', to: 'y' })),
  ).rejects.toThrow();
  await expect(process(job('drop-tables'))).rejects.toThrow(/Unknown work-sessions job/);
});

test('the work-session sweeper fans out every minute and sweeps inside each tenant', async () => {
  const { process, added, calls } = setup();
  expect(await process(job('work-session-sweep'))).toEqual({ tenants: 2 });
  expect(added.map((a) => a.jobId)).toEqual([
    `work-session-sweep-tenant-${T1}-202611251042`,
    `work-session-sweep-tenant-${T2}-202611251042`,
  ]);
  expect(await process(job('work-session-sweep-tenant', { tenantId: T2 }))).toEqual({
    checked: 4,
    disconnected: 1,
    closed: 1,
  });
  expect(calls.at(-1)).toEqual(['sweep', T2]);
});
