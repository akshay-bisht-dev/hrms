// @ts-check
/**
 * Permission catalog (Phase 3, 02 §2). Tenants compose roles from these codes; they cannot invent codes.
 * `sensitive: true` → never self-grantable, requires a Company Admin with MFA, audited and notified (RBAC-05).
 *
 * @typedef {{ code: string, module: string, description: string, sensitive: boolean }} PermissionDef
 */

/** @type {(code: string, description: string, sensitive?: boolean) => PermissionDef} */
const p = (code, description, sensitive = false) => ({
  code,
  module: code.split(/[._]/)[0],
  description,
  sensitive,
});

/** @type {ReadonlyArray<PermissionDef>} */
export const PERMISSIONS = Object.freeze([
  // Company & administration
  p('company.profile.manage', 'Edit company profile, legal entities and settings'),
  p('company.org.manage', 'Manage branches, departments, designations, teams and calendars'),
  p('roles.manage', 'Create roles and assign them to members', true),
  p('members.invite', 'Invite users to the company'),
  p('audit.log.view', 'View the audit log', true),
  p('subscription.manage', 'Manage plan, billing and invoices', true),
  p('reports.view', 'View standard reports'),
  p('reports.export', 'Export reports and data', true),
  // Employees
  p('employee.profile.view', 'View employee profiles within scope'),
  p('employee.profile.create', 'Create employees'),
  p('employee.profile.update', 'Update employee profiles within scope'),
  p('employee.sensitive.view', 'View national IDs and other restricted personal fields', true),
  p('employee.documents.view', 'View employee documents', true),
  p('employee.documents.manage', 'Upload and verify employee documents'),
  p('employee.bulk.import', 'Import employees in bulk'),
  p('employee.bulk.export', 'Export employee data in bulk', true),
  // Attendance & leave
  p('attendance.view', 'View attendance within scope'),
  p('attendance.manage', 'Manage shifts, rules and attendance records'),
  p('attendance.regularization.approve', 'Approve attendance corrections'),
  p('leave.config.manage', 'Manage leave types and policies'),
  p('leave.request.view', 'View leave requests within scope'),
  p('leave.request.approve', 'Approve leave requests'),
  p('leave.balance.adjust', 'Adjust leave balances'),
  // Payroll (all sensitive)
  p('payroll.config.manage', 'Manage salary components, structures and statutory settings', true),
  p('payroll.salary.view', 'View salaries', true),
  p('payroll.salary.manage', 'Change salaries', true),
  p('payroll.run.create', 'Create and calculate payroll runs', true),
  p('payroll.run.review', 'Review payroll runs', true),
  p('payroll.run.approve', 'Approve payroll runs (must differ from reviewer)', true),
  p('payroll.bank.view', 'View bank account details', true),
  p('payroll.bank.manage', 'Change bank account details', true),
  p('payroll.payslip.view', 'View payslips of others', true),
  p('payroll.tax.review', 'Review tax declarations', true),
  // Recruitment, onboarding, performance
  p('recruitment.manage', 'Manage requisitions, postings, candidates and interviews'),
  p('recruitment.offer.approve', 'Approve offers'),
  p('onboarding.manage', 'Manage onboarding cases and templates'),
  p('performance.manage', 'Manage performance cycles'),
  p('performance.review', 'Review direct and indirect reports'),
  // Work status & monitoring (separate from ordinary employee management)
  p('work.config.manage', 'Manage work locations and work policies'),
  p('wfh.request.approve', 'Approve work-from-home requests'),
  p('view_team_work_status', 'See live work status of the team', true),
  p('view_own_screenshots', 'See own screenshots (always granted while monitored)', true),
  p('view_team_screenshots', 'View screenshots of employees in scope', true),
  p('download_screenshots', 'Download screenshots (watermarked, logged)', true),
  p('manage_monitoring_policy', 'Activate monitoring and manage screenshot policies and devices', true),
  p('approve_timesheets', 'Approve timesheets', true),
  p('approve_work_reports', 'Approve daily work reports', true),
  p('manage_work_sessions', 'Correct and manage work sessions of others', true),
  p('view_activity_reports', 'View application activity reports', true),
  // Tasks & projects
  p('project.manage', 'Create and manage projects'),
  p('task.assign', 'Assign tasks to others'),
]);

/** @type {ReadonlySet<string>} */
export const PERMISSION_CODES = new Set(PERMISSIONS.map((x) => x.code));

/** Data scopes, narrowest first. */
export const DATA_SCOPES = Object.freeze(['OWN', 'TEAM', 'DEPARTMENT', 'BRANCH', 'LEGAL_ENTITY', 'COMPANY']);
