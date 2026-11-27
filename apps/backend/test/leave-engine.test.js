import { formatDays, fromCenti, toCenti } from '@hrms/shared/quantity';
import { LeavePolicyRules } from '@hrms/shared/schemas/leave';
import {
  accrualsDue,
  capCredit,
  countLeaveDays,
  leaveYearOf,
  monthlyShare,
  validateRequest,
  yearEndExpiry,
} from '../src/modules/leave/engine.js';
import { weekday } from '../src/lib/time.js';

const rules = (over = {}) => LeavePolicyRules.parse({ accrual: { method: 'NONE' }, ...over });
// Mon–Fri working, Sat/Sun weekend, 2026-12-25 (Fri) a holiday.
const kind = (d) => (d === '2026-12-25' ? 'HOLIDAY' : [0, 6].includes(weekday(d)) ? 'WEEKEND' : 'WORKING');
const count = (from, to, r = rules(), extra = {}) =>
  countLeaveDays({ fromDate: from, toDate: to, dayKind: kind, rules: r, ...extra });

describe('quantities never use floating point', () => {
  test('parse and format', () => {
    expect(toCenti('1.5')).toBe(150);
    expect(toCenti('-0.25')).toBe(-25);
    expect(toCenti('18')).toBe(1800);
    expect(toCenti({ toString: () => '2.50' })).toBe(250); // Prisma Decimal
    expect(fromCenti(-150)).toBe('-1.50');
    expect(formatDays(150)).toBe('1.5');
    expect(formatDays(1000)).toBe('10');
    expect(formatDays(0)).toBe('0');
    expect(() => toCenti('1.234')).toThrow();
    expect(() => toCenti('abc')).toThrow();
  });
  test('0.1 + 0.2 style errors cannot happen', () => {
    expect(fromCenti(toCenti('0.1') + toCenti('0.2'))).toBe('0.30');
  });
});

describe('day counting', () => {
  test('a working week; weekends excluded by default', () => {
    expect(count('2026-11-23', '2026-11-29').totalCenti).toBe(500);
  });
  test('half days at either edge, and a single half day', () => {
    expect(
      count('2026-11-23', '2026-11-25', rules(), { fromHalfDay: true, toHalfDay: true }).totalCenti,
    ).toBe(200);
    expect(count('2026-11-24', '2026-11-24', rules(), { fromHalfDay: true }).totalCenti).toBe(50);
    expect(
      count('2026-11-24', '2026-11-24', rules(), { fromHalfDay: true, toHalfDay: true }).totalCenti,
    ).toBe(50);
  });
  test('holidays are skipped unless the policy counts them', () => {
    expect(count('2026-12-24', '2026-12-28').totalCenti).toBe(200); // Thu, [Fri holiday], [weekend], Mon
    expect(count('2026-12-24', '2026-12-28', rules({ countHolidays: true })).totalCenti).toBe(300);
    expect(count('2026-12-24', '2026-12-28', rules({ countWeekends: true })).totalCenti).toBe(400);
  });
  test('sandwich rule counts rest days between two leave days, not at the edges', () => {
    const r = rules({ sandwich: true });
    expect(count('2026-11-27', '2026-11-30', r).totalCenti).toBe(400); // Fri, Sat, Sun, Mon
    expect(count('2026-11-28', '2026-11-30', r).totalCenti).toBe(100); // Sat, Sun at the start: not sandwiched
    expect(count('2026-11-27', '2026-11-30', r).days.map((d) => d.kind)).toEqual([
      'WORKING',
      'WEEKEND',
      'WEEKEND',
      'WORKING',
    ]);
  });
  test('a request made only of rest days is worth nothing', () => {
    expect(count('2026-11-28', '2026-11-29').totalCenti).toBe(0);
  });
});

