import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { authApi } from '@/services/auth';

/** Confirms the emailed token once on load (StrictMode-safe: the ref stops a second request). */
export function VerifyEmailPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [state, setState] = useState('pending');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = params.get('token');
    if (!token) return setState('failed');
    authApi.verifyEmail(token).then(
      () => setState('ok'),
      () => setState('failed'),
    );
  }, [params]);

  if (state === 'pending') {
    return (
      <p role="status" className="text-sm text-text-muted">
        {t('auth.verify.title')}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4" role="status">
      <h1 className="text-2xl font-bold">{state === 'ok' ? t('auth.verify.ok') : t('auth.verify.fail')}</h1>
      <p className="text-sm text-text-muted">
        {state === 'ok' ? t('auth.verify.okBody') : t('auth.verify.failBody')}
      </p>
      <Button asChild>
        <Link to="/login">{t('auth.verify.signIn')}</Link>
      </Button>
    </div>
  );
}
