import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RegisterBody } from '@hrms/shared/schemas/auth';
import { Button } from '@/components/ui/button';
import { Field, SelectField } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { authApi, fetchCountries } from '@/services/auth';
import { ApiError } from '@/services/api';
import { errorMessage } from '@/utils/errors';

export function RegisterPage() {
  const { t } = useTranslation();
  const countries = useQuery({
    queryKey: ['reference', 'countries'],
    queryFn: fetchCountries,
    staleTime: 3600_000,
  });
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    companyName: '',
    countryCode: 'IN',
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [doneFor, setDoneFor] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError(null);
    const parsed = RegisterBody.omit({ timezone: true }).safeParse(form);
    if (!parsed.success)
      return setFieldErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message])));
    setFieldErrors({});
    setBusy(true);
    try {
      await authApi.register(parsed.data);
      setDoneFor(parsed.data.email);
    } catch (err) {
      if (err instanceof ApiError && err.errors.length) setFieldErrors(err.fieldErrors());
      else setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  if (doneFor) {
    return (
      <div className="flex flex-col gap-4" role="status">
        <h1 className="text-2xl font-bold">{t('auth.register.doneTitle')}</h1>
        <p className="text-sm text-text-muted">{t('auth.register.doneBody', { email: doneFor })}</p>
        <Button asChild variant="secondary">
          <Link to="/login">{t('auth.register.signIn')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">{t('auth.register.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('auth.register.subtitle')}</p>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <Field
        label={t('auth.fullName')}
        autoComplete="name"
        value={form.fullName}
        error={fieldErrors.fullName}
        onChange={set('fullName')}
        autoFocus
      />
      <Field
        label={t('auth.email')}
        type="email"
        autoComplete="email"
        value={form.email}
        error={fieldErrors.email}
        onChange={set('email')}
      />
      <Field
        label={t('auth.password')}
        type="password"
        autoComplete="new-password"
        value={form.password}
        error={fieldErrors.password}
        hint={t('auth.passwordHint')}
        onChange={set('password')}
      />
      <Field
        label={t('auth.companyName')}
        autoComplete="organization"
        value={form.companyName}
        error={fieldErrors.companyName}
        onChange={set('companyName')}
      />
      <SelectField
        label={t('auth.country')}
        value={form.countryCode}
        error={fieldErrors.countryCode}
        onChange={set('countryCode')}
        disabled={!countries.data}
      >
        {(countries.data?.data ?? [{ code: form.countryCode, name: t('common.loading') }]).map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <p className="text-xs text-text-muted">{t('auth.register.terms')}</p>
      <Button type="submit" disabled={busy}>
        {t('auth.register.submit')}
      </Button>
      <p className="text-center text-sm text-text-muted">
        {t('auth.register.haveAccount')}{' '}
        <Link to="/login" className="font-medium text-primary hover:underline">
          {t('auth.register.signIn')}
        </Link>
      </p>
    </form>
  );
}
