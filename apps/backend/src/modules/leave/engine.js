// @ts-check
/**
 * Pure leave calculations (LEV-01..03). Quantities are integer hundredths of a day ("centi"), never floats.
 * No database access: the API and the worker share these functions, and every rule is unit-tested.
 */
import { formatDays, toCenti } from '@hrms/shared/quantity';
import { addDays, daysBetween, eachDay } from '../../lib/time.js';

const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
const lastDayOfMonth = (/** @type {string} */ month) => {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
};

/**
 * Which days of a request count, and how much. Working days count fully (half on a half-day edge).
 * Weekends and holidays count only when the policy says so, or when `sandwich` is on and they fall between
 * two working days of the same request.
 * @param {{ fromDate: string, toDate: string, fromHalfDay?: boolean, toHalfDay?: boolean,
 *           dayKind: (ymd: string) => 'WORKING' | 'WEEKEND' | 'HOLIDAY', rules: any }} input
 */
export function countLeaveDays({ fromDate, toDate, fromHalfDay = false, toHalfDay = false, dayKind, rules }) {
  const kinds = eachDay(fromDate, toDate).map((date) => ({ date, kind: dayKind(date) }));
  const working = kinds.filter((k) => k.kind === 'WORKING');
  const firstWorking = working[0]?.date;
  const lastWorking = working.at(-1)?.date;
  /** @type {{ date: string, centi: number, kind: string }[]} */
  const days = [];
  for (const { date, kind } of kinds) {
    let centi = 0;
    if (kind === 'WORKING') centi = 100;
    else if ((kind === 'WEEKEND' && rules.countWeekends) || (kind === 'HOLIDAY' && rules.countHolidays))
      centi = 100;
    else if (
      rules.sandwich &&
      firstWorking &&
      date > firstWorking &&
      date < /** @type {string} */ (lastWorking)
    )
      centi = 100;
    if (centi && ((date === fromDate && fromHalfDay) || (date === toDate && toHalfDay))) centi = 50;
    if (centi) days.push({ date, centi, kind });
  }
  return { days, totalCenti: days.reduce((s, d) => s + d.centi, 0) };
}

/** The leave year containing `ymd`. @param {string} ymd @param {number} startMonth 1–12 */
export function leaveYearOf(ymd, startMonth = 1) {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const startYear = m >= startMonth ? y : y - 1;
  const start = `${startYear}-${pad(startMonth)}-01`;
  const end = /** @type {string} */ (addDays(`${startYear + 1}-${pad(startMonth)}-01`, -1));
  return { key: start.slice(0, 7), start, end };
}

/** Month `index` (1–12) share of an annual amount; the twelve shares always add up exactly. */
export const monthlyShare = (/** @type {number} */ annualCenti, /** @type {number} */ index) =>
  Math.floor((annualCenti * index) / 12) - Math.floor((annualCenti * (index - 1)) / 12);

/** Rounds down to whole or half days. @param {number} centi */
const toHalfDays = (centi) => Math.floor(centi / 50) * 50;

/**
 * Credits due for one employee in one month. Idempotency comes from the period key (UNIQUE in the ledger).
 * - MONTHLY: one twelfth on the 1st of each month for anyone employed on the 15th.
 * - ANNUAL_UPFRONT: the whole year once; joiners after the 15th of the first month get the remaining months,
 *   rounded down to half days (unless proration is off).
 * @param {{ rules: any, month: string, dateOfJoining: string, exitDate?: string | null }} input month is 'YYYY-MM'
 * @returns {{ periodKey: string, centi: number, postedOn: string, note: string }[]}
 */
