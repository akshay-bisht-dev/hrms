// @ts-check
/**
 * Work Status (Sprint 8): work policies, work-from-home requests, work sessions with breaks and heartbeats,
 * an automatic sweeper for abandoned sessions, corrections, and the team's live status.
 *
 * What is recorded, and nothing more: when a session starts and ends, breaks, and that the My work page is still
 * open (a heartbeat about once a minute). No screenshots, keystrokes, applications, webcam or microphone. The
 * desktop agent and any monitoring arrive in later sprints, behind their own activation and acknowledgement.
 *
 * The event log (work_session_events, append-only) is the source of truth; the totals on work_sessions are
 * derived from it by session-engine.js and can always be recalculated.
 */
import { newId } from '@hrms/shared/ids';
import { TARGET_PRIORITY } from '@hrms/shared/schemas/leave';
import { HEARTBEAT_INTERVAL_SEC, allowedMinutes } from '@hrms/shared/schemas/work';
import { minutesToTime } from '@hrms/shared/schemas/attendance';
import { audit } from '../../lib/audit.js';
import { currentContext } from '../../lib/context.js';
import { db } from '../../lib/db.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import {
  addDays,
  dateToYmd,
  daysBetween,
  eachDay,
  localYmd,
  offsetMinutes,
  weekday,
  ymdToDate,
} from '../../lib/time.js';
import { anyOf, employeeScope } from '../employees/scope.js';
import { REMOTE_LOCATION_TYPES } from '../attendance/engine.js';
import { SIGNALS, computeTimeline } from './session-engine.js';

const ctx = () => /** @type {any} */ (currentContext());
const fullName = (/** @type {any} */ e) => [e.firstName, e.lastName].filter(Boolean).join(' ');
const SYSTEM_USER = '00000000-0000-0000-0000-000000000000';
const OPEN_STATUSES = ['ACTIVE', 'ON_BREAK', 'DISCONNECTED'];
/** A session longer than this is closed automatically, like an attendance day with a missing clock-out. */
export const MAX_SESSION_HOURS = 20;
const CORRECTION_WINDOW_DAYS = 30;
const MAX_WFH_RANGE_DAYS = 93;

export const DISCLOSURE = Object.freeze({
  recorded: [
    'When you start and end a work session, and where you said you are working',
    'When your breaks start and end',
    'That this page is open: a small signal about once a minute while a session runs',
  ],
  notRecorded: [
    'Screenshots or your screen',
    'Keystrokes, clipboard or passwords',
    'Which applications or websites you use',
    'Webcam or microphone',
    'Anything outside a work session',
  ],
  disconnected:
    'If the signal stops for longer than your policy allows, that time shows as disconnected rather than worked. You can ask for a correction.',
});

const EMPLOYEE_SELECT = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  timezone: true,
  legalEntityId: true,
  branchId: true,
  departmentId: true,
  managerId: true,
  dateOfJoining: true,
  exitDate: true,
  status: true,
};

const DEFAULT_POLICY = Object.freeze({
  name: 'Standard',
  appliesTo: 'COMPANY',
  targetId: null,
  priority: 0,
  wfhAllowed: true,
  wfhRequiresApproval: true,
  wfhMaxDaysPerMonth: null,
  allowedStartMin: 0,
  allowedEndMin: 1440,
  heartbeatTimeoutSec: 180,
  idleThresholdSec: 300,
  idleCounting: 'COUNTED_UNTIL_THRESHOLD',
  maxBreakMinutes: null,
  resumeWindowMin: 120,
  timesheetRequired: false,
  dailyReportRequired: false,
});

const hhmm = (/** @type {number} */ m) => (m >= 1440 ? '24:00' : minutesToTime(m));
/** @param {any} p */
export const policyDto = (p, today = /** @type {string | null} */ (null)) => ({
  id: p.id,
  name: p.name,
  version: p.version,
  appliesTo: p.appliesTo,
  targetId: p.targetId,
  priority: p.priority,
  wfhAllowed: p.wfhAllowed,
  wfhRequiresApproval: p.wfhRequiresApproval,
  wfhMaxDaysPerMonth: p.wfhMaxDaysPerMonth,
  allowedStart: hhmm(p.allowedStartMin),
  allowedEnd: hhmm(p.allowedEndMin),
  heartbeatTimeoutSec: p.heartbeatTimeoutSec,
  idleThresholdSec: p.idleThresholdSec,
  idleCounting: p.idleCounting,
  maxBreakMinutes: p.maxBreakMinutes,
  resumeWindowMin: p.resumeWindowMin,
  timesheetRequired: p.timesheetRequired,
  dailyReportRequired: p.dailyReportRequired,
  effectiveFrom: dateToYmd(p.effectiveFrom),
  effectiveTo: dateToYmd(p.effectiveTo),
  ...(today
    ? {
        inForce:
          /** @type {string} */ (dateToYmd(p.effectiveFrom)) <= today &&
          (!p.effectiveTo || /** @type {string} */ (dateToYmd(p.effectiveTo)) >= today),
      }
    : {}),
});

/** @param {any} s */
const sessionDto = (s) => ({
  id: s.id,
  employeeId: s.employeeId,
  workDate: dateToYmd(s.workDate),
  status: s.status,
  startedAt: s.startedAt,
  endedAt: s.endedAt,
  lastHeartbeatAt: s.lastHeartbeatAt,
  workedSec: s.workedSec,
  breakSec: s.breakSec,
  idleSec: s.idleSec,
  disconnectedSec: s.disconnectedSec,
  needsReview: s.needsReview,
  closeReason: s.closeReason,
  policy: { id: s.policyId, version: s.policyVersion },
  location: s.workLocation
    ? { id: s.workLocation.id, name: s.workLocation.name, type: s.workLocation.type }
    : { id: s.workLocationId },
  wfhRequestId: s.wfhRequestId,
});

/** @param {any} r */
const wfhDto = (r) => ({
  id: r.id,
  employeeId: r.employeeId,
  employee: r.employee
    ? { id: r.employee.id, code: r.employee.employeeCode, name: fullName(r.employee) }
    : undefined,
  location: r.workLocation
    ? { id: r.workLocation.id, name: r.workLocation.name, type: r.workLocation.type }
    : undefined,
  fromDate: dateToYmd(r.fromDate),
  toDate: dateToYmd(r.toDate),
  weekdays: r.recurrence?.weekdays ?? null,
  reason: r.reason,
  status: r.status,
  decidedAt: r.decidedAt ?? null,
  decisionNote: r.decisionNote ?? null,
  createdAt: r.createdAt,
});

