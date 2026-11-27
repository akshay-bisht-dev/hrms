// @ts-check
import { createHash } from 'node:crypto';
import { calculatePay, dec, ENGINE_VERSION, sum, toStore } from '@hrms/payroll';
import { newId } from '@hrms/shared/ids';
import { audit } from '../../lib/audit.js';
import { currentContext } from '../../lib/context.js';
import { db } from '../../lib/db.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { dateToYmd, eachDay, ymdToDate } from '../../lib/time.js';
import { employeeScope } from '../employees/scope.js';
import { engineComponents, fiscalYearOf, monthsRemainingInYear } from './config.service.js';
import { buildPayslipPdf } from './payslip-pdf.js';

const ctx = () => /** @type {any} */ (currentContext());
const str = (/** @type {any} */ d) => (d === null || d === undefined ? null : String(d));
const fullName = (/** @type {any} */ e) => [e.firstName, e.lastName].filter(Boolean).join(' ');
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const lastDay = (/** @type {string} */ month) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
/** Who may move a run between which states, and with which permission. */
const TRANSITIONS = {
  lock: { from: ['DRAFT'], to: 'INPUTS_LOCKED', permission: 'payroll.run.create' },
  unlock: {
    from: ['INPUTS_LOCKED', 'CALCULATED', 'REVIEWED'],
    to: 'DRAFT',
    permission: 'payroll.run.create',
  },
  calculate: { from: ['INPUTS_LOCKED', 'CALCULATED'], to: 'CALCULATING', permission: 'payroll.run.create' },
  review: { from: ['CALCULATED'], to: 'REVIEWED', permission: 'payroll.run.review' },
  approve: { from: ['REVIEWED'], to: 'APPROVED', permission: 'payroll.run.approve' },
  reject: { from: ['REVIEWED', 'APPROVED'], to: 'CALCULATED', permission: 'payroll.run.approve' },
  finalize: { from: ['APPROVED'], to: 'FINALIZED', permission: 'payroll.run.approve' },
  markPaid: { from: ['FINALIZED'], to: 'PAID', permission: 'payroll.run.approve' },
  cancel: {
    from: ['DRAFT', 'INPUTS_LOCKED', 'CALCULATED', 'REVIEWED', 'APPROVED'],
    to: 'CANCELLED',
    permission: 'payroll.run.create',
  },
};

/**
 * Payroll runs (PAY-03..05): DRAFT → INPUTS_LOCKED → CALCULATED → REVIEWED → APPROVED → FINALIZED → PAID.
 * Maker-checker: the approver must be a different person from the reviewer. Finalized runs are frozen by triggers.
 * @param {{ config: ReturnType<typeof import('./config.service.js').createPayrollConfigService>,
 *           cipher?: { decrypt: (b: any, aad?: string) => string }, files?: any, buckets?: { documents: string },
 *           queues?: { workSessions?: { add: Function } }, now?: () => Date }} deps
 */
