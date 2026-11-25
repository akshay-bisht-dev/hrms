// @ts-check
/**
 * Pure attendance calculations (ATT-02/03). No database access: everything a day needs is passed in,
 * so the API (after a punch) and the worker (nightly roll-up) produce identical results, and every rule is unit-tested.
 *
 * Times: shift and schedule times are minutes after local midnight in the employee's time zone.
 * An end time past 1440 means the next calendar day (night shift); the whole shift belongs to the day it starts.
 */
import { addDays, weekday, zonedTime } from '../../lib/time.js';

/** Used when a company has saved no attendance policy. Every value is editable per legal entity. */
export const DEFAULT_POLICY = Object.freeze({
  presentPercent: 75,
  halfDayPercent: 50,
  autoDeductBreak: true,
  captureIp: false,
  captureGeo: false,
  regularizationWindowDays: 30,
});

/** A day is final this long after its planned end (or local midnight), so late clock-outs still count. */
export const CLOSE_BUFFER_MINUTES = 240;
/** An open clock-in older than this is treated as abandoned: the next action is a new clock-in. */
export const MAX_SESSION_HOURS = 20;
/** Work locations whose time is reported as working from home. */
export const REMOTE_LOCATION_TYPES = new Set(['WFH', 'REMOTE']);

/**
 * @typedef {object} Plan
 * @property {'WORKING' | 'WEEKEND' | 'HOLIDAY'} kind
 * @property {'SHIFT' | 'SCHEDULE' | 'DEFAULT'} source
 * @property {string | null} [shiftId]
 * @property {string | null} [holidayName]
 * @property {number | null} startMin
 * @property {number | null} endMin may exceed 1440 (ends the next day)
 * @property {number} breakMinutes planned unpaid break inside the span
 * @property {number} graceLate
 * @property {number} graceEarly
 * @property {number | null} expectedMinutes planned net work; null when nothing is planned
 * @property {boolean} flexible no fixed start/end, so no late or early flags
 *
 * @typedef {{ type: 'IN' | 'OUT', serverTs: Date, source?: string, createdAt?: Date, workLocationId?: string | null, locationType?: string | null }} Punch
 * @typedef {{ dailyThresholdMin: number | null, weeklyThresholdMin: number | null, requiresApproval: boolean, restDayAllOvertime: boolean }} OvertimeRule
 */

/**
 * What the employee was expected to work on `workDate`. Priority: shift assignment → work schedule on the
 * employment record → the legal entity's weekend days. A public holiday on the branch calendar overrides all three.
 * @param {{ workDate: string, shift?: any, schedule?: any, weekendDays: number[], holiday?: { name: string } | null }} input
 * @returns {Plan}
 */
export function resolvePlan({ workDate, shift, schedule, weekendDays, holiday }) {
  const wd = weekday(workDate);
  const restDay = weekendDays.includes(wd);
  /** @type {Plan} */
  let plan;
  if (shift) {
    const endMin =
      shift.crossesMidnight || shift.endMin <= shift.startMin ? shift.endMin + 1440 : shift.endMin;
    plan = {
      kind: restDay ? 'WEEKEND' : 'WORKING',
      source: 'SHIFT',
      shiftId: shift.id,
      startMin: shift.startMin,
      endMin,
      breakMinutes: shift.breakMinutes ?? 0,
      graceLate: shift.graceLateMin ?? 0,
      graceEarly: shift.graceEarlyMin ?? 0,
      expectedMinutes: Math.max(0, endMin - shift.startMin - (shift.breakMinutes ?? 0)),
      flexible: false,
    };
  } else if (schedule) {
    const day = (schedule.weeklyPattern ?? []).find((/** @type {any} */ d) => d.day === wd);
    const working = Boolean(day?.working);
    const fixed =
      schedule.type === 'FIXED' && (day?.startMin ?? null) !== null && (day?.endMin ?? null) !== null;
    plan = {
      kind: working ? 'WORKING' : 'WEEKEND',
      source: 'SCHEDULE',
      startMin: fixed ? day.startMin : null,
      endMin: fixed ? day.endMin : null,
      // A 09:00–18:00 day with 480 planned minutes has a 60-minute break.
      breakMinutes: fixed ? Math.max(0, day.endMin - day.startMin - schedule.dailyMinutes) : 0,
      graceLate: schedule.graceMinutes ?? 0,
      graceEarly: schedule.graceMinutes ?? 0,
      expectedMinutes: working ? schedule.dailyMinutes : null,
      flexible: !fixed,
    };
  } else {
    plan = {
      kind: restDay ? 'WEEKEND' : 'WORKING',
      source: 'DEFAULT',
      startMin: null,
      endMin: null,
      breakMinutes: 0,
      graceLate: 0,
      graceEarly: 0,
      expectedMinutes: null,
      flexible: true,
    };
  }
  if (holiday) return { ...plan, kind: 'HOLIDAY', holidayName: holiday.name };
  return plan;
}

