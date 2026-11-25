import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import { MonitorSmartphone, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { authApi } from '@/services/auth';
import { ApiError } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { errorMessage } from '@/utils/errors';

const card = 'rounded-[var(--radius-card)] border border-border bg-surface p-5 sm:p-6';

function MfaSection() {
  const { t } = useTranslation();
  const { me, signedIn } = useAuth();
  const [step, setStep] = useState('idle'); // idle → password → scan → codes
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState(null);
  const [qr, setQr] = useState(null);
  const [codes, setCodes] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (setup?.otpauthUri)
      QRCode.toDataURL(setup.otpauthUri, { margin: 1, width: 192 }).then(setQr, () => setQr(null));
  }, [setup]);

  const run = async (fn) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError && err.errors.length ? err.errors[0].message : errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const enabled = me.mfa.enabled;
  return (
    <section aria-labelledby="mfa-h" className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {enabled ? (
            <ShieldCheck aria-hidden="true" className="size-5 text-success-text" />
          ) : (
            <ShieldAlert aria-hidden="true" className="size-5 text-warning-text" />
          )}
          <h2 id="mfa-h" className="text-lg font-semibold">
            {t('security.mfa.title')}
          </h2>
        </div>
        <Badge tone={enabled ? 'success' : 'warning'} withDot>
          {enabled ? t('security.mfa.on') : t('security.mfa.off')}
        </Badge>
      </div>
      <p className="mt-2 text-sm text-text-muted">{t('security.mfa.explain')}</p>
      {me.mfa.requiredForRole && !enabled && (
        <Alert tone="warning" className="mt-4">
          {t('security.mfa.required')}
        </Alert>
      )}
      {notice && (
        <Alert tone="success" className="mt-4">
          {notice}
        </Alert>
      )}
      {error && (
        <Alert tone="error" className="mt-4">
          {error}
        </Alert>
      )}

      {!enabled && step === 'idle' && (
        <Button className="mt-4" onClick={() => setStep('password')}>
          {t('security.mfa.start')}
        </Button>
      )}

      {step === 'password' && (
        <form
          className="mt-4 flex max-w-sm flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              setSetup(await authApi.mfaSetup(password));
              setPassword('');
              setStep('scan');
            });
          }}
        >
          <Field
            label={t('security.mfa.confirmPassword')}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !password}>
              {t('security.mfa.continue')}
            </Button>
            <Button variant="ghost" onClick={() => setStep('idle')}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      )}

      {step === 'scan' && setup && (
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const out = await authApi.mfaConfirm(code);
              setCodes(out.recoveryCodes);
              setCode('');
              setStep('codes');
              await signedIn(out.accessToken);
            });
          }}
        >
          <p className="text-sm">{t('security.mfa.scan')}</p>
          <div className="flex flex-wrap items-center gap-5">
            {qr && (
              <img
                src={qr}
                alt="QR code for your authenticator app"
                width={192}
                height={192}
                className="rounded border border-border"
              />
            )}
            <div className="text-sm">
              <div className="font-medium">{t('security.mfa.manualKey')}</div>
              <code className="mt-1 block break-all rounded bg-bg px-2 py-1 font-mono text-xs">
                {setup.secret}
              </code>
            </div>
          </div>
          <Field
            label={t('security.mfa.enterCode')}
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="max-w-xs"
            maxLength={7}
          />
          <div>
            <Button type="submit" disabled={busy || code.replace(/\s/g, '').length !== 6}>
              {t('security.mfa.activate')}
            </Button>
          </div>
        </form>
      )}

      {step === 'codes' && codes && (
        <div className="mt-4 flex flex-col gap-3">
          <h3 className="font-semibold">{t('security.mfa.recoveryTitle')}</h3>
          <p className="text-sm text-text-muted">{t('security.mfa.recoveryBody')}</p>
          <ul
            className="grid max-w-sm grid-cols-2 gap-2 rounded bg-bg p-3 font-mono text-sm"
            aria-label={t('security.mfa.recoveryTitle')}
          >
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard?.writeText(codes.join('\n'));
                setCopied(true);
              }}
            >
              {copied ? t('security.mfa.copied') : t('security.mfa.copy')}
            </Button>
            <Button
              onClick={() => {
                setCodes(null);
                setStep('idle');
                setNotice(t('security.mfa.turnedOn'));
              }}
            >
              {t('security.mfa.saved')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function SessionsSection() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { signOut } = useAuth();
  const sessions = useQuery({ queryKey: ['auth', 'sessions'], queryFn: authApi.sessions });
  const revoke = useMutation({
    mutationFn: authApi.revokeSession,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['auth', 'sessions'] }),
  });
  const fmt = (d) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d));
  const device = (ua) => {
    if (!ua) return t('security.sessions.unknownDevice');
    const browser = /Edg\//.test(ua)
      ? 'Edge'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';
    const os = /Windows/.test(ua)
      ? 'Windows'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Android/.test(ua)
          ? 'Android'
          : /iPhone|iPad/.test(ua)
            ? 'iOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : '';
    return os ? `${browser} on ${os}` : browser;
  };
  return (
    <section aria-labelledby="sess-h" className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="sess-h" className="text-lg font-semibold">
          {t('security.sessions.title')}
        </h2>
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            await authApi.logoutAll();
            await signOut();
          }}
        >
          {t('security.sessions.revokeAll')}
        </Button>
      </div>
      {sessions.isPending && <p className="mt-3 text-sm text-text-muted">{t('common.loading')}</p>}
      {sessions.isError && (
        <Alert tone="error" className="mt-3">
          {errorMessage(sessions.error, t)}
        </Alert>
      )}
      {sessions.data && (
        <ul className="mt-3 divide-y divide-slate-100">
          {sessions.data.data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-3">
                <MonitorSmartphone aria-hidden="true" className="size-5 text-text-muted" />
                <div className="text-sm">
                  <div className="font-medium">
                    {device(s.userAgent)}{' '}
                    {s.current && <Badge tone="info">{t('security.sessions.current')}</Badge>}
                  </div>
                  <div className="text-xs text-text-muted">
                    {t('security.sessions.started', { date: fmt(s.startedAt) })} ·{' '}
                    {t('security.sessions.lastActive', { date: fmt(s.lastActiveAt) })}
                    {s.ipAddress ? ` · ${s.ipAddress}` : ''}
                  </div>
                </div>
              </div>
              {!s.current && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => revoke.mutate(s.id)}
                  disabled={revoke.isPending}
                >
                  {t('security.sessions.revoke')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PasswordSection() {
  const { t } = useTranslation();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const change = useMutation({
    mutationFn: authApi.changePassword,
    onSuccess: () => {
      setDone(true);
      setForm({ currentPassword: '', newPassword: '' });
    },
    onError: (err) =>
      err instanceof ApiError && err.errors.length
        ? setFieldErrors(err.fieldErrors())
        : setError(errorMessage(err, t)),
  });
  return (
    <section aria-labelledby="pw-h" className={card}>
      <h2 id="pw-h" className="text-lg font-semibold">
        {t('security.password.title')}
      </h2>
      <form
        className="mt-4 flex max-w-sm flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setFieldErrors({});
          setError(null);
          setDone(false);
          change.mutate(form);
        }}
      >
        {done && <Alert tone="success">{t('security.password.done')}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <Field
          label={t('security.password.current')}
          type="password"
          autoComplete="current-password"
          value={form.currentPassword}
          error={fieldErrors.currentPassword}
          onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
        />
        <Field
          label={t('security.password.new')}
          type="password"
          autoComplete="new-password"
          value={form.newPassword}
          error={fieldErrors.newPassword}
          hint={t('auth.passwordHint')}
          onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
        />
        <div>
          <Button type="submit" disabled={change.isPending || !form.currentPassword || !form.newPassword}>
            {t('security.password.submit')}
          </Button>
        </div>
      </form>
    </section>
  );
}

export function SecurityPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold">{t('security.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('security.subtitle')}</p>
      </header>
      <MfaSection />
      <SessionsSection />
      <PasswordSection />
    </div>
  );
}
