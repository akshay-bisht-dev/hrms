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
