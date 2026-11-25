import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { EmailBody } from '@hrms/shared/schemas/auth';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { authApi } from '@/services/auth';
import { errorMessage } from '@/utils/errors';

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState();
  const [error, setError] = useState(null);
  const [sentTo, setSentTo] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const parsed = EmailBody.safeParse({ email });
    if (!parsed.success) return setFieldError(parsed.error.issues[0].message);
    setFieldError(undefined);
    setError(null);
    setBusy(true);
    try {
      await authApi.forgotPassword(parsed.data.email);
      setSentTo(parsed.data.email);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold">{t('auth.forgot.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('auth.forgot.body')}</p>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      {sentTo ? (
        <Alert tone="success">{t('auth.forgot.done', { email: sentTo })}</Alert>
      ) : (
        <>
          <Field
            label={t('auth.email')}
            type="email"
            autoComplete="email"
            value={email}
            error={fieldError}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          <Button type="submit" disabled={busy}>
            {t('auth.forgot.submit')}
          </Button>
        </>
      )}
      <Link to="/login" className="text-center text-sm text-primary hover:underline">
        {t('auth.forgot.back')}
      </Link>
    </form>
  );
}
