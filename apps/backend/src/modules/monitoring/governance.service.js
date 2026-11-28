// @ts-check
/**
 * Monitoring governance (Sprint 10): activation checklist, jurisdiction rules, screenshot policies, notices.
 *
 * Monitoring is OFF by default. It applies to a person only when ALL of these hold (monitoringFor):
 *   1. the company completed the activation checklist (ACTIVE, not paused),
 *   2. the notice start date has passed, and so has their country's minimum notice period since completion,
 *   3. their work country's jurisdiction entry allows screenshots and the steps it requires are recorded as done
 *      (no entry, UNKNOWN or NOT_ALLOWED → off: fail closed),
 *   4. they are in the activation's scope,
 *   5. an enabled screenshot policy applies to them,
 *   6. they acknowledged this version of the notice.
 * The platform supplies controls, not legal advice: the company also confirms it took its own legal advice.
 */
import { newId } from '@hrms/shared/ids';
import { TARGET_PRIORITY } from '@hrms/shared/schemas/leave';
import { audit } from '../../lib/audit.js';
import { currentContext } from '../../lib/context.js';
import { db, platformDb } from '../../lib/db.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { addDays, dateToYmd, localYmd, ymdToDate } from '../../lib/time.js';

const ctx = () => /** @type {any} */ (currentContext());
const EMP = {
  id: true,
  workCountry: true,
  legalEntityId: true,
  branchId: true,
  departmentId: true,
  timezone: true,
  status: true,
};

/** @param {any} a */
export const activationDto = (a) =>
  a && {
    id: a.id,
    version: a.version,
    status: a.status,
    purpose: a.purpose,
    scope: a.scope,
    lawfulBasis: a.lawfulBasis,
    noticeText: a.noticeText,
    noticeLocales: a.noticeLocales,
    noticeStartsOn: dateToYmd(a.noticeStartsOn),
    viewerRoleIds: a.viewerRoleIds,
    retentionDays: a.retentionDays,
    contacts: a.contacts,
    reviewDueOn: dateToYmd(a.reviewDueOn),
    jurisdictionSteps: a.jurisdictionSteps,
    ownLegalAdviceConfirmed: Boolean(a.lawfulBasis?.ownLegalAdviceConfirmed),
    completedAt: a.completedAt,
    createdAt: a.createdAt,
  };

/** @param {any} p */
export const policyDto = (p) =>
  p && {
    id: p.id,
    name: p.name,
    version: p.version,
    appliesTo: p.appliesTo,
    targetId: p.targetId,
    enabled: p.enabled,
    intervalMin: p.intervalMin,
    jitterPct: p.jitterPct,
    captureMode: p.captureMode,
    retentionDays: p.retentionDays,
    excludedApps: p.excludedApps,
    blurZones: p.blurZones ?? null,
    employeeCanDelete: p.employeeCanDelete,
    activityTrackingEnabled: false,
    effectiveFrom: dateToYmd(p.effectiveFrom),
    effectiveTo: dateToYmd(p.effectiveTo),
  };

/** The latest jurisdiction entry for a country in force on a date (platform registry). @param {string} country @param {string} ymd */
export async function jurisdictionFor(country, ymd) {
  return platformDb().jurisdictionPolicy.findFirst({
    where: { countryCode: country, regionCode: '', effectiveFrom: { lte: ymdToDate(ymd) } },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
  });
}

