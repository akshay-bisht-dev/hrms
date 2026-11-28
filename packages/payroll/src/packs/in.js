// @ts-check
/**
 * India country pack. Pure functions: every rate, ceiling and slab comes from the rule version passed in
 * (see ../rules/in.js); this file only says how to apply them. Rounding follows common practice: PF and PT to
 * the nearest rupee, ESI up to the next rupee, TDS to the nearest rupee, taxable income to the nearest ₹10 (s.288A).
 *
 * Status: implemented and golden-tested; must be reviewed by an Indian payroll expert before being sold as compliant.
 */
import { D, dec, max, min, sum } from '../money.js';

/** @typedef {import('decimal.js').Decimal} Dec */

export const IN_PACK_VERSION = '1.0.0';

/** Per legal entity choices (tenant_statutory_settings.overrides). */
export const IN_DEFAULT_SETTINGS = Object.freeze({
  pfEnabled: true,
  /** Components whose total is the PF wage (usually basic + DA). */
  pfWageCodes: ['BASIC'],
  /** false = contribute on wages up to the ceiling (statutory minimum); true = on actual wages. */
  pfOnActualWages: false,
  esiEnabled: true,
  /** State whose Professional Tax applies (null = none, e.g. a state without PT). */
  ptState: /** @type {string | null} */ (null),
});

export const IN_STATUTORY_KEYS = Object.freeze({
  'IN.PF.EE': 'Provident Fund (employee)',
  'IN.PF.ER': 'Provident Fund (employer)',
  'IN.PF.CHARGES': 'EDLI and PF admin charges (employer)',
  'IN.ESI.EE': 'ESI (employee)',
  'IN.ESI.ER': 'ESI (employer)',
  'IN.PT': 'Professional Tax',
  'IN.TDS': 'Income tax (TDS)',
});

const rupee = (/** @type {Dec} */ v) => v.toDecimalPlaces(0, D.ROUND_HALF_UP);
const rupeeUp = (/** @type {Dec} */ v) => v.toDecimalPlaces(0, D.ROUND_CEIL);
const isWoman = (/** @type {string | null | undefined} */ g) =>
  /^(f|female|woman)$/i.test(String(g ?? '').trim());

/**
 * Income tax for a year from slabs, rebate (s.87A), surcharge and cess. Taxable income is rounded to ₹10.
 * @param {Dec} income @param {any} regime @param {string} cessRate
 */
export function annualTax(income, regime, cessRate) {
  const taxable = max(dec(0), income).dividedBy(10).toDecimalPlaces(0, D.ROUND_HALF_UP).times(10);
  let tax = dec(0);
  let lower = dec(0);
  const bands = [];
  for (const slab of regime.slabs) {
    const upper = slab.upTo === null ? null : dec(slab.upTo);
    if (taxable.lessThanOrEqualTo(lower)) break;
    const top = upper === null ? taxable : min(taxable, upper);
    const part = top.minus(lower).times(slab.rate);
    if (!part.isZero())
      bands.push({ from: lower.toFixed(0), to: top.toFixed(0), rate: slab.rate, tax: part.toFixed(2) });
    tax = tax.plus(part);
    if (upper === null) break;
    lower = upper;
  }
  const slabTax = tax;
  let rebate = dec(0);
  const limit = dec(regime.rebate.incomeUpTo);
  if (taxable.lessThanOrEqualTo(limit)) rebate = min(tax, dec(regime.rebate.maxRebate));
  else if (regime.rebate.marginalRelief && tax.greaterThan(taxable.minus(limit)))
    rebate = tax.minus(taxable.minus(limit));
  tax = tax.minus(rebate);
  const band = [...regime.surcharge].reverse().find((/** @type {any} */ s) => taxable.greaterThan(s.above));
  const surcharge = band ? tax.times(band.rate) : dec(0);
  const cess = tax.plus(surcharge).times(cessRate);
  const total = rupee(tax.plus(surcharge).plus(cess));
  return {
    taxableIncome: taxable,
    total,
    trace: {
      taxableIncome: taxable.toFixed(0),
      bands,
      slabTax: slabTax.toFixed(2),
      rebate: rebate.toFixed(2),
      surcharge: surcharge.toFixed(2),
      cess: cess.toFixed(2),
      annualTax: total.toFixed(0),
    },
  };
}

/**
 * One statutory amount for the India pack.
 * @param {string} key one of IN_STATUTORY_KEYS
 * @param {{ rules: any, settings: any, values: Record<string, Dec>, lines: any[], employee: { gender?: string | null },
 *           period: { month: number, monthsRemainingInYear: number },
 *           tax: { regime?: string, deductions?: Record<string, string>, ytdTaxable?: string, ytdTds?: string, ytdPt?: string },
 *           mode: 'full' | 'actual' }} ctx
 * @returns {{ amount: Dec, trace: object }}
 */