export function accrualsDue({ rules, month, dateOfJoining, exitDate = null }) {
  const method = rules.accrual?.method ?? 'NONE';
  if (method === 'NONE') return [];
  const annual = toCenti(rules.accrual.daysPerYear);
  const monthStart = `${month}-01`;
  const mid = `${month}-15`;
  const monthEnd = lastDayOfMonth(month);
  if (dateOfJoining > monthEnd) return [];
  if (exitDate && exitDate < monthStart) return [];
  const year = leaveYearOf(monthStart, rules.yearStartMonth ?? 1);
  const index = ((Number(month.slice(5, 7)) - (rules.yearStartMonth ?? 1) + 12) % 12) + 1;

  if (method === 'MONTHLY') {
    if (dateOfJoining > mid || (exitDate && exitDate < mid)) return [];
    const centi = monthlyShare(annual, index);
    return centi > 0
      ? [{ periodKey: `ACC-${month}`, centi, postedOn: monthStart, note: `Monthly accrual ${month}` }]
      : [];
  }

  // ANNUAL_UPFRONT
  const firstMid = `${year.start.slice(0, 7)}-15`;
  let centi = annual;
  let postedOn = year.start;
  if (dateOfJoining > firstMid && rules.accrual.prorateForJoiners !== false) {
    const joinIndex = ((Number(dateOfJoining.slice(5, 7)) - (rules.yearStartMonth ?? 1) + 12) % 12) + 1;
    const remaining = 12 - (joinIndex - 1) - (Number(dateOfJoining.slice(8, 10)) > 15 ? 1 : 0);
    centi = toHalfDays(Math.floor((annual * remaining) / 12));
    postedOn = dateOfJoining;
  } else if (dateOfJoining > year.start) postedOn = dateOfJoining;
  return centi > 0
    ? [{ periodKey: `ACC-Y${year.key}`, centi, postedOn, note: `Annual entitlement ${year.key}` }]
    : [];
}

/** At the end of a leave year, everything above the carry-forward limit expires. @param {{ balanceCenti: number, rules: any }} input */
export function yearEndExpiry({ balanceCenti, rules }) {
  if (rules.carryForwardMaxDays === null || rules.carryForwardMaxDays === undefined) return 0;
  return Math.max(0, balanceCenti - toCenti(rules.carryForwardMaxDays));
}

/** A credit never takes the balance above the policy maximum. @param {{ centi: number, balanceCenti: number, rules: any }} input */
export function capCredit({ centi, balanceCenti, rules }) {
  if (rules.maxBalanceDays === null || rules.maxBalanceDays === undefined) return centi;
  return Math.max(0, Math.min(centi, toCenti(rules.maxBalanceDays) - balanceCenti));
}

/**
 * Checks a request against its policy. Returns field errors ({ path, message }); empty means it may be submitted.
 * Past dates are allowed (e.g. sick leave recorded afterwards); notice applies only to future leave.
 * @param {{ rules: any, leaveType: any, dateOfJoining: string, today: string, request: any,
 *           totalCenti: number, availableCenti: number, overlaps: boolean }} input
 */
export function validateRequest({
  rules,
  leaveType,
  dateOfJoining,
  today,
  request,
  totalCenti,
  availableCenti,
  overlaps,
}) {
  /** @type {{ path: string, message: string }[]} */
  const errors = [];
  const add = (/** @type {string} */ path, /** @type {string} */ message) =>
    errors.push({ path: `body.${path}`, message });
  if ((request.fromHalfDay || request.toHalfDay) && !rules.allowHalfDay)
    add('fromHalfDay', 'Half days are not allowed for this leave type');
  if (totalCenti === 0) add('fromDate', 'These dates have no working days to take as leave');
  if (request.fromDate < dateOfJoining) add('fromDate', 'Before your joining date');
  else if (daysBetween(dateOfJoining, request.fromDate) < (rules.minTenureDays ?? 0))
    add('fromDate', `Available after ${rules.minTenureDays} days of employment`);
  if (request.fromDate >= today && daysBetween(today, request.fromDate) < (rules.minNoticeDays ?? 0))
    add('fromDate', `Apply at least ${rules.minNoticeDays} days ahead`);
  if (rules.maxConsecutiveDays && totalCenti > rules.maxConsecutiveDays * 100)
    add('toDate', `At most ${rules.maxConsecutiveDays} days in one request`);
  if (leaveType.isPaid && !leaveType.allowNegative && totalCenti > availableCenti)
    add('toDate', `Not enough balance: ${formatDays(Math.max(0, availableCenti))} days available`);
  if (
    leaveType.requiresDocumentAfterDays &&
    totalCenti > leaveType.requiresDocumentAfterDays * 100 &&
    !request.documentId
  )
    add(
      'documentId',
      `Attach a supporting document for more than ${leaveType.requiresDocumentAfterDays} days`,
    );
  if (overlaps) add('fromDate', 'You already have leave on some of these dates');
  return errors;
}