/** @param {{ now?: () => Date }} [deps] */
export function createGovernanceService({ now = () => new Date() } = {}) {
  const active = () =>
    db().monitoringActivation.findFirst({ where: { status: 'ACTIVE' }, orderBy: { version: 'desc' } });

  /** Is the person inside the activation's scope? @param {any} activation @param {any} emp */
  function inScope(activation, emp) {
    const s = activation.scope ?? {};
    const ids = s.targetIds ?? [];
    switch (s.appliesTo ?? 'COMPANY') {
      case 'COMPANY':
        return true;
      case 'LEGAL_ENTITY':
        return ids.includes(emp.legalEntityId);
      case 'BRANCH':
        return ids.includes(emp.branchId);
      case 'DEPARTMENT':
        return ids.includes(emp.departmentId);
      case 'EMPLOYEE':
        return ids.includes(emp.id);
      default:
        return false;
    }
  }

  /** The screenshot policy in force for a person: most specific target, then newest. @param {any} activation @param {any} emp @param {string} ymd */
  async function policyFor(activation, emp, ymd) {
    const date = ymdToDate(ymd);
    const rows = await db().screenshotPolicy.findMany({
      where: {
        activationId: activation.id,
        effectiveFrom: { lte: date },
        AND: [
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] },
          {
            OR: [
              { appliesTo: 'COMPANY' },
              { appliesTo: 'EMPLOYEE', targetId: emp.id },
              ...(emp.departmentId ? [{ appliesTo: 'DEPARTMENT', targetId: emp.departmentId }] : []),
              ...(emp.branchId ? [{ appliesTo: 'BRANCH', targetId: emp.branchId }] : []),
              { appliesTo: 'LEGAL_ENTITY', targetId: emp.legalEntityId },
            ],
          },
        ],
      },
    });
    rows.sort(
      (a, b) =>
        TARGET_PRIORITY.indexOf(/** @type {any} */ (a.appliesTo)) -
          TARGET_PRIORITY.indexOf(/** @type {any} */ (b.appliesTo)) ||
        b.effectiveFrom.getTime() - a.effectiveFrom.getTime() ||
        b.version - a.version,
    );
    return rows[0] ?? null;
  }

  /**
   * Whether screenshot monitoring applies to a person now, and why not if it doesn't. The single gate used by the
   * web app, the agent and the capture API.
   * @param {string} employeeId
   */
  async function monitoringFor(employeeId) {
    const emp = await db().employee.findUnique({ where: { id: employeeId }, select: EMP });
    if (!emp) throw new NotFoundError();
    const t = now();
    const today = localYmd(t, emp.timezone);
    const off = (/** @type {string} */ reason, extra = {}) => ({ enabled: false, reason, ...extra });
    const activation = await active();
    if (!activation) return off('NOT_ACTIVATED');
    const base = { activation: { id: activation.id, version: activation.version } };
    if (!inScope(activation, emp)) return off('OUT_OF_SCOPE', base);
    const j = await jurisdictionFor(emp.workCountry, today);
    if (!j || j.screenshotsAllowed === 'UNKNOWN')
      return off('JURISDICTION_UNKNOWN', { ...base, country: emp.workCountry });
    if (j.screenshotsAllowed === 'NOT_ALLOWED')
      return off('JURISDICTION_NOT_ALLOWED', { ...base, country: emp.workCountry });
    const required = /** @type {string[]} */ (j.requiredSteps ?? []);
    const steps = /** @type {any} */ (activation.jurisdictionSteps)?.[emp.workCountry] ?? {};
    const missing = required.filter((k) => !steps[k]?.done);
    if (missing.length)
      return off('JURISDICTION_STEPS_MISSING', { ...base, country: emp.workCountry, missing });
    const noticeFrom = [
      /** @type {string} */ (dateToYmd(activation.noticeStartsOn)),
      /** @type {string} */ (
        addDays(/** @type {string} */ (dateToYmd(activation.completedAt)), j.minNoticeDays)
      ),
    ].sort()[1];
    if (today < noticeFrom) return off('NOTICE_PERIOD', { ...base, startsOn: noticeFrom });
    const policy = await policyFor(activation, emp, today);
    if (!policy || !policy.enabled) return off('NO_POLICY', base);
    const ack = await db().monitoringAcknowledgement.findUnique({
      where: {
        tenantId_employeeId_activationId: {
          tenantId: ctx().tenantId,
          employeeId: emp.id,
          activationId: activation.id,
        },
      },
    });
    const retentionDays = Math.min(policy.retentionDays, activation.retentionDays, j.maxRetentionDays ?? 90);
    if (!ack)
      return off('ACK_REQUIRED', {
        ...base,
        notice: {
          text: activation.noticeText,
          purpose: activation.purpose,
          contacts: activation.contacts,
          retentionDays,
        },
      });
    return {
      enabled: true,
      reason: 'ON',
      ...base,
      scope: activation.scope,
      policy: { ...policyDto(policy), retentionDays },
      legalReviewed: Boolean(j.legalReviewedOn),
    };
  }

  /** @param {any} b */
  async function assertRoles(b) {
    if (!b.viewerRoleIds) return;
    const n = await db().role.count({ where: { id: { in: b.viewerRoleIds } } });
    if (n !== new Set(b.viewerRoleIds).size)
      throw new ValidationError([
        { path: 'body.viewerRoleIds', message: 'Some roles were not found in this company' },
      ]);
  }

  /** Draft fields as stored. ownLegalAdviceConfirmed lives inside lawfulBasis (no extra column). @param {any} b @param {any} [prev] */
  const draftData = (b, prev = null) => {
    const data = /** @type {any} */ ({});
    for (const k of [
      'purpose',
      'scope',
      'noticeText',
      'noticeLocales',
      'viewerRoleIds',
      'retentionDays',
      'contacts',
      'jurisdictionSteps',
    ])
      if (b[k] !== undefined) data[k] = b[k];
    if (b.noticeStartsOn) data.noticeStartsOn = ymdToDate(b.noticeStartsOn);
    if (b.reviewDueOn) data.reviewDueOn = ymdToDate(b.reviewDueOn);
    if (b.lawfulBasis || b.ownLegalAdviceConfirmed !== undefined)
      data.lawfulBasis = {
        ...(prev?.lawfulBasis ?? {}),
        ...(b.lawfulBasis ?? {}),
        ...(b.ownLegalAdviceConfirmed !== undefined
          ? { ownLegalAdviceConfirmed: b.ownLegalAdviceConfirmed }
          : {}),
      };
    return data;
  };

  const service = {
    monitoringFor,
    jurisdictionFor,

    /** The jurisdiction rules for every country where the company employs people. */
    async jurisdictions() {
      const countries = await db().employee.groupBy({
        by: ['workCountry'],
        where: { deletedAt: null, status: { not: 'EXITED' } },
        _count: { _all: true },
      });
      const today = /** @type {string} */ (dateToYmd(now()));
      const out = [];
      for (const c of countries) {
        const j = await jurisdictionFor(c.workCountry, today);
        out.push({
          country: c.workCountry,
          employees: c._count._all,
          screenshots: j?.screenshotsAllowed ?? 'UNKNOWN',
          requiredSteps: j?.requiredSteps ?? [],
          maxRetentionDays: j?.maxRetentionDays ?? null,
          minNoticeDays: j?.minNoticeDays ?? null,
          legalReviewed: Boolean(j?.legalReviewedOn),
          version: j?.version ?? null,
        });
      }
      return out.sort((a, b) => a.country.localeCompare(b.country));
    },

    async listActivations() {
      const rows = await db().monitoringActivation.findMany({ orderBy: { version: 'desc' } });
      return rows.map(activationDto);
    },

    /** Starts a new checklist version as a draft (copying the current one, if any). @param {any} b ActivationBody */
    async createDraft(b) {
      if (await db().monitoringActivation.findFirst({ where: { status: 'DRAFT' } }))
        throw new ConflictError('draft_exists', 'Finish or change the open draft first');
      await assertRoles(b);
      const last = await db().monitoringActivation.findFirst({ orderBy: { version: 'desc' } });
      const row = await db().monitoringActivation.create({
        data: {
          id: newId(),
          version: (last?.version ?? 0) + 1,
          status: 'DRAFT',
          ...draftData(b),
          lawfulBasis: { ...b.lawfulBasis, ownLegalAdviceConfirmed: b.ownLegalAdviceConfirmed },
        },
      });
      await audit(db(), {
        action: 'monitoring.activation_drafted',
        entityType: 'MonitoringActivation',
        entityId: row.id,
        changes: { version: row.version },
      });
      return activationDto(row);
    },

    /** @param {string} id @param {any} b ActivationPatch */
    async updateDraft(id, b) {
      const a = await db().monitoringActivation.findUnique({ where: { id } });
      if (!a) throw new NotFoundError();
      if (a.status !== 'DRAFT')
        throw new ConflictError('not_draft', 'A completed checklist cannot change. Start a new version.');
      await assertRoles(b);
      const row = await db().monitoringActivation.update({ where: { id }, data: draftData(b, a) });
      return activationDto(row);
    },

    /**
     * Completes the checklist: every country with employees in scope must allow screenshots, have its required steps
     * done, and the company must confirm its own legal advice. The previous version is superseded.
     * @param {string} id
     */
    async complete(id) {
      const a = await db().monitoringActivation.findUnique({ where: { id } });
      if (!a) throw new NotFoundError();
      if (a.status !== 'DRAFT') throw new ConflictError('not_draft', 'Only a draft can be completed');
      const problems = [];
      if (!(/** @type {any} */ (a.lawfulBasis)?.ownLegalAdviceConfirmed))
        problems.push({
          path: 'body.ownLegalAdviceConfirmed',
          message: 'Confirm that you took legal advice for every country in scope',
        });
      const today = /** @type {string} */ (dateToYmd(now()));
      if (/** @type {string} */ (dateToYmd(a.reviewDueOn)) <= today)
        problems.push({ path: 'body.reviewDueOn', message: 'Set a review date in the future' });
      const employees = await db().employee.findMany({
        where: { deletedAt: null, status: { not: 'EXITED' } },
        select: EMP,
      });
      const countries = [...new Set(employees.filter((e) => inScope(a, e)).map((e) => e.workCountry))];
      for (const c of countries) {
        const j = await jurisdictionFor(c, today);
        if (!j || !['ALLOWED', 'ALLOWED_WITH_STEPS'].includes(j.screenshotsAllowed)) continue; // stays off there (fail closed)
        if (j.maxRetentionDays && a.retentionDays > j.maxRetentionDays)
          problems.push({
            path: 'body.retentionDays',
            message: `${c} allows at most ${j.maxRetentionDays} days`,
          });
        const steps = /** @type {any} */ (a.jurisdictionSteps)?.[c] ?? {};
        for (const k of /** @type {string[]} */ (j.requiredSteps ?? []))
          if (!steps[k]?.done)
            problems.push({
              path: `body.jurisdictionSteps.${c}.${k}`,
              message: `${c}: record "${k}" as done`,
            });
      }
      if (problems.length) throw new ValidationError(problems);
      const t = now();
      await db().$transaction(async (/** @type {any} */ tx) => {
        await tx.monitoringActivation.updateMany({
          where: { status: { in: ['ACTIVE', 'PAUSED'] } },
          data: { status: 'SUPERSEDED' },
        });
        await tx.monitoringActivation.update({
          where: { id },
          data: { status: 'ACTIVE', completedBy: ctx().userId, completedAt: t },
        });
        await audit(tx, {
          action: 'monitoring.activated',
          entityType: 'MonitoringActivation',
          entityId: id,
          changes: { version: a.version, countries },
        });
      });
      return activationDto(await db().monitoringActivation.findUnique({ where: { id } }));
    },

    /** Stops all monitoring at once (no capture until resumed). @param {string} id @param {boolean} paused */
    async setPaused(id, paused) {
      const a = await db().monitoringActivation.findUnique({ where: { id } });
      if (!a) throw new NotFoundError();
      const from = paused ? 'ACTIVE' : 'PAUSED';
      const n = await db().monitoringActivation.updateMany({
        where: { id, status: from },
        data: { status: paused ? 'PAUSED' : 'ACTIVE' },
      });
      if (!n.count)
        throw new ConflictError(
          'wrong_status',
          paused ? 'Monitoring is not active' : 'Monitoring is not paused',
        );
      await audit(db(), {
        action: paused ? 'monitoring.paused' : 'monitoring.resumed',
        entityType: 'MonitoringActivation',
        entityId: id,
      });
      return activationDto(await db().monitoringActivation.findUnique({ where: { id } }));
    },

    // ── Screenshot policies ──
    async listPolicies() {
      const rows = await db().screenshotPolicy.findMany({ orderBy: [{ name: 'asc' }, { version: 'desc' }] });
      return rows.map(policyDto);
    },

    /** @param {any} b ScreenshotPolicyBody */
    async createPolicy(b) {
      const a = await active();
      if (!a) throw new ConflictError('not_activated', 'Complete the monitoring checklist first');
      if (b.retentionDays > a.retentionDays)
        throw new ValidationError([
          { path: 'body.retentionDays', message: `The checklist allows at most ${a.retentionDays} days` },
        ]);
      try {
        const row = await db().screenshotPolicy.create({
          data: {
            id: newId(),
            activationId: a.id,
            name: b.name,
            version: 1,
            ...policyData(b),
            createdBy: ctx().userId,
          },
        });
        await audit(db(), {
          action: 'monitoring.policy_created',
          entityType: 'ScreenshotPolicy',
          entityId: row.id,
          changes: { enabled: row.enabled },
        });
        return policyDto(row);
      } catch (err) {
        if (/** @type {any} */ (err)?.code === 'P2002')
          throw new ConflictError('policy_exists', 'A policy with this name exists');
        throw err;
      }
    },

    /** A change is a new version from effectiveFrom (today or later). @param {string} id @param {any} b */
    async changePolicy(id, b) {
      const old = await db().screenshotPolicy.findUnique({ where: { id } });
      if (!old) throw new NotFoundError();
      const latest = await db().screenshotPolicy.findFirst({
        where: { name: old.name },
        orderBy: { version: 'desc' },
      });
      if (latest?.id !== old.id)
        throw new ConflictError('not_latest_version', 'Change the latest version of this policy');
      const a = await active();
      if (!a) throw new ConflictError('not_activated', 'Monitoring is not active');
      if (b.retentionDays > a.retentionDays)
        throw new ValidationError([
          { path: 'body.retentionDays', message: `The checklist allows at most ${a.retentionDays} days` },
        ]);
      const today = /** @type {string} */ (dateToYmd(now()));
      if (b.effectiveFrom < today)
        throw new ValidationError([
          { path: 'body.effectiveFrom', message: 'A change starts today or later' },
        ]);
      const oldFrom = /** @type {string} */ (dateToYmd(old.effectiveFrom));
      const prevTo =
        b.effectiveFrom > oldFrom ? /** @type {string} */ (addDays(b.effectiveFrom, -1)) : oldFrom;
      const row = await db().$transaction(async (/** @type {any} */ tx) => {
        await tx.screenshotPolicy.update({ where: { id }, data: { effectiveTo: ymdToDate(prevTo) } });
        return tx.screenshotPolicy.create({
          data: {
            id: newId(),
            activationId: a.id,
            name: old.name,
            version: old.version + 1,
            ...policyData(b),
            createdBy: ctx().userId,
          },
        });
      });
      await audit(db(), {
        action: 'monitoring.policy_versioned',
        entityType: 'ScreenshotPolicy',
        entityId: row.id,
        changes: { version: row.version, enabled: row.enabled },
      });
      return policyDto(row);
    },

    // ── The employee's side ──

    /** What monitoring means for the signed-in person (works without an employee record: then nothing applies). */
    async myStatus() {
      const id = ctx().employeeId;
      if (!id) return { enabled: false, reason: 'NO_EMPLOYEE_RECORD' };
      const s = await monitoringFor(id);
      const activation = await active();
      return {
        ...s,
        ...(activation && !('notice' in s)
          ? {
              notice: {
                text: activation.noticeText,
                purpose: activation.purpose,
                contacts: activation.contacts,
              },
            }
          : {}),
      };
    },

    /** Records that the person read this version of the notice. @param {{ activationId: string, locale: string }} b @param {{ ip?: string | null, channel?: 'WEB' | 'DESKTOP_AGENT' }} meta */
    async acknowledge(b, { ip = null, channel = 'WEB' } = {}) {
      const id = ctx().employeeId;
      if (!id)
        throw new AppError(409, 'no_employee_record', 'Your sign-in is not linked to an employee record');
      const a = await active();
      if (!a || a.id !== b.activationId)
        throw new ConflictError('notice_changed', 'The notice changed. Read the current one.');
      try {
        await db().monitoringAcknowledgement.create({
          data: {
            id: newId(),
            employeeId: id,
            activationId: a.id,
            activationVersion: a.version,
            locale: b.locale,
            channel,
            acknowledgedAt: now(),
            ipAddress: ip ? ip.slice(0, 45) : null,
          },
        });
      } catch (err) {
        if (/** @type {any} */ (err)?.code !== 'P2002') throw err; // already acknowledged: fine
      }
      await audit(db(), {
        action: 'monitoring.acknowledged',
        entityType: 'MonitoringActivation',
        entityId: a.id,
        changes: { version: a.version, channel },
      });
      return service.myStatus();
    },
  };
  return service;
}

/** @param {any} b */
function policyData(b) {
  return {
    appliesTo: b.appliesTo,
    targetId: b.appliesTo === 'COMPANY' ? null : b.targetId,
    enabled: b.enabled,
    intervalMin: b.intervalMin,
    jitterPct: b.jitterPct,
    captureMode: b.captureMode,
    retentionDays: b.retentionDays,
    excludedApps: b.excludedApps,
    blurZones: b.blurZones ?? undefined,
    employeeCanDelete: b.employeeCanDelete,
    activityTrackingEnabled: false,
    effectiveFrom: ymdToDate(b.effectiveFrom),
  };
}
