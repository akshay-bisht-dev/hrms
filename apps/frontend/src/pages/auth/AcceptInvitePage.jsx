import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiFetch, ApiError } from '@/services/api';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { errorMessage } from '@/utils/errors';

export function AcceptInvitePage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const info = useQuery({
    queryKey: ['invite', token],
    queryFn: () => apiFetch('/api/v1/auth/invite-info', { method: 'POST', json: { token }, auth: false }),
    enabled: token.length > 20,
    retry: false,
  });
  const [form, setForm] = useState({ fullName: '', password: '' });
  const [errors, setErrors] = useState({});
  const accept = useMutation({
    mutationFn: () =>
      apiFetch('/api/v1/auth/accept-invite', {
        method: 'POST',
        json: { token, ...(info.data?.needsPassword ? form : {}) },
        auth: false,
      }),
    onError: (err) =>
      setErrors(
        err instanceof ApiError && err.errors.length ? err.fieldErrors() : { _: errorMessage(err, t) },
      ),
  });

  if (!token || info.isError) return <Alert tone="error">{t('invite.invalid')}</Alert>;
  if (info.isPending)
    return (
      <p role="status" className="text-sm text-text-muted">
        {t('common.loading')}
      </p>
    );
  if (accept.isSuccess) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success">{t('invite.done', { company: info.data.companyName })}</Alert>
        <Button asChild>
          <Link to="/login">{t('invite.signIn')}</Link>
        </Button>
      </div>
    );
  }
  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        setErrors({});
        accept.mutate();
      }}
    >
      <div>
        <h1 className="text-2xl font-bold">{t('invite.title', { company: info.data.companyName })}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('invite.body', { email: info.data.email })}</p>
      </div>
      {errors._ && <Alert tone="error">{errors._}</Alert>}
      {info.data.needsPassword ? (
        <>
          <Field
            label={t('invite.fullName')}
            autoComplete="name"
            value={form.fullName}
            error={errors.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
          <Field
            label={t('invite.password')}
            type="password"
            autoComplete="new-password"
            hint={t('auth.passwordHint')}
            value={form.password}
            error={errors.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </>
      ) : (
        <p className="text-sm">{t('invite.existing')}</p>
      )}
      <Button type="submit" disabled={accept.isPending}>
        {t('invite.accept')}
      </Button>
    </form>
  );
}
