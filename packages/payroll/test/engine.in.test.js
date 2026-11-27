// Golden-file tests for the payroll engine with the India pack (FY 2025-26 rules).
// Every expected figure below was worked out by hand from the rule data; the arithmetic is in the comments.
import { calculatePay } from '../src/engine.js';
import { annualTax, component, inPack } from '../src/packs/in.js';
import { IN_RULES_2025_26 as RULES } from '../src/rules/in.js';
import { IN_STARTER_COMPONENTS } from '../src/templates.js';
import { dec } from '../src/money.js';

const INR = { code: 'INR', minorUnits: 2 };
const run = ({
  annualCtc,
  paidDays = '30',
  periodDays = '30',
  settings = { ptState: 'KA' },
  month = 4,
  remaining = 12,
  tax = {},
  gender = null,
  inputs = {},
  components = IN_STARTER_COMPONENTS,
}) =>
  calculatePay({
    currency: INR,
    annualCtc,
    paidDays,
    periodDays,
    components,
    inputs,
    pack: inPack,
    packContext: {
      rules: RULES,
      settings,
      employee: { gender },
      period: { month, monthsRemainingInYear: remaining },
      tax,
    },
  });
const lines = (out) => Object.fromEntries(out.lines.map((l) => [l.code, l.amount]));

test('₹12 lakh CTC in Bengaluru, April: PF on the ceiling, no ESI, Karnataka PT, no TDS after the rebate', () => {
  const out = run({ annualCtc: '1200000' });
  // Monthly CTC 1,00,000 → BASIC 50,000; HRA 25,000; employer PF 12% × 15,000 = 1,800; SPECIAL = 1,00,000 − 50,000 − 25,000 − 1,800.
  expect(lines(out)).toMatchObject({
    BASIC: '50000.0000',
    HRA: '25000.0000',
    PF_ER: '1800.0000',
    SPECIAL: '23200.0000',
    BONUS: '0.0000',
    PF_EE: '1800.0000',
    ESI_EE: '0.0000', // gross 98,200 > 21,000
    PT: '200.0000',
    TDS: '0.0000', // 98,200 × 12 − 75,000 = 11,03,400 ≤ 12,00,000 → s.87A rebate
  });
  expect(out.totals).toEqual({
    gross: '98200.0000',
    deductions: '2000.0000',
    employerContributions: '1800.0000',
    reimbursements: '0.0000',
    net: '96200.0000',
    employerCost: '100000.0000', // = CTC
  });
  expect(out.errors).toEqual([]);
  expect(out.lines.find((l) => l.code === 'PF_ER').trace).toMatchObject({ eps: '1250', epf: '550' }); // 8.33% × 15,000 = 1,249.5 → 1,250
});

test('₹24 lakh CTC: new-regime TDS spread over the year', () => {
  const out = run({ annualCtc: '2400000' });
  // Gross 1,98,200 × 12 = 23,78,400 − 75,000 = 23,03,400.
  // 5% × 4L + 10% × 4L + 15% × 4L + 20% × 4L + 25% × 3,03,400 = 20,000 + 40,000 + 60,000 + 80,000 + 75,850 = 2,75,850
  // + 4% cess 11,034 = 2,86,884 → ÷ 12 = 23,907.
  expect(lines(out).TDS).toBe('23907.0000');
  expect(out.totals.net).toBe('172293.0000'); // 1,98,200 − 1,800 − 200 − 23,907
  expect(out.lines.find((l) => l.code === 'TDS').trace).toMatchObject({
    regime: 'NEW',
    taxableIncome: '2303400',
    annualTax: '286884',
  });
});

test('below the ESI limit: ESI rounds up to the next rupee; no PT under ₹25,000', () => {
  const out = run({ annualCtc: '264000' });
  // Monthly 22,000 → BASIC 11,000; HRA 5,500; PF_ER 1,320; SPECIAL 4,180; gross 20,680.
  // ESI 0.75% = 155.10 → 156; employer 3.25% = 672.10 → 673.
  expect(lines(out)).toMatchObject({
    PF_EE: '1320.0000',
    ESI_EE: '156.0000',
    ESI_ER: '673.0000',
    PT: '0.0000',
    TDS: '0.0000',
  });
  expect(out.totals).toMatchObject({ net: '19204.0000', employerCost: '22673.0000' });
});

test('loss of pay: earnings prorated by paid days; PF on the prorated basic', () => {
  const out = run({
    annualCtc: '360000',
    paidDays: '28',
    periodDays: '30',
    month: 11,
    remaining: 5,
    tax: { ytdTaxable: '210000' },
  });
  // Full month: BASIC 15,000; HRA 7,500; PF_ER 1,800; SPECIAL 5,700. × 28/30 → BASIC 14,000; HRA 7,000; SPECIAL 5,320.
  // PF on 14,000 = 1,680. Gross 26,320 → PT 200. TDS: 2,10,000 + 26,320 × 5 − 75,000 = 2,66,600 → nil.
  expect(lines(out)).toMatchObject({
    BASIC: '14000.0000',
    HRA: '7000.0000',
    SPECIAL: '5320.0000',
    PF_EE: '1680.0000',
    PF_ER: '1680.0000',
    PT: '200.0000',
    TDS: '0.0000',
  });
  expect(out.totals.net).toBe('24440.0000');
  expect(out.lines.find((l) => l.code === 'BASIC').trace).toMatchObject({
    fullMonth: '15000.0000',
    factor: '28/30',
  });
});