/**
 * Applies approved corrections. The latest CORRECTION IN replaces everything before it, and the latest
 * CORRECTION OUT replaces everything after it. Original punches are never deleted; they are only left out.
 * @param {Punch[]} punches
 * @returns {Punch[]}
 */
export function effectivePunches(punches) {
  const byTime = [...punches].sort((a, b) => a.serverTs.getTime() - b.serverTs.getTime());
  const corrections = byTime
    .filter((p) => p.source === 'CORRECTION')
    .sort((a, b) => (a.createdAt ?? a.serverTs).getTime() - (b.createdAt ?? b.serverTs).getTime());
  if (!corrections.length) return byTime;
  const latest = (/** @type {string} */ type) => corrections.filter((p) => p.type === type).at(-1);
  const cin = latest('IN');
  const cout = latest('OUT');
  const kept = byTime.filter(
    (p) =>
      p.source !== 'CORRECTION' &&
      (!cin || p.serverTs >= cin.serverTs) &&
      (!cout || p.serverTs <= cout.serverTs),
  );
  return [...(cin ? [cin] : []), ...kept, ...(cout ? [cout] : [])];
}

/**
 * Pairs IN with the next OUT. A second IN while already in, or an OUT while out, is ignored.
 * @param {Punch[]} punches sorted
 */
export function pairPunches(punches) {
  /** @type {{ in: Punch, out: Punch }[]} */
  const pairs = [];
  /** @type {Punch | null} */
  let open = null;
  for (const p of punches) {
    if (p.type === 'IN') open ??= p;
    else if (open) {
      pairs.push({ in: open, out: p });
      open = null;
    }
  }
  return { pairs, open };
}

/** When the day becomes final. @param {string} workDate @param {string} tz @param {Plan} plan */
export function closesAt(workDate, tz, plan) {
  const midnight = zonedTime(/** @type {string} */ (addDays(workDate, 1)), 0, tz).getTime();
  const planned = (plan.endMin ?? null) !== null ? zonedTime(workDate, plan.endMin, tz).getTime() : 0;
  return new Date(Math.max(midnight, planned) + CLOSE_BUFFER_MINUTES * 60_000);
}

const minutes = (/** @type {number} */ ms) => Math.floor(ms / 60_000);

/**
 * Calculates one attendance day.
 * @param {object} input
 * @param {string} input.workDate
 * @param {string} input.tz employee time zone
 * @param {Plan} input.plan
 * @param {Punch[]} input.punches every punch with this work date
 * @param {typeof DEFAULT_POLICY} input.policy
 * @param {OvertimeRule | null} input.overtimeRule
 * @param {number} [input.weekWorkedBefore] minutes worked earlier in the same week (for weekly overtime)
 * @param {Date} input.now
 */
