// @ts-check
/**
 * Country-neutral payroll calculation for one employee and one period (PAY-01, Phase 1 06 §4).
 *
 * Two passes over the structure's components, in sequence order:
 *  1. "full": the month as if fully worked. Formulas such as a balancing special allowance
 *     (CTC_MONTHLY - BASIC - HRA - PF_ER) are worked out here.
 *  2. "actual": earnings from pass 1 are prorated by paid days / period days; deductions, statutory amounts
 *     and inputs are calculated on the actual figures. Statutory components use the earnings listed above them.
 * Every line carries a calculation trace. Rounding is per component, to the currency's minor units.
 */
import { evaluate, FormulaError } from './formula.js';
import { dec, round, sum, toStore } from './money.js';

export const ENGINE_VERSION = '1.0.0';
const PRORATED_KINDS = new Set(['EARNING']);
const PRORATED_TYPES = new Set(['FIXED', 'PERCENTAGE', 'FORMULA']);

/**
 * @typedef {{ id?: string, code: string, name: string, kind: string, calcType: string, formula?: string | null,
 *             percentOf?: string | null, rate?: string | null, fixedAmount?: string | null, taxable?: boolean,
 *             roundingRule?: string, statutoryKey?: string | null, sequence: number }} Component
 */

/**
 * @param {object} input
 * @param {{ code: string, minorUnits: number }} input.currency
 * @param {string} input.annualCtc
 * @param {string} input.paidDays
 * @param {string} input.periodDays
 * @param {Component[]} input.components
 * @param {Record<string, string>} [input.inputs] amounts for INPUT components, by code
 * @param {{ component: (key: string, ctx: any) => { amount: any, trace: object } } | null} [input.pack]
 * @param {object} [input.packContext] rules, settings, employee, period, tax: passed to the pack
 */
export function calculatePay({
  currency,
  annualCtc,
  paidDays,
  periodDays,
  components,
  inputs = {},
  pack = null,
  packContext = {},
}) {
  const ordered = [...components].sort((a, b) => a.sequence - b.sequence);
  const errors = /** @type {{ code: string | null, message: string }[]} */ ([]);
  const ctcAnnual = dec(annualCtc);
  const days = dec(periodDays);
  const paid = dec(paidDays);
  if (days.lessThanOrEqualTo(0)) throw new Error('periodDays must be positive');
  const factor = paid.greaterThan(days) ? dec(1) : paid.dividedBy(days);
  const base = {
    CTC_ANNUAL: ctcAnnual,
    CTC_MONTHLY: ctcAnnual.dividedBy(12),
    PAID_DAYS: paid,
    PERIOD_DAYS: days,
    LOP_DAYS: days.minus(paid),
  };

  /** @type {Record<string, import('decimal.js').Decimal>} */
  let full = {};
  /** @type {any[]} */
  let lines = [];
  for (const pass of /** @type {const} */ (['full', 'actual'])) {
    /** @type {Record<string, import('decimal.js').Decimal>} */
    const values = { ...base };
    lines = [];
    for (const c of ordered) {
      let amount = dec(0);
      /** @type {any} */
      let trace = { calcType: c.calcType };
      try {
        if (pass === 'actual' && PRORATED_KINDS.has(c.kind) && PRORATED_TYPES.has(c.calcType)) {
          amount = full[c.code].times(factor);
          trace = {
            ...trace,
            fullMonth: toStore(full[c.code]),
            factor: `${paid.toString()}/${days.toString()}`,
          };
        } else if (c.calcType === 'FIXED') {
          amount = dec(c.fixedAmount);
        } else if (c.calcType === 'PERCENTAGE') {
          const ref = c.percentOf === 'CTC' ? 'CTC_MONTHLY' : String(c.percentOf);
          if (!(ref in values))
            throw new FormulaError(
              `${c.code} is a percentage of ${c.percentOf}, which comes later or does not exist`,
            );
          amount = values[ref].times(dec(c.rate));
          trace = { ...trace, of: ref, base: toStore(values[ref]), rate: String(c.rate) };
        } else if (c.calcType === 'FORMULA') {
          amount = evaluate(String(c.formula), values);
          trace = { ...trace, formula: c.formula };
        } else if (c.calcType === 'INPUT') {
          amount = dec(inputs[c.code]);
          trace = { ...trace, source: 'payroll input' };
        } else if (c.calcType === 'STATUTORY') {
          if (!pack)
            throw new FormulaError(`${c.code} needs a statutory pack, and this legal entity has none`);
          const out = pack.component(String(c.statutoryKey), { ...packContext, values, lines, mode: pass });
          amount = dec(out.amount);
          trace = { ...trace, key: c.statutoryKey, ...out.trace };
        }
      } catch (err) {
        if (!(err instanceof FormulaError)) throw err;
        // Keep errors from both passes: a prorated earning is never re-evaluated in the actual pass.
        if (!errors.some((e) => e.code === c.code && e.message === err.message))
          errors.push({ code: c.code, message: err.message });
        amount = dec(0);
      }
      amount = round(amount, currency.minorUnits, /** @type {any} */ (c.roundingRule ?? 'HALF_UP'));
      values[c.code] = amount;
      lines.push({
        componentId: c.id ?? null,
        code: c.code,
        label: c.name,
        kind: c.kind,
        taxable: c.taxable !== false,
        statutoryKey: c.statutoryKey ?? null,
        sequence: c.sequence,
        amount,
        trace,
      });
    }
    if (pass === 'full') full = values;
  }

  for (const l of lines)
    if (l.amount.isNegative() && l.kind === 'EARNING')
      errors.push({
        code: l.code,
        message: `${l.label} came out negative: the fixed parts of the structure are more than the CTC`,
      });

  const by = (/** @type {string} */ kind) => sum(lines.filter((l) => l.kind === kind).map((l) => l.amount));
  const gross = by('EARNING');
  const deductions = by('DEDUCTION');
  const employer = by('EMPLOYER_CONTRIBUTION');
  const reimbursements = by('REIMBURSEMENT');
  const net = gross.plus(reimbursements).minus(deductions);
  if (net.isNegative())
    errors.push({ code: null, message: 'Deductions are more than the pay for this period' });
  return {
    engineVersion: ENGINE_VERSION,
    lines: lines.map((l) => ({ ...l, amount: toStore(l.amount) })),
    totals: {
      gross: toStore(gross),
      deductions: toStore(deductions),
      employerContributions: toStore(employer),
      reimbursements: toStore(reimbursements),
      net: toStore(net),
      employerCost: toStore(gross.plus(employer).plus(reimbursements)),
    },
    errors,
  };
}
