// @ts-check
/**
 * Calendar-date and time-zone helpers built on Intl (no extra dependency).
 * A "ymd" is a 'YYYY-MM-DD' string for a calendar date with no time zone. DATE columns store it as UTC midnight.
 */

/** @type {Map<string, Intl.DateTimeFormat>} */
const formatters = new Map();
/** @param {string} tz */
const formatter = (tz) => {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
};

/** @param {Date} date @param {string} tz */
function wallClock(date, tz) {
  /** @type {Record<string, number>} */
  const p = {};
  for (const part of formatter(tz).formatToParts(date))
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  return p;
}

/** True when `tz` is an IANA zone this runtime knows. @param {string} tz */
export function isValidTimeZone(tz) {
  try {
    formatter(tz);
    return true;
  } catch {
    return false;
  }
}

/** Minutes the zone is ahead of UTC at that instant (e.g. +330 for Asia/Kolkata). @param {Date} date @param {string} tz */
export function offsetMinutes(date, tz) {
  const p = wallClock(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** The calendar date in `tz` at that instant. @param {Date} date @param {string} tz @returns {string} */
export function localYmd(date, tz) {
  const p = wallClock(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * The instant at `minutes` past local midnight of `ymd` in `tz`. Minutes may exceed 1440 (next day, for night shifts).
 * In a DST gap the time moves forward by the gap; in an overlap the earlier instant wins.
 * @param {string} ymd @param {number} minutes @param {string} tz @returns {Date}
 */
export function zonedTime(ymd, minutes, tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d) + minutes * 60_000;
  // Offsets in force around the wall-clock time (a DST change, if any, falls inside this window).
  const offsets = [...new Set([-14, 0, 14].map((h) => offsetMinutes(new Date(guess + h * 3_600_000), tz)))];
  const valid = offsets
    .map((o) => guess - o * 60_000)
    .filter((t) => offsetMinutes(new Date(t), tz) === Math.round((guess - t) / 60_000));
  if (valid.length) return new Date(Math.min(...valid));
  return new Date(guess - Math.min(...offsets) * 60_000); // DST gap: move forward
}

/** @param {string} ymd @returns {Date} UTC midnight, for DATE columns */
export const ymdToDate = (ymd) => new Date(`${ymd}T00:00:00.000Z`);

/** @param {Date | null | undefined} d @returns {string | null} */
export const dateToYmd = (d) => (d ? d.toISOString().slice(0, 10) : null);

/** @param {string} ymd @param {number} days */
export const addDays = (ymd, days) => dateToYmd(new Date(ymdToDate(ymd).getTime() + days * 86_400_000));

/** Day of the week, 0 = Sunday. @param {string} ymd */
export const weekday = (ymd) => ymdToDate(ymd).getUTCDay();

/** Whole days from `a` to `b`. @param {string} a @param {string} b */
export const daysBetween = (a, b) =>
  Math.round((ymdToDate(b).getTime() - ymdToDate(a).getTime()) / 86_400_000);

/** The first day of the week containing `ymd`, for a week that starts on `weekStartDay` (0 = Sunday). */
export const weekStart = (/** @type {string} */ ymd, /** @type {number} */ weekStartDay) =>
  addDays(ymd, -((weekday(ymd) - weekStartDay + 7) % 7));

/** Every date from `from` to `to`, inclusive. @param {string} from @param {string} to */
export function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = /** @type {string} */ (addDays(d, 1))) out.push(d);
  return out;
}
