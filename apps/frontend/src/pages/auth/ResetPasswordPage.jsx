import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Password } from '@hrms/shared/schemas/auth';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { authApi } from '@/services/auth';
import { ApiError } from '@/services/api';
import { errorMessage } from '@/utils/errors';

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState();
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const parsed = Password.safeParse(password);
    if (!parsed.success) return setFieldError(parsed.error.issues[0].message);
    setFieldError(undefined);
    setError(null);
    setBusy(true);
    try {
      await authApi.resetPassword({ token, password });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors().password) setFieldError(err.fieldErrors().password);
      else setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (!token) return <Alert tone="error">{t('auth.reset.missing')}</Alert>;
  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success">{t('auth.reset.done')}</Alert>
        <Button asChild>
          <Link to="/login">{t('auth.reset.signIn')}</Link>
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold">{t('auth.reset.title')}</h1>
      {error && <Alert tone="error">{error}</Alert>}
      <Field
        label={t('auth.password')}
        type="password"
        autoComplete="new-password"
        value={password}
        error={fieldError}
        hint={t('auth.passwordHint')}
        onChange={(e) => setPassword(e.target.value)}
        autoFocus
      />
      <Button type="submit" disabled={busy}>
        {t('auth.reset.submit')}
      </Button>
    </form>
  );
}
