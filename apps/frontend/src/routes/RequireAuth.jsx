import { Navigate, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/context/AuthContext';

/** Gate for signed-in areas. While the session is being restored, show a neutral loading state (no flash of the login page). */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  const { t } = useTranslation();
  if (status === 'loading') {
    return (
      <div role="status" className="flex min-h-screen items-center justify-center text-sm text-text-muted">
        {t('common.loading')}
      </div>
    );
  }
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/** Sends signed-in users away from the login/register pages. */
export function RedirectIfAuthenticated() {
  const { status } = useAuth();
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <Outlet />;
}