export function createPayrollRunService({ config, cipher, files, buckets, queues, now = () => new Date() }) {
  const can = (/** @type {string} */ code) => Boolean(ctx().permissions?.has(code));

  /** @param {string} id */
  async function runOr404(id) {
    const run = await db().payrollRun.findUnique({
      where: { id },
      include: { period: { include: { legalEntity: true } } },
    });
    if (!run) throw new NotFoundError();
    return run;
  }

  const runDto = (/** @type {any} */ r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    currency: r.currency,
    legalEntity: {
      id: r.period.legalEntity.id,
      name: r.period.legalEntity.name,
      countryCode: r.period.legalEntity.countryCode,
    },
    period: {
      id: r.period.id,
      month: dateToYmd(r.period.startDate)?.slice(0, 7),
      startDate: dateToYmd(r.period.startDate),
      endDate: dateToYmd(r.period.endDate),
      payDate: dateToYmd(r.period.payDate),
    },
    totals: r.totals,
    ruleVersionsPinned: r.ruleVersionsPinned,
    engineVersion: r.engineVersion,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    inputsLockedAt: r.inputsLockedAt,
    calculatedAt: r.calculatedAt,
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt,
    approvedBy: r.approvedBy,
    approvedAt: r.approvedAt,
    finalizedAt: r.finalizedAt,
    paidAt: r.paidAt,
    finalHash: r.finalHash,
  });

  /**
   * Moves a run between states atomically (the WHERE on the current status stops double clicks and races).
   * @param {string} id @param {keyof typeof TRANSITIONS} action @param {object} [data] @param {(tx: any, run: any) => Promise<void>} [inTx]
   */
  async function transition(id, action, data = {}, inTx = undefined) {
    const t = TRANSITIONS[action];
    if (!can(t.permission)) throw new ForbiddenError();
    const run = await runOr404(id);
    if (!t.from.includes(run.status))
      throw new ConflictError(
        'wrong_status',
        `This run is ${run.status.toLowerCase().replace('_', ' ')}; it cannot be ${action === 'markPaid' ? 'marked paid' : `${action}ed`} now`,
      );
    await db().$transaction(async (/** @type {any} */ tx) => {
      const { count } = await tx.payrollRun.updateMany({
        where: { id, status: run.status },
        data: { status: t.to, ...data },
      });
      if (!count) throw new ConflictError('wrong_status', 'This run changed. Reload and try again.');
      if (inTx) await inTx(tx, run);
      await audit(tx, {
        action: `payroll.run_${action}`,
        entityType: 'PayrollRun',
        entityId: id,
        changes: { from: run.status, to: t.to },
      });
    });
    return run;
  }

  /** Locks (or unlocks) the attendance days of the run's legal entity in its period, so inputs cannot change underneath it. */
  async function setAttendanceLock(
    /** @type {any} */ tx,
    /** @type {any} */ run,
    /** @type {boolean} */ locked,
  ) {
    await tx.attendanceDay.updateMany({
      where: {
        workDate: { gte: run.period.startDate, lte: run.period.endDate },
        isLocked: !locked,
        employee: { legalEntityId: run.period.legalEntityId },
      },
      data: { isLocked: locked },
    });
  }

  /** Loss of pay and paid days for one employee in the period. @param {any} emp @param {any} run @param {any} settings */
  async function attendanceFor(emp, run, settings) {
    const start = /** @type {string} */ (dateToYmd(run.period.startDate));
    const end = /** @type {string} */ (dateToYmd(run.period.endDate));
    const doj = /** @type {string} */ (dateToYmd(emp.dateOfJoining));
    const exit = dateToYmd(emp.exitDate);
    const from = doj > start ? doj : start;
    const to = exit && exit < end ? exit : end;
    const calendarDays = eachDay(start, end).length;
    const notEmployed = calendarDays - (from <= to ? eachDay(from, to).length : 0);
    const window = { gte: ymdToDate(from), lte: ymdToDate(to) };
    const [unpaid, absent] = await Promise.all([
      db().leaveRequestDay.findMany({
        where: {
          date: window,
          request: { employeeId: emp.id, status: 'APPROVED', leaveType: { isPaid: false } },
        },
        select: { quantity: true },
      }),
      settings.lopFromAbsence
        ? db().attendanceDay.findMany({
            where: { employeeId: emp.id, workDate: window, status: { in: ['ABSENT', 'HALF_DAY'] } },
            select: { status: true },
          })
        : [],
    ]);
    const unpaidDays = sum(unpaid.map((d) => String(d.quantity)));
    const absentDays = sum(absent.map((d) => (d.status === 'ABSENT' ? '1' : '0.5')));
    const periodDays = settings.paidDaysBasis === 'FIXED_30' ? dec(30) : dec(calendarDays);
    const lop = dec(notEmployed).plus(unpaidDays).plus(absentDays);
    const paid = periodDays.minus(lop).isNegative() ? dec(0) : periodDays.minus(lop);
    return {
      periodDays,
      paidDays: paid,
      lopDays: lop,
      detail: { notEmployed, unpaidLeave: unpaidDays.toString(), absence: absentDays.toString() },
    };
  }

  /** Taxable earnings, TDS and PT already paid this fiscal year in finalized runs (for the India TDS projection). */
  async function yearToDate(
    /** @type {string} */ employeeId,
    /** @type {any} */ run,
    /** @type {string} */ fyStart,
  ) {
    const lines = await db().payrollLine.findMany({
      where: {
        runEmployee: {
          employeeId,
          run: {
            status: { in: ['FINALIZED', 'PAID'] },
            period: {
              legalEntityId: run.period.legalEntityId,
              startDate: { gte: ymdToDate(fyStart), lt: run.period.startDate },
            },
          },
        },
      },
      select: { kind: true, amount: true, component: { select: { taxable: true, statutoryKey: true } } },
    });
    return {
      ytdTaxable: toStore(
        sum(
          lines
            .filter((l) => l.kind === 'EARNING' && l.component?.taxable !== false)
            .map((l) => String(l.amount)),
        ),
      ),
      ytdTds: toStore(
        sum(lines.filter((l) => l.component?.statutoryKey === 'IN.TDS').map((l) => String(l.amount))),
      ),
      ytdPt: toStore(
        sum(lines.filter((l) => l.component?.statutoryKey === 'IN.PT').map((l) => String(l.amount))),
      ),
    };
  }

  /** A canonical hash of everything a finalized run pays, so any later change is detectable. @param {string} runId */
  async function resultHash(runId) {
    const rows = await db().payrollRunEmployee.findMany({
      where: { runId },
      orderBy: { employeeId: 'asc' },
      include: { payrollLines: { orderBy: [{ sequence: 'asc' }, { code: 'asc' }] } },
    });
    const canonical = rows.map((r) => [
      r.employeeId,
      str(r.gross),
      str(r.deductions),
      str(r.employerCost),
      str(r.net),
      r.payrollLines.map((l) => [l.code, l.kind, str(l.amount)]),
    ]);
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  const service = {
    /** @param {{ legalEntityId: string, month: string }} input */
    async create(input) {
      if (!can('payroll.run.create')) throw new ForbiddenError();
      const le = await db().legalEntity.findUnique({ where: { id: input.legalEntityId } });
      if (!le) throw new ValidationError([{ path: 'body.legalEntityId', message: 'Legal entity not found' }]);
      const settings = await config.getPayrollSettings(le.id);
      const start = `${input.month}-01`;
      const end = lastDay(input.month);
      const payDay = settings.payDayOfMonth
        ? `${input.month}-${String(Math.min(settings.payDayOfMonth, Number(end.slice(8)))).padStart(2, '0')}`
        : end;
      const id = newId();
      await db().$transaction(async (/** @type {any} */ tx) => {
        const period = await tx.payrollPeriod.upsert({
          where: {
            tenantId_legalEntityId_frequency_startDate: {
              tenantId: ctx().tenantId,
              legalEntityId: le.id,
              frequency: 'MONTHLY',
              startDate: ymdToDate(start),
            },
          },
          create: {
            id: newId(),
            legalEntityId: le.id,
            frequency: 'MONTHLY',
            startDate: ymdToDate(start),
            endDate: ymdToDate(end),
            payDate: ymdToDate(payDay),
          },
          update: {},
        });
        const active = await tx.payrollRun.count({
          where: { periodId: period.id, type: 'REGULAR', status: { not: 'CANCELLED' } },
        });
        if (active)
          throw new ConflictError('run_exists', `There is already a payroll run for ${input.month}`);
        await tx.payrollRun.create({
          data: { id, periodId: period.id, type: 'REGULAR', currency: le.currency, createdBy: ctx().userId },
        });
        await audit(tx, {
          action: 'payroll.run_created',
          entityType: 'PayrollRun',
          entityId: id,
          changes: input,
        });
      });
      return service.get(id);
    },

    /** @param {{ status?: string, legalEntityId?: string }} q */
    async list(q) {
      if (!['payroll.run.create', 'payroll.run.review', 'payroll.run.approve'].some(can))
        throw new ForbiddenError();
      const rows = await db().payrollRun.findMany({
        where: {
          ...(q.status ? { status: q.status } : {}),
          ...(q.legalEntityId ? { period: { legalEntityId: q.legalEntityId } } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { period: { include: { legalEntity: true } } },
      });
      return rows.map(runDto);
    },

    /** @param {string} id */
    async get(id) {
      if (!['payroll.run.create', 'payroll.run.review', 'payroll.run.approve'].some(can))
        throw new ForbiddenError();
      const run = await runOr404(id);
      const counts = await db().payrollRunEmployee.groupBy({
        by: ['status'],
        where: { runId: id },
        _count: { _all: true },
      });
      return { ...runDto(run), counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])) };
    },

    // ── Inputs (variable pay, reimbursements) ──────────────────────────────────

    /** @param {string} runId */
    async inputs(runId) {
      await service.get(runId);
      const rows = await db().payrollInput.findMany({
        where: { runId },
        orderBy: { createdAt: 'asc' },
        include: {
          component: { select: { code: true, name: true } },
          employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
        },
      });
      return rows.map((r) => ({
        id: r.id,
        amount: str(r.amount),
        note: r.note,
        component: r.component,
        employee: { id: r.employee.id, code: r.employee.employeeCode, name: fullName(r.employee) },
      }));
    },

    /** @param {string} runId @param {any} input */
    async addInput(runId, input) {
      if (!can('payroll.run.create')) throw new ForbiddenError();
      const run = await runOr404(runId);
      if (run.status !== 'DRAFT')
        throw new ConflictError('inputs_locked', 'Inputs can only change while the run is a draft');
      const [component, emp] = await Promise.all([
        db().salaryComponent.findUnique({ where: { id: input.componentId } }),
        db().employee.findFirst({
          where: { id: input.employeeId, legalEntityId: run.period.legalEntityId, deletedAt: null },
        }),
      ]);
      if (!component || component.calcType !== 'INPUT')
        throw new ValidationError([
          { path: 'body.componentId', message: 'Choose a component whose amount comes from inputs' },
        ]);
      if (!emp)
        throw new ValidationError([
          { path: 'body.employeeId', message: "Not an employee of this run's legal entity" },
        ]);
      const id = newId();
      await db().payrollInput.create({
        data: {
          id,
          runId,
          employeeId: emp.id,
          componentId: component.id,
          amount: input.amount,
          note: input.note ?? null,
          sourceType: 'MANUAL',
          createdBy: ctx().userId,
        },
      });
      await audit(db(), {
        action: 'payroll.input_added',
        entityType: 'PayrollRun',
        entityId: runId,
        changes: { employee: emp.id, component: component.code, amount: input.amount },
      });
      return { id };
    },

    /** @param {string} runId @param {string} inputId */
    async removeInput(runId, inputId) {
      if (!can('payroll.run.create')) throw new ForbiddenError();
      const run = await runOr404(runId);
      if (run.status !== 'DRAFT')
        throw new ConflictError('inputs_locked', 'Inputs can only change while the run is a draft');
      const { count } = await db().payrollInput.deleteMany({ where: { id: inputId, runId } });
      if (!count) throw new NotFoundError();
      await audit(db(), {
        action: 'payroll.input_removed',
        entityType: 'PayrollRun',
        entityId: runId,
        changes: { inputId },
      });
    },

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    /** @param {string} id */
    async lock(id) {
      await transition(id, 'lock', { inputsLockedAt: now() }, (tx, run) => setAttendanceLock(tx, run, true));
      return service.get(id);
    },
    /** Back to draft: results are discarded and attendance unlocked. @param {string} id */
    async unlock(id) {
      await transition(
        id,
        'unlock',
        { inputsLockedAt: null, calculatedAt: null, reviewedBy: null, reviewedAt: null, totals: null },
        async (tx, run) => {
          await tx.payrollLine.deleteMany({ where: { runEmployee: { runId: id } } });
          await tx.payrollRunEmployee.deleteMany({ where: { runId: id } });
          await setAttendanceLock(tx, run, false);
        },
      );
      return service.get(id);
    },
    /** Queues the calculation for the worker. @param {string} id */
    async requestCalculation(id) {
      if (!queues?.workSessions)
        throw new AppError(503, 'queue_unavailable', 'Background jobs are not available');
      await transition(id, 'calculate', { reviewedBy: null, reviewedAt: null });
      await queues.workSessions.add(
        'payroll-calculate',
        { tenantId: ctx().tenantId, userId: ctx().userId, runId: id },
        { jobId: `payroll-calculate-${id}-${Date.now()}` },
      );
      return service.get(id);
    },
    /** @param {string} id @param {{ comment?: string }} input */
    async review(id, input) {
      const errors = await db().payrollRunEmployee.count({ where: { runId: id, status: 'ERROR' } });
      if (errors)
        throw new ConflictError(
          'run_has_errors',
          `${errors} employee${errors > 1 ? 's have' : ' has'} errors. Fix them and recalculate first.`,
        );
      await transition(id, 'review', { reviewedBy: ctx().userId, reviewedAt: now() });
      if (input.comment)
        await audit(db(), {
          action: 'payroll.run_review_note',
          entityType: 'PayrollRun',
          entityId: id,
          changes: { comment: input.comment },
        });
      return service.get(id);
    },
    /** Maker-checker: whoever reviewed the run cannot approve it. @param {string} id */
    async approve(id) {
      const run = await runOr404(id);
      if (run.reviewedBy === ctx().userId)
        throw new ForbiddenError('same_person', 'You reviewed this run, so someone else has to approve it');
      await transition(id, 'approve', { approvedBy: ctx().userId, approvedAt: now() });
      return service.get(id);
    },
    /** @param {string} id @param {{ comment: string }} input */
    async reject(id, input) {
      await transition(id, 'reject', {
        reviewedBy: null,
        reviewedAt: null,
        approvedBy: null,
        approvedAt: null,
      });
      await audit(db(), {
        action: 'payroll.run_rejected_note',
        entityType: 'PayrollRun',
        entityId: id,
        changes: { comment: input.comment },
      });
      return service.get(id);
    },
    /** Freezes the run: from here the database refuses any change except marking it paid. Payslips are queued. @param {string} id */
    async finalize(id) {
      const hash = await resultHash(id);
      await transition(id, 'finalize', { finalizedAt: now(), finalHash: hash });
      await queues?.workSessions?.add(
        'payroll-payslips',
        { tenantId: ctx().tenantId, runId: id },
        { jobId: `payroll-payslips-${id}` },
      );
      return service.get(id);
    },
    /** @param {string} id */
    async markPaid(id) {
      await transition(id, 'markPaid', { paidAt: now() });
      return service.get(id);
    },
    /** @param {string} id */
    async cancel(id) {
      await transition(id, 'cancel', {}, async (tx, run) => {
        await tx.payrollLine.deleteMany({ where: { runEmployee: { runId: id } } });
        await tx.payrollRunEmployee.deleteMany({ where: { runId: id } });
        await setAttendanceLock(tx, run, false);
      });
      return service.get(id);
    },

    /**
     * Calculates every employee of the legal entity employed in the period (worker). Rule versions are pinned on the run.
     * @param {string} id
     */
    async calculate(id) {
      const run = await runOr404(id);
      if (run.status !== 'CALCULATING')
        throw new ConflictError('wrong_status', 'This run is not waiting to be calculated');
      const le = run.period.legalEntity;
      const end = /** @type {string} */ (dateToYmd(run.period.endDate));
      const start = /** @type {string} */ (dateToYmd(run.period.startDate));
      try {
        const r = await config.rulesFor(le.countryCode, end);
        const rules = /** @type {any} */ (r?.version?.rules) ?? null;
        const fyStartMonth = rules?.fiscalYearStartMonth ?? 4;
        const fy = fiscalYearOf(start, fyStartMonth);
        const fyStart = `${fy.slice(0, 4)}-${String(fyStartMonth).padStart(2, '0')}-01`;
        const { settings: statutory } = await config.statutorySettingsFor(le.id, r?.pack, end);
        const settings = await config.getPayrollSettings(le.id);
        const currency = await db().currency.findUnique({ where: { code: run.currency } });
        const employees = await db().employee.findMany({
          where: {
            legalEntityId: le.id,
            deletedAt: null,
            dateOfJoining: { lte: run.period.endDate },
            OR: [{ exitDate: null }, { exitDate: { gte: run.period.startDate } }],
          },
          orderBy: { employeeCode: 'asc' },
        });
        const inputs = await db().payrollInput.findMany({
          where: { runId: id },
          include: { component: { select: { code: true } } },
        });
        /** @type {any[]} */
        const results = [];
        for (const emp of employees) {
          const salary = await db().employeeSalary.findFirst({
            where: {
              employeeId: emp.id,
              effectiveFrom: { lte: run.period.endDate },
              OR: [{ effectiveTo: null }, { effectiveTo: { gte: run.period.endDate } }],
            },
            orderBy: { effectiveFrom: 'desc' },
          });
          if (!salary) {
            results.push({
              emp,
              salary: null,
              status: 'EXCLUDED',
              errors: [{ code: null, message: 'No salary in force at the end of the period' }],
            });
            continue;
          }
          const structure = await config.structureWithComponents(salary.structureId);
          const days = await attendanceFor(emp, run, settings);
          const declaration = await db().taxDeclaration.findUnique({
            where: {
              tenantId_employeeId_fiscalYear: {
                tenantId: ctx().tenantId,
                employeeId: emp.id,
                fiscalYear: fy,
              },
            },
          });
          const empInputs = Object.fromEntries(
            Object.entries(
              inputs
                .filter((i) => i.employeeId === emp.id)
                .reduce(
                  (/** @type {Record<string, any>} */ acc, i) => ({
                    ...acc,
                    [i.component.code]: dec(acc[i.component.code] ?? 0).plus(String(i.amount)),
                  }),
                  {},
                ),
            ).map(([k, v]) => [k, toStore(v)]),
          );
          const out = calculatePay({
            currency: { code: run.currency, minorUnits: currency?.minorUnits ?? 2 },
            annualCtc: String(salary.annualCtc),
            paidDays: days.paidDays.toString(),
            periodDays: days.periodDays.toString(),
            components: engineComponents(structure.salaryStructureComponents),
            inputs: empInputs,
            pack: r?.pack ?? null,
            packContext: {
              rules,
              settings: statutory,
              employee: { gender: emp.gender },
              period: {
                month: Number(start.slice(5, 7)),
                monthsRemainingInYear: monthsRemainingInYear(start, fyStartMonth),
              },
              tax: {
                regime: declaration?.status !== 'REJECTED' ? (declaration?.regime ?? undefined) : undefined,
                deductions:
                  declaration?.status === 'VERIFIED' ? /** @type {any} */ (declaration.declarations) : {},
                ...(await yearToDate(emp.id, run, fyStart)),
              },
            },
          });
          results.push({
            emp,
            salary,
            out,
            days,
            status: out.errors.length ? 'ERROR' : days.paidDays.isZero() ? 'WARNING' : 'OK',
            errors: out.errors,
          });
        }
        const totals = {
          employees: results.length,
          calculated: results.filter((x) => x.out).length,
          excluded: results.filter((x) => x.status === 'EXCLUDED').length,
          errors: results.filter((x) => x.status === 'ERROR').length,
          gross: toStore(sum(results.filter((x) => x.out).map((x) => x.out.totals.gross))),
          deductions: toStore(sum(results.filter((x) => x.out).map((x) => x.out.totals.deductions))),
          employerContributions: toStore(
            sum(results.filter((x) => x.out).map((x) => x.out.totals.employerContributions)),
          ),
          net: toStore(sum(results.filter((x) => x.out).map((x) => x.out.totals.net))),
          employerCost: toStore(sum(results.filter((x) => x.out).map((x) => x.out.totals.employerCost))),
        };
        const pinned = r
          ? {
              pack: r.packRow.code,
              packVersion: r.pack.version,
              ruleVersion: r.version?.version ?? null,
              ruleChecksum: r.version?.checksum ?? null,
              reviewed: Boolean(r.version?.reviewedBy),
            }
          : null;
        await db().$transaction(
          async (/** @type {any} */ tx) => {
            await tx.payrollLine.deleteMany({ where: { runEmployee: { runId: id } } });
            await tx.payrollRunEmployee.deleteMany({ where: { runId: id } });
            for (const x of results) {
              const reId = newId();
              await tx.payrollRunEmployee.create({
                data: {
                  id: reId,
                  runId: id,
                  employeeId: x.emp.id,
                  employeeSalaryId: x.salary?.id ?? null,
                  currency: run.currency,
                  paidDays: x.days ? x.days.paidDays.toFixed(2) : '0',
                  lopDays: x.days ? x.days.lopDays.toFixed(2) : '0',
                  gross: x.out?.totals.gross ?? '0',
                  deductions: x.out?.totals.deductions ?? '0',
                  employerCost: x.out?.totals.employerCost ?? '0',
                  net: x.out?.totals.net ?? '0',
                  status: x.status,
                  errors:
                    x.errors.length || x.days
                      ? { errors: x.errors, days: x.days?.detail ?? null }
                      : undefined,
                },
              });
              if (x.out)
                await tx.payrollLine.createMany({
                  data: x.out.lines.map((/** @type {any} */ l) => ({
                    id: newId(),
                    runEmployeeId: reId,
                    componentId: l.componentId,
                    code: l.code,
                    label: l.label,
                    kind: l.kind,
                    amount: l.amount,
                    sequence: l.sequence,
                    calcTrace: l.trace,
                  })),
                });
            }
            await tx.payrollRun.update({
              where: { id },
              data: {
                status: 'CALCULATED',
                calculatedAt: now(),
                totals,
                ruleVersionsPinned: pinned ?? undefined,
                engineVersion: ENGINE_VERSION,
              },
            });
          },
          { timeout: 120_000 },
        );
        await audit(db(), {
          action: 'payroll.run_calculated',
          entityType: 'PayrollRun',
          entityId: id,
          changes: { employees: totals.employees, errors: totals.errors },
        });
        return totals;
      } catch (err) {
        // A failed calculation leaves the run where it can be fixed and retried.
        await db().payrollRun.updateMany({
          where: { id, status: 'CALCULATING' },
          data: {
            status: 'INPUTS_LOCKED',
            totals: { failed: String(/** @type {any} */ (err)?.message ?? err) },
          },
        });
        throw err;
      }
    },

    // ── Results, reports and files ─────────────────────────────────────────────

    /** @param {string} runId */
    async employees(runId) {
      await service.get(runId);
      const rows = await db().payrollRunEmployee.findMany({
        where: { runId },
        orderBy: { employee: { employeeCode: 'asc' } },
        include: {
          employee: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              department: { select: { name: true } },
            },
          },
        },
      });
      return rows.map((r) => ({
        id: r.id,
        employee: {
          id: r.employee.id,
          code: r.employee.employeeCode,
          name: fullName(r.employee),
          department: r.employee.department?.name ?? null,
        },
        status: r.status,
        paidDays: str(r.paidDays),
        lopDays: str(r.lopDays),
        gross: str(r.gross),
        deductions: str(r.deductions),
        employerCost: str(r.employerCost),
        net: str(r.net),
        errors: /** @type {any} */ (r.errors)?.errors ?? [],
        days: /** @type {any} */ (r.errors)?.days ?? null,
      }));
    },

    /** One employee's lines with calculation traces. @param {string} runId @param {string} runEmployeeId */
    async employeeLines(runId, runEmployeeId) {
      await service.get(runId);
      const r = await db().payrollRunEmployee.findFirst({
        where: { id: runEmployeeId, runId },
        include: {
          payrollLines: { orderBy: [{ sequence: 'asc' }] },
          employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
        },
      });
      if (!r) throw new NotFoundError();
      return {
        id: r.id,
        employee: { id: r.employee.id, code: r.employee.employeeCode, name: fullName(r.employee) },
        status: r.status,
        paidDays: str(r.paidDays),
        lopDays: str(r.lopDays),
        totals: {
          gross: str(r.gross),
          deductions: str(r.deductions),
          employerCost: str(r.employerCost),
          net: str(r.net),
        },
        lines: r.payrollLines.map((l) => ({
          code: l.code,
          label: l.label,
          kind: l.kind,
          amount: str(l.amount),
          trace: l.calcTrace,
        })),
      };
    },

    /** Change per employee against the previous finalized run of the same legal entity (PAY-05 reconciliation). @param {string} runId */
    async variance(runId) {
      const run = await runOr404(runId);
      await service.get(runId);
      const previous = await db().payrollRun.findFirst({
        where: {
          status: { in: ['FINALIZED', 'PAID'] },
          id: { not: runId },
          period: { legalEntityId: run.period.legalEntityId, startDate: { lt: run.period.startDate } },
        },
        orderBy: { period: { startDate: 'desc' } },
        include: { period: true },
      });
      const current = await service.employees(runId);
      const before = previous ? await service.employees(previous.id) : [];
      const prevBy = new Map(before.map((e) => [e.employee.id, e]));
      const rows = current.map((e) => {
        const p = prevBy.get(e.employee.id);
        return {
          employee: e.employee,
          previousNet: p?.net ?? null,
          net: e.net,
          change: p ? toStore(dec(e.net).minus(p.net)) : null,
          note: p ? null : 'New this period',
        };
      });
      for (const p of before)
        if (!current.some((e) => e.employee.id === p.employee.id))
          rows.push({
            employee: p.employee,
            previousNet: p.net,
            net: null,
            change: null,
            note: 'Not in this period',
          });
      return {
        previousRun: previous
          ? { id: previous.id, month: dateToYmd(previous.period.startDate)?.slice(0, 7) }
          : null,
        data: rows,
      };
    },

    /** Register rows for CSV: one row per employee, one column per component code. @param {string} runId */
    async register(runId) {
      if (!can('payroll.salary.view')) throw new ForbiddenError();
      await service.get(runId);
      const rows = await db().payrollRunEmployee.findMany({
        where: { runId },
        orderBy: { employee: { employeeCode: 'asc' } },
        include: {
          payrollLines: true,
          employee: { select: { employeeCode: true, firstName: true, lastName: true } },
        },
      });
      const codes = [
        ...new Set(
          rows.flatMap((r) => r.payrollLines.sort((a, b) => a.sequence - b.sequence).map((l) => l.code)),
        ),
      ];
      await audit(db(), { action: 'payroll.register_downloaded', entityType: 'PayrollRun', entityId: runId });
      return {
        header: [
          'employeeCode',
          'name',
          'status',
          'paidDays',
          'lopDays',
          ...codes,
          'gross',
          'deductions',
          'net',
          'employerCost',
        ],
        rows: rows.map((r) => {
          const by = new Map(r.payrollLines.map((l) => [l.code, str(l.amount)]));
          return [
            r.employee.employeeCode,
            fullName(r.employee),
            r.status,
            str(r.paidDays),
            str(r.lopDays),
            ...codes.map((c) => by.get(c) ?? ''),
            str(r.gross),
            str(r.deductions),
            str(r.net),
            str(r.employerCost),
          ];
        }),
      };
    },

    /**
     * Bank transfer rows for a finalized run. Account numbers are decrypted only here, never stored in the file system;
     * the download is audited. People without a bank account are reported, not silently dropped.
     * @param {string} runId
     */
    async bankFile(runId) {
      if (!can('payroll.bank.view')) throw new ForbiddenError();
      if (!cipher) throw new AppError(503, 'encryption_unavailable', 'Encryption key is not configured');
      const run = await runOr404(runId);
      if (!['FINALIZED', 'PAID'].includes(run.status))
        throw new ConflictError('not_finalized', 'Bank files are available once the run is finalized');
      const rows = await db().payrollRunEmployee.findMany({
        where: { runId, status: { in: ['OK', 'WARNING'] } },
        orderBy: { employee: { employeeCode: 'asc' } },
        include: { employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } } },
      });
      const out = [];
      const missing = [];
      for (const r of rows) {
        if (!dec(String(r.net)).greaterThan(0)) continue;
        const acct = await db().employeeBankAccount.findFirst({
          where: {
            employeeId: r.employeeId,
            effectiveFrom: { lte: run.period.payDate },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: run.period.payDate } }],
          },
          orderBy: [{ isPrimary: 'desc' }, { effectiveFrom: 'desc' }],
        });
        if (!acct) {
          missing.push(r.employee.employeeCode);
          continue;
        }
        const fields = /** @type {any} */ (acct.bankFields) ?? {};
        out.push([
          r.employee.employeeCode,
          acct.accountHolder,
          cipher.decrypt(acct.accountNumberEnc, acct.id),
          fields.ifsc ?? fields.sortCode ?? fields.routingNumber ?? fields.iban ?? '',
          str(r.net),
          run.currency,
          `SALARY ${dateToYmd(run.period.startDate)?.slice(0, 7)} ${r.employee.employeeCode}`,
        ]);
      }
      await audit(db(), {
        action: 'payroll.bank_file_downloaded',
        entityType: 'PayrollRun',
        entityId: runId,
        changes: { rows: out.length, missing },
      });
      return {
        header: [
          'employeeCode',
          'accountHolder',
          'accountNumber',
          'bankCode',
          'amount',
          'currency',
          'reference',
        ],
        rows: out,
        missing,
      };
    },

    /** Creates the PDF payslips of a finalized run (worker). Already generated payslips are left alone. @param {string} runId */
    async generatePayslips(runId) {
      if (!files || !buckets) throw new Error('Storage is not configured');
      const run = await runOr404(runId);
      if (!['FINALIZED', 'PAID'].includes(run.status))
        throw new ConflictError('not_finalized', 'Payslips are generated after finalizing');
      const tenant = await db().tenant.findUnique({ where: { id: ctx().tenantId } });
      const currency = await db().currency.findUnique({ where: { code: run.currency } });
      const rows = await db().payrollRunEmployee.findMany({
        where: { runId, status: { in: ['OK', 'WARNING'] }, payslip: null },
        include: {
          payrollLines: { orderBy: { sequence: 'asc' } },
          employee: {
            select: {
              id: true,
              employeeCode: true,
              firstName: true,
              lastName: true,
              department: { select: { name: true } },
              designation: { select: { title: true } },
            },
          },
        },
      });
      const start = /** @type {string} */ (dateToYmd(run.period.startDate));
      let created = 0;
      for (const r of rows) {
        const bytes = await buildPayslipPdf({
          company: tenant?.name ?? '',
          legalEntity: run.period.legalEntity.name,
          periodLabel: `${MONTHS[Number(start.slice(5, 7)) - 1]} ${start.slice(0, 4)}`,
          payDate: /** @type {string} */ (dateToYmd(run.period.payDate)),
          currency: run.currency,
          minorUnits: currency?.minorUnits ?? 2,
          employee: {
            name: fullName(r.employee),
            code: r.employee.employeeCode,
            department: r.employee.department?.name,
            designation: r.employee.designation?.title,
          },
          paidDays: String(r.paidDays),
          lopDays: String(r.lopDays),
          lines: r.payrollLines
            .filter((l) => !dec(String(l.amount)).isZero())
            .map((l) => ({ label: l.label, kind: l.kind, amount: String(l.amount) })),
          totals: { gross: String(r.gross), deductions: String(r.deductions), net: String(r.net) },
          reference: `${runId.slice(0, 8)}-${r.employee.employeeCode}`,
        });
        const key = `tenant/${ctx().tenantId}/payslips/${runId}/${r.id}.pdf`;
        await files.put(buckets.documents, key, Buffer.from(bytes), 'application/pdf');
        await db().payslip.create({
          data: {
            id: newId(),
            runEmployeeId: r.id,
            s3Key: key,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            locale: 'en',
            generatedAt: now(),
            publishedAt: now(),
          },
        });
        created++;
      }
      return { created };
    },

    /** The signed-in employee's published payslips. */
    async myPayslips() {
      const employeeId = ctx().employeeId;
      if (!employeeId) return [];
      const rows = await db().payslip.findMany({
        where: {
          publishedAt: { not: null },
          runEmployee: { employeeId, run: { status: { in: ['FINALIZED', 'PAID'] } } },
        },
        include: { runEmployee: { include: { run: { include: { period: true } } } } },
        orderBy: { generatedAt: 'desc' },
      });
      return rows.map((p) => ({
        id: p.id,
        month: dateToYmd(p.runEmployee.run.period.startDate)?.slice(0, 7),
        payDate: dateToYmd(p.runEmployee.run.period.payDate),
        net: str(p.runEmployee.net),
        currency: p.runEmployee.currency,
      }));
    },

    /** A 60-second download link for your own payslip, or anyone's with payroll.payslip.view in scope. @param {string} id */
    async payslipUrl(id) {
      if (!files || !buckets) throw new Error('Storage is not configured');
      const p = await db().payslip.findUnique({
        where: { id },
        include: { runEmployee: { include: { run: { include: { period: true } } } } },
      });
      if (!p) throw new NotFoundError();
      const own = p.runEmployee.employeeId === ctx().employeeId;
      if (!own) {
        if (!can('payroll.payslip.view')) throw new NotFoundError();
        const scope = await employeeScope('payroll.payslip.view');
        if (!(await db().employee.count({ where: { AND: [{ id: p.runEmployee.employeeId }, scope] } })))
          throw new NotFoundError();
      }
      await audit(db(), {
        action: 'payroll.payslip_downloaded',
        entityType: 'Payslip',
        entityId: id,
        changes: { own },
      });
      const month = dateToYmd(p.runEmployee.run.period.startDate)?.slice(0, 7);
      return {
        url: await files.downloadUrl(buckets.documents, p.s3Key, `payslip-${month}.pdf`),
        expiresInSec: 60,
      };
    },
  };
  return service;
}
