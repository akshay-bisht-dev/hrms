import { newId, isId } from '../src/ids.js';
import { PERMISSIONS, PERMISSION_CODES } from '../src/permissions.js';
import { QUEUES } from '../src/queues.js';

describe('ids', () => {
  test('newId returns a UUIDv7 that sorts by creation time', () => {
    const a = newId();
    const b = newId();
    expect(isId(a)).toBe(true);
    expect(a < b).toBe(true);
  });
  test('isId rejects non-v7 values', () => {
    expect(isId('not-a-uuid')).toBe(false);
    expect(isId('3b241101-e2bb-4255-8caf-4136c566a962')).toBe(false); // v4
    expect(isId(42)).toBe(false);
  });
});

describe('permission catalog', () => {
  test('codes are unique', () => {
    expect(PERMISSION_CODES.size).toBe(PERMISSIONS.length);
  });
  test('every monitoring and payroll permission is marked sensitive', () => {
    const mustBeSensitive = PERMISSIONS.filter(
      (p) =>
        p.code.startsWith('payroll.') ||
        /screenshot|work_status|work_sessions|timesheets|work_reports|activity_reports|monitoring/.test(
          p.code,
        ),
    );
    expect(mustBeSensitive.length).toBeGreaterThan(10);
    expect(mustBeSensitive.every((p) => p.sensitive)).toBe(true);
  });
  test('all brief-required work-status permissions exist', () => {
    for (const code of [
      'view_team_work_status',
      'view_own_screenshots',
      'view_team_screenshots',
      'download_screenshots',
      'manage_monitoring_policy',
      'approve_timesheets',
      'approve_work_reports',
      'manage_work_sessions',
      'view_activity_reports',
    ]) {
      expect(PERMISSION_CODES.has(code)).toBe(true);
    }
  });
  test('codes fit the permissions.code column (VARCHAR(80))', () => {
    expect(PERMISSIONS.every((p) => p.code.length <= 80 && p.description.length <= 255)).toBe(true);
  });
});

describe('queues', () => {
  test('queue names are frozen and unique', () => {
    const names = Object.values(QUEUES);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.isFrozen(QUEUES)).toBe(true);
  });
});

import { DEFAULT_ROLES } from '../src/roles.js';
import { RegisterBody, TotpCode, MfaVerifyBody } from '../src/schemas/auth.js';

describe('default roles', () => {
  test('every grant uses a catalog code and a valid scope', () => {
    for (const r of DEFAULT_ROLES) {
      for (const [code, scope] of r.grants) {
        expect(PERMISSION_CODES.has(code)).toBe(true);
        expect(['OWN', 'TEAM', 'DEPARTMENT', 'BRANCH', 'LEGAL_ENTITY', 'COMPANY']).toContain(scope);
      }
    }
  });
  test('only Company Admin can view or download team screenshots or approve payroll', () => {
    const holders = (code) =>
      DEFAULT_ROLES.filter((r) => r.grants.some(([c]) => c === code)).map((r) => r.key);
    expect(holders('view_team_screenshots')).toEqual(['company_admin']);
    expect(holders('download_screenshots')).toEqual(['company_admin']);
    expect(holders('payroll.run.approve')).toEqual(['company_admin', 'finance_manager']);
  });
  test('managers do not get payroll access by default', () => {
    for (const key of ['department_manager', 'team_leader', 'hr_manager']) {
      const role = DEFAULT_ROLES.find((r) => r.key === key);
      expect(role.grants.some(([c]) => c.startsWith('payroll.'))).toBe(false);
    }
  });
});