export function component(key, ctx) {
  const { rules, values } = ctx;
  const settings = { ...IN_DEFAULT_SETTINGS, ...(ctx.settings ?? {}) };
  const earnings = (/** @type {(l: any) => boolean} */ pick = () => true) =>
    sum(ctx.lines.filter((l) => l.kind === 'EARNING' && pick(l)).map((l) => l.amount));

  if (key.startsWith('IN.PF.')) {
    if (!settings.pfEnabled)
      return { amount: dec(0), trace: { reason: 'PF is turned off for this legal entity' } };
    const wages = sum(settings.pfWageCodes.map((/** @type {string} */ c) => values[c] ?? dec(0)));
    const ceiling = dec(rules.pf.wageCeiling);
    const capped = min(wages, ceiling);
    const base = settings.pfOnActualWages ? wages : capped;
    if (key === 'IN.PF.EE') {
      const amount = rupee(base.times(rules.pf.employeeRate));
      return {
        amount,
        trace: { pfWages: wages.toFixed(2), contributoryWages: base.toFixed(2), rate: rules.pf.employeeRate },
      };
    }
    if (key === 'IN.PF.ER') {
      const amount = rupee(base.times(rules.pf.employerRate));
      const eps = min(amount, rupee(capped.times(rules.pf.epsRate)));
      return {
        amount,
        trace: {
          pfWages: wages.toFixed(2),
          contributoryWages: base.toFixed(2),
          rate: rules.pf.employerRate,
          eps: eps.toFixed(0),
          epf: amount.minus(eps).toFixed(0),
        },
      };
    }
    if (key === 'IN.PF.CHARGES') {
      const edli = capped.times(rules.pf.edliRate);
      const admin = base.times(rules.pf.adminRate);
      return { amount: rupee(edli.plus(admin)), trace: { edli: edli.toFixed(2), admin: admin.toFixed(2) } };
    }
  }

  if (key.startsWith('IN.ESI.')) {
    if (!settings.esiEnabled)
      return { amount: dec(0), trace: { reason: 'ESI is turned off for this legal entity' } };
    const gross = earnings();
    if (gross.greaterThan(rules.esi.wageLimit))
      return {
        amount: dec(0),
        trace: { gross: gross.toFixed(2), reason: `Gross above the ESI limit of ${rules.esi.wageLimit}` },
      };
    const rate = key === 'IN.ESI.EE' ? rules.esi.employeeRate : rules.esi.employerRate;
    return { amount: rupeeUp(gross.times(rate)), trace: { gross: gross.toFixed(2), rate } };
  }

  if (key === 'IN.PT') {
    const state = settings.ptState ? rules.pt.states[settings.ptState] : null;
    if (!state)
      return { amount: dec(0), trace: { reason: 'No Professional Tax state set for this legal entity' } };
    const gross = earnings();
    const slabs = isWoman(ctx.employee?.gender) && state.slabsForWomen ? state.slabsForWomen : state.slabs;
    const slab = [...slabs].reverse().find((/** @type {any} */ s) => gross.greaterThanOrEqualTo(s.from));
    if (!slab)
      return {
        amount: dec(0),
        trace: { gross: gross.toFixed(2), state: settings.ptState, reason: 'Below the first slab' },
      };
    const amount = dec(ctx.period.month === 2 && slab.februaryAmount ? slab.februaryAmount : slab.amount);
    return { amount, trace: { gross: gross.toFixed(2), state: settings.ptState, slabFrom: slab.from } };
  }

  if (key === 'IN.TDS') {
    if (ctx.mode === 'full') return { amount: dec(0), trace: { reason: 'Not part of CTC' } };
    const regimeKey =
      ctx.tax?.regime && rules.tds.regimes[ctx.tax.regime] ? ctx.tax.regime : rules.tds.defaultRegime;
    const regime = rules.tds.regimes[regimeKey];
    const remaining = Math.max(1, ctx.period.monthsRemainingInYear);
    const taxableNow = earnings((l) => l.taxable !== false);
    const projectedGross = dec(ctx.tax?.ytdTaxable).plus(taxableNow.times(remaining));
    const ptNow = sum(ctx.lines.filter((l) => l.statutoryKey === 'IN.PT').map((l) => l.amount));
    const deductions = [];
    deductions.push({
      name: 'Standard deduction',
      amount: min(projectedGross, dec(regime.standardDeduction)),
    });
    if (regime.professionalTaxDeductible)
      deductions.push({ name: 'Professional Tax', amount: dec(ctx.tax?.ytdPt).plus(ptNow.times(remaining)) });
    for (const d of regime.allowedDeductions) {
      const declared = dec(ctx.tax?.deductions?.[d.section]);
      if (declared.greaterThan(0)) deductions.push({ name: d.section, amount: min(declared, dec(d.cap)) });
    }
    const income = projectedGross.minus(sum(deductions.map((d) => d.amount)));
    const yearly = annualTax(income, regime, rules.tds.cessRate);
    const due = max(dec(0), yearly.total.minus(dec(ctx.tax?.ytdTds)));
    const amount = rupee(due.dividedBy(remaining));
    return {
      amount,
      trace: {
        regime: regimeKey,
        projectedTaxableGross: projectedGross.toFixed(2),
        monthsRemaining: remaining,
        deductions: deductions.map((d) => ({ name: d.name, amount: d.amount.toFixed(2) })),
        ...yearly.trace,
        alreadyDeducted: dec(ctx.tax?.ytdTds).toFixed(2),
      },
    };
  }

  throw new Error(`Unknown India statutory key ${key}`);
}

export const inPack = Object.freeze({
  code: 'IN',
  version: IN_PACK_VERSION,
  keys: IN_STATUTORY_KEYS,
  defaultSettings: IN_DEFAULT_SETTINGS,
  component,
});
