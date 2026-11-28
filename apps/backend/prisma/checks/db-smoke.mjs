// Database smoke checks: run against an EMPTY, freshly migrated database (it inserts test rows).
// Usage: DATABASE_URL=mysql://root:<pw>@127.0.0.1:3306/hrms_test node prisma/checks/db-smoke.mjs
// Sprint 1 turns these into Jest integration tests with Testcontainers.
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { randomUUID as id } from 'node:crypto';

const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
const results = [];
const check = async (name, fn, expectError) => {
  try {
    await fn();
    results.push([name, expectError ? 'FAIL (no error)' : 'pass']);
  } catch (e) {
    results.push([
      name,
      expectError && String(e.message).match(expectError)
        ? 'pass'
        : 'FAIL: ' + e.message.split('\n').slice(-2).join(' '),
    ]);
  }
};

await db.countryProfile.create({
  data: {
    code: 'IN',
    name: 'India',
    defaultCurrency: 'INR',
    defaultLocale: 'en-IN',
    weekendDays: [0],
    fieldRules: {},
    nationalIdTypes: [],
    bankFieldFormat: {},
    addressFormat: {},
  },
});
const mkTenant = async (slug) => {
  const t = await db.tenant.create({
    data: {
      id: id(),
      slug,
      name: slug,
      region: 'in',
      countryCode: 'IN',
      defaultCurrency: 'INR',
      timezone: 'Asia/Kolkata',
    },
  });
  const le = await db.legalEntity.create({
    data: {
      id: id(),
      tenantId: t.id,
      name: slug + ' Pvt Ltd',
      countryCode: 'IN',
      currency: 'INR',
      weekendDays: [0],
      timezone: 'Asia/Kolkata',
    },
  });
  const emp = await db.employee.create({
    data: {
      id: id(),
      tenantId: t.id,
      legalEntityId: le.id,
      employeeCode: 'E1',
      firstName: 'A',
      workCountry: 'IN',
      timezone: 'Asia/Kolkata',
      payCurrency: 'INR',
      dateOfJoining: new Date('2026-01-01'),
    },
  });
  return { t, le, emp };
};
const A = await mkTenant('tenant-a');
const B = await mkTenant('tenant-b');

await check(
  'employee in tenant B cannot use tenant A legal entity (composite FK)',
  () =>
    db.employee.create({
      data: {
        id: id(),
        tenantId: B.t.id,
        legalEntityId: A.le.id,
        employeeCode: 'X',
        firstName: 'X',
        workCountry: 'IN',
        timezone: 'UTC',
        payCurrency: 'INR',
        dateOfJoining: new Date(),
      },
    }),
  /Foreign key|constraint/i,
);

await check(
  'tenant B task cannot be assigned to tenant A employee (composite FK)',
  async () => {
    const task = await db.task.create({ data: { id: id(), tenantId: B.t.id, title: 'T' } });
    await db.taskAssignment.create({
      data: { id: id(), tenantId: B.t.id, taskId: task.id, employeeId: A.emp.id },
    });
  },
  /Foreign key|constraint/i,
);

await check('decimal money round-trips exactly', async () => {
  const s = await db.salaryStructure.create({
    data: {
      id: id(),
      tenantId: A.t.id,
      legalEntityId: A.le.id,
      name: 'S',
      currency: 'INR',
      effectiveFrom: new Date('2026-01-01'),
    },
  });
  const sal = await db.employeeSalary.create({
    data: {
      id: id(),
      tenantId: A.t.id,
      employeeId: A.emp.id,
      structureId: s.id,
      currency: 'INR',
      annualCtc: new Prisma.Decimal('1234567.8912'),
      effectiveFrom: new Date('2026-01-01'),
      reason: 'JOIN',
    },
  });
  const back = await db.employeeSalary.findUnique({ where: { id: sal.id } });
  if (back.annualCtc.toString() !== '1234567.8912') throw new Error('got ' + back.annualCtc);
});

const period = await db.payrollPeriod.create({
  data: {
    id: id(),
    tenantId: A.t.id,
    legalEntityId: A.le.id,
    frequency: 'MONTHLY',
    startDate: new Date('2026-11-01'),
    endDate: new Date('2026-11-30'),
    payDate: new Date('2026-11-30'),
  },
});
const run = await db.payrollRun.create({
  data: { id: id(), tenantId: A.t.id, periodId: period.id, currency: 'INR', createdBy: id() },
});
const re = await db.payrollRunEmployee.create({
  data: {
    id: id(),
    tenantId: A.t.id,
    runId: run.id,
    employeeId: A.emp.id,
    currency: 'INR',
    paidDays: 30,
    lopDays: 0,
    gross: '100000.00',
    deductions: '12000.00',
    employerCost: '8000.00',
    net: '88000.00',
  },
});
await db.payrollLine.create({
  data: {
    id: id(),
    tenantId: A.t.id,
    runEmployeeId: re.id,
    code: 'BASIC',
    label: 'Basic',
    kind: 'EARNING',
    amount: '50000.00',
    sequence: 1,
  },
});
await db.payrollRun.update({
  where: { id: run.id },
  data: { status: 'FINALIZED', finalizedAt: new Date(), finalHash: 'a'.repeat(64) },
});

