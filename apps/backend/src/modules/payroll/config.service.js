// @ts-check
import {
  calculatePay,
  dec,
  IN_STARTER_COMPONENTS,
  PACKS,
  packFor,
  references,
  FormulaError,
} from '@hrms/payroll';
import { newId } from '@hrms/shared/ids';
import { FORMULA_VARIABLES, InStatutorySettings } from '@hrms/shared/schemas/payroll';
import { audit } from '../../lib/audit.js';
import { currentContext } from '../../lib/context.js';
import { db } from '../../lib/db.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { addDays, dateToYmd, localYmd, ymdToDate } from '../../lib/time.js';
import { employeeScope } from '../employees/scope.js';

const ctx = () => /** @type {any} */ (currentContext());
const str = (/** @type {any} */ d) => (d === null || d === undefined ? null : String(d));
/** Money in the storage format (four decimals), whatever form the database returns it in. */
const money = (/** @type {any} */ d) => (d === null || d === undefined ? null : dec(String(d)).toFixed(4));
const scoped = (/** @type {object} */ where, /** @type {object} */ scope) => ({ AND: [where, scope] });
/** Pack-specific settings schemas. */
const SETTINGS_SCHEMAS = { in: InStatutorySettings };

/** The fiscal months left in the year from `ymd`'s month, inclusive (1–12). */
export function monthsRemainingInYear(/** @type {string} */ ymd, startMonth = 4) {
  const m = Number(ymd.slice(5, 7));
  return ((startMonth - m + 11) % 12) + 1;
}

/** The fiscal year label, e.g. '2025-26' for any date from 1 Apr 2025 to 31 Mar 2026. */
export function fiscalYearOf(/** @type {string} */ ymd, startMonth = 4) {
  const y = Number(ymd.slice(0, 4));
  const start = Number(ymd.slice(5, 7)) >= startMonth ? y : y - 1;
  return startMonth === 1 ? String(start) : `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Engine-shaped components from a structure's rows (overrides applied). @param {any[]} rows */
export const engineComponents = (rows) =>
  rows.map((r) => ({
    id: r.component.id,
    code: r.component.code,
    name: r.component.name,
    kind: r.component.kind,
    calcType: r.component.calcType,
    formula: r.overrideFormula ?? r.component.formula,
    percentOf: r.component.percentOf,
    rate: str(r.overrideRate ?? r.component.rate),
    fixedAmount: str(r.component.fixedAmount),
    taxable: r.component.taxable,
    roundingRule: r.component.roundingRule,
    statutoryKey: r.component.statutoryKey,
    sequence: r.sequence,
  }));

/**
 * Checks a structure before saving: formulas and percentages may only use built-in variables and components
 * listed above them; statutory items must exist in the legal entity's country pack.
 * @param {ReturnType<typeof engineComponents>} comps @param {any} pack
 */
export function checkStructure(comps, pack) {
  const errors = [];
  const sorted = [...comps].sort((a, b) => a.sequence - b.sequence);
  const seen = new Set(/** @type {string[]} */ ([...FORMULA_VARIABLES]));
  const codes = new Set(sorted.map((c) => c.code));
  for (const [i, c] of sorted.entries()) {
    const path = `body.components.${i}`;
    if (c.calcType === 'FORMULA') {
      try {
        for (const ref of references(String(c.formula)))
          if (!seen.has(ref))
            errors.push({
              path,
              message: codes.has(ref)
                ? `${c.code} uses ${ref}, which must come before it`
                : `${c.code} uses unknown name ${ref}`,
            });
      } catch (err) {
        if (!(err instanceof FormulaError)) throw err;
        errors.push({ path, message: `${c.code}: ${err.message}` });
      }
    }
    if (c.calcType === 'PERCENTAGE' && c.percentOf !== 'CTC' && !seen.has(String(c.percentOf)))
      errors.push({
        path,
        message: `${c.code} is a percentage of ${c.percentOf}, which must come before it`,
      });
    if (c.calcType === 'STATUTORY' && !(pack && c.statutoryKey && c.statutoryKey in pack.keys))
      errors.push({
        path,
        message: `${c.code}: ${c.statutoryKey} is not available for this legal entity's country`,
      });
    seen.add(c.code);
  }
  return errors;
}

