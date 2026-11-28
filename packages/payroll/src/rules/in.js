// @ts-check
/**
 * India statutory rule data, FY 2025-26 (1 April 2025 – 31 March 2026), seeded into statutory_rule_versions.
 * This file is data, not logic: the India pack reads these values; a new financial year is a new version.
 * Every rate here must be confirmed by an in-country payroll expert before the pack is marked reviewed.
 *
 * Sources to verify against: EPF & MP Act 1952 / EPFO circulars; ESI Act 1948 / ESIC notifications;
 * state Professional Tax Acts (Karnataka, Maharashtra); Income-tax Act 1961 as amended by the Finance Act 2025
 * (s.115BAC new regime, s.87A rebate, s.16 standard deduction).
 */
export const IN_RULES_2025_26 = Object.freeze({
  fiscalYearStartMonth: 4,
  pf: {
    employeeRate: '0.12',
    employerRate: '0.12',
    /** Employer share that goes to the pension scheme (EPS), on wages up to the ceiling. */
    epsRate: '0.0833',
    wageCeiling: '15000',
    edliRate: '0.005',
    adminRate: '0.005',
  },
  esi: { employeeRate: '0.0075', employerRate: '0.0325', wageLimit: '21000' },
  pt: {
    /** Monthly slabs by gross salary. `from` is inclusive. February amounts make the annual total add up. */
    states: {
      KA: { name: 'Karnataka', slabs: [{ from: '25000', amount: '200', februaryAmount: '300' }] },
      MH: {
        name: 'Maharashtra',
        slabs: [
          { from: '7501', amount: '175' },
          { from: '10001', amount: '200', februaryAmount: '300' },
        ],
        /** Maharashtra exempts women earning up to ₹25,000 a month. */
        slabsForWomen: [{ from: '25001', amount: '200', februaryAmount: '300' }],
      },
    },
  },
  tds: {
    cessRate: '0.04',
    defaultRegime: 'NEW',
    regimes: {
      NEW: {
        standardDeduction: '75000',
        slabs: [
          { upTo: '400000', rate: '0' },
          { upTo: '800000', rate: '0.05' },
          { upTo: '1200000', rate: '0.10' },
          { upTo: '1600000', rate: '0.15' },
          { upTo: '2000000', rate: '0.20' },
          { upTo: '2400000', rate: '0.25' },
          { upTo: null, rate: '0.30' },
        ],
        rebate: { incomeUpTo: '1200000', maxRebate: '60000', marginalRelief: true },
        surcharge: [
          { above: '5000000', rate: '0.10' },
          { above: '10000000', rate: '0.15' },
          { above: '20000000', rate: '0.25' },
        ],
        professionalTaxDeductible: false,
        allowedDeductions: [],
      },
      OLD: {
        standardDeduction: '50000',
        slabs: [
          { upTo: '250000', rate: '0' },
          { upTo: '500000', rate: '0.05' },
          { upTo: '1000000', rate: '0.20' },
          { upTo: null, rate: '0.30' },
        ],
        rebate: { incomeUpTo: '500000', maxRebate: '12500', marginalRelief: false },
        surcharge: [
          { above: '5000000', rate: '0.10' },
          { above: '10000000', rate: '0.15' },
          { above: '20000000', rate: '0.25' },
          { above: '50000000', rate: '0.37' },
        ],
        professionalTaxDeductible: true,
        /** Section → annual cap. Only verified declarations count. */
        allowedDeductions: [
          { section: '80C', cap: '150000' },
          { section: '80D', cap: '100000' },
          { section: '80CCD1B', cap: '50000' },
          { section: '24B', cap: '200000' },
        ],
      },
    },
  },
});