await check(
  'finalized run: payroll line update blocked',
  () => db.payrollLine.updateMany({ where: { runEmployeeId: re.id }, data: { amount: '1.00' } }),
  /IMMUTABLE/,
);
await check(
  'finalized run: new payroll line blocked',
  () =>
    db.payrollLine.create({
      data: {
        id: id(),
        tenantId: A.t.id,
        runEmployeeId: re.id,
        code: 'X',
        label: 'X',
        kind: 'EARNING',
        amount: '1.00',
        sequence: 2,
      },
    }),
  /IMMUTABLE/,
);
await check(
  'finalized run: net pay update blocked',
  () => db.payrollRunEmployee.update({ where: { id: re.id }, data: { net: '1.00' } }),
  /IMMUTABLE/,
);
await check(
  'finalized run: status back to DRAFT blocked',
  () => db.payrollRun.update({ where: { id: run.id }, data: { status: 'DRAFT' } }),
  /IMMUTABLE/,
);
await check('finalized run: FINALIZED -> PAID allowed', () =>
  db.payrollRun.update({ where: { id: run.id }, data: { status: 'PAID', paidAt: new Date() } }),
);
await check('paid run: delete blocked', () => db.payrollRun.delete({ where: { id: run.id } }), /IMMUTABLE/);

const al = await db.auditLog.create({
  data: { id: id(), tenantId: A.t.id, actorType: 'SYSTEM', action: 'test', entityType: 'x' },
});
await check(
  'audit log update blocked',
  () => db.auditLog.update({ where: { id: al.id }, data: { action: 'tampered' } }),
  /IMMUTABLE/,
);
await check('audit log delete blocked', () => db.auditLog.delete({ where: { id: al.id } }), /IMMUTABLE/);

const loc = await db.workLocation.create({ data: { id: id(), tenantId: A.t.id, name: 'WFH', type: 'WFH' } });
const pol = await db.workPolicy.create({
  data: {
    id: id(),
    tenantId: A.t.id,
    name: 'Default',
    appliesTo: 'COMPANY',
    effectiveFrom: new Date('2026-01-01'),
    createdBy: id(),
  },
});
const ses = await db.workSession.create({
  data: {
    id: id(),
    tenantId: A.t.id,
    employeeId: A.emp.id,
    workDate: new Date('2026-11-25'),
    workLocationId: loc.id,
    policyId: pol.id,
    policyVersion: 1,
    startedAt: new Date(),
  },
});
await db.employeeActiveSession.create({
  data: { tenantId: A.t.id, employeeId: A.emp.id, sessionId: ses.id, startedAt: new Date() },
});
await check(
  'second active session for same employee blocked',
  async () => {
    const s2 = await db.workSession.create({
      data: {
        id: id(),
        tenantId: A.t.id,
        employeeId: A.emp.id,
        workDate: new Date('2026-11-25'),
        workLocationId: loc.id,
        policyId: pol.id,
        policyVersion: 1,
        startedAt: new Date(),
      },
    });
    await db.employeeActiveSession.create({
      data: { tenantId: A.t.id, employeeId: A.emp.id, sessionId: s2.id, startedAt: new Date() },
    });
  },
  /Unique constraint/i,
);
const ev = await db.workSessionEvent.create({
  data: {
    id: id(),
    tenantId: A.t.id,
    sessionId: ses.id,
    type: 'START',
    serverTs: new Date(),
    source: 'WEB',
    idempotencyKey: 'k1',
  },
});
await check(
  'duplicate session event (same idempotency key) blocked',
  () =>
    db.workSessionEvent.create({
      data: {
        id: id(),
        tenantId: A.t.id,
        sessionId: ses.id,
        type: 'START',
        serverTs: new Date(),
        source: 'WEB',
        idempotencyKey: 'k1',
      },
    }),
  /Unique constraint/i,
);
await check(
  'session event update blocked',
  () => db.workSessionEvent.update({ where: { id: ev.id }, data: { type: 'END' } }),
  /IMMUTABLE/,
);