/** Payroll configuration, salaries and tax declarations (PAY-01, PAY-02). */
export function createPayrollConfigService({ now = () => new Date() } = {}) {
  /** @param {string} id */
  async function legalEntityOr404(id) {
    const le = await db().legalEntity.findUnique({ where: { id } });
    if (!le) throw new NotFoundError();
    return le;
  }

  /** The statutory pack and the rule version in force on `ymd` for a country (null for configurable countries). */
  async function rulesFor(/** @type {string} */ countryCode, /** @type {string} */ ymd) {
    const packRow = await db().statutoryRulePack.findFirst({ where: { countryCode, regionCode: '' } });
    const pack = packFor(packRow?.engineModule);
    if (!packRow || !pack) return null;
    const date = ymdToDate(ymd);
    const version = await db().statutoryRuleVersion.findFirst({
      where: {
        packId: packRow.id,
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    return { packRow, pack, version };
  }

  /** The legal entity's statutory settings in force on `ymd`, merged over the pack defaults. */
  async function statutorySettingsFor(
    /** @type {string} */ legalEntityId,
    /** @type {any} */ pack,
    /** @type {string} */ ymd,
  ) {
    const date = ymdToDate(ymd);
    const row = await db().tenantStatutorySetting.findFirst({
      where: {
        legalEntityId,
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    return {
      row,
      settings: { ...(pack?.defaultSettings ?? {}), .../** @type {any} */ (row?.overrides ?? {}) },
    };
  }

  /** @param {string} structureId */
  async function structureWithComponents(structureId) {
    const s = await db().salaryStructure.findUnique({
      where: { id: structureId },
      include: {
        salaryStructureComponents: { include: { component: true }, orderBy: { sequence: 'asc' } },
        legalEntity: true,
      },
    });
    if (!s) throw new NotFoundError();
    return s;
  }

  const structureDto = (/** @type {any} */ s) => ({
    id: s.id,
    legalEntityId: s.legalEntityId,
    name: s.name,
    currency: s.currency,
    version: s.version,
    effectiveFrom: dateToYmd(s.effectiveFrom),
    effectiveTo: dateToYmd(s.effectiveTo),
    components: (s.salaryStructureComponents ?? []).map((r) => ({
      componentId: r.componentId,
      code: r.component.code,
      name: r.component.name,
      kind: r.component.kind,
      calcType: r.component.calcType,
      sequence: r.sequence,
      overrideRate: str(r.overrideRate),
      overrideFormula: r.overrideFormula,
    })),
  });

  const service = {
    rulesFor,
    statutorySettingsFor,
    structureWithComponents,

    /** Statutory items a legal entity's country pack offers (for the component form). @param {string} legalEntityId */
    async statutoryKeys(legalEntityId) {
      const le = await legalEntityOr404(legalEntityId);
      const r = await rulesFor(le.countryCode, localYmd(now(), le.timezone));
      return {
        countryCode: le.countryCode,
        pack: r
          ? {
              code: r.packRow.code,
              version: r.pack.version,
              ruleVersion: r.version?.version ?? null,
              reviewed: Boolean(r.version?.reviewedBy),
            }
          : null,
        keys: r ? Object.entries(r.pack.keys).map(([key, label]) => ({ key, label })) : [],
      };
    },

    /** Validates a component's formula or statutory key before it is saved. @param {any} body @param {string} [id] */
    async checkComponent(body, id) {
      if (id) {
        const existing = await db().salaryComponent.findUnique({ where: { id } });
        if (existing && body.code !== undefined && body.code !== existing.code)
          throw new ValidationError([{ path: 'body.code', message: 'The code cannot change once created' }]);
        if (existing && body.calcType !== undefined && body.calcType !== existing.calcType)
          throw new ValidationError([
            { path: 'body.calcType', message: 'The calculation type cannot change once created' },
          ]);
      }
      if (body.calcType === 'FORMULA' || body.formula) {
        try {
          references(String(body.formula));
        } catch (err) {
          if (err instanceof FormulaError)
            throw new ValidationError([{ path: 'body.formula', message: err.message }]);
          throw err;
        }
      }
      if (body.statutoryKey) {
        const keys = new Set(Object.values(PACKS).flatMap((p) => Object.keys(p.keys)));
        if (!keys.has(body.statutoryKey))
          throw new ValidationError([{ path: 'body.statutoryKey', message: 'Unknown statutory item' }]);
      }
    },

    /** @param {string} id */
    async getStructure(id) {
      return structureDto(await structureWithComponents(id));
    },

    /**
     * Replaces a structure's components after checking order and references. Structures used by a finalized
     * payroll keep their history because runs store their own lines.
     * @param {string} id @param {{ components: any[] }} input
     */
    async setStructureComponents(id, input) {
      const s = await structureWithComponents(id);
      const ids = input.components.map((c) => c.componentId);
      if (new Set(ids).size !== ids.length)
        throw new ValidationError([{ path: 'body.components', message: 'Each component can appear once' }]);
      const found = await db().salaryComponent.findMany({ where: { id: { in: ids } } });
      if (found.length !== ids.length)
        throw new ValidationError([{ path: 'body.components', message: 'Some components were not found' }]);
      const byId = new Map(found.map((c) => [c.id, c]));
      const comps = engineComponents(
        input.components.map((c) => ({ ...c, component: byId.get(c.componentId) })),
      );
      const r = await rulesFor(s.legalEntity.countryCode, localYmd(now(), s.legalEntity.timezone));
      const errors = checkStructure(comps, r?.pack ?? null);
      if (errors.length) throw new ValidationError(errors);
      await db().$transaction(async (/** @type {any} */ tx) => {
        await tx.salaryStructureComponent.deleteMany({ where: { structureId: id } });
        await tx.salaryStructureComponent.createMany({
          data: input.components.map((c) => ({
            structureId: id,
            componentId: c.componentId,
            sequence: c.sequence,
            overrideRate: c.overrideRate ?? null,
            overrideFormula: c.overrideFormula ?? null,
          })),
        });
        await audit(tx, {
          action: 'payroll.structure_components_set',
          entityType: 'SalaryStructure',
          entityId: id,
          changes: { components: ids.length },
        });
      });
      return service.getStructure(id);
    },

    /**
     * India starter: creates the standard components (skipping codes that exist) and an "India standard" structure.
     * @param {string} legalEntityId
     */
    async loadIndiaStarter(legalEntityId) {
      const le = await legalEntityOr404(legalEntityId);
      if (le.countryCode !== 'IN')
        throw new ValidationError([
          { path: 'body.legalEntityId', message: 'The India starter is for Indian legal entities' },
        ]);
      const created = [];
      const structureId = newId();
      await db().$transaction(async (/** @type {any} */ tx) => {
        const rows = [];
        for (const c of IN_STARTER_COMPONENTS) {
          let comp = await tx.salaryComponent.findUnique({
            where: { tenantId_code: { tenantId: ctx().tenantId, code: c.code } },
          });
          if (!comp) {
            comp = await tx.salaryComponent.create({
              data: {
                id: newId(),
                code: c.code,
                name: c.name,
                kind: c.kind,
                calcType: c.calcType,
                formula: c.formula ?? null,
                percentOf: c.percentOf ?? null,
                rate: c.rate ?? null,
                taxable: c.taxable ?? true,
                statutoryKey: c.statutoryKey ?? null,
                displayOrder: c.sequence,
              },
            });
            created.push(c.code);
          }
          rows.push({ structureId, componentId: comp.id, sequence: c.sequence });
        }
        await tx.salaryStructure.create({
          data: {
            id: structureId,
            legalEntityId: le.id,
            name: 'India standard',
            currency: le.currency,
            effectiveFrom: ymdToDate(`${localYmd(now(), le.timezone).slice(0, 4)}-01-01`),
          },
        });
        await tx.salaryStructureComponent.createMany({ data: rows });
        await audit(tx, {
          action: 'payroll.india_starter_loaded',
          entityType: 'LegalEntity',
          entityId: le.id,
          changes: { created },
        });
      });
      return { createdComponents: created, structure: await service.getStructure(structureId) };
    },

    // ── Statutory and payroll settings ─────────────────────────────────────────

    /** @param {string} legalEntityId */
    async getStatutorySettings(legalEntityId) {
      const le = await legalEntityOr404(legalEntityId);
      const today = localYmd(now(), le.timezone);
      const r = await rulesFor(le.countryCode, today);
      const { row, settings } = await statutorySettingsFor(le.id, r?.pack, today);
      return {
        legalEntityId: le.id,
        countryCode: le.countryCode,
        pack: r
          ? {
              code: r.packRow.code,
              version: r.pack.version,
              ruleVersion: r.version?.version ?? null,
              reviewed: Boolean(r.version?.reviewedBy),
            }
          : null,
        settings,
        registrationNumbers: row?.registrationNumbers ?? {},
        effectiveFrom: dateToYmd(row?.effectiveFrom),
        ptStates: r
          ? Object.entries(/** @type {any} */ (r.version?.rules)?.pt?.states ?? {}).map(([code, s]) => ({
              code,
              name: /** @type {any} */ (s).name,
            }))
          : [],
      };
    },

    /** New settings from a date; the previous row ends the day before. @param {string} legalEntityId @param {any} input */
    async saveStatutorySettings(legalEntityId, input) {
      const le = await legalEntityOr404(legalEntityId);
      const r = await rulesFor(le.countryCode, input.effectiveFrom);
      if (!r)
        throw new ValidationError([
          { path: 'body.settings', message: 'There is no statutory pack for this country yet' },
        ]);
      const schema = /** @type {any} */ (SETTINGS_SCHEMAS)[r.packRow.engineModule];
      const parsed = schema.safeParse(input.settings);
      if (!parsed.success)
        throw new ValidationError(
          parsed.error.issues.map((i) => ({ path: `body.settings.${i.path.join('.')}`, message: i.message })),
        );
      if (
        parsed.data.ptState &&
        !(/** @type {any} */ (r.version?.rules?.pt?.states ?? {})[parsed.data.ptState])
      )
        throw new ValidationError([
          { path: 'body.settings.ptState', message: 'No Professional Tax rules for this state yet' },
        ]);
      const from = ymdToDate(input.effectiveFrom);
      await db().$transaction(async (/** @type {any} */ tx) => {
        const later = await tx.tenantStatutorySetting.count({
          where: { legalEntityId, effectiveFrom: { gte: from } },
        });
        if (later)
          throw new ConflictError('settings_overlap', 'Settings already start on or after this date');
        await tx.tenantStatutorySetting.updateMany({
          where: { legalEntityId, effectiveTo: null },
          data: { effectiveTo: ymdToDate(/** @type {string} */ (addDays(input.effectiveFrom, -1))) },
        });
        await tx.tenantStatutorySetting.create({
          data: {
            id: newId(),
            legalEntityId,
            packId: r.packRow.id,
            overrides: parsed.data,
            registrationNumbers: input.registrationNumbers ?? {},
            effectiveFrom: from,
          },
        });
        await audit(tx, {
          action: 'payroll.statutory_settings_saved',
          entityType: 'LegalEntity',
          entityId: legalEntityId,
          changes: { settings: parsed.data, effectiveFrom: input.effectiveFrom },
        });
      });
      return service.getStatutorySettings(legalEntityId);
    },

    /** @param {string} legalEntityId */
    async getPayrollSettings(legalEntityId) {
      await legalEntityOr404(legalEntityId);
      const row = await db().payrollSetting.findUnique({
        where: { tenantId_legalEntityId: { tenantId: ctx().tenantId, legalEntityId } },
      });
      return {
        legalEntityId,
        paidDaysBasis: row?.paidDaysBasis ?? 'CALENDAR',
        lopFromAbsence: row?.lopFromAbsence ?? false,
        payDayOfMonth: row?.payDayOfMonth ?? null,
      };
    },

    /** @param {string} legalEntityId @param {any} input */
    async savePayrollSettings(legalEntityId, input) {
      await legalEntityOr404(legalEntityId);
      await db().payrollSetting.upsert({
        where: { tenantId_legalEntityId: { tenantId: ctx().tenantId, legalEntityId } },
        create: { id: newId(), legalEntityId, ...input },
        update: input,
      });
      await audit(db(), {
        action: 'payroll.settings_saved',
        entityType: 'LegalEntity',
        entityId: legalEntityId,
        changes: input,
      });
      return service.getPayrollSettings(legalEntityId);
    },

    // ── Salaries ────────────────────────────────────────────────────────────────

    /** @param {string} employeeId */
    async salaries(employeeId) {
      const scope = await employeeScope('payroll.salary.view');
      const emp = await db().employee.findFirst({
        where: scoped({ id: employeeId, deletedAt: null }, scope),
      });
      if (!emp) throw new NotFoundError();
      const rows = await db().employeeSalary.findMany({
        where: { employeeId },
        orderBy: { effectiveFrom: 'desc' },
        include: { structure: { select: { id: true, name: true } } },
      });
      await audit(db(), { action: 'payroll.salary_viewed', entityType: 'Employee', entityId: employeeId });
      return rows.map((r) => ({
        id: r.id,
        structure: r.structure,
        currency: r.currency,
        annualCtc: money(r.annualCtc),
        payFrequency: r.payFrequency,
        effectiveFrom: dateToYmd(r.effectiveFrom),
        effectiveTo: dateToYmd(r.effectiveTo),
        reason: r.reason,
      }));
    },

    /**
     * A new salary from a date: the current one ends the day before. Sensitive: audited with the CTC change.
     * @param {string} employeeId @param {any} input
     */
    async setSalary(employeeId, input) {
      const scope = await employeeScope('payroll.salary.manage');
      const emp = await db().employee.findFirst({
        where: scoped({ id: employeeId, deletedAt: null }, scope),
      });
      if (!emp) throw new NotFoundError();
      if (emp.status === 'EXITED')
        throw new ConflictError('employee_exited', 'This person has left the company');
      const s = await structureWithComponents(input.structureId);
      if (s.legalEntityId !== emp.legalEntityId)
        throw new ValidationError([
          { path: 'body.structureId', message: "Choose a structure from this person's legal entity" },
        ]);
      if (!s.salaryStructureComponents.length)
        throw new ValidationError([
          { path: 'body.structureId', message: 'This structure has no components yet' },
        ]);
      if (input.effectiveFrom < /** @type {string} */ (dateToYmd(emp.dateOfJoining)))
        throw new ValidationError([{ path: 'body.effectiveFrom', message: 'Before the joining date' }]);
      const from = ymdToDate(input.effectiveFrom);
      const id = newId();
      await db().$transaction(async (/** @type {any} */ tx) => {
        const later = await tx.employeeSalary.count({ where: { employeeId, effectiveFrom: { gte: from } } });
        if (later) throw new ConflictError('salary_overlap', 'A salary already starts on or after this date');
        const previous = await tx.employeeSalary.findFirst({ where: { employeeId, effectiveTo: null } });
        await tx.employeeSalary.updateMany({
          where: { employeeId, effectiveTo: null },
          data: { effectiveTo: ymdToDate(/** @type {string} */ (addDays(input.effectiveFrom, -1))) },
        });
        await tx.employeeSalary.create({
          data: {
            id,
            employeeId,
            structureId: s.id,
            currency: s.currency,
            annualCtc: input.annualCtc,
            effectiveFrom: from,
            reason: input.reason,
            approvedBy: ctx().userId,
          },
        });
        await audit(tx, {
          action: 'payroll.salary_set',
          entityType: 'Employee',
          entityId: employeeId,
          changes: {
            from: str(previous?.annualCtc),
            to: input.annualCtc,
            effectiveFrom: input.effectiveFrom,
            reason: input.reason,
          },
        });
      });
      return (await service.salaries(employeeId))[0];
    },

    /**
     * Monthly breakdown of a CTC on a structure, as a full month with today's rules (no loss of pay, no inputs).
     * @param {{ structureId: string, annualCtc: string }} q
     */
    async preview(q) {
      const s = await structureWithComponents(q.structureId);
      const le = s.legalEntity;
      const today = localYmd(now(), le.timezone);
      const r = await rulesFor(le.countryCode, today);
      const { settings } = await statutorySettingsFor(le.id, r?.pack, today);
      const currency = await db().currency.findUnique({ where: { code: s.currency } });
      const rules = /** @type {any} */ (r?.version?.rules);
      return calculatePay({
        currency: { code: s.currency, minorUnits: currency?.minorUnits ?? 2 },
        annualCtc: q.annualCtc,
        paidDays: '30',
        periodDays: '30',
        components: engineComponents(s.salaryStructureComponents),
        pack: r?.pack ?? null,
        packContext: {
          rules,
          settings,
          employee: { gender: null },
          period: {
            month: Number(today.slice(5, 7)),
            monthsRemainingInYear: monthsRemainingInYear(today, rules?.fiscalYearStartMonth ?? 4),
          },
          tax: {},
        },
      });
    },

    // ── Tax declarations (India) ────────────────────────────────────────────────

    /** @param {string} fiscalYear */
    async myDeclaration(fiscalYear) {
      const id = ctx().employeeId;
      if (!id)
        throw new ConflictError('no_employee_record', 'Your sign-in is not linked to an employee record');
      const row = await db().taxDeclaration.findUnique({
        where: { tenantId_employeeId_fiscalYear: { tenantId: ctx().tenantId, employeeId: id, fiscalYear } },
      });
      return row
        ? { ...row, tenantId: undefined }
        : { fiscalYear, regime: 'NEW', declarations: {}, status: 'DRAFT' };
    },

    /** The employee submits a regime and declared deductions; HR verifies them. @param {string} fiscalYear @param {any} input */
    async saveMyDeclaration(fiscalYear, input) {
      const id = ctx().employeeId;
      if (!id)
        throw new ConflictError('no_employee_record', 'Your sign-in is not linked to an employee record');
      const key = {
        tenantId_employeeId_fiscalYear: { tenantId: ctx().tenantId, employeeId: id, fiscalYear },
      };
      const existing = await db().taxDeclaration.findUnique({ where: key });
      if (existing?.status === 'VERIFIED')
        throw new ConflictError('already_verified', 'This declaration is verified. Ask HR to reopen it.');
      const data = {
        regime: input.regime,
        declarations: input.deductions,
        status: 'SUBMITTED',
        submittedAt: now(),
        reviewedBy: null,
        reviewedAt: null,
      };
      await db().taxDeclaration.upsert({
        where: key,
        create: { id: newId(), employeeId: id, fiscalYear, ...data },
        update: data,
      });
      await audit(db(), {
        action: 'payroll.tax_declaration_submitted',
        entityType: 'Employee',
        entityId: id,
        changes: { fiscalYear, regime: input.regime },
      });
      return service.myDeclaration(fiscalYear);
    },

    /** @param {{ status?: string }} q */
    async declarations(q) {
      const scope = await employeeScope('payroll.tax.review');
      const rows = await db().taxDeclaration.findMany({
        where: { employee: scope, ...(q.status ? { status: q.status } : {}) },
        orderBy: { submittedAt: 'desc' },
        take: 500,
        include: { employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } } },
      });
      return rows.map((r) => ({ ...r, tenantId: undefined }));
    },

    /** @param {string} id @param {{ decision: 'VERIFIED' | 'REJECTED' }} input */
    async reviewDeclaration(id, input) {
      const scope = await employeeScope('payroll.tax.review');
      const row = await db().taxDeclaration.findFirst({ where: { id, employee: scope } });
      if (!row) throw new NotFoundError();
      if (row.employeeId === ctx().employeeId)
        throw new ConflictError('own_declaration', 'You cannot verify your own declaration');
      await db().taxDeclaration.update({
        where: { id },
        data: { status: input.decision, reviewedBy: ctx().userId, reviewedAt: now() },
      });
      await audit(db(), {
        action: `payroll.tax_declaration_${input.decision.toLowerCase()}`,
        entityType: 'TaxDeclaration',
        entityId: id,
      });
      return { id, status: input.decision };
    },
  };
  return service;
}
