// @ts-check
/**
 * Money and rate arithmetic on decimal.js. Amounts travel as strings (DECIMAL(19,4) in MySQL) and are never
 * converted to JavaScript numbers (Phase 2: no floating-point financial calculations).
 */
import DecimalLib from 'decimal.js';

/** A private Decimal constructor so global configuration elsewhere can never change payroll results. */
export const D = DecimalLib.clone({ precision: 40, rounding: DecimalLib.ROUND_HALF_UP });

/** @typedef {import('decimal.js').Decimal} Dec */

/** @param {string | number | Dec | null | undefined} v */
export const dec = (v) =>
  new D(v === null || v === undefined || v === '' ? 0 : typeof v === 'object' ? v.toString() : v);

const MODES = {
  HALF_UP: D.ROUND_HALF_UP,
  HALF_EVEN: D.ROUND_HALF_EVEN,
  UP: D.ROUND_UP,
  DOWN: D.ROUND_DOWN,
  CEIL: D.ROUND_CEIL,
  FLOOR: D.ROUND_FLOOR,
};

/**
 * Rounds to `places` decimals. NONE keeps four places (the storage precision).
 * @param {Dec} value @param {number} places @param {keyof typeof MODES | 'NONE'} [mode]
 */
export function round(value, places, mode = 'HALF_UP') {
  if (mode === 'NONE') return value.toDecimalPlaces(4, D.ROUND_HALF_UP);
  return value.toDecimalPlaces(places, MODES[mode] ?? D.ROUND_HALF_UP);
}

/** Storage format: four decimals, e.g. '1234.5000'. @param {Dec} value */
export const toStore = (value) => value.toFixed(4);

/** Display format with the currency's minor units, e.g. '1234.50'. @param {Dec | string} value @param {number} minorUnits */
export const toMoney = (value, minorUnits) => dec(value).toFixed(minorUnits);

/** Sum of values. @param {Array<Dec | string>} values */
export const sum = (values) => values.reduce((/** @type {Dec} */ acc, v) => acc.plus(dec(v)), dec(0));

/** The smaller of two values. @param {Dec} a @param {Dec} b */
export const min = (a, b) => (a.lessThan(b) ? a : b);

/** The larger of two values. @param {Dec} a @param {Dec} b */
export const max = (a, b) => (a.greaterThan(b) ? a : b);