// Attendance (Sprint 5) ----------------------------------------------------------
const punch = await db.attendancePunch.create({
  data: {
    id: id(),
    tenantId: A.t.id,
    employeeId: A.emp.id,
    type: 'IN',
    serverTs: new Date(),
    workDate: new Date('2026-11-25T00:00:00Z'),
    source: 'WEB',
  },
});
await check(
  'attendance punch edit blocked',
  () => db.attendancePunch.update({ where: { id: punch.id }, data: { type: 'OUT' } }),
  /IMMUTABLE/,
);
await check(
  'tenant B punch cannot use tenant A work location (composite FK)',
  () =>
    db.attendancePunch.create({
      data: {
        id: id(),
        tenantId: B.t.id,
        employeeId: B.emp.id,
        type: 'IN',
        serverTs: new Date(),
        workDate: new Date('2026-11-25T00:00:00Z'),
        source: 'WEB',
        workLocationId: loc.id,
      },
    }),
  /Foreign key/i,
);
const day = await db.attendanceDay.create({
  data: {
    id: id(),
    tenantId: A.t.id,
    employeeId: A.emp.id,
    workDate: new Date('2026-11-25T00:00:00Z'),
    computedAt: new Date(),
    isLocked: true,
  },
});
await check(
  'locked attendance day cannot change',
  () => db.attendanceDay.update({ where: { id: day.id }, data: { workedMinutes: 480 } }),
  /IMMUTABLE/,
);
await check('locked attendance day can be unlocked explicitly', () =>
  db.attendanceDay.update({ where: { id: day.id }, data: { isLocked: false } }),
);
await check(
  'attendance policy with half-day above present threshold rejected',
  () =>
    db.attendancePolicy.create({
      data: {
        id: id(),
        tenantId: A.t.id,
        scopeKey: 'default',
        presentPercent: 50,
        halfDayPercent: 60,
        updatedAt: new Date(),
      },
    }),
  /check|constraint/i,
);

// Leave (Sprint 6) ---------------------------------------------------------------
const lt = await db.leaveType.create({
  data: { id: id(), tenantId: A.t.id, code: 'ANNUAL', name: 'Annual', updatedAt: new Date() },
});
const entry = await db.leaveLedgerEntry.create({
  data: {
    id: id(),
    tenantId: A.t.id,
    employeeId: A.emp.id,
    leaveTypeId: lt.id,
    entryType: 'ACCRUAL',
    quantity: '1.67',
    postedOn: new Date('2026-11-01T00:00:00Z'),
    periodKey: 'ACC-2026-11',
    sourceType: 'SCHEDULED',
  },
});
await check(
  'leave ledger entry edit blocked',
  () => db.leaveLedgerEntry.update({ where: { id: entry.id }, data: { quantity: '99' } }),
  /IMMUTABLE/,
);
await check(
  'leave ledger entry delete blocked',
  () => db.leaveLedgerEntry.delete({ where: { id: entry.id } }),
  /IMMUTABLE/,
);
await check(
  'second accrual for the same period blocked',
  () =>
    db.leaveLedgerEntry.create({
      data: { ...entry, id: id(), createdAt: undefined },
    }),
  /Unique constraint/i,
);
await check('ledger quantities are exact decimals', async () => {
  const sum = await db.leaveLedgerEntry.aggregate({
    where: { leaveTypeId: lt.id },
    _sum: { quantity: true },
  });
  if (String(sum._sum.quantity) !== '1.67') throw new Error(`got ${sum._sum.quantity}`);
});
await check(
  'tenant B ledger entry cannot use tenant A leave type (composite FK)',
  () =>
    db.leaveLedgerEntry.create({
      data: {
        ...entry,
        id: id(),
        tenantId: B.t.id,
        employeeId: B.emp.id,
        periodKey: null,
        createdAt: undefined,
      },
    }),
  /Foreign key/i,
);