describe('auth schemas', () => {
  test('register normalizes email and country, enforces password length', () => {
    const ok = RegisterBody.parse({
      fullName: 'A',
      email: ' Priya@Example.COM ',
      password: 'x'.repeat(12),
      companyName: 'Acme',
      countryCode: 'in',
    });
    expect(ok.email).toBe('priya@example.com');
    expect(ok.countryCode).toBe('IN');
    expect(
      RegisterBody.safeParse({
        fullName: 'A',
        email: 'a@b.co',
        password: 'short',
        companyName: 'Acme',
        countryCode: 'IN',
      }).success,
    ).toBe(false);
  });
  test('unknown keys are rejected (mass assignment)', () => {
    expect(
      RegisterBody.safeParse({
        fullName: 'A',
        email: 'a@b.co',
        password: 'x'.repeat(12),
        companyName: 'Acme',
        countryCode: 'IN',
        role: 'admin',
      }).success,
    ).toBe(false);
  });
  test('TOTP code accepts spaces, rejects non-digits', () => {
    expect(TotpCode.parse('123 456')).toBe('123456');
    expect(TotpCode.safeParse('12345a').success).toBe(false);
  });
  test('MFA verify requires exactly one of code / recovery code', () => {
    expect(MfaVerifyBody.safeParse({ challengeToken: 't' }).success).toBe(false);
    expect(
      MfaVerifyBody.safeParse({ challengeToken: 't', code: '123456', recoveryCode: 'abcde12345' }).success,
    ).toBe(false);
    expect(MfaVerifyBody.safeParse({ challengeToken: 't', code: '123456' }).success).toBe(true);
  });
});

import {
  BranchBody,
  WorkScheduleBody,
  TimeZone,
  Code,
  LegalEntityBody,
  partial,
  DepartmentBody,
} from '../src/schemas/org.js';
import { RoleBody } from '../src/schemas/members.js';

describe('org schemas', () => {
  test('time zones are validated against IANA names', () => {
    expect(TimeZone.safeParse('Asia/Kolkata').success).toBe(true);
    expect(TimeZone.safeParse('Mars/Olympus').success).toBe(false);
  });
  test('codes are upper-cased and restricted', () => {
    expect(Code.parse(' eng-1 ')).toBe('ENG-1');
    expect(Code.safeParse('a b').success).toBe(false);
  });
  test('branch requires a legal entity id and rejects unknown keys', () => {
    expect(
      BranchBody.safeParse({ legalEntityId: 'x', name: 'HQ', code: 'HQ', timezone: 'UTC' }).success,
    ).toBe(false);
    expect(
      BranchBody.safeParse({
        legalEntityId: '0190f7a0-0000-7000-8000-000000000000',
        name: 'HQ',
        code: 'HQ',
        timezone: 'UTC',
        tenantId: 'x',
      }).success,
    ).toBe(false);
  });
  test('weekend days must be unique', () => {
    expect(
      LegalEntityBody.safeParse({
        name: 'A',
        countryCode: 'in',
        currency: 'inr',
        weekendDays: [0, 0],
        timezone: 'UTC',
      }).success,
    ).toBe(false);
  });
  test('fixed schedules need start before end on working days', () => {
    const week = (over = {}) =>
      Array.from({ length: 7 }, (_, day) => ({
        day,
        working: day > 0 && day < 6,
        startMin: 540,
        endMin: 1080,
        ...over,
      }));
    expect(
      WorkScheduleBody.safeParse({ name: 'Std', type: 'FIXED', weeklyPattern: week(), dailyMinutes: 480 })
        .success,
    ).toBe(true);
    expect(
      WorkScheduleBody.safeParse({
        name: 'Bad',
        type: 'FIXED',
        weeklyPattern: week({ endMin: 500 }),
        dailyMinutes: 480,
      }).success,
    ).toBe(false);
  });
  test('partial schemas keep rejecting unknown keys', () => {
    expect(partial(DepartmentBody).safeParse({ name: 'X' }).success).toBe(true);
    expect(partial(DepartmentBody).safeParse({ tenantId: 'x' }).success).toBe(false);
  });
});

describe('role schema', () => {
  test('only catalog permissions and valid scopes, each once', () => {
    expect(
      RoleBody.safeParse({ name: 'Ops', grants: [{ permissionCode: 'attendance.view', scope: 'TEAM' }] })
        .success,
    ).toBe(true);
    expect(
      RoleBody.safeParse({ name: 'Ops', grants: [{ permissionCode: 'root.everything', scope: 'COMPANY' }] })
        .success,
    ).toBe(false);
    expect(
      RoleBody.safeParse({ name: 'Ops', grants: [{ permissionCode: 'attendance.view', scope: 'GALAXY' }] })
        .success,
    ).toBe(false);
    expect(
      RoleBody.safeParse({
        name: 'Ops',
        grants: [
          { permissionCode: 'attendance.view', scope: 'TEAM' },
          { permissionCode: 'attendance.view', scope: 'OWN' },
        ],
      }).success,
    ).toBe(false);
  });
});