/** @param {any} c */
const correctionDto = (c) => ({
  id: c.id,
  sessionId: c.sessionId,
  employeeId: c.employeeId,
  employee: c.employee
    ? { id: c.employee.id, code: c.employee.employeeCode, name: fullName(c.employee) }
    : undefined,
  session: c.session
    ? { workDate: dateToYmd(c.session.workDate), startedAt: c.session.startedAt, endedAt: c.session.endedAt }
    : undefined,
  kind: c.kind,
  fromTs: c.fromTs,
  toTs: c.toTs,
  reason: c.reason,
  status: c.status,
  decidedBy: c.decidedBy,
  decidedAt: c.decidedAt,
  createdAt: c.createdAt,
});

/** Days of a WFH request: the range, narrowed to the chosen weekdays if any. @param {any} r */
export function wfhDays(r) {
  const days = eachDay(
    /** @type {string} */ (dateToYmd(r.fromDate)),
    /** @type {string} */ (dateToYmd(r.toDate)),
  );
  const weekdays = r.recurrence?.weekdays;
  return Array.isArray(weekdays) ? days.filter((d) => weekdays.includes(weekday(d))) : days;
}

/** Minutes after local midnight. @param {Date} t @param {string} tz */
const localMinutes = (t, tz) =>
  (((t.getUTCHours() * 60 + t.getUTCMinutes() + offsetMinutes(t, tz)) % 1440) + 1440) % 1440;

/**
 * @param {{ attendance: { recordWorkPunch: Function }, mfaEnforce?: boolean, now?: () => Date }} deps
 */