// Payroll (Sprint 7) -------------------------------------------------------------
await check(
  'payroll settings: pay day outside 1–31 rejected',
  () =>
    db.payrollSetting.create({
      data: { id: id(), tenantId: A.t.id, legalEntityId: A.le.id, payDayOfMonth: 32, updatedAt: new Date() },
    }),
  /check|constraint/i,
);
await check(
  'tenant B payroll settings cannot use tenant A legal entity (composite FK)',
  () =>
    db.payrollSetting.create({
      data: { id: id(), tenantId: B.t.id, legalEntityId: A.le.id, updatedAt: new Date() },
    }),
  /Foreign key/i,
);
// Work status (Sprint 8) ---------------------------------------------------------
const policyRow = (extra) => ({
  id: id(),
  tenantId: A.t.id,
  name: `P ${id()}`,
  appliesTo: 'COMPANY',
  effectiveFrom: new Date('2026-01-01'),
  createdBy: id(),
  ...extra,
});
await check(
  'work policy: allowed window must end after it starts',
  () => db.workPolicy.create({ data: policyRow({ allowedStartMin: 600, allowedEndMin: 540 }) }),
  /check|constraint/i,
);
await check(
  'work policy: company-wide policy cannot have a target',
  () => db.workPolicy.create({ data: policyRow({ targetId: A.emp.id }) }),
  /check|constraint/i,
);
await check(
  'work policy: heartbeat timeout below a minute rejected',
  () => db.workPolicy.create({ data: policyRow({ heartbeatTimeoutSec: 10 }) }),
  /check|constraint/i,
);
await check(
  'work session cannot end before it starts',
  () =>
    db.workSession.update({
      where: { id: ses.id },
      data: { endedAt: new Date(ses.startedAt.getTime() - 1000) },
    }),
  /check|constraint/i,
);
await check(
  'work session totals cannot be negative',
  () => db.workSession.update({ where: { id: ses.id }, data: { workedSec: -1 } }),
  /check|constraint/i,
);
await check(
  'work correction must cover a positive time range',
  () =>
    db.workCorrection.create({
      data: {
        id: id(),
        tenantId: A.t.id,
        sessionId: ses.id,
        employeeId: A.emp.id,
        kind: 'ADD_WORK_TIME',
        fromTs: new Date('2026-11-25T10:00:00Z'),
        toTs: new Date('2026-11-25T10:00:00Z'),
        reason: 'x',
      },
    }),
  /check|constraint/i,
);
await check(
  'WFH request cannot end before it starts',
  () =>
    db.wfhRequest.create({
      data: {
        id: id(),
        tenantId: A.t.id,
        employeeId: A.emp.id,
        workLocationId: loc.id,
        fromDate: new Date('2026-12-02'),
        toDate: new Date('2026-12-01'),
      },
    }),
  /check|constraint/i,
);
await check(
  'tenant B WFH request cannot use tenant A work location (composite FK)',
  () =>
    db.wfhRequest.create({
      data: {
        id: id(),
        tenantId: B.t.id,
        employeeId: B.emp.id,
        workLocationId: loc.id,
        fromDate: new Date('2026-12-01'),
        toDate: new Date('2026-12-01'),
      },
    }),
  /Foreign key/i,
);
await check(
  'session event delete blocked',
  () => db.workSessionEvent.delete({ where: { id: ev.id } }),
  /IMMUTABLE/,
);
await check('system clock-out punch accepted', () =>
  db.attendancePunch.create({
    data: {
      id: id(),
      tenantId: A.t.id,
      employeeId: A.emp.id,
      type: 'OUT',
      serverTs: new Date(),
      workDate: new Date('2026-11-25T00:00:00Z'),
      source: 'SYSTEM',
    },
  }),
);
// Tasks and timesheets (Sprint 9) -----------------------------------------------
const task = await db.task.create({ data: { id: id(), tenantId: A.t.id, title: 'Smoke task' } });
await check(
  'task progress above 100% rejected',
  () => db.task.update({ where: { id: task.id }, data: { progressPct: 101 } }),
  /check|constraint/i,
);
await check(
  'task time entry cannot end before it starts',
  () =>
    db.taskTimeEntry.create({
      data: {
        id: id(),
        tenantId: A.t.id,
        taskId: task.id,
        employeeId: A.emp.id,
        startedAt: new Date('2026-11-25T10:00:00Z'),
        endedAt: new Date('2026-11-25T09:00:00Z'),
      },
    }),
  /check|constraint/i,
);
await check(
  'tenant B time entry cannot use tenant A task (composite FK)',
  () =>
    db.taskTimeEntry.create({
      data: { id: id(), tenantId: B.t.id, taskId: task.id, employeeId: B.emp.id, startedAt: new Date() },
    }),
  /Foreign key/i,
);
await check(
  'one timesheet per person and week',
  async () => {
    const row = {
      tenantId: A.t.id,
      employeeId: A.emp.id,
      weekStart: new Date('2026-11-23'),
      totalSec: 0,
      breakdown: {},
    };
    await db.timesheetApproval.create({ data: { id: id(), ...row } });
    await db.timesheetApproval.create({ data: { id: id(), ...row } });
  },
  /Unique constraint/i,
);
await check(
  'project cannot end before it starts',
  () =>
    db.project.create({
      data: {
        id: id(),
        tenantId: A.t.id,
        code: 'SMK',
        name: 'Smoke',
        startDate: new Date('2026-12-01'),
        endDate: new Date('2026-11-01'),
      },
    }),
  /check|constraint/i,
);
console.table(results);
await db.$disconnect();
process.exit(results.some((r) => r[1] !== 'pass') ? 1 : 0);
