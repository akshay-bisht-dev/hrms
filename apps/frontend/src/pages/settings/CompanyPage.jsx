import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { orgApi, toDayList } from '@/services/org';
import { fetchCountries } from '@/services/auth';
import { useAuth } from '@/context/AuthContext';
import { ResourceSection } from '@/components/resource/ResourceSection';
import { Button } from '@/components/ui/button';
import { Field, SelectField } from '@/components/ui/field';
import { Alert } from '@/components/ui/alert';
import { ApiError } from '@/services/api';
import { errorMessage } from '@/utils/errors';

function ProfileForm() {
  const { t, i18n } = useTranslation();
  const { can, refreshMe } = useAuth();
  const qc = useQueryClient();
  const company = useQuery({ queryKey: ['company'], queryFn: orgApi.company });
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const timezones = useMemo(
    () => (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['UTC']),
    [],
  );
  useEffect(() => {
    if (company.data && !form) setForm({ name: company.data.name, timezone: company.data.timezone });
  }, [company.data, form]);
  const save = useMutation({
    mutationFn: orgApi.updateCompany,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['company'] });
      refreshMe();
      setNotice(t('company.saved'));
    },
    onError: (err) =>
      setErrors(
        err instanceof ApiError && err.errors.length ? err.fieldErrors() : { _: errorMessage(err, t) },
      ),
  });
  if (company.isPending || !form)
    return (
      <p role="status" className="text-sm text-text-muted">
        {t('common.loading')}
      </p>
    );
  if (company.isError) return <Alert tone="error">{errorMessage(company.error, t)}</Alert>;
  const editable = can('company.profile.manage');
  return (
    <section
      aria-labelledby="profile-h"
      className="rounded-[var(--radius-card)] border border-border bg-surface p-5"
    >
      <h2 id="profile-h" className="text-base font-semibold">
        {t('company.profile')}
      </h2>
      <p className="mt-1 text-xs text-text-muted">
        {company.data.trialEndsAt &&
          t('company.trialEnds', {
            date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
              new Date(company.data.trialEndsAt),
            ),
          })}{' '}
        · {t('company.region', { region: company.data.region })}
      </p>
      <form
        className="mt-4 grid max-w-2xl gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setErrors({});
          setNotice(null);
          save.mutate(form);
        }}
      >
        {notice && (
          <Alert tone="success" className="sm:col-span-2">
            {notice}
          </Alert>
        )}
        {errors._ && (
          <Alert tone="error" className="sm:col-span-2">
            {errors._}
          </Alert>
        )}
        <Field
          label={t('company.name')}
          value={form.name}
          error={errors.name}
          disabled={!editable}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <SelectField
          label={t('company.timezone')}
          value={form.timezone}
          error={errors.timezone}
          disabled={!editable}
          onChange={(e) => setForm({ ...form, timezone: e.target.value })}
        >
          {timezones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </SelectField>
        {editable && (
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              {t('company.save')}
            </Button>
          </div>
        )}
      </form>
    </section>
  );
}

export function CompanyPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const countries = useQuery({
    queryKey: ['reference', 'countries'],
    queryFn: fetchCountries,
    staleTime: 3600_000,
  });
  const countryOptions = (countries.data?.data ?? []).map((c) => ({ value: c.code, label: c.name }));
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold">{t('company.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('company.subtitle')}</p>
      </header>
      <ProfileForm />
      <ResourceSection
        title={t('company.legalEntities')}
        description={t('company.legalEntitiesHelp')}
        endpoint="/api/v1/companies/legal-entities"
        queryKey={['org', 'legal-entities']}
        canWrite={can('company.profile.manage')}
        emptyText={t('company.noLegalEntities')}
        columns={[
          { key: 'name', label: t('company.le.name') },
          { key: 'countryCode', label: t('company.le.country') },
          { key: 'currency', label: t('company.le.currency') },
          { key: 'timezone', label: t('company.le.timezone') },
        ]}
        fields={[
          { name: 'name', label: t('company.le.name') },
          { name: 'countryCode', label: t('company.le.country'), type: 'select', options: countryOptions },
          { name: 'currency', label: t('company.le.currency') },
          { name: 'registrationNumber', label: t('company.le.registration'), optional: true },
          { name: 'fiscalYearStartMonth', label: t('company.le.fiscalStart'), type: 'number' },
          { name: 'weekStartDay', label: t('company.le.weekStart'), type: 'number' },
          { name: 'weekendDays', label: t('company.le.weekend') },
          { name: 'timezone', label: t('company.le.timezone'), type: 'timezone' },
        ]}
        fromRow={(r) => ({
          ...r,
          weekendDays: (r.weekendDays ?? []).join(','),
          registrationNumber: r.registrationNumber ?? '',
        })}
        toBody={(f) => ({
          ...f,
          weekendDays: toDayList(f.weekendDays),
          fiscalYearStartMonth: f.fiscalYearStartMonth ?? 1,
          weekStartDay: f.weekStartDay ?? 1,
        })}
      />
    </div>
  );
}
