import { Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';

/** Centered card for sign-in, sign-up and recovery screens. */
export function AuthLayout() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-4 py-10">
      <div className="mb-6 flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex size-9 items-center justify-center rounded-lg bg-primary font-bold text-white"
        >
          W
        </span>
        <span className="text-lg font-semibold">{t('app.name')}</span>
      </div>
      <main className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-surface p-6 shadow-sm sm:p-8">
        <Outlet />
      </main>
      <p className="mt-6 text-center text-sm text-text-muted">{t('auth.brandTagline')}</p>
    </div>
  );
}