describe('leave years and accruals', () => {
  test('leave year boundaries, including an April–March year', () => {
    expect(leaveYearOf('2026-11-25')).toEqual({ key: '2026-01', start: '2026-01-01', end: '2026-12-31' });
    expect(leaveYearOf('2027-02-10', 4)).toEqual({ key: '2026-04', start: '2026-04-01', end: '2027-03-31' });
  });
  test('monthly shares of 20 days add up to exactly 20', () => {
    const shares = Array.from({ length: 12 }, (_, i) => monthlyShare(2000, i + 1));
    expect(shares.reduce((a, b) => a + b, 0)).toBe(2000);
    expect(shares.slice(0, 3)).toEqual([166, 167, 167]);
  });
  const monthly = rules({ accrual: { method: 'MONTHLY', daysPerYear: '18' } });
  test('monthly accrual for anyone employed on the 15th', () => {
    expect(accrualsDue({ rules: monthly, month: '2026-11', dateOfJoining: '2025-01-01' })).toEqual([
      { periodKey: 'ACC-2026-11', centi: 150, postedOn: '2026-11-01', note: 'Monthly accrual 2026-11' },
    ]);
    expect(accrualsDue({ rules: monthly, month: '2026-11', dateOfJoining: '2026-11-15' })).toHaveLength(1);
    expect(accrualsDue({ rules: monthly, month: '2026-11', dateOfJoining: '2026-11-16' })).toEqual([]);
    expect(
      accrualsDue({ rules: monthly, month: '2026-11', dateOfJoining: '2025-01-01', exitDate: '2026-11-10' }),
    ).toEqual([]);
  });
  const upfront = rules({ accrual: { method: 'ANNUAL_UPFRONT', daysPerYear: '12' } });
  test('annual upfront: full year for existing staff, prorated to half days for joiners', () => {
    expect(accrualsDue({ rules: upfront, month: '2026-11', dateOfJoining: '2024-03-01' })).toEqual([
      { periodKey: 'ACC-Y2026-01', centi: 1200, postedOn: '2026-01-01', note: 'Annual entitlement 2026-01' },
    ]);
    // Joined 20 Jul: Aug–Dec remain = 5 months → 5 days.
    expect(accrualsDue({ rules: upfront, month: '2026-07', dateOfJoining: '2026-07-20' })[0]).toMatchObject({
      centi: 500,
      postedOn: '2026-07-20',
    });
    // Joined 10 Jul (by the 15th): Jul–Dec = 6 months → 6 days. 10 days a year, joined 1 Feb: 11/12 × 10 = 9.17 → 9 (half days, rounded down).
    expect(accrualsDue({ rules: upfront, month: '2026-07', dateOfJoining: '2026-07-10' })[0].centi).toBe(600);
    const ten = rules({ accrual: { method: 'ANNUAL_UPFRONT', daysPerYear: '10' } });
    expect(accrualsDue({ rules: ten, month: '2026-02', dateOfJoining: '2026-02-01' })[0].centi).toBe(900);
    expect(
      accrualsDue({
        rules: rules({ accrual: { method: 'ANNUAL_UPFRONT', daysPerYear: '12', prorateForJoiners: false } }),
        month: '2026-07',
        dateOfJoining: '2026-07-20',
      })[0].centi,
    ).toBe(1200);
    expect(accrualsDue({ rules: upfront, month: '2026-06', dateOfJoining: '2026-07-20' })).toEqual([]);
  });
  test('NONE never accrues', () => {
    expect(accrualsDue({ rules: rules(), month: '2026-11', dateOfJoining: '2020-01-01' })).toEqual([]);
  });
  test('carry forward and balance caps', () => {
    expect(yearEndExpiry({ balanceCenti: 800, rules: rules({ carryForwardMaxDays: '5' }) })).toBe(300);
    expect(yearEndExpiry({ balanceCenti: 400, rules: rules({ carryForwardMaxDays: '5' }) })).toBe(0);
    expect(yearEndExpiry({ balanceCenti: 800, rules: rules({ carryForwardMaxDays: '0' }) })).toBe(800);
    expect(yearEndExpiry({ balanceCenti: 800, rules: rules() })).toBe(0); // no limit
    expect(capCredit({ centi: 200, balanceCenti: 2900, rules: rules({ maxBalanceDays: '30' }) })).toBe(100);
    expect(capCredit({ centi: 200, balanceCenti: 3100, rules: rules({ maxBalanceDays: '30' }) })).toBe(0);
  });
});

describe('request validation', () => {
  const base = {
    rules: rules({ minNoticeDays: 3, maxConsecutiveDays: 10, minTenureDays: 90 }),
    leaveType: { isPaid: true, allowNegative: false, requiresDocumentAfterDays: 2 },
    dateOfJoining: '2026-01-05',
    today: '2026-11-25',
    request: { fromDate: '2026-12-01', toDate: '2026-12-02' },
    totalCenti: 200,
    availableCenti: 500,
    overlaps: false,
  };
  const paths = (over) => validateRequest({ ...base, ...over }).map((e) => e.path);
  test('a normal request passes', () => expect(paths({})).toEqual([]));
  test('balance, notice, tenure, length, overlap, documents, half days', () => {
    expect(validateRequest({ ...base, availableCenti: 150 })[0].message).toBe(
      'Not enough balance: 1.5 days available',
    );
    expect(paths({ request: { fromDate: '2026-11-26', toDate: '2026-11-26' }, totalCenti: 100 })).toEqual([
      'body.fromDate',
    ]);
    expect(paths({ request: { fromDate: '2026-11-20', toDate: '2026-11-20' }, totalCenti: 100 })).toEqual([]); // past: no notice
    expect(paths({ dateOfJoining: '2026-11-01' })).toEqual(['body.fromDate']);
    expect(paths({ totalCenti: 1100, availableCenti: 2000 })).toContain('body.toDate');
    expect(paths({ overlaps: true })).toEqual(['body.fromDate']);
    expect(paths({ totalCenti: 300 })).toEqual(['body.documentId']);
    expect(paths({ totalCenti: 300, request: { ...base.request, documentId: 'd' } })).toEqual([]);
    expect(
      paths({ rules: rules({ allowHalfDay: false }), request: { ...base.request, toHalfDay: true } }),
    ).toEqual(['body.fromHalfDay']);
    expect(paths({ totalCenti: 0 })).toEqual(['body.fromDate']);
  });
  test('unpaid or negative-allowed types skip the balance check', () => {
    expect(paths({ availableCenti: 0, leaveType: { isPaid: false } })).toEqual([]);
    expect(paths({ availableCenti: 0, leaveType: { isPaid: true, allowNegative: true } })).toEqual([]);
  });
});
