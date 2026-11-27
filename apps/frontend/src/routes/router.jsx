import { createBrowserRouter } from 'react-router';
import { AppShell } from '@/layouts/AppShell';
import { AuthLayout } from '@/layouts/AuthLayout';
import { RedirectIfAuthenticated, RequireAuth } from '@/routes/RequireAuth';
import { SystemStatusPage } from '@/pages/SystemStatusPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { LoginPage } from '@/pages/auth/LoginPage';
import { RegisterPage } from '@/pages/auth/RegisterPage';
import { VerifyEmailPage } from '@/pages/auth/VerifyEmailPage';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/auth/ResetPasswordPage';
import { SecurityPage } from '@/pages/settings/SecurityPage';
import { CompanyPage } from '@/pages/settings/CompanyPage';
import { OrganizationPage } from '@/pages/settings/OrganizationPage';
import { MembersPage } from '@/pages/settings/MembersPage';
import { RolesPage } from '@/pages/settings/RolesPage';
import { AcceptInvitePage } from '@/pages/auth/AcceptInvitePage';
import { EmployeesPage } from '@/pages/employees/EmployeesPage';
import { EmployeeNewPage } from '@/pages/employees/EmployeeNewPage';
import { EmployeeImportPage } from '@/pages/employees/EmployeeImportPage';
import { EmployeeProfilePage, MyProfileRedirect } from '@/pages/employees/EmployeeProfilePage';
import { MyAttendancePage } from '@/pages/attendance/MyAttendancePage';
import { TeamAttendancePage } from '@/pages/attendance/TeamAttendancePage';
import { EmployeeAttendancePage } from '@/pages/attendance/EmployeeAttendancePage';
import { ApprovalsPage } from '@/pages/attendance/ApprovalsPage';
import { AttendanceReportPage } from '@/pages/attendance/AttendanceReportPage';
import { AttendanceSettingsPage } from '@/pages/settings/AttendanceSettingsPage';
import { MyLeavePage } from '@/pages/leave/MyLeavePage';
import { WhosAwayPage } from '@/pages/leave/WhosAwayPage';
import { LeaveReportPage } from '@/pages/leave/LeaveReportPage';
import { LeaveSettingsPage } from '@/pages/settings/LeaveSettingsPage';
import { PayrollRunsPage } from '@/pages/payroll/PayrollRunsPage';
import { PayrollRunPage } from '@/pages/payroll/PayrollRunPage';
import { MyPayslipsPage } from '@/pages/payroll/MyPayslipsPage';
import { PayrollSettingsPage } from '@/pages/settings/PayrollSettingsPage';

/** Route table. Each sprint adds its module routes under the signed-in shell. */
export const routes = [
  {
    element: <AuthLayout />,
    children: [
      {
        element: <RedirectIfAuthenticated />,
        children: [
          { path: 'login', element: <LoginPage /> },
          { path: 'register', element: <RegisterPage /> },
        ],
      },
      { path: 'verify-email', element: <VerifyEmailPage /> },
      { path: 'forgot-password', element: <ForgotPasswordPage /> },
      { path: 'reset-password', element: <ResetPasswordPage /> },
      { path: 'accept-invite', element: <AcceptInvitePage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <SystemStatusPage /> },
          { path: 'employees', element: <EmployeesPage /> },
          { path: 'employees/new', element: <EmployeeNewPage /> },
          { path: 'employees/import', element: <EmployeeImportPage /> },
          { path: 'employees/:id', element: <EmployeeProfilePage /> },
          { path: 'me', element: <MyProfileRedirect /> },
          { path: 'attendance', element: <MyAttendancePage /> },
          { path: 'attendance/team', element: <TeamAttendancePage /> },
          { path: 'attendance/employees/:id', element: <EmployeeAttendancePage /> },
          { path: 'attendance/approvals', element: <ApprovalsPage /> },
          { path: 'attendance/reports', element: <AttendanceReportPage /> },
          { path: 'settings/attendance', element: <AttendanceSettingsPage /> },
          { path: 'leave', element: <MyLeavePage /> },
          { path: 'leave/calendar', element: <WhosAwayPage /> },
          { path: 'leave/reports', element: <LeaveReportPage /> },
          { path: 'settings/leave', element: <LeaveSettingsPage /> },
          { path: 'payroll', element: <PayrollRunsPage /> },
          { path: 'payroll/runs/:id', element: <PayrollRunPage /> },
          { path: 'payslips', element: <MyPayslipsPage /> },
          { path: 'settings/payroll', element: <PayrollSettingsPage /> },
          { path: 'settings/security', element: <SecurityPage /> },
          { path: 'settings/company', element: <CompanyPage /> },
          { path: 'settings/organization', element: <OrganizationPage /> },
          { path: 'settings/members', element: <MembersPage /> },
          { path: 'settings/roles', element: <RolesPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];

export const createRouter = () => createBrowserRouter(routes);
