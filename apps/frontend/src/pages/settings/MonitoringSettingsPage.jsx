import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { DEVICE_TONE, monitoringApi } from '@/services/monitoring';
import { orgApi } from '@/services/org';
import { FormMessages, useFormAction } from '@/hooks/useFormAction';
import { useAuth } from '@/context/AuthContext';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, SelectField } from '@/components/ui/field';
import { errorMessage } from '@/utils/errors';

const card = 'rounded-[var(--radius-card)] border border-border bg-surface';
const TABS = ['countries', 'checklist', 'policies', 'devices', 'reviews'];
const todayYmd = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Screen monitoring setup: off by default, on only after the checklist, per country and per person. */
export function MonitoringSettingsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [tab, setTab] = useState('checklist');
  if (!can('manage_monitoring_policy')) return <Alert tone="info">{t('monitoringSettings.noAccess')}</Alert>;
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold">{t('monitoringSettings.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('monitoringSettings.subtitle')}</p>
      </header>
      <div role="tablist" aria-label={t('monitoringSettings.title')} className="flex flex-wrap gap-1">
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`rounded-[var(--radius-control)] px-3 py-2 text-sm ${tab === k ? 'bg-primary-soft font-semibold text-primary-hover' : 'text-slate-700 hover:bg-surface'}`}
          >
            {t(`monitoringSettings.tab.${k}`)}
          </button>
        ))}
      </div>
      {tab === 'countries' && <Countries />}
      {tab === 'checklist' && <Checklist />}
      {tab === 'policies' && <Policies />}
      {tab === 'devices' && <Devices />}
      {tab === 'reviews' && <Reviews />}
    </div>
  );
}

