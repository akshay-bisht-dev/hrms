// @ts-check
import { PERMISSIONS } from './permissions.js';

/**
 * Default tenant roles created at company registration (Phase 1, 01 §2; Phase 3, 02 §2).
 * Tenants can edit these (except Company Admin) and create their own in Sprint 3.
 * No default role other than Company Admin holds screenshot-view/download or payroll permissions.
 * @typedef {{ key: string, name: string, description: string, grants: Array<[string, string]> }} RoleDef
 */

const all = (scope) => PERMISSIONS.map((p) => /** @type {[string, string]} */ ([p.code, scope]));

/** @type {ReadonlyArray<RoleDef>} */
export const DEFAULT_ROLES = Object.freeze([
  {
    key: 'company_admin',
    name: 'Company Admin',
    description: 'Full access to the company account',
    grants: all('COMPANY'),
  },
  {
    key: 'hr_manager',
    name: 'HR Manager',
    description: 'Runs HR operations; payroll view only if granted',
    grants: [
      ['company.org.manage', 'COMPANY'],
      ['members.invite', 'COMPANY'],
      ['reports.view', 'COMPANY'],
      ['employee.profile.view', 'COMPANY'],
      ['employee.profile.create', 'COMPANY'],
      ['employee.profile.update', 'COMPANY'],
      ['employee.documents.view', 'COMPANY'],
      ['employee.documents.manage', 'COMPANY'],
      ['employee.bulk.import', 'COMPANY'],
      ['attendance.view', 'COMPANY'],
      ['attendance.manage', 'COMPANY'],
      ['attendance.regularization.approve', 'COMPANY'],
      ['leave.config.manage', 'COMPANY'],
      ['leave.request.view', 'COMPANY'],
      ['leave.request.approve', 'COMPANY'],
      ['leave.balance.adjust', 'COMPANY'],
      ['onboarding.manage', 'COMPANY'],
      ['performance.manage', 'COMPANY'],
      ['work.config.manage', 'COMPANY'],
      ['wfh.request.approve', 'COMPANY'],
      ['view_team_work_status', 'COMPANY'],
    ],
  },
  {
    key: 'hr_executive',
    name: 'HR Executive',
    description: 'Day-to-day HR data entry',
    grants: [
      ['employee.profile.view', 'COMPANY'],
      ['employee.profile.create', 'COMPANY'],
      ['employee.profile.update', 'COMPANY'],
      ['employee.documents.manage', 'COMPANY'],
      ['attendance.view', 'COMPANY'],
      ['leave.request.view', 'COMPANY'],
      ['onboarding.manage', 'COMPANY'],
    ],
  },
  {
    key: 'payroll_manager',
    name: 'Payroll Manager',
    description: 'Prepares and reviews payroll (maker)',
    grants: [
      ['payroll.config.manage', 'COMPANY'],
      ['payroll.salary.view', 'COMPANY'],
      ['payroll.salary.manage', 'COMPANY'],
      ['payroll.run.create', 'COMPANY'],
      ['payroll.run.review', 'COMPANY'],
      ['payroll.bank.view', 'COMPANY'],
      ['payroll.payslip.view', 'COMPANY'],
      ['payroll.tax.review', 'COMPANY'],
      ['employee.profile.view', 'COMPANY'],
      ['attendance.view', 'COMPANY'],
    ],
  },
  {
    key: 'finance_manager',
    name: 'Finance Manager',
    description: 'Approves payroll (checker) and bank files',
    grants: [
      ['payroll.run.approve', 'COMPANY'],
      ['payroll.salary.view', 'COMPANY'],
      ['payroll.bank.view', 'COMPANY'],
      ['reports.view', 'COMPANY'],
    ],
  },
  {
    key: 'department_manager',
    name: 'Department Manager',
    description: 'Approvals for their department',
    grants: [
      ['employee.profile.view', 'DEPARTMENT'],
      ['attendance.view', 'DEPARTMENT'],
      ['attendance.regularization.approve', 'DEPARTMENT'],
      ['leave.request.view', 'DEPARTMENT'],
      ['leave.request.approve', 'DEPARTMENT'],
      ['wfh.request.approve', 'DEPARTMENT'],
      ['view_team_work_status', 'DEPARTMENT'],
      ['approve_timesheets', 'DEPARTMENT'],
      ['approve_work_reports', 'DEPARTMENT'],
      ['performance.review', 'DEPARTMENT'],
      ['task.assign', 'DEPARTMENT'],
      ['project.manage', 'DEPARTMENT'],
    ],
  },
  {
    key: 'team_leader',
    name: 'Team Leader',
    description: 'Approvals for their reporting line',
    grants: [
      ['employee.profile.view', 'TEAM'],
      ['attendance.view', 'TEAM'],
      ['leave.request.view', 'TEAM'],
      ['leave.request.approve', 'TEAM'],
      ['wfh.request.approve', 'TEAM'],
      ['view_team_work_status', 'TEAM'],
      ['approve_timesheets', 'TEAM'],
      ['approve_work_reports', 'TEAM'],
      ['performance.review', 'TEAM'],
      ['task.assign', 'TEAM'],
    ],
  },
  {
    key: 'recruiter',
    name: 'Recruiter',
    description: 'Hiring pipeline only; no employee records',
    grants: [['recruitment.manage', 'COMPANY']],
  },
  {
    key: 'employee',
    name: 'Employee',
    description: 'Self-service',
    grants: [
      ['employee.profile.view', 'OWN'],
      ['attendance.view', 'OWN'],
      ['leave.request.view', 'OWN'],
    ],
  },
]);
