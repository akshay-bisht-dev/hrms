import { addDays, eachDay, localYmd, offsetMinutes, weekStart, weekday, zonedTime } from '../src/lib/time.js';
import {
  DEFAULT_POLICY,
  closesAt,
  computeDay,
  effectivePunches,
  pairPunches,
  resolvePlan,
} from '../src/modules/attendance/engine.js';

const iso = (d) => d.toISOString();

describe('time helpers', () => {
  test('offsets follow the zone and its daylight-saving rules', () => {
    expect(offsetMinutes(new Date('2026-11-25T12:00:00Z'), 'Asia/Kolkata')).toBe(330);
    expect(offsetMinutes(new Date('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(-300);
    expect(offsetMinutes(new Date('2026-07-15T12:00:00Z'), 'America/New_York')).toBe(-240);
    expect(offsetMinutes(new Date('2026-07-15T12:00:00Z'), 'Asia/Kathmandu')).toBe(345);
  });

  test('local calendar date differs from the UTC date near midnight', () => {
    expect(localYmd(new Date('2026-03-01T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-03-02');
    expect(localYmd(new Date('2026-03-02T03:00:00Z'), 'America/Los_Angeles')).toBe('2026-03-01');
  });

  test('zonedTime turns local wall-clock minutes into an instant, including the next day', () => {
    expect(iso(zonedTime('2026-11-25', 540, 'Asia/Kolkata'))).toBe('2026-11-25T03:30:00.000Z');
    expect(iso(zonedTime('2026-11-25', 1440 + 120, 'Asia/Kolkata'))).toBe('2026-11-25T20:30:00.000Z');
    expect(iso(zonedTime('2026-11-25', 0, 'UTC'))).toBe('2026-11-25T00:00:00.000Z');
  });

  test('DST gaps move forward and overlaps take the earlier instant, on both sides of UTC', () => {
    // New York springs forward at 02:00 on 2026-03-08; 02:30 does not exist → 03:30 EDT.
    expect(iso(zonedTime('2026-03-08', 150, 'America/New_York'))).toBe('2026-03-08T07:30:00.000Z');
    // New York falls back at 02:00 on 2026-11-01; 01:30 happens twice → the first (EDT).
    expect(iso(zonedTime('2026-11-01', 90, 'America/New_York'))).toBe('2026-11-01T05:30:00.000Z');
    // Berlin springs forward 2026-03-29 and falls back 2026-10-25.
    expect(iso(zonedTime('2026-03-29', 150, 'Europe/Berlin'))).toBe('2026-03-29T01:30:00.000Z');
    expect(iso(zonedTime('2026-10-25', 150, 'Europe/Berlin'))).toBe('2026-10-25T00:30:00.000Z');
  });

  test('calendar arithmetic', () => {
    expect(weekday('2026-11-25')).toBe(3); // Wednesday
    expect(weekStart('2026-11-25', 1)).toBe('2026-11-23');
    expect(weekStart('2026-11-25', 0)).toBe('2026-11-22');
    expect(weekStart('2026-11-25', 6)).toBe('2026-11-21');
    expect(weekStart('2026-11-23', 1)).toBe('2026-11-23');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(eachDay('2026-02-27', '2026-03-02')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
  });
});

const TZ = 'Asia/Kolkata';
const DAY = '2026-11-25'; // a Wednesday
const WEEKEND = [0, 6];
const at = (hhmm, dayOffset = 0, date = DAY, tz = TZ) => {
  const [h, m] = hhmm.split(':').map(Number);
  return zonedTime(addDays(date, dayOffset), h * 60 + m, tz);
};
const punch = (type, ts, extra = {}) => ({ type, serverTs: ts, source: 'WEB', ...extra });
const SHIFT = {
  id: 'shift-1',
  startMin: 540,
  endMin: 1080,
  breakMinutes: 60,
  graceLateMin: 10,
  graceEarlyMin: 10,
  crossesMidnight: false,
};
const dayPlan = resolvePlan({ workDate: DAY, shift: SHIFT, weekendDays: WEEKEND });
const AFTER = at('12:00', 1); // the next day at noon: the day is final
const run = (punches, extra = {}) =>
  computeDay({
    workDate: DAY,
    tz: TZ,
    plan: dayPlan,
    punches,
    policy: DEFAULT_POLICY,
    overtimeRule: null,
    now: AFTER,
    ...extra,
  });

describe('plan resolution', () => {
  test('a shift on a weekday is a working day; the planned break comes off the expected time', () => {
    expect(dayPlan).toMatchObject({
      kind: 'WORKING',
      source: 'SHIFT',
      startMin: 540,
      endMin: 1080,
      expectedMinutes: 480,
      flexible: false,
    });
  });

  test('weekend days come from the legal entity; a holiday overrides everything', () => {
    expect(resolvePlan({ workDate: '2026-11-28', shift: SHIFT, weekendDays: WEEKEND }).kind).toBe('WEEKEND');
    // Friday–Saturday weekend (e.g. UAE before 2022, Saudi Arabia): Sunday is a working day.
    expect(resolvePlan({ workDate: '2026-11-29', weekendDays: [5, 6] }).kind).toBe('WORKING');
    expect(
      resolvePlan({ workDate: DAY, shift: SHIFT, weekendDays: WEEKEND, holiday: { name: 'Founders Day' } }),
    ).toMatchObject({ kind: 'HOLIDAY', holidayName: 'Founders Day' });
  });

  test('a night shift ends the next day', () => {
    const night = resolvePlan({
      workDate: DAY,
      shift: { ...SHIFT, startMin: 1320, endMin: 360, breakMinutes: 30, crossesMidnight: true },
      weekendDays: WEEKEND,
    });
    expect(night).toMatchObject({ startMin: 1320, endMin: 1800, expectedMinutes: 450 });
  });

  test('a fixed schedule takes times from its weekly pattern; a flexible one only counts hours', () => {
    const pattern = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      day,
      working: day >= 1 && day <= 5,
      ...(day >= 1 && day <= 5 ? { startMin: 540, endMin: 1080 } : {}),
    }));
    const fixed = resolvePlan({
      workDate: DAY,
      schedule: { type: 'FIXED', weeklyPattern: pattern, dailyMinutes: 480, graceMinutes: 15 },
      weekendDays: [],
    });
    expect(fixed).toMatchObject({
      kind: 'WORKING',
      startMin: 540,
      breakMinutes: 60,
      graceLate: 15,
      flexible: false,
    });
    const flexible = resolvePlan({
      workDate: DAY,
      schedule: { type: 'FLEXIBLE', weeklyPattern: pattern, dailyMinutes: 450, graceMinutes: 0 },
      weekendDays: [],
    });
    expect(flexible).toMatchObject({ startMin: null, expectedMinutes: 450, flexible: true });
    expect(
      resolvePlan({
        workDate: '2026-11-28',
        schedule: { type: 'FIXED', weeklyPattern: pattern, dailyMinutes: 480 },
        weekendDays: [],
      }).kind,
    ).toBe('WEEKEND');
  });
});

describe('punch handling', () => {
  test('pairs ignore a repeated IN or a stray OUT', () => {
    const { pairs, open } = pairPunches([
      punch('OUT', at('08:00')),
      punch('IN', at('09:00')),
      punch('IN', at('09:05')),
      punch('OUT', at('13:00')),
      punch('IN', at('14:00')),
    ]);
    expect(pairs).toHaveLength(1);
    expect(iso(pairs[0].in.serverTs)).toBe(iso(at('09:00')));
    expect(iso(open.serverTs)).toBe(iso(at('14:00')));
  });

  test('a correction replaces punches before its IN and after its OUT, keeping the originals stored', () => {
    const original = [punch('IN', at('09:40')), punch('OUT', at('12:00')), punch('IN', at('12:30'))];
    const corrected = effectivePunches([
      ...original,
      punch('IN', at('09:00'), { source: 'CORRECTION' }),
      punch('OUT', at('18:00'), { source: 'CORRECTION' }),
    ]);
    expect(corrected.map((p) => [p.type, iso(p.serverTs)])).toEqual([
      ['IN', iso(at('09:00'))],
      ['IN', iso(at('09:40'))],
      ['OUT', iso(at('12:00'))],
      ['IN', iso(at('12:30'))],
      ['OUT', iso(at('18:00'))],
    ]);
  });
});

describe('daily calculation', () => {
  test('a full day on time: the unpunched lunch break is deducted', () => {
    const d = run([punch('IN', at('09:00')), punch('OUT', at('18:00'))]);
    expect(d).toMatchObject({
      status: 'PRESENT',
      workedMinutes: 480,
      breakMinutes: 60,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      overtimeMinutes: 0,
      expectedMinutes: 480,
      flags: [],
    });
  });

  test('a punched lunch break is not deducted twice', () => {
    const d = run([
      punch('IN', at('09:00')),
      punch('OUT', at('13:00')),
      punch('IN', at('14:00')),
      punch('OUT', at('18:00')),
    ]);
    expect(d).toMatchObject({ workedMinutes: 480, breakMinutes: 60, status: 'PRESENT' });
  });

  test('break deduction can be switched off', () => {
    const d = run([punch('IN', at('09:00')), punch('OUT', at('18:00'))], {
      policy: { ...DEFAULT_POLICY, autoDeductBreak: false },
    });
    expect(d.workedMinutes).toBe(540);
  });

  test('late arrival: inside the grace period is on time; past it counts from the shift start', () => {
    expect(run([punch('IN', at('09:10')), punch('OUT', at('18:00'))]).lateMinutes).toBe(0);
    const late = run([punch('IN', at('09:11')), punch('OUT', at('18:00'))]);
    expect(late.lateMinutes).toBe(11);
    expect(late.flags).toContain('LATE');
  });

  test('early leaving works the same way', () => {
    expect(run([punch('IN', at('09:00')), punch('OUT', at('17:50'))]).earlyLeaveMinutes).toBe(0);
    const early = run([punch('IN', at('09:00')), punch('OUT', at('17:45'))]);
    expect(early.earlyLeaveMinutes).toBe(15);
    expect(early.flags).toContain('EARLY_LEAVE');
  });

  test('present / half day / absent follow the policy percentages', () => {
    // 4 hours of 8 = 50% → half day. Not more than half the day, so no break is deducted.
    expect(run([punch('IN', at('09:00')), punch('OUT', at('13:00'))])).toMatchObject({
      status: 'HALF_DAY',
      workedMinutes: 240,
    });
    expect(run([punch('IN', at('09:00')), punch('OUT', at('11:00'))]).status).toBe('ABSENT');
    expect(run([]).status).toBe('ABSENT');
    const strict = { ...DEFAULT_POLICY, presentPercent: 100, halfDayPercent: 40 };
    expect(run([punch('IN', at('09:00')), punch('OUT', at('17:00'))], { policy: strict }).status).toBe(
      'HALF_DAY',
    );
  });

  test('the day stays PENDING until it closes; an open clock-in is reported', () => {
    const d = run([punch('IN', at('09:00'))], { now: at('12:00') });
    expect(d).toMatchObject({ status: 'PENDING', closed: false, workedMinutes: 0 });
    expect(iso(d.openSince)).toBe(iso(at('09:00')));
    expect(closesAt(DAY, TZ, dayPlan).toISOString()).toBe(iso(at('04:00', 1)));
  });

  test('a forgotten clock-out is flagged once the day closes', () => {
    const d = run([punch('IN', at('09:00'))]);
    expect(d).toMatchObject({ status: 'ABSENT', workedMinutes: 0 });
    expect(d.flags).toContain('MISSING_OUT');
  });

  test('a night shift is one day, measured in real elapsed time', () => {
    const night = resolvePlan({
      workDate: DAY,
      shift: { ...SHIFT, startMin: 1320, endMin: 360, breakMinutes: 30, crossesMidnight: true },
      weekendDays: WEEKEND,
    });
    const d = computeDay({
      workDate: DAY,
      tz: TZ,
      plan: night,
      punches: [punch('IN', at('22:05')), punch('OUT', at('06:00', 1))],
      policy: DEFAULT_POLICY,
      overtimeRule: null,
      now: at('11:00', 1),
    });
    expect(d).toMatchObject({ status: 'PRESENT', workedMinutes: 445, lateMinutes: 0, closed: true });
    // Still open at 09:00 the next morning (shift end 06:00 + 4 hours).
    expect(
      computeDay({
        workDate: DAY,
        tz: TZ,
        plan: night,
        punches: [punch('IN', at('22:05'))],
        policy: DEFAULT_POLICY,
        overtimeRule: null,
        now: at('09:00', 1),
      }).status,
    ).toBe('PENDING');
  });

  test('across a DST change the worked time is the real elapsed time', () => {
    const tz = 'America/New_York';
    const date = '2026-03-07'; // Saturday night into Sunday 2026-03-08, clocks go forward at 02:00
    const plan = resolvePlan({
      workDate: date,
      shift: { ...SHIFT, startMin: 1320, endMin: 360, breakMinutes: 0, crossesMidnight: true },
      weekendDays: [],
    });
    const d = computeDay({
      workDate: date,
      tz,
      plan,
      punches: [punch('IN', at('22:00', 0, date, tz)), punch('OUT', at('06:00', 1, date, tz))],
      policy: DEFAULT_POLICY,
      overtimeRule: null,
      now: at('12:00', 1, date, tz),
    });
    expect(d.workedMinutes).toBe(420); // 8 hours on the clock, 7 really worked
  });

  test('daily overtime above the threshold', () => {
    const rule = {
      dailyThresholdMin: 480,
      weeklyThresholdMin: null,
      requiresApproval: true,
      restDayAllOvertime: true,
    };
    const d = run([punch('IN', at('09:00')), punch('OUT', at('20:00'))], { overtimeRule: rule });
    expect(d).toMatchObject({ workedMinutes: 600, overtimeMinutes: 120 });
    expect(d.flags).toContain('OVERTIME');
  });

  test('weekly overtime counts only the minutes that cross the weekly threshold', () => {
    const rule = {
      dailyThresholdMin: null,
      weeklyThresholdMin: 2400,
      requiresApproval: false,
      restDayAllOvertime: false,
    };
    const full = [punch('IN', at('09:00')), punch('OUT', at('18:00'))];
    expect(run(full, { overtimeRule: rule, weekWorkedBefore: 1920 }).overtimeMinutes).toBe(0);
    expect(run(full, { overtimeRule: rule, weekWorkedBefore: 2280 }).overtimeMinutes).toBe(360);
    expect(run(full, { overtimeRule: rule, weekWorkedBefore: 2500 }).overtimeMinutes).toBe(480);
  });

  test('daily and weekly excess are not added together', () => {
    const rule = {
      dailyThresholdMin: 480,
      weeklyThresholdMin: 2400,
      requiresApproval: true,
      restDayAllOvertime: true,
    };
    const d = run([punch('IN', at('09:00')), punch('OUT', at('20:00'))], {
      overtimeRule: rule,
      weekWorkedBefore: 2300,
    });
    expect(d.overtimeMinutes).toBe(500); // weekly 500 beats daily 120
  });

  test('work on a weekend keeps the WEEKEND status and can count fully as overtime', () => {
    const plan = resolvePlan({ workDate: '2026-11-28', shift: SHIFT, weekendDays: WEEKEND });
    const rule = {
      dailyThresholdMin: 480,
      weeklyThresholdMin: null,
      requiresApproval: true,
      restDayAllOvertime: true,
    };
    const d = computeDay({
      workDate: '2026-11-28',
      tz: TZ,
      plan,
      punches: [punch('IN', at('10:00', 3)), punch('OUT', at('14:00', 3))],
      policy: DEFAULT_POLICY,
      overtimeRule: rule,
      now: at('12:00', 4),
    });
    expect(d).toMatchObject({ status: 'WEEKEND', workedMinutes: 240, overtimeMinutes: 240, lateMinutes: 0 });
    expect(d.flags).toEqual(['OVERTIME', 'WORKED_ON_REST_DAY']);
    expect(
      computeDay({
        workDate: '2026-11-28',
        tz: TZ,
        plan,
        punches: [punch('IN', at('10:00', 3)), punch('OUT', at('14:00', 3))],
        policy: DEFAULT_POLICY,
        overtimeRule: { ...rule, restDayAllOvertime: false },
        now: at('12:00', 4),
      }).overtimeMinutes,
    ).toBe(0);
  });

  test('a holiday stays a holiday', () => {
    const plan = resolvePlan({ workDate: DAY, shift: SHIFT, weekendDays: WEEKEND, holiday: { name: 'X' } });
    expect(run([], { plan }).status).toBe('HOLIDAY');
  });

  test('an approved correction fixes a late, unfinished day', () => {
    const d = run([
      punch('IN', at('09:40')),
      punch('IN', at('09:00'), { source: 'CORRECTION' }),
      punch('OUT', at('18:00'), { source: 'CORRECTION' }),
    ]);
    expect(d).toMatchObject({ status: 'PRESENT', workedMinutes: 480, lateMinutes: 0 });
    expect(d.flags).toEqual(['CORRECTED']);
  });

  test('approved full-day leave makes the day ON_LEAVE, even before it closes, with no late or absence', () => {
    expect(run([], { leaveCenti: 100 })).toMatchObject({ status: 'ON_LEAVE', flags: ['ON_LEAVE'] });
    expect(run([], { leaveCenti: 100, now: at('08:00') }).status).toBe('ON_LEAVE');
    // Leave on a weekend changes nothing.
    const weekend = resolvePlan({ workDate: '2026-11-28', shift: SHIFT, weekendDays: WEEKEND });
    expect(run([], { leaveCenti: 100, plan: weekend }).status).toBe('WEEKEND');
  });

  test('half-day leave: the worked half is measured against half the planned time; no late flag', () => {
    // Afternoon at work after a morning off: 13:30–18:00 = 270 min, more than 75% of 240.
    const d = run([punch('IN', at('13:30')), punch('OUT', at('18:00'))], { leaveCenti: 50 });
    expect(d).toMatchObject({ status: 'PRESENT', lateMinutes: 0, flags: ['ON_LEAVE_HALF'] });
    expect(run([], { leaveCenti: 50 }).status).toBe('ABSENT'); // the other half was missed
  });

  test('mostly remote time is reported as WFH', () => {
    const d = run([
      punch('IN', at('09:00'), { locationType: 'WFH', workLocationId: 'home' }),
      punch('OUT', at('18:00')),
    ]);
    expect(d).toMatchObject({ status: 'WFH', workLocationId: 'home' });
  });

  test('flexible schedules never flag late or early, and no plan means any work is a present day', () => {
    const flexible = resolvePlan({
      workDate: DAY,
      schedule: {
        type: 'FLEXIBLE',
        weeklyPattern: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, working: true })),
        dailyMinutes: 480,
      },
      weekendDays: [],
    });
    const d = run([punch('IN', at('11:30')), punch('OUT', at('19:30'))], { plan: flexible });
    expect(d).toMatchObject({ status: 'PRESENT', lateMinutes: 0, earlyLeaveMinutes: 0, workedMinutes: 480 });
    const none = resolvePlan({ workDate: DAY, weekendDays: WEEKEND });
    expect(run([punch('IN', at('10:00')), punch('OUT', at('11:00'))], { plan: none }).status).toBe('PRESENT');
  });
});