function Countries() {
  const { t } = useTranslation();
  const list = useQuery({ queryKey: ['monitoring', 'jurisdictions'], queryFn: monitoringApi.jurisdictions });
  return (
    <section aria-label={t('monitoringSettings.tab.countries')} className={card}>
      <p className="border-b border-border px-5 py-4 text-sm text-text-muted">
        {t('monitoringSettings.countriesHelp')}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="bg-bg text-xs font-semibold text-text-muted">
              {['country', 'people', 'screenshots', 'steps', 'retention', 'notice'].map((c) => (
                <th key={c} scope="col" className="px-4 py-2.5 text-start">
                  {t(`monitoringSettings.col.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(list.data?.data ?? []).map((j) => (
              <tr key={j.country} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium">{j.country}</td>
                <td className="tabular px-4 py-3">{j.employees}</td>
                <td className="px-4 py-3">
                  <Badge tone={j.screenshots.startsWith('ALLOWED') ? 'info' : 'neutral'}>
                    {t(`monitoringSettings.allowance.${j.screenshots}`)}
                  </Badge>{' '}
                  {j.screenshots.startsWith('ALLOWED') && !j.legalReviewed && (
                    <Badge tone="warning">{t('monitoringSettings.provisional')}</Badge>
                  )}
                </td>
                <td className="px-4 py-3">
                  {j.requiredSteps.map((s) => t(`monitoringSettings.step.${s}`)).join(', ') || '—'}
                </td>
                <td className="tabular px-4 py-3">
                  {j.maxRetentionDays ? t('monitoringSettings.days', { count: j.maxRetentionDays }) : '—'}
                </td>
                <td className="tabular px-4 py-3">
                  {j.minNoticeDays !== null ? t('monitoringSettings.days', { count: j.minNoticeDays }) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const blank = () => ({
  purpose: '',
  basis: 'LEGITIMATE_INTEREST',
  explanation: '',
  noticeText: '',
  noticeStartsOn: plusDays(7),
  viewerRoleIds: [],
  retentionDays: 30,
  privacyContactName: '',
  privacyContactEmail: '',
  grievanceEmail: '',
  reviewDueOn: plusDays(90),
  companyDevicesOnly: true,
  requireDeviceApproval: true,
  steps: {},
  ownLegalAdviceConfirmed: false,
});
const fromRow = (a) => ({
  purpose: a.purpose,
  basis: a.lawfulBasis?.basis ?? 'LEGITIMATE_INTEREST',
  explanation: a.lawfulBasis?.explanation ?? '',
  noticeText: a.noticeText,
  noticeStartsOn: a.noticeStartsOn,
  viewerRoleIds: a.viewerRoleIds ?? [],
  retentionDays: a.retentionDays,
  privacyContactName: a.contacts?.privacyContactName ?? '',
  privacyContactEmail: a.contacts?.privacyContactEmail ?? '',
  grievanceEmail: a.contacts?.grievanceEmail ?? '',
  reviewDueOn: a.reviewDueOn,
  companyDevicesOnly: a.scope?.companyDevicesOnly !== false,
  requireDeviceApproval: a.scope?.requireDeviceApproval !== false,
  steps: a.jurisdictionSteps ?? {},
  ownLegalAdviceConfirmed: Boolean(a.ownLegalAdviceConfirmed),
});

function Checklist() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['monitoring', 'activations'], queryFn: monitoringApi.activations });
  const roles = useQuery({ queryKey: ['roles'], queryFn: orgApi.roles });
  const countries = useQuery({
    queryKey: ['monitoring', 'jurisdictions'],
    queryFn: monitoringApi.jurisdictions,
  });
  const rows = list.data?.data ?? [];
  const draft = rows.find((a) => a.status === 'DRAFT');
  const current = rows.find((a) => ['ACTIVE', 'PAUSED'].includes(a.status));
  const [form, setForm] = useState(blank());
  useEffect(() => {
    if (draft) setForm(fromRow(draft));
    else if (current) setForm(fromRow(current));
  }, [draft?.id, current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) =>
    setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const body = () => ({
    purpose: form.purpose,
    scope: {
      appliesTo: 'COMPANY',
      targetIds: [],
      companyDevicesOnly: form.companyDevicesOnly,
      requireDeviceApproval: form.requireDeviceApproval,
    },
    lawfulBasis: { basis: form.basis, explanation: form.explanation },
    noticeText: form.noticeText,
    noticeStartsOn: form.noticeStartsOn,
    viewerRoleIds: form.viewerRoleIds,
    retentionDays: Number(form.retentionDays),
    contacts: {
      privacyContactName: form.privacyContactName,
      privacyContactEmail: form.privacyContactEmail,
      grievanceEmail: form.grievanceEmail,
    },
    reviewDueOn: form.reviewDueOn,
    jurisdictionSteps: form.steps,
    ownLegalAdviceConfirmed: form.ownLegalAdviceConfirmed,
  });
  /** Saves into the open draft if there is one (asked fresh from the server), or starts one. */
  const saveDraft = async () => {
    const open = (await monitoringApi.activations()).data.find((a) => a.status === 'DRAFT');
    return open ? monitoringApi.updateDraft(open.id, body()) : monitoringApi.createDraft(body());
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ['monitoring'] });
  const save = useFormAction(saveDraft, () => {
    refresh();
    return t('monitoringSettings.saved');
  });
  const complete = useFormAction(
    async () => {
      const d = await saveDraft();
      try {
        return await monitoringApi.complete(d.id);
      } finally {
        refresh(); // the draft exists now, whether or not completing it was accepted
      }
    },
    () => t('monitoringSettings.completed'),
  );
  const pause = useMutation({
    mutationFn: () =>
      current.status === 'ACTIVE' ? monitoringApi.pause(current.id) : monitoringApi.resume(current.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitoring'] }),
  });
  const stepCountries = (countries.data?.data ?? []).filter(
    (c) => c.screenshots.startsWith('ALLOWED') && c.requiredSteps.length,
  );
  const setStep = (country, step, done) =>
    setForm({
      ...form,
      steps: { ...form.steps, [country]: { ...(form.steps[country] ?? {}), [step]: { done } } },
    });
  const errors = { ...save.errors, ...complete.errors };
  return (
    <div className="flex flex-col gap-4">
      {current && (
        <section
          aria-label={t('monitoringSettings.current')}
          className={`${card} flex flex-wrap items-center justify-between gap-3 p-5`}
        >
          <div className="text-sm">
            <span className="font-semibold">
              {t('monitoringSettings.version', { version: current.version })}
            </span>{' '}
            <Badge tone={current.status === 'ACTIVE' ? 'warning' : 'neutral'} withDot>
              {t(`monitoringSettings.status.${current.status}`)}
            </Badge>
            <div className="text-text-muted">
              {t('monitoringSettings.currentHelp', {
                date: current.noticeStartsOn,
                review: current.reviewDueOn,
              })}
            </div>
          </div>
          <Button variant="secondary" disabled={pause.isPending} onClick={() => pause.mutate()}>
            {current.status === 'ACTIVE' ? t('monitoringSettings.pause') : t('monitoringSettings.resume')}
          </Button>
        </section>
      )}
      <section aria-label={t('monitoringSettings.checklist')} className={card}>
        <form
          noValidate
          className="grid gap-4 p-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.run();
          }}
        >
          <div className="sm:col-span-2">
            <h2 className="text-base font-semibold">
              {draft || !current ? t('monitoringSettings.checklist') : t('monitoringSettings.newVersion')}
            </h2>
            <p className="text-sm text-text-muted">{t('monitoringSettings.checklistHelp')}</p>
          </div>
          <div className="sm:col-span-2">
            <FormMessages action={save} />
            <FormMessages action={complete} />
          </div>
          <TextArea
            id="m-purpose"
            label={t('monitoringSettings.f.purpose')}
            value={form.purpose}
            error={errors.purpose}
            onChange={set('purpose')}
          />
          <div className="flex flex-col gap-4">
            <SelectField label={t('monitoringSettings.f.basis')} value={form.basis} onChange={set('basis')}>
              {['LEGITIMATE_INTEREST', 'CONTRACT', 'LEGAL_OBLIGATION', 'CONSENT'].map((b) => (
                <option key={b} value={b}>
                  {t(`monitoringSettings.basis.${b}`)}
                </option>
              ))}
            </SelectField>
            <Field
              label={t('monitoringSettings.f.explanation')}
              value={form.explanation}
              error={errors.explanation}
              onChange={set('explanation')}
            />
          </div>
          <TextArea
            id="m-notice"
            className="sm:col-span-2"
            rows={5}
            label={t('monitoringSettings.f.notice')}
            value={form.noticeText}
            error={errors.noticeText}
            onChange={set('noticeText')}
          />
          <Field
            label={t('monitoringSettings.f.noticeStartsOn')}
            type="date"
            min={todayYmd()}
            value={form.noticeStartsOn}
            error={errors.noticeStartsOn}
            onChange={set('noticeStartsOn')}
          />
          <Field
            label={t('monitoringSettings.f.retention')}
            type="number"
            min={7}
            max={90}
            value={form.retentionDays}
            error={errors.retentionDays}
            onChange={set('retentionDays')}
          />
          <fieldset className="flex flex-col gap-2 sm:col-span-2">
            <legend className="text-sm font-medium">{t('monitoringSettings.f.viewers')}</legend>
            <div className="flex flex-wrap gap-3">
              {(roles.data?.data ?? []).map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={form.viewerRoleIds.includes(r.id)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        viewerRoleIds: e.target.checked
                          ? [...form.viewerRoleIds, r.id]
                          : form.viewerRoleIds.filter((x) => x !== r.id),
                      })
                    }
                  />
                  {r.name}
                </label>
              ))}
            </div>
            <span className="text-xs text-text-muted">{t('monitoringSettings.f.viewersHint')}</span>
            {errors.viewerRoleIds && <span className="text-xs text-red-700">{errors.viewerRoleIds}</span>}
          </fieldset>
          <Field
            label={t('monitoringSettings.f.contactName')}
            value={form.privacyContactName}
            error={errors.privacyContactName}
            onChange={set('privacyContactName')}
          />
          <Field
            label={t('monitoringSettings.f.contactEmail')}
            type="email"
            value={form.privacyContactEmail}
            error={errors.privacyContactEmail}
            onChange={set('privacyContactEmail')}
          />
          <Field
            label={t('monitoringSettings.f.grievanceEmail')}
            type="email"
            value={form.grievanceEmail}
            error={errors.grievanceEmail}
            onChange={set('grievanceEmail')}
          />
          <Field
            label={t('monitoringSettings.f.reviewDueOn')}
            type="date"
            min={todayYmd()}
            value={form.reviewDueOn}
            error={errors.reviewDueOn}
            onChange={set('reviewDueOn')}
          />
          <fieldset className="flex flex-col gap-2 sm:col-span-2">
            <legend className="text-sm font-medium">{t('monitoringSettings.f.devices')}</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={form.companyDevicesOnly}
                onChange={set('companyDevicesOnly')}
              />
              {t('monitoringSettings.f.companyDevicesOnly')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={form.requireDeviceApproval}
                onChange={set('requireDeviceApproval')}
              />
              {t('monitoringSettings.f.requireDeviceApproval')}
            </label>
          </fieldset>
          {stepCountries.map((c) => (
            <fieldset key={c.country} className="flex flex-col gap-2 sm:col-span-2">
              <legend className="text-sm font-medium">
                {t('monitoringSettings.f.stepsFor', { country: c.country })}{' '}
                {!c.legalReviewed && <Badge tone="warning">{t('monitoringSettings.provisional')}</Badge>}
              </legend>
              {c.requiredSteps.map((step) => (
                <label key={step} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={Boolean(form.steps[c.country]?.[step]?.done)}
                    onChange={(e) => setStep(c.country, step, e.target.checked)}
                  />
                  {t(`monitoringSettings.step.${step}`)}
                </label>
              ))}
              {Object.entries(errors)
                .filter(([k]) => Object.keys(form.steps).includes(k) || c.requiredSteps.includes(k))
                .map(([k, v]) => (
                  <span key={k} className="text-xs text-red-700">
                    {v}
                  </span>
                ))}
            </fieldset>
          ))}
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={form.ownLegalAdviceConfirmed}
              onChange={set('ownLegalAdviceConfirmed')}
            />
            <span>
              {t('monitoringSettings.f.legalAdvice')}
              {errors.ownLegalAdviceConfirmed && (
                <span className="block text-xs text-red-700">{errors.ownLegalAdviceConfirmed}</span>
              )}
            </span>
          </label>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit" variant="secondary" disabled={save.pending || complete.pending}>
              {t('monitoringSettings.saveDraft')}
            </Button>
            <Button type="button" disabled={save.pending || complete.pending} onClick={() => complete.run()}>
              {t('monitoringSettings.complete')}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function TextArea({ id, label, value, error, onChange, rows = 3, className = '' }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        aria-invalid={error ? true : undefined}
        onChange={onChange}
        className="rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 py-2 text-sm"
      />
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

function Policies() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['monitoring', 'policies'], queryFn: monitoringApi.policies });
  const [form, setForm] = useState({
    name: 'Company laptops',
    enabled: true,
    intervalMin: 10,
    jitterPct: 20,
    captureMode: 'FULL_SCREEN',
    retentionDays: 30,
    employeeCanDelete: false,
    excludedApps: '',
    effectiveFrom: todayYmd(),
  });
  const set = (k) => (e) =>
    setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = useFormAction(
    () =>
      monitoringApi.createPolicy({
        name: form.name,
        enabled: form.enabled,
        intervalMin: Number(form.intervalMin),
        jitterPct: Number(form.jitterPct),
        captureMode: form.captureMode,
        retentionDays: Number(form.retentionDays),
        employeeCanDelete: form.employeeCanDelete,
        ...(form.excludedApps.trim()
          ? {
              excludedApps: form.excludedApps
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : {}),
        effectiveFrom: form.effectiveFrom,
      }),
    () => {
      qc.invalidateQueries({ queryKey: ['monitoring'] });
      return t('resource.created');
    },
  );
  const rows = list.data?.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      <section aria-label={t('monitoringSettings.policies')} className={card}>
        <ul className="divide-y divide-slate-100">
          {rows.length === 0 && (
            <li className="p-5 text-sm text-text-muted">{t('monitoringSettings.noPolicies')}</li>
          )}
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
              <span>
                <strong>{p.name}</strong> v{p.version} ·{' '}
                {t('monitoringSettings.policySummary', {
                  interval: p.intervalMin,
                  jitter: p.jitterPct,
                  days: p.retentionDays,
                  mode: t(`monitoringSettings.mode.${p.captureMode}`),
                })}
              </span>
              <Badge tone={p.enabled ? 'warning' : 'neutral'}>
                {p.enabled ? t('monitoringSettings.enabled') : t('monitoringSettings.disabled')}
              </Badge>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label={t('monitoringSettings.newPolicy')} className={card}>
        <form
          noValidate
          className="grid gap-4 p-5 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.run();
          }}
        >
          <h2 className="text-base font-semibold sm:col-span-3">{t('monitoringSettings.newPolicy')}</h2>
          <div className="sm:col-span-3">
            <FormMessages action={save} />
          </div>
          <Field
            label={t('monitoringSettings.p.name')}
            value={form.name}
            error={save.errors.name}
            onChange={set('name')}
          />
          <Field
            label={t('monitoringSettings.p.interval')}
            type="number"
            min={5}
            max={240}
            value={form.intervalMin}
            error={save.errors.intervalMin}
            onChange={set('intervalMin')}
          />
          <Field
            label={t('monitoringSettings.p.jitter')}
            type="number"
            min={0}
            max={50}
            value={form.jitterPct}
            error={save.errors.jitterPct}
            onChange={set('jitterPct')}
          />
          <SelectField
            label={t('monitoringSettings.p.mode')}
            value={form.captureMode}
            onChange={set('captureMode')}
          >
            {['FULL_SCREEN', 'BLURRED', 'ACTIVE_WINDOW'].map((m) => (
              <option key={m} value={m}>
                {t(`monitoringSettings.mode.${m}`)}
              </option>
            ))}
          </SelectField>
          <Field
            label={t('monitoringSettings.p.retention')}
            type="number"
            min={1}
            max={90}
            value={form.retentionDays}
            error={save.errors.retentionDays}
            onChange={set('retentionDays')}
          />
          <Field
            label={t('monitoringSettings.p.from')}
            type="date"
            min={todayYmd()}
            value={form.effectiveFrom}
            error={save.errors.effectiveFrom}
            onChange={set('effectiveFrom')}
          />
          <Field
            className="sm:col-span-3"
            label={t('monitoringSettings.p.excluded')}
            hint={t('monitoringSettings.p.excludedHint')}
            value={form.excludedApps}
            onChange={set('excludedApps')}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={form.enabled} onChange={set('enabled')} />
            {t('monitoringSettings.p.enabled')}
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="size-4"
              checked={form.employeeCanDelete}
              onChange={set('employeeCanDelete')}
            />
            {t('monitoringSettings.p.employeeCanDelete')}
          </label>
          <p className="text-xs text-text-muted sm:col-span-3">{t('monitoringSettings.p.noActivity')}</p>
          <div className="sm:col-span-3">
            <Button type="submit" disabled={save.pending}>
              {t('monitoringSettings.createPolicy')}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Devices() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['devices', 'all'],
    queryFn: monitoringApi.devices,
    refetchOnMount: 'always',
  });
  const act = useMutation({
    mutationFn: (fn) => fn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  });
  const when = (iso) =>
    iso
      ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(
          new Date(iso),
        )
      : '—';
  return (
    <section aria-label={t('monitoringSettings.tab.devices')} className={card}>
      {act.isError && (
        <div className="px-5 pt-4">
          <Alert tone="error">{errorMessage(act.error, t)}</Alert>
        </div>
      )}
      {(list.data?.data ?? []).length === 0 && (
        <p className="p-5 text-sm text-text-muted">{t('monitoring.devices.none')}</p>
      )}
      <ul className="divide-y divide-slate-100">
        {(list.data?.data ?? []).map((d) => (
          <li
            key={d.id}
            className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"
            data-testid={`device-${d.employee?.code}`}
          >
            <span>
              <strong>{d.employee?.name}</strong> · {t(`monitoring.os.${d.os}`)} {d.osVersion} ·{' '}
              {t(`monitoring.ownership.${d.ownership}`)} ·{' '}
              {t('monitoring.devices.lastSeen', { time: when(d.lastSeenAt) })}
            </span>
            <span className="flex items-center gap-2">
              <Badge tone={DEVICE_TONE[d.status]}>{t(`monitoring.deviceStatus.${d.status}`)}</Badge>
              {d.status === 'PENDING' && (
                <Button
                  size="sm"
                  disabled={act.isPending}
                  onClick={() => act.mutate(() => monitoringApi.approveDevice(d.id))}
                >
                  {t('monitoringSettings.approve')}
                </Button>
              )}
              {d.status !== 'REVOKED' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={act.isPending}
                  onClick={() =>
                    act.mutate(() => monitoringApi.revokeDevice(d.id, 'Disconnected by an administrator'))
                  }
                >
                  {t('monitoring.devices.disconnect')}
                </Button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Reviews() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const disputes = useQuery({
    queryKey: ['screenshots', 'disputes', 'all'],
    queryFn: monitoringApi.disputes,
    refetchOnMount: 'always',
  });
  const incidents = useQuery({
    queryKey: ['screenshots', 'incidents', 'all'],
    queryFn: monitoringApi.incidents,
    refetchOnMount: 'always',
  });
  const [note, setNote] = useState('');
  const act = useMutation({
    mutationFn: (fn) => fn(),
    onSuccess: () => {
      setNote('');
      qc.invalidateQueries({ queryKey: ['screenshots'] });
    },
  });
  const open = (disputes.data?.data ?? []).filter((d) => ['OPEN', 'UNDER_REVIEW'].includes(d.status));
  const openIncidents = (incidents.data?.data ?? []).filter((i) => i.status !== 'RESOLVED');
  return (
    <div className="flex flex-col gap-4">
      <Field
        label={t('monitoringSettings.resolutionNote')}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {act.isError && <Alert tone="error">{errorMessage(act.error, t)}</Alert>}
      <section aria-label={t('monitoringSettings.disputes')} className={card}>
        <h2 className="border-b border-border px-5 py-4 text-base font-semibold">
          {t('monitoringSettings.disputes')} <span className="tabular text-text-muted">{open.length}</span>
        </h2>
        {open.length === 0 && <p className="p-5 text-sm text-text-muted">{t('approvals.none')}</p>}
        <ul className="divide-y divide-slate-100">
          {open.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 px-5 py-3 text-sm">
              <span>
                <strong>{d.employee.name}</strong> · {d.reason}
              </span>
              <span className="flex flex-wrap gap-2">
                {['RESTORED', 'DELETED', 'TIME_CORRECTED'].map((o) => (
                  <Button
                    key={o}
                    size="sm"
                    variant={o === 'DELETED' ? 'primary' : 'secondary'}
                    disabled={act.isPending || note.trim().length < 5}
                    onClick={() =>
                      act.mutate(() =>
                        monitoringApi.resolveDispute(d.id, { outcome: o, resolution: note.trim() }),
                      )
                    }
                  >
                    {t(`monitoringSettings.outcome.${o}`)}
                  </Button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label={t('monitoringSettings.incidents')} className={card}>
        <h2 className="border-b border-border px-5 py-4 text-base font-semibold">
          {t('monitoringSettings.incidents')}{' '}
          <span className="tabular text-text-muted">{openIncidents.length}</span>
        </h2>
        {openIncidents.length === 0 && <p className="p-5 text-sm text-text-muted">{t('approvals.none')}</p>}
        <ul className="divide-y divide-slate-100">
          {openIncidents.map((i) => (
            <li key={i.id} className="flex flex-col gap-2 px-5 py-3 text-sm">
              <span>{i.description}</span>
              <span>
                <Button
                  size="sm"
                  disabled={act.isPending || note.trim().length < 5}
                  onClick={() =>
                    act.mutate(() =>
                      monitoringApi.resolveIncident(i.id, {
                        resolution: note.trim(),
                        deleteScreenshot: true,
                      }),
                    )
                  }
                >
                  {t('monitoringSettings.resolveIncident')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
