import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LoginBody, MfaVerifyBody } from '@hrms/shared/schemas/auth';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { authApi } from '@/services/auth';
import { useAuth } from '@/context/AuthContext';
import { ApiError } from '@/services/api';
import { errorMessage } from '@/utils/errors';

const zodErrors = (result) => Object.fromEntries(result.error.issues.map((i) => [i.path[0], i.message]));

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { signedIn } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [notVerified, setNotVerified] = useState(false);
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState(null);
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');

  const finish = async (accessToken) => {
    await signedIn(accessToken);
    navigate(location.state?.from ?? '/', { replace: true });
  };

  async function submitPassword(e) {
    e.preventDefault();
    setError(null);
    setNotVerified(false);
    const parsed = LoginBody.safeParse(form);
    if (!parsed.success) return setFieldErrors(zodErrors(parsed));
    setFieldErrors({});
    setBusy(true);
    try {
      const res = await authApi.login(parsed.data);
      if (res.mfaRequired) setChallenge(res.challengeToken);
      else await finish(res.accessToken);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'email_not_verified') setNotVerified(true);
      else setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e) {
    e.preventDefault();
    setError(null);
    const body = { challengeToken: challenge, ...(useRecovery ? { recoveryCode: code } : { code }) };
    const parsed = MfaVerifyBody.safeParse(body);
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    setBusy(true);
    try {
      const res = await authApi.verifyMfa(parsed.data);
      await finish(res.accessToken);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'challenge_expired') {
        setChallenge(null);
        setCode('');
      }
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (challenge) {
    return (
      <form onSubmit={submitCode} noValidate className="flex flex-col gap-5">
        <div>
          <h1 className="text-2xl font-bold">{t('auth.mfa.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('auth.mfa.body')}</p>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <Field
          label={useRecovery ? t('auth.mfa.recoveryCode') : t('auth.mfa.code')}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode={useRecovery ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoFocus
          maxLength={useRecovery ? 11 : 7}
        />
        <Button type="submit" disabled={busy}>
          {t('auth.mfa.submit')}
        </Button>
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => {
              setUseRecovery(!useRecovery);
              setCode('');
            }}
          >
            {useRecovery ? t('auth.mfa.useApp') : t('auth.mfa.useRecovery')}
          </button>
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => {
              setChallenge(null);
              setCode('');
              setError(null);
            }}
          >
            {t('auth.mfa.back')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={submitPassword} noValidate className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold">{t('auth.login.title')}</h1>
      {error && <Alert tone="error">{error}</Alert>}
      {notVerified && (
        <Alert tone="warning">
          <p>{t('auth.login.notVerified')}</p>
          {resent ? (
            <p className="mt-1">{t('auth.login.resent')}</p>
          ) : (
            <button
              type="button"
              className="mt-1 font-medium underline"
              onClick={async () => {
                await authApi.resendVerification(form.email).catch(() => {});
                setResent(true);
              }}
            >
              {t('auth.login.resend')}
            </button>
          )}
        </Alert>
      )}
      <Field
        label={t('auth.email')}
        type="email"
        autoComplete="username"
        value={form.email}
        error={fieldErrors.email}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
        autoFocus
      />
      <Field
        label={t('auth.password')}
        type="password"
        autoComplete="current-password"
        value={form.password}
        error={fieldErrors.password}
        onChange={(e) => setForm({ ...form, password: e.target.value })}
      />
      <div className="-mt-2 text-end text-sm">
        <Link to="/forgot-password" className="text-primary hover:underline">
          {t('auth.login.forgot')}
        </Link>
      </div>
      <Button type="submit" disabled={busy}>
        {t('auth.login.submit')}
      </Button>
      <p className="text-center text-sm text-text-muted">
        {t('auth.login.noAccount')}{' '}
        <Link to="/register" className="font-medium text-primary hover:underline">
          {t('auth.login.register')}
        </Link>
      </p>
    </form>
  );
}