export function computeDay({ workDate, tz, plan, punches, policy, overtimeRule, weekWorkedBefore = 0, now }) {
  const closed = now >= closesAt(workDate, tz, plan);
  const effective = effectivePunches(punches);
  const { pairs, open } = pairPunches(effective);
  const flags = new Set();
  if (punches.some((p) => p.source === 'CORRECTION')) flags.add('CORRECTED');

  const pairedMs = pairs.reduce((sum, p) => sum + (p.out.serverTs.getTime() - p.in.serverTs.getTime()), 0);
  let gapMs = 0;
  for (let i = 1; i < pairs.length; i++)
    gapMs += pairs[i].in.serverTs.getTime() - pairs[i - 1].out.serverTs.getTime();
  let worked = minutes(pairedMs);
  let breaks = minutes(gapMs);

  // Planned unpaid break that wasn't taken as a clock-out is deducted, once the person has worked more than half the day.
  if (policy.autoDeductBreak && plan.breakMinutes > 0 && plan.expectedMinutes) {
    const untaken = Math.max(0, plan.breakMinutes - breaks);
    if (untaken > 0 && worked > plan.expectedMinutes / 2) {
      const deducted = Math.min(untaken, worked);
      worked -= deducted;
      breaks += deducted;
    }
  }

  const firstIn = effective.find((p) => p.type === 'IN') ?? null;
  const lastOut = pairs.at(-1)?.out ?? null;
  const dayStart = zonedTime(workDate, 0, tz).getTime();
  const at = (/** @type {Punch} */ p) => minutes(p.serverTs.getTime() - dayStart);

  let late = 0;
  let early = 0;
  if (plan.kind === 'WORKING' && !plan.flexible && (plan.startMin ?? null) !== null && firstIn) {
    const diff = at(firstIn) - plan.startMin;
    if (diff > plan.graceLate) late = diff;
  }
  if (
    plan.kind === 'WORKING' &&
    !plan.flexible &&
    (plan.endMin ?? null) !== null &&
    lastOut &&
    !open &&
    closed
  ) {
    const diff = plan.endMin - at(lastOut);
    if (diff > plan.graceEarly) early = diff;
  }
  if (late) flags.add('LATE');
  if (early) flags.add('EARLY_LEAVE');
  if (closed && open) flags.add('MISSING_OUT');

  // Overtime: the larger of the daily and weekly excess, so the same minutes are never counted twice.
  let overtime = 0;
  if (overtimeRule && worked > 0) {
    const restDay = plan.kind !== 'WORKING';
    const daily =
      restDay && overtimeRule.restDayAllOvertime
        ? worked
        : (overtimeRule.dailyThresholdMin ?? null) !== null
          ? Math.max(0, worked - overtimeRule.dailyThresholdMin)
          : 0;
    const wt = overtimeRule.weeklyThresholdMin;
    const weekly =
      (wt ?? null) !== null
        ? Math.max(0, weekWorkedBefore + worked - wt) - Math.max(0, weekWorkedBefore - wt)
        : 0;
    overtime = Math.max(daily, weekly);
  }
  if (overtime) flags.add('OVERTIME');
  if (plan.kind !== 'WORKING' && worked > 0) flags.add('WORKED_ON_REST_DAY');

  /** @type {string} */
  let status;
  if (plan.kind === 'HOLIDAY') status = 'HOLIDAY';
  else if (plan.kind === 'WEEKEND') status = 'WEEKEND';
  else if (!closed) status = 'PENDING';
  else if (worked === 0) status = 'ABSENT';
  else if (!plan.expectedMinutes) status = 'PRESENT';
  else if (worked * 100 >= plan.expectedMinutes * policy.presentPercent) status = 'PRESENT';
  else if (worked * 100 >= plan.expectedMinutes * policy.halfDayPercent) status = 'HALF_DAY';
  else status = 'ABSENT';

  if (status === 'PRESENT') {
    const remoteMs = pairs
      .filter((p) => p.in.locationType && REMOTE_LOCATION_TYPES.has(p.in.locationType))
      .reduce((sum, p) => sum + (p.out.serverTs.getTime() - p.in.serverTs.getTime()), 0);
    if (remoteMs * 2 > pairedMs) status = 'WFH';
  }

  return {
    status,
    closed,
    firstInAt: firstIn?.serverTs ?? null,
    lastOutAt: lastOut?.serverTs ?? null,
    openSince: open?.serverTs ?? null,
    workedMinutes: worked,
    breakMinutes: breaks,
    lateMinutes: late,
    earlyLeaveMinutes: early,
    overtimeMinutes: overtime,
    expectedMinutes: plan.kind === 'WORKING' ? plan.expectedMinutes : null,
    workLocationId: firstIn?.workLocationId ?? null,
    flags: [...flags].sort(),
  };
}