test('February Professional Tax makes the Karnataka year add up to ₹2,500', () => {
  expect(lines(run({ annualCtc: '1200000', month: 2, remaining: 2 })).PT).toBe('300.0000');
});

test('Maharashtra slabs, including the exemption for women up to ₹25,000', () => {
  const ctx = (gross, gender) => ({
    rules: RULES,
    settings: { ptState: 'MH' },
    values: {},
    lines: [{ kind: 'EARNING', amount: dec(gross) }],
    employee: { gender },
    period: { month: 6, monthsRemainingInYear: 10 },
    tax: {},
    mode: 'actual',
  });
  expect(component('IN.PT', ctx('7000', 'male')).amount.toString()).toBe('0');
  expect(component('IN.PT', ctx('9000', 'male')).amount.toString()).toBe('175');
  expect(component('IN.PT', ctx('20000', 'male')).amount.toString()).toBe('200');
  expect(component('IN.PT', ctx('20000', 'Female')).amount.toString()).toBe('0');
  expect(component('IN.PT', ctx('30000', 'F')).amount.toString()).toBe('200');
});

test('settings: PF on actual wages, PF and ESI switched off, no PT state', () => {
  const actual = lines(run({ annualCtc: '1200000', settings: { pfOnActualWages: true } }));
  expect(actual.PF_EE).toBe('6000.0000'); // 12% × 50,000
  const off = lines(run({ annualCtc: '264000', settings: { pfEnabled: false, esiEnabled: false } }));
  expect([off.PF_EE, off.PF_ER, off.ESI_EE, off.PT]).toEqual(['0.0000', '0.0000', '0.0000', '0.0000']);
});

test('old regime: standard deduction, Professional Tax and capped 80C', () => {
  const out = run({
    annualCtc: '1200000',
    components: IN_STARTER_COMPONENTS.map((c) =>
      c.code === 'SPECIAL'
        ? { ...c, formula: 'CTC_MONTHLY - BASIC - HRA' }
        : c.code === 'PF_ER'
          ? { ...c, kind: 'INFORMATIONAL' }
          : c,
    ),
    tax: { regime: 'OLD', deductions: { '80C': '200000' } },
  });
  // Gross 1,00,000 × 12 = 12,00,000 − 50,000 − PT 200 × 12 − 80C 1,50,000 (capped) = 9,97,600.
  // 5% × 2.5L + 20% × 4,97,600 = 12,500 + 99,520 = 1,12,020 + 4% cess 4,480.80 = 1,16,500.80 → 1,16,501 ÷ 12 = 9,708.42 → 9,708.
  expect(lines(out).TDS).toBe('9708.0000');
});

test('rebate with marginal relief, and surcharge', () => {
  const NEW = RULES.tds.regimes.NEW;
  expect(annualTax(dec('1200000'), NEW, '0.04').total.toString()).toBe('0');
  // 12,10,000: slab tax 61,500, but tax may not exceed the income above 12L (10,000) → 10,000 + 4% = 10,400.
  expect(annualTax(dec('1210000'), NEW, '0.04').total.toString()).toBe('10400');
  // 60L: 3,00,000 up to 24L + 30% × 36L = 13,80,000; surcharge 10% = 1,38,000; cess 4% of 15,18,000 = 60,720 → 15,78,720.
  expect(annualTax(dec('6000000'), NEW, '0.04').total.toString()).toBe('1578720');
  // Taxable income is rounded to the nearest ₹10 (s.288A).
  expect(annualTax(dec('1300004'), NEW, '0.04').trace.taxableIncome).toBe('1300000');
});

test('TDS already deducted this year is taken off the remaining months', () => {
  const out = run({
    annualCtc: '2400000',
    month: 10,
    remaining: 6,
    tax: { ytdTaxable: '1189200', ytdTds: '143442' },
  });
  // Projected: 11,89,200 + 1,98,200 × 6 = 23,78,400 → same annual tax 2,86,884; remaining 1,43,442 ÷ 6 = 23,907.
  expect(lines(out).TDS).toBe('23907.0000');
});

test('inputs, reimbursements and errors', () => {
  const out = run({ annualCtc: '1200000', inputs: { BONUS: '10000', REIMB: '2500' } });
  expect(out.totals).toMatchObject({ gross: '108200.0000', reimbursements: '2500.0000' });
  expect(lines(out).REIMB).toBe('2500.0000');
  // A structure whose fixed parts exceed the CTC is flagged, not silently paid.
  const bad = run({
    annualCtc: '120000',
    components: IN_STARTER_COMPONENTS.map((c) =>
      c.code === 'SPECIAL' ? { ...c, formula: 'CTC_MONTHLY - BASIC - HRA - PF_ER - 8000' } : c,
    ),
  });
  expect(bad.errors.map((e) => e.code)).toContain('SPECIAL');
  const unknown = run({
    annualCtc: '1200000',
    components: [
      { code: 'X', name: 'X', kind: 'EARNING', calcType: 'FORMULA', formula: 'NOPE * 2', sequence: 1 },
    ],
  });
  expect(unknown.errors).toEqual([{ code: 'X', message: 'Unknown name NOPE' }]);
});
