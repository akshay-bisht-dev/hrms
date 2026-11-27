// @ts-check
/**
 * Leave quantities are DECIMAL(8,2) days. They are handled as integer hundredths ("centi-days") so no
 * calculation ever goes through floating point (Phase 2: no floating-point arithmetic on balances or money).
 */

const PATTERN = /^(-)?(\d{1,6})(?:\.(\d{1,2}))?$/;

/** '1.5' | '-0.25' | 2 → hundredths. Throws on anything else. @param {string | number | { toString(): string }} value */
export function toCenti(value) {
  const s = typeof value === 'number' ? String(value) : String(value);
  const m = PATTERN.exec(s.trim());
  if (!m) throw new Error(`Not a quantity: ${s}`);
  const n = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -n : n;
}

/** hundredths → '1.50' (always two decimals, the DB format). @param {number} centi */
export function fromCenti(centi) {
  if (!Number.isInteger(centi)) throw new Error(`Not an integer quantity: ${centi}`);
  const sign = centi < 0 ? '-' : '';
  const abs = Math.abs(centi);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** hundredths → short display: 150 → '1.5', 200 → '2', 25 → '0.25'. @param {number} centi */
export function formatDays(centi) {
  return fromCenti(centi).replace(/\.?0+$/, '') || '0';
}