export function createWorkService({ attendance, mfaEnforce = true, now = () => new Date() }) {
  /** A permission the caller holds; sensitive ones also need a two-step-verified session (as on routes). */
  const holds = (/** @type {string} */ permission, sensitive = false) =>
    Boolean(ctx().permissions?.has(permission)) && (!sensitive || !mfaEnforce || ctx().mfa === true);

  const loadEmployee = (/** @type {string} */ id) =>
    db().employee.findUnique({ where: { id }, select: EMPLOYEE_SELECT });

  async function me() {
    const id = ctx().employeeId;
    const emp = id ? await loadEmployee(id) : null;
    if (!emp)
      throw new AppError(
        409,
        'no_employee_record',
        'Your sign-in is not linked to an employee record. Ask HR to link it.',
      );
    return emp;
  }

  // ── Policies ──────────────────────────────────────────────────────────────────

  /** Every company has at least one policy, so sessions always pin one. */
  async function ensureDefaultPolicy() {
    if ((await db().workPolicy.count()) > 0) return;
    try {
      await db().workPolicy.create({
        data: {
          id: newId(),
          ...DEFAULT_POLICY,
          version: 1,
          effectiveFrom: ymdToDate('2000-01-01'),
          createdBy: ctx().userId ?? SYSTEM_USER,
        },
      });
    } catch (err) {
      if (/** @type {any} */ (err)?.code !== 'P2002') throw err; // created by a concurrent request
    }
  }

  /** The policy in force for a person on a date: most specific target, then priority, then newest version. */
  async function policyFor(/** @type {any} */ emp, /** @type {string} */ ymd) {
    await ensureDefaultPolicy();
    const date = ymdToDate(ymd);
    const rows = await db().workPolicy.findMany({
      where: {
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
    if (!rows.length) {
      // Every policy was retired or starts later: fall back to the oldest company-wide one.
      const fallback = await db().workPolicy.findFirst({
        where: { appliesTo: 'COMPANY' },
        orderBy: [{ effectiveFrom: 'asc' }, { version: 'desc' }],
      });
      if (!fallback) throw new ConflictError('no_work_policy', 'No work policy applies. Ask HR to add one.');
      return fallback;
    }
    rows.sort(
      (a, b) =>
        TARGET_PRIORITY.indexOf(/** @type {any} */ (a.appliesTo)) -
          TARGET_PRIORITY.indexOf(/** @type {any} */ (b.appliesTo)) ||
        b.priority - a.priority ||
        b.effectiveFrom.getTime() - a.effectiveFrom.getTime() ||
        b.version - a.version,
    );
    return rows[0];
  }

  /** @param {any} b validated body */
  function policyData(b) {
    return {
      appliesTo: b.appliesTo,
      targetId: b.appliesTo === 'COMPANY' ? null : b.targetId,
      priority: b.priority,
      wfhAllowed: b.wfhAllowed,
      wfhRequiresApproval: b.wfhRequiresApproval,
      wfhMaxDaysPerMonth: b.wfhMaxDaysPerMonth ?? null,
      allowedStartMin: allowedMinutes(b.allowedStart),
      allowedEndMin: allowedMinutes(b.allowedEnd),
      heartbeatTimeoutSec: b.heartbeatTimeoutSec,
      idleThresholdSec: b.idleThresholdSec,
      idleCounting: b.idleCounting,
      maxBreakMinutes: b.maxBreakMinutes ?? null,
      resumeWindowMin: b.resumeWindowMin,
      timesheetRequired: b.timesheetRequired,
      dailyReportRequired: b.dailyReportRequired,
      effectiveFrom: ymdToDate(b.effectiveFrom),
    };
  }

  /** Checks that the target of a policy exists in this company. @param {any} b */
  async function assertTarget(b) {
    if (b.appliesTo === 'COMPANY') return;
    const model = {
      LEGAL_ENTITY: 'legalEntity',
      BRANCH: 'branch',
      DEPARTMENT: 'department',
      EMPLOYEE: 'employee',
    }[/** @type {string} */ (b.appliesTo)];
    const found = await /** @type {any} */ (db())[/** @type {string} */ (model)].findUnique({
      where: { id: b.targetId },
    });
    if (!found) throw new ValidationError([{ path: 'body.targetId', message: 'Not found in this company' }]);
  }

  // ── Sessions ──────────────────────────────────────────────────────────────────

  const activeKey = (/** @type {string} */ employeeId) => ({
    tenantId_employeeId: { tenantId: ctx().tenantId, employeeId },
  });

  /** @param {string} employeeId */
  async function activeSession(employeeId) {
    const row = await db().employeeActiveSession.findUnique({
      where: activeKey(employeeId),
      include: { session: { include: { policy: true, workLocation: true } } },
    });
    return row?.session ?? null;
  }

  /** @param {string} employeeId */
  async function activeOr409(employeeId) {
    const s = await activeSession(employeeId);
    if (!s) throw new ConflictError('no_active_session', 'You have no work session running');
    return s;
  }

  /** @param {any} tx @param {any} s @param {string} type @param {Date} t @param {{ clientTs?: string, idempotencyKey?: string, meta?: object, source?: string }} [o] */
  async function appendEvent(tx, s, type, t, o = {}) {
    try {
      await tx.workSessionEvent.create({
        data: {
          id: newId(),
          sessionId: s.id,
          type,
          serverTs: t,
          clientTs: o.clientTs ? new Date(o.clientTs) : null,
          source: o.source ?? 'WEB',
          idempotencyKey: o.idempotencyKey ?? null,
          ...(o.meta ? { meta: o.meta } : {}),
        },
      });
      return true;
    } catch (err) {
      if (/** @type {any} */ (err)?.code === 'P2002' && o.idempotencyKey) return false; // a retried request
      throw err;
    }
  }

  /** Timeline of one session from its events. @param {any} s with policy */
  async function timelineOf(s, client = db()) {
    const events = await client.workSessionEvent.findMany({
      where: { sessionId: s.id },
      orderBy: { serverTs: 'asc' },
      select: { type: true, serverTs: true, meta: true },
    });
    return computeTimeline({
      events,
      policy: s.policy,
      now: now(),
      lastHeartbeatAt: s.lastHeartbeatAt, // a real sign of life even when not stored as an event
    });
  }

  /** Recalculates stored totals (and the end time, which a missing-check-out correction can move). @param {any} s */
  async function recompute(s, client = db()) {
    const t = await timelineOf(s, client);
    return client.workSession.update({
      where: { id: s.id },
      data: {
        workedSec: t.totals.workedSec,
        breakSec: t.totals.breakSec,
        idleSec: t.totals.idleSec,
        disconnectedSec: t.totals.disconnectedSec,
        ...(t.endedAt ? { endedAt: t.endedAt } : {}),
      },
      include: { workLocation: true },
    });
  }

  /** Locations the person may start a session at today, and whether each is ready to use. @param {any} emp @param {any} policy @param {string} ymd */
  async function locationsFor(emp, policy, ymd) {
    const [locations, approved] = await Promise.all([
      db().workLocation.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      approvedWfhOn(emp.id, ymd),
    ]);
    return locations
      .filter((l) => policy.wfhAllowed || !REMOTE_LOCATION_TYPES.has(l.type))
      .map((l) => {
        const needsApproval =
          l.requiresApproval || (REMOTE_LOCATION_TYPES.has(l.type) && policy.wfhRequiresApproval);
        const request = approved.find((r) => r.workLocationId === l.id) ?? null;
        return {
          id: l.id,
          name: l.name,
          type: l.type,
          needsApproval,
          available: !needsApproval || Boolean(request),
          wfhRequestId: request?.id ?? null,
        };
      });
  }

  /** Approved WFH requests that cover a date for one person. @param {string} employeeId @param {string} ymd */
  async function approvedWfhOn(employeeId, ymd) {
    const date = ymdToDate(ymd);
    const rows = await db().wfhRequest.findMany({
      where: { employeeId, status: 'APPROVED', fromDate: { lte: date }, toDate: { gte: date } },
    });
    return rows.filter((r) => wfhDays(r).includes(ymd));
  }

  /** May the caller decide a request about this employee? Never their own; their direct manager, or a holder of the permission in scope. */
  async function canDecide(/** @type {any} */ emp, /** @type {string} */ permission, sensitive = false) {
    const myId = ctx().employeeId ?? null;
    if (myId && myId === emp.id) return false;
    if (myId && emp.managerId === myId) return true;
    if (!holds(permission, sensitive)) return false;
    const scope = await employeeScope(permission);
    return (await db().employee.count({ where: { AND: [{ id: emp.id, deletedAt: null }, scope] } })) > 0;
  }

  /** People whose requests the caller may decide: direct reports plus the permission's scope, never themselves. */
  async function decidableEmployees(/** @type {string} */ permission, sensitive = false) {
    const myId = ctx().employeeId ?? null;
    /** @type {object[]} */
    const or = [];
    if (myId) or.push({ managerId: myId });
    if (holds(permission, sensitive)) or.push(await employeeScope(permission));
    if (!or.length) return null;
    return { AND: [anyOf(or), ...(myId ? [{ id: { not: myId } }] : [])] };
  }

  /** A session the caller may see: their own, or someone in their team-status or session-management scope. @param {string} id */
  async function viewableSession(id) {
    const s = await db().workSession.findUnique({
      where: { id },
      include: { policy: true, workLocation: true },
    });
    if (!s) throw new NotFoundError();
    if (s.employeeId === ctx().employeeId) return s;
    for (const [perm, sensitive] of [
      ['view_team_work_status', true],
      ['manage_work_sessions', true],
    ]) {
      if (!holds(/** @type {string} */ (perm), /** @type {boolean} */ (sensitive))) continue;
      const scope = await employeeScope(/** @type {string} */ (perm));
      if ((await db().employee.count({ where: { AND: [{ id: s.employeeId }, scope] } })) > 0) return s;
    }
    throw new NotFoundError();
  }

  /** Closes an open session at `endAt`, writes the clock-out and recalculates. @param {any} s @param {{ type: 'END' | 'AUTO_CLOSED', endAt: Date, at: Date, reason?: string, source: string, input?: any }} o */
  async function close(s, o) {
    const closed = await db().$transaction(async (/** @type {any} */ tx) => {
      // The lock row goes first: only one request can close a session.
      const gone = await tx.employeeActiveSession.deleteMany({ where: { sessionId: s.id } });
      if (gone.count === 0) return null;
      await appendEvent(tx, s, o.type, o.at, {
        source: o.source,
        clientTs: o.input?.clientTs,
        idempotencyKey: o.input?.idempotencyKey,
        ...(o.type === 'AUTO_CLOSED' ? { meta: { endAt: o.endAt.toISOString(), reason: o.reason } } : {}),
      });
      const openBreak = await tx.workBreak.findFirst({ where: { sessionId: s.id, endedAt: null } });
      if (openBreak) {
        const endedAt = o.endAt < openBreak.startedAt ? openBreak.startedAt : o.endAt;
        await tx.workBreak.update({
          where: { id: openBreak.id },
          data: {
            endedAt,
            durationSec: Math.floor((endedAt.getTime() - openBreak.startedAt.getTime()) / 1000),
          },
        });
      }
      await tx.workSession.update({
        where: { id: s.id },
        data: {
          status: o.type === 'END' ? 'ENDED' : 'AUTO_CLOSED',
          endedAt: o.endAt,
          closeReason: o.reason ?? null,
          needsReview: o.type === 'AUTO_CLOSED',
        },
      });
      return recompute({ ...s, endedAt: o.endAt }, tx);
    });
    if (!closed) return null;
    await attendance.recordWorkPunch(s.employeeId, {
      type: 'OUT',
      at: o.endAt,
      source: o.type === 'END' ? 'WEB' : 'SYSTEM',
    });
    return closed;
  }

  /** Live view of one session for its owner or a viewer. @param {any} s */
  async function liveSession(s) {
    const t = await timelineOf(s);
    const openBreak =
      s.status === 'ON_BREAK'
        ? await db().workBreak.findFirst({ where: { sessionId: s.id, endedAt: null } })
        : null;
    return {
      ...sessionDto(s),
      ...t.totals,
      segments: t.segments,
      openBreak: openBreak ? { type: openBreak.type, startedAt: openBreak.startedAt } : null,
    };
  }

  const service = {
    DISCLOSURE,
    policyFor,

    // ── Policies (work.config.manage) ──
    async listPolicies() {
      await ensureDefaultPolicy();
      const rows = await db().workPolicy.findMany({ orderBy: [{ name: 'asc' }, { version: 'desc' }] });
      const today = /** @type {string} */ (dateToYmd(now()));
      return rows.map((p) => policyDto(p, today));
    },

    /** @param {any} b WorkPolicyBody */
    async createPolicy(b) {
      await assertTarget(b);
      try {
        const row = await db().workPolicy.create({
          data: { id: newId(), name: b.name, version: 1, ...policyData(b), createdBy: ctx().userId },
        });
        await audit(db(), {
          action: 'work.policy_created',
          entityType: 'WorkPolicy',
          entityId: row.id,
          changes: { name: b.name },
        });
        return policyDto(row);
      } catch (err) {
        if (/** @type {any} */ (err)?.code === 'P2002')
          throw new ConflictError(
            'policy_exists',
            'A policy with this name exists. Change it to make a new version.',
          );
        throw err;
      }
    },

    /**
     * A change makes a new version from effectiveFrom; the previous version ends the day before (or, for a
     * same-day change, on that day, where the newer version wins). Running sessions keep the version they pinned.
     * @param {string} id @param {any} b WorkPolicyChange
     */
    async changePolicy(id, b) {
      const old = await db().workPolicy.findUnique({ where: { id } });
      if (!old) throw new NotFoundError();
      const latest = await db().workPolicy.findFirst({
        where: { name: old.name },
        orderBy: { version: 'desc' },
      });
      if (latest?.id !== old.id)
        throw new ConflictError(
          'not_latest_version',
          `Change the latest version (v${latest?.version}) of this policy`,
        );
      await assertTarget(b);
      const from = /** @type {string} */ (b.effectiveFrom);
      const oldFrom = /** @type {string} */ (dateToYmd(old.effectiveFrom));
      if (from < oldFrom)
        throw new ValidationError([
          {
            path: 'body.effectiveFrom',
            message: `Must be on or after ${oldFrom}, when the current version starts`,
          },
        ]);
      const today = /** @type {string} */ (dateToYmd(now()));
      if (from < today)
        throw new ValidationError([
          {
            path: 'body.effectiveFrom',
            message: 'A change starts today or later; past days keep the version they used',
          },
        ]);
      const prevTo = from > oldFrom ? /** @type {string} */ (addDays(from, -1)) : oldFrom;
      const created = await db().$transaction(async (/** @type {any} */ tx) => {
        await tx.workPolicy.update({ where: { id: old.id }, data: { effectiveTo: ymdToDate(prevTo) } });
        return tx.workPolicy.create({
          data: {
            id: newId(),
            name: old.name,
            version: old.version + 1,
            ...policyData(b),
            createdBy: ctx().userId,
          },
        });
      });
      await audit(db(), {
        action: 'work.policy_versioned',
        entityType: 'WorkPolicy',
        entityId: created.id,
        changes: {
          name: old.name,
          fromVersion: old.version,
          toVersion: created.version,
          effectiveFrom: from,
        },
      });
      return policyDto(created, today);
    },

    /** Ends a policy from today. The last company-wide policy cannot be retired. @param {string} id */
    async retirePolicy(id) {
      const p = await db().workPolicy.findUnique({ where: { id } });
      if (!p) throw new NotFoundError();
      const today = /** @type {string} */ (dateToYmd(now()));
      const from = /** @type {string} */ (dateToYmd(p.effectiveFrom));
      const endsOn = from > today ? from : today;
      if (p.appliesTo === 'COMPANY') {
        // Another company-wide policy must still be in force after this one ends.
        const others = await db().workPolicy.count({
          where: {
            appliesTo: 'COMPANY',
            id: { not: p.id },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: ymdToDate(endsOn) } }],
          },
        });
        if (others === 0)
          throw new ConflictError(
            'last_company_policy',
            'Keep one company-wide policy. Change it instead of retiring it.',
          );
      }
      const row = await db().workPolicy.update({ where: { id }, data: { effectiveTo: ymdToDate(endsOn) } });
      await audit(db(), {
        action: 'work.policy_retired',
        entityType: 'WorkPolicy',
        entityId: id,
        changes: { name: p.name, version: p.version },
      });
      return policyDto(row, today);
    },

    // ── My work ──

    /** Everything the My work page needs: policy, locations, the running session and today's sessions. */
    async status() {
      const id = ctx().employeeId;
      const emp = id ? await loadEmployee(id) : null;
      if (!emp) return { hasEmployeeRecord: false, disclosure: DISCLOSURE };
      const t = now();
      const active = await activeSession(emp.id);
      const ymd = active ? /** @type {string} */ (dateToYmd(active.workDate)) : localYmd(t, emp.timezone);
      const policy = active?.policy ?? (await policyFor(emp, ymd));
      const [locations, today] = await Promise.all([
        locationsFor(emp, policy, ymd),
        db().workSession.findMany({
          where: { employeeId: emp.id, workDate: ymdToDate(ymd) },
          orderBy: { startedAt: 'asc' },
          include: { workLocation: true },
        }),
      ]);
      const live = active ? await liveSession(active) : null;
      const totals = { workedSec: 0, breakSec: 0, idleSec: 0, disconnectedSec: 0 };
      for (const s of today) {
        const src = live && s.id === live.id ? live : s;
        for (const k of /** @type {const} */ (['workedSec', 'breakSec', 'idleSec', 'disconnectedSec']))
          totals[k] += src[k];
      }
      return {
        hasEmployeeRecord: true,
        employee: { id: emp.id, name: fullName(emp), timezone: emp.timezone },
        workDate: ymd,
        serverTime: t,
        heartbeatIntervalSec: HEARTBEAT_INTERVAL_SEC,
        policy: policyDto(policy),
        locations,
        active: live,
        today: today.map(sessionDto),
        totals,
        disclosure: DISCLOSURE,
      };
    },

    /** @param {any} input StartSessionBody */
    async start(input) {
      const emp = await me();
      if (emp.status === 'EXITED')
        throw new ConflictError('employee_exited', 'This person has left the company');
      const t = now();
      const ymd = localYmd(t, emp.timezone);
      if (/** @type {string} */ (dateToYmd(emp.dateOfJoining)) > ymd)
        throw new ConflictError('not_started', 'You can start work from your joining date');
      if (await activeSession(emp.id))
        throw new ConflictError('session_active', 'You already have a work session running');
      const policy = await policyFor(emp, ymd);
      const minute = localMinutes(t, emp.timezone);
      if (minute < policy.allowedStartMin || minute >= policy.allowedEndMin)
        throw new ConflictError(
          'outside_allowed_hours',
          `Your work policy allows sessions between ${hhmm(policy.allowedStartMin)} and ${hhmm(policy.allowedEndMin)}`,
        );
      const location = (await locationsFor(emp, policy, ymd)).find((l) => l.id === input.workLocationId);
      if (!location)
        throw new ValidationError([
          { path: 'body.workLocationId', message: 'Choose an active work location you may use' },
        ]);
      if (!location.available)
        throw new ConflictError(
          'wfh_not_approved',
          `Working from "${location.name}" today needs an approved request`,
        );

      const id = newId();
      try {
        await db().$transaction(async (/** @type {any} */ tx) => {
          const s = await tx.workSession.create({
            data: {
              id,
              employeeId: emp.id,
              workDate: ymdToDate(ymd),
              workLocationId: location.id,
              policyId: policy.id,
              policyVersion: policy.version,
              wfhRequestId: location.wfhRequestId,
              startedAt: t,
              lastHeartbeatAt: t,
            },
          });
          await appendEvent(tx, s, 'START', t, {
            clientTs: input.clientTs,
            meta: { workLocationId: location.id },
          });
          // Primary key (tenant, employee): a second concurrent start fails here and rolls back.
          await tx.employeeActiveSession.create({
            data: { employeeId: emp.id, sessionId: s.id, startedAt: t },
          });
        });
      } catch (err) {
        if (/** @type {any} */ (err)?.code === 'P2002')
          throw new ConflictError('session_active', 'You already have a work session running');
        throw err;
      }
      await attendance.recordWorkPunch(emp.id, {
        type: 'IN',
        at: t,
        source: 'WEB',
        workLocationId: location.id,
      });
      return service.status();
    },

    /**
     * The page is still open. Stored as an event only when enough time has passed since the last stored signal
     * (at most half the timeout), so the log stays small but a gap can never hide inside it.
     * @param {any} input SessionSignalBody
     */
    async heartbeat(input) {
      const emp = await me();
      const s = await activeOr409(emp.id);
      const t = now();
      const timeoutMs = s.policy.heartbeatTimeoutSec * 1000;
      const last = s.lastHeartbeatAt ?? s.startedAt;
      const lost = s.status === 'DISCONNECTED' || t.getTime() - last.getTime() > timeoutMs;
      let status = s.status;
      if (lost) {
        const onBreak = await db().workBreak.findFirst({ where: { sessionId: s.id, endedAt: null } });
        status = onBreak ? 'ON_BREAK' : 'ACTIVE';
        await appendEvent(db(), s, 'RECONNECTED', t, {
          ...input,
          meta: { lastHeartbeatAt: last.toISOString() },
        });
      } else {
        const lastStored = await db().workSessionEvent.findFirst({
          where: { sessionId: s.id, type: { in: [...SIGNALS] } },
          orderBy: { serverTs: 'desc' },
          select: { serverTs: true },
        });
        if (!lastStored || t.getTime() - lastStored.serverTs.getTime() >= timeoutMs / 2)
          await appendEvent(db(), s, 'HEARTBEAT', t, input);
      }
      await db().workSession.update({ where: { id: s.id }, data: { lastHeartbeatAt: t, status } });
      return {
        sessionId: s.id,
        status,
        reconnected: lost,
        serverTime: t,
        nextHeartbeatSec: HEARTBEAT_INTERVAL_SEC,
      };
    },

    /** @param {any} input BreakBody */
    async startBreak(input) {
      const emp = await me();
      const s = await activeOr409(emp.id);
      if (s.status === 'ON_BREAK') throw new ConflictError('already_on_break', 'You are already on a break');
      const t = now();
      await db().$transaction(async (/** @type {any} */ tx) => {
        await appendEvent(tx, s, 'BREAK_START', t, { ...input, meta: { type: input.type } });
        await tx.workBreak.create({ data: { id: newId(), sessionId: s.id, type: input.type, startedAt: t } });
        await tx.workSession.update({
          where: { id: s.id },
          data: { status: 'ON_BREAK', lastHeartbeatAt: t },
        });
      });
      return service.status();
    },

    /** @param {any} input SessionSignalBody */
    async endBreak(input) {
      const emp = await me();
      const s = await activeOr409(emp.id);
      const t = now();
      const open = await db().workBreak.findFirst({ where: { sessionId: s.id, endedAt: null } });
      if (!open) throw new ConflictError('not_on_break', 'You are not on a break');
      await db().$transaction(async (/** @type {any} */ tx) => {
        await appendEvent(tx, s, 'BREAK_END', t, input);
        await tx.workBreak.update({
          where: { id: open.id },
          data: { endedAt: t, durationSec: Math.floor((t.getTime() - open.startedAt.getTime()) / 1000) },
        });
        await tx.workSession.update({ where: { id: s.id }, data: { status: 'ACTIVE', lastHeartbeatAt: t } });
      });
      return service.status();
    },

    /** @param {any} input SessionSignalBody */
    async end(input) {
      const emp = await me();
      const s = await activeOr409(emp.id);
      const t = now();
      const closed = await close(s, { type: 'END', endAt: t, at: t, source: 'WEB', input });
      if (!closed) throw new ConflictError('no_active_session', 'You have no work session running');
      return service.status();
    },

    /**
     * Desktop-agent idle reports (the agent arrives in a later sprint; the web page never reports idle).
     * @param {string} employeeId @param {'IDLE_START' | 'IDLE_END'} type
     */
    async recordIdle(employeeId, type) {
      const s = await activeOr409(employeeId);
      const t = now();
      await db().$transaction(async (/** @type {any} */ tx) => {
        await appendEvent(tx, s, type, t, { source: 'DESKTOP_AGENT' });
        if (type === 'IDLE_START')
          await tx.idleRecord.create({ data: { id: newId(), sessionId: s.id, idleStart: t } });
        else {
          const open = await tx.idleRecord.findFirst({
            where: { sessionId: s.id, idleEnd: null },
            orderBy: { idleStart: 'desc' },
          });
          if (open)
            await tx.idleRecord.update({
              where: { id: open.id },
              data: { idleEnd: t, durationSec: Math.floor((t.getTime() - open.idleStart.getTime()) / 1000) },
            });
        }
        await tx.workSession.update({ where: { id: s.id }, data: { lastHeartbeatAt: t } });
      });
    },

    /**
     * Sessions of the caller, or of someone in their team-status scope.
     * @param {{ from: string, to: string, employeeId?: string }} q
     */
    async listSessions(q) {
      if (daysBetween(q.from, q.to) > 92)
        throw new ValidationError([{ path: 'query.to', message: 'Choose at most 93 days' }]);
      const employeeId = q.employeeId ?? (await me()).id;
      if (employeeId !== ctx().employeeId) {
        if (!holds('view_team_work_status', true)) throw new ForbiddenError();
        const scope = await employeeScope('view_team_work_status');
        if ((await db().employee.count({ where: { AND: [{ id: employeeId }, scope] } })) === 0)
          throw new NotFoundError();
      }
      const rows = await db().workSession.findMany({
        where: { employeeId, workDate: { gte: ymdToDate(q.from), lte: ymdToDate(q.to) } },
        orderBy: { startedAt: 'desc' },
        include: { workLocation: true },
      });
      return rows.map(sessionDto);
    },

    /** One session with its timeline, breaks and corrections. Heartbeats are summarised, not listed. @param {string} id */
    async getSession(id) {
      const s = await viewableSession(id);
      const [live, breaks, corrections, events] = await Promise.all([
        liveSession(s),
        db().workBreak.findMany({ where: { sessionId: s.id }, orderBy: { startedAt: 'asc' } }),
        db().workCorrection.findMany({ where: { sessionId: s.id }, orderBy: { createdAt: 'asc' } }),
        db().workSessionEvent.findMany({
          where: { sessionId: s.id, type: { not: 'HEARTBEAT' } },
          orderBy: { serverTs: 'asc' },
          select: { type: true, serverTs: true, source: true },
        }),
      ]);
      return {
        ...live,
        breaks: breaks.map((b) => ({
          type: b.type,
          startedAt: b.startedAt,
          endedAt: b.endedAt,
          durationSec: b.durationSec,
        })),
        corrections: corrections.map(correctionDto),
        events,
      };
    },

    /**
     * Background sweep for one company: a session with no heartbeat for longer than its timeout is marked
     * disconnected; after the resume window (or the maximum length) it is closed at the last heartbeat and
     * flagged for review, and the clock-out is written at that time. Runs in a system context.
     */
    async sweep() {
      const t = now();
      const open = await db().workSession.findMany({
        where: { status: { in: OPEN_STATUSES } },
        include: { policy: true },
        take: 5000,
      });
      let disconnected = 0;
      let closed = 0;
      for (const s of open) {
        const last = s.lastHeartbeatAt ?? s.startedAt;
        const gap = t.getTime() - last.getTime();
        const tooLong = t.getTime() - s.startedAt.getTime() > MAX_SESSION_HOURS * 3_600_000;
        if (gap > s.policy.resumeWindowMin * 60_000 || tooLong) {
          const endAt =
            tooLong && gap <= s.policy.resumeWindowMin * 60_000
              ? new Date(Math.min(last.getTime(), s.startedAt.getTime() + MAX_SESSION_HOURS * 3_600_000))
              : last;
          const done = await close(s, {
            type: 'AUTO_CLOSED',
            endAt,
            at: t,
            source: 'SYSTEM',
            reason: tooLong && gap <= s.policy.resumeWindowMin * 60_000 ? 'MAX_LENGTH' : 'NO_HEARTBEAT',
          });
          if (done) {
            closed++;
            await audit(db(), {
              actorType: 'SYSTEM',
              action: 'work.session_auto_closed',
              entityType: 'WorkSession',
              entityId: s.id,
              changes: { endAt: endAt.toISOString(), lastHeartbeatAt: last.toISOString() },
            });
          }
        } else if (s.status === 'ACTIVE' && gap > s.policy.heartbeatTimeoutSec * 1000) {
          const n = await db().workSession.updateMany({
            where: { id: s.id, status: 'ACTIVE', lastHeartbeatAt: s.lastHeartbeatAt },
            data: { status: 'DISCONNECTED' },
          });
          if (n.count) {
            await appendEvent(db(), s, 'DISCONNECTED', t, {
              source: 'SYSTEM',
              meta: { lastHeartbeatAt: last.toISOString() },
            });
            disconnected++;
          }
        }
      }
      return { checked: open.length, disconnected, closed };
    },

    // ── Corrections ──

    /** @param {any} b CorrectionBody */
    async requestCorrection(b) {
      const emp = await me();
      const s = await db().workSession.findUnique({ where: { id: b.sessionId }, include: { policy: true } });
      if (!s || s.employeeId !== emp.id) throw new NotFoundError();
      if (!s.endedAt)
        throw new ConflictError('session_open', 'End the session before asking for a correction');
      const t = now();
      if (t.getTime() - s.endedAt.getTime() > CORRECTION_WINDOW_DAYS * 86_400_000)
        throw new ConflictError(
          'correction_window_closed',
          `Corrections can be requested up to ${CORRECTION_WINDOW_DAYS} days after a session`,
        );
      const from = new Date(b.fromTs);
      const to = new Date(b.toTs);
      const err = (/** @type {string} */ path, /** @type {string} */ message) =>
        new ValidationError([{ path: `body.${path}`, message }]);
      if (to > t) throw err('toTs', 'Must not be in the future');
      if (b.kind === 'MISSING_CHECKOUT') {
        if (s.status !== 'AUTO_CLOSED')
          throw err('kind', 'Only a session that was closed automatically can have a missing check-out');
        if (from.getTime() !== s.endedAt.getTime())
          throw err('fromTs', 'A missing check-out starts when the session was closed');
        if (to.getTime() - s.startedAt.getTime() > MAX_SESSION_HOURS * 3_600_000)
          throw err('toTs', `A session can be at most ${MAX_SESSION_HOURS} hours`);
      } else if (from < s.startedAt || to > s.endedAt)
        throw err('fromTs', 'Choose a time inside the session');
      const overlapping = await db().workCorrection.count({
        where: { sessionId: s.id, status: 'PENDING', fromTs: { lt: to }, toTs: { gt: from } },
      });
      if (overlapping)
        throw new ConflictError('correction_pending', 'You already asked for a correction to this time');
      const row = await db().workCorrection.create({
        data: {
          id: newId(),
          sessionId: s.id,
          employeeId: emp.id,
          kind: b.kind,
          fromTs: from,
          toTs: to,
          reason: b.reason,
        },
      });
      await audit(db(), {
        action: 'work.correction_requested',
        entityType: 'WorkCorrection',
        entityId: row.id,
        changes: { kind: b.kind },
      });
      return correctionDto(row);
    },

    /** @param {{ view: 'mine' | 'approvals', status?: string }} q */
    async listCorrections(q) {
      let where;
      if (q.view === 'mine') where = { employeeId: (await me()).id };
      else {
        const employees = await decidableEmployees('manage_work_sessions', true);
        if (!employees) return [];
        where = { employee: employees };
      }
      const rows = await db().workCorrection.findMany({
        where: { ...where, ...(q.status ? { status: /** @type {any} */ (q.status) } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: { employee: { select: EMPLOYEE_SELECT }, session: true },
      });
      return rows.map(correctionDto);
    },

    /** @param {string} id @param {{ decision: 'APPROVED' | 'REJECTED', comment?: string }} d */
    async decideCorrection(id, d) {
      const c = await db().workCorrection.findUnique({
        where: { id },
        include: { employee: { select: EMPLOYEE_SELECT } },
      });
      if (!c) throw new NotFoundError();
      if (c.employeeId === ctx().employeeId)
        throw new ForbiddenError('own_request', 'You cannot decide your own request');
      if (!(await canDecide(c.employee, 'manage_work_sessions', true))) throw new NotFoundError();
      const t = now();
      await db().$transaction(async (/** @type {any} */ tx) => {
        const n = await tx.workCorrection.updateMany({
          where: { id, status: 'PENDING' },
          data: { status: d.decision, decidedBy: ctx().userId, decidedAt: t },
        });
        if (n.count === 0) throw new ConflictError('already_decided', 'This request was already decided');
        if (d.decision === 'APPROVED') {
          const s = await tx.workSession.findUnique({
            where: { id: c.sessionId },
            include: { policy: true },
          });
          await appendEvent(tx, s, 'CORRECTION_APPLIED', t, {
            source: 'ADMIN',
            meta: {
              correctionId: c.id,
              kind: c.kind,
              fromTs: c.fromTs.toISOString(),
              toTs: c.toTs.toISOString(),
            },
          });
          await recompute(s, tx);
          const pending = await tx.workCorrection.count({ where: { sessionId: s.id, status: 'PENDING' } });
          if (!pending) await tx.workSession.update({ where: { id: s.id }, data: { needsReview: false } });
        }
        await audit(tx, {
          action: d.decision === 'APPROVED' ? 'work.correction_approved' : 'work.correction_rejected',
          entityType: 'WorkCorrection',
          entityId: id,
          changes: { kind: c.kind, ...(d.comment ? { comment: d.comment } : {}) },
        });
      });
      return correctionDto(await db().workCorrection.findUnique({ where: { id } }));
    },

    /** @param {string} id */
    async cancelCorrection(id) {
      const c = await db().workCorrection.findUnique({ where: { id } });
      if (!c || c.employeeId !== ctx().employeeId) throw new NotFoundError();
      const n = await db().workCorrection.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      if (!n.count) throw new ConflictError('not_pending', 'Only a pending request can be cancelled');
      return correctionDto({ ...c, status: 'CANCELLED' });
    },

    // ── Work from home ──

    /** @param {any} b WfhRequestBody */
    async requestWfh(b) {
      const emp = await me();
      if (daysBetween(b.fromDate, b.toDate) >= MAX_WFH_RANGE_DAYS)
        throw new ValidationError([
          { path: 'body.toDate', message: `Choose at most ${MAX_WFH_RANGE_DAYS} days` },
        ]);
      const today = localYmd(now(), emp.timezone);
      if (b.toDate < today)
        throw new ValidationError([{ path: 'body.toDate', message: 'Must not be in the past' }]);
      const loc = await db().workLocation.findUnique({ where: { id: b.workLocationId } });
      if (!loc || !loc.isActive)
        throw new ValidationError([
          { path: 'body.workLocationId', message: 'Choose an active work location' },
        ]);
      const policy = await policyFor(emp, b.fromDate < today ? today : b.fromDate);
      const remote = REMOTE_LOCATION_TYPES.has(loc.type);
      if (remote && !policy.wfhAllowed)
        throw new ConflictError('wfh_not_allowed', 'Your work policy does not allow working from home');
      if (!loc.requiresApproval && !(remote && policy.wfhRequiresApproval))
        throw new ConflictError('no_request_needed', `"${loc.name}" can be used without a request`);
      const draft = {
        fromDate: ymdToDate(b.fromDate),
        toDate: ymdToDate(b.toDate),
        recurrence: b.weekdays ? { weekdays: b.weekdays } : null,
      };
      const days = wfhDays(draft);
      if (!days.length)
        throw new ValidationError([
          { path: 'body.weekdays', message: 'No days in this range match the chosen weekdays' },
        ]);

      const existing = await db().wfhRequest.findMany({
        where: {
          employeeId: emp.id,
          status: { in: ['PENDING', 'APPROVED'] },
          fromDate: { lte: ymdToDate(/** @type {string} */ (addDays(b.toDate, 31))) },
          toDate: { gte: ymdToDate(/** @type {string} */ (addDays(b.fromDate, -31))) },
        },
      });
      const taken = new Set(existing.flatMap(wfhDays));
      const clash = days.find((d) => taken.has(d));
      if (clash) throw new ConflictError('wfh_overlap', `You already have a request for ${clash}`);
      if (policy.wfhMaxDaysPerMonth && remote) {
        /** @type {Record<string, number>} */
        const perMonth = {};
        for (const d of [...taken, ...days]) perMonth[d.slice(0, 7)] = (perMonth[d.slice(0, 7)] ?? 0) + 1;
        const over = Object.entries(perMonth).find(
          ([m, n]) =>
            n > /** @type {number} */ (policy.wfhMaxDaysPerMonth) && days.some((d) => d.startsWith(m)),
        );
        if (over)
          throw new ConflictError(
            'wfh_monthly_limit',
            `Your policy allows ${policy.wfhMaxDaysPerMonth} work-from-home days a month; ${over[0]} would have ${over[1]}`,
          );
      }
      const row = await db().wfhRequest.create({
        data: {
          id: newId(),
          employeeId: emp.id,
          workLocationId: loc.id,
          ...draft,
          recurrence: draft.recurrence ?? undefined,
          reason: b.reason ?? null,
        },
        include: { workLocation: true },
      });
      await audit(db(), {
        action: 'wfh.requested',
        entityType: 'WfhRequest',
        entityId: row.id,
        changes: { days: days.length },
      });
      return { ...wfhDto(row), days };
    },

    /** @param {{ view: 'mine' | 'approvals', status?: string }} q */
    async listWfh(q) {
      let where;
      if (q.view === 'mine') where = { employeeId: (await me()).id };
      else {
        const employees = await decidableEmployees('wfh.request.approve');
        if (!employees) return [];
        where = { employee: employees };
      }
      const rows = await db().wfhRequest.findMany({
        where: { ...where, ...(q.status ? { status: /** @type {any} */ (q.status) } : {}) },
        orderBy: { fromDate: 'desc' },
        take: 200,
        include: { workLocation: true, employee: { select: EMPLOYEE_SELECT } },
      });
      return rows.map((r) => ({ ...wfhDto(r), days: wfhDays(r).length }));
    },

    /** @param {string} id @param {{ decision: 'APPROVED' | 'REJECTED', comment?: string }} d */
    async decideWfh(id, d) {
      const r = await db().wfhRequest.findUnique({
        where: { id },
        include: { employee: { select: EMPLOYEE_SELECT } },
      });
      if (!r) throw new NotFoundError();
      if (r.employeeId === ctx().employeeId)
        throw new ForbiddenError('own_request', 'You cannot decide your own request');
      if (!(await canDecide(r.employee, 'wfh.request.approve'))) throw new NotFoundError();
      const n = await db().wfhRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: d.decision,
          decidedBy: ctx().userId,
          decidedAt: now(),
          decisionNote: d.comment ?? null,
        },
      });
      if (!n.count) throw new ConflictError('already_decided', 'This request was already decided');
      await audit(db(), {
        action: d.decision === 'APPROVED' ? 'wfh.approved' : 'wfh.rejected',
        entityType: 'WfhRequest',
        entityId: id,
        changes: d.comment ? { comment: d.comment } : undefined,
      });
      return wfhDto(await db().wfhRequest.findUnique({ where: { id }, include: { workLocation: true } }));
    },

    /** Cancels a pending request, or an approved one that no session has used yet. @param {string} id */
    async cancelWfh(id) {
      const r = await db().wfhRequest.findUnique({ where: { id } });
      if (!r || r.employeeId !== ctx().employeeId) throw new NotFoundError();
      if (!['PENDING', 'APPROVED'].includes(r.status))
        throw new ConflictError('not_cancellable', 'This request cannot be cancelled');
      if (r.status === 'APPROVED' && (await db().workSession.count({ where: { wfhRequestId: id } })) > 0)
        throw new ConflictError('wfh_in_use', 'Work sessions already used this approval');
      const n = await db().wfhRequest.updateMany({
        where: { id, status: r.status },
        data: { status: 'CANCELLED' },
      });
      if (!n.count) throw new ConflictError('not_cancellable', 'This request changed. Reload and try again.');
      await audit(db(), { action: 'wfh.cancelled', entityType: 'WfhRequest', entityId: id });
      return { id, status: 'CANCELLED' };
    },

    // ── Team status (view_team_work_status) ──

    /**
     * Who is working right now and today's totals, for people in the caller's scope. Status only: no screenshots,
     * applications or activity, which are separate permissions in later sprints.
     * @param {{ departmentId?: string, status?: string }} q
     */
    async teamStatus(q) {
      const scope = await employeeScope('view_team_work_status');
      const t = now();
      const employees = await db().employee.findMany({
        where: {
          AND: [scope, { deletedAt: null, status: { not: 'EXITED' } }],
          ...(q.departmentId ? { departmentId: q.departmentId } : {}),
        },
        select: { ...EMPLOYEE_SELECT, department: { select: { name: true } } },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        take: 500,
      });
      const ids = employees.map((e) => e.id);
      const since = ymdToDate(/** @type {string} */ (addDays(/** @type {string} */ (dateToYmd(t)), -1)));
      const [active, recent] = await Promise.all([
        db().employeeActiveSession.findMany({
          where: { employeeId: { in: ids } },
          include: { session: { include: { policy: true, workLocation: true } } },
        }),
        db().workSession.findMany({
          where: { employeeId: { in: ids }, workDate: { gte: since }, endedAt: { not: null } },
        }),
      ]);
      const byEmp = new Map(active.map((a) => [a.employeeId, a.session]));
      const out = [];
      for (const e of employees) {
        const ymd = localYmd(t, e.timezone);
        const s = byEmp.get(e.id) ?? null;
        const live = s ? await timelineOf(s) : null;
        const done = recent.filter((r) => r.employeeId === e.id && dateToYmd(r.workDate) === ymd);
        const workedSec = done.reduce((n, r) => n + r.workedSec, 0) + (live?.totals.workedSec ?? 0);
        const breakSec = done.reduce((n, r) => n + r.breakSec, 0) + (live?.totals.breakSec ?? 0);
        const lost =
          s &&
          (s.status === 'DISCONNECTED' ||
            t.getTime() - (s.lastHeartbeatAt ?? s.startedAt).getTime() > s.policy.heartbeatTimeoutSec * 1000);
        const state = s
          ? s.status === 'ON_BREAK'
            ? 'ON_BREAK'
            : lost
              ? 'DISCONNECTED'
              : 'WORKING'
          : done.length
            ? 'FINISHED'
            : 'NOT_STARTED';
        if (q.status && q.status !== state) continue;
        out.push({
          employee: {
            id: e.id,
            code: e.employeeCode,
            name: fullName(e),
            department: e.department?.name ?? null,
          },
          state,
          session: s
            ? {
                id: s.id,
                startedAt: s.startedAt,
                lastHeartbeatAt: s.lastHeartbeatAt,
                location: { name: s.workLocation.name, type: s.workLocation.type },
              }
            : null,
          today: { workDate: ymd, workedSec, breakSec, sessions: done.length + (s ? 1 : 0) },
        });
      }
      const counts = { WORKING: 0, ON_BREAK: 0, DISCONNECTED: 0, FINISHED: 0, NOT_STARTED: 0 };
      for (const r of out) counts[/** @type {keyof typeof counts} */ (r.state)]++;
      return { asOf: t, counts, data: out };
    },
  };
  return service;
}
