import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { workApi } from '@/services/work';
import { orgApi } from '@/services/org';
import { employeesApi } from '@/services/employees';
import { FormMessages, useFormAction } from '@/hooks/useFormAction';
import { useAuth } from '@/context/AuthContext';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, SelectField } from '@/components/ui/field';
import { errorMessage } from '@/utils/errors';

const card = 'rounded-[var(--radius-card)] border border-border bg-surface';
const TARGETS = ['COMPANY', 'LEGAL_ENTITY', 'BRANCH', 'DEPARTMENT', 'EMPLOYEE'];
const todayYmd = () => new Date().toISOString().slice(0, 10);
const fullName = (e) => [e.firstName, e.lastName].filter(Boolean).join(' ');

const blank = () => ({
  name: '',
  appliesTo: 'COMPANY',
  targetId: '',
  priority: 0,
  wfhAllowed: true,
  wfhRequiresApproval: true,
  wfhMaxDaysPerMonth: '',
  allowedStart: '00:00',
  allowedEnd: '24:00',
  heartbeatTimeoutSec: 180,
  resumeWindowMin: 120,
  maxBreakMinutes: '',
  effectiveFrom: todayYmd(),
});
const fromPolicy = (p) => ({
  ...blank(),
  ...Object.fromEntries(Object.keys(blank()).map((k) => [k, p[k] ?? blank()[k]])),
  targetId: p.targetId ?? '',
  wfhMaxDaysPerMonth: p.wfhMaxDaysPerMonth ?? '',
  maxBreakMinutes: p.maxBreakMinutes ?? '',
  effectiveFrom: todayYmd(),
});

/** Work policies: who may work from home, allowed hours, heartbeat timeout and when abandoned sessions close. */
export function WorkSettingsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [editing, setEditing] = useState(null); // null | { mode: 'new' } | { mode: 'version', policy }
  if (!can('work.config.manage')) return <Alert tone="info">{t('workSettings.noAccess')}</Alert>;
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold">{t('workSettings.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">
          {t('workSettings.subtitle')}{' '}
          <Link className="underline" to="/settings/attendance">
            {t('workSettings.locationsLink')}
          </Link>
        </p>
      </header>
      {editing && (
        <PolicyForm key={editing.policy?.id ?? 'new'} editing={editing} onClose={() => setEditing(null)} />
      )}
      <Policies
        onNew={() => setEditing({ mode: 'new' })}
        onChange={(policy) => setEditing({ mode: 'version', policy })}
      />
    </div>
  );
}

function Policies({ onNew, onChange }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['work', 'policies'], queryFn: workApi.policies });
  const retire = useMutation({
    mutationFn: (id) => workApi.retirePolicy(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work'] }),
  });
  const rows = list.data?.data ?? [];
  const latest = rows.filter((p) => !rows.some((q) => q.name === p.name && q.version > p.version));
  return (
    <section aria-label={t('workSettings.policies')} className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">{t('workSettings.policies')}</h2>
        <Button size="sm" variant="secondary" onClick={onNew}>
          {t('workSettings.new')}
        </Button>
      </div>
      {list.isError && (
        <div className="p-5">
          <Alert tone="error">{errorMessage(list.error, t)}</Alert>
        </div>
      )}
      {retire.isError && (
        <div className="px-5 pt-4">
          <Alert tone="error">{errorMessage(retire.error, t)}</Alert>
        </div>
      )}
      <ul className="divide-y divide-slate-100">
        {latest.map((p) => {
          const versions = rows.filter((q) => q.name === p.name).length;
          return (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 text-sm">
              <div className="flex flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {p.name} <span className="text-text-muted">v{p.version}</span>
                  <Badge tone={p.inForce ? 'success' : 'neutral'}>
                    {p.inForce
                      ? t('workSettings.inForce')
                      : p.effectiveTo
                        ? t('workSettings.ended')
                        : t('workSettings.upcoming')}
                  </Badge>
                </span>
                <span className="text-text-muted">
                  {t(`leaveSettings.assign.targets.${p.appliesTo}`)} · {p.effectiveFrom}
                  {p.effectiveTo ? ` – ${p.effectiveTo}` : ''} ·{' '}
                  {p.wfhAllowed
                    ? p.wfhRequiresApproval
                      ? t('workSettings.wfhApproval')
                      : t('workSettings.wfhFree')
                    : t('workSettings.wfhOff')}
                  {p.wfhMaxDaysPerMonth
                    ? ` · ${t('workSettings.wfhMax', { count: p.wfhMaxDaysPerMonth })}`
                    : ''}
                </span>
                <span className="text-text-muted">
                  {t('workSettings.summary', {
                    from: p.allowedStart,
                    to: p.allowedEnd,
                    timeout: Math.round(p.heartbeatTimeoutSec / 60),
                    window: p.resumeWindowMin,
                  })}
                  {versions > 1 ? ` · ${t('workSettings.versions', { count: versions })}` : ''}
                </span>
              </div>
              {!p.effectiveTo && (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => onChange(p)}>
                    {t('workSettings.change')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={retire.isPending}
                    onClick={() => retire.mutate(p.id)}
                  >
                    {t('workSettings.retire')}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PolicyForm({ editing, onClose }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isNew = editing.mode === 'new';
  const [form, setForm] = useState(() => (isNew ? blank() : fromPolicy(editing.policy)));
  const set = (k) => (e) =>
    setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const targetPath = { LEGAL_ENTITY: 'legal-entities', BRANCH: 'branches', DEPARTMENT: 'departments' }[
    form.appliesTo
  ];
  const targets = useQuery({
    queryKey: ['org', targetPath],
    queryFn: () => orgApi.list(targetPath),
    enabled: Boolean(targetPath),
  });
  const people = useQuery({
    queryKey: ['employees', 'pick-all'],
    queryFn: () => employeesApi.list({ limit: 200 }),
    enabled: form.appliesTo === 'EMPLOYEE',
  });
  const options =
    form.appliesTo === 'EMPLOYEE'
      ? (people.data?.data ?? []).map((e) => ({ value: e.id, label: `${fullName(e)} · ${e.employeeCode}` }))
      : (targets.data?.data ?? []).map((x) => ({ value: x.id, label: x.name }));
  const num = (v) => (v === '' || v === null ? null : Number(v));
  const save = useFormAction(
    () => {
      const body = {
        appliesTo: form.appliesTo,
        targetId: form.appliesTo === 'COMPANY' ? null : form.targetId || null,
        priority: Number(form.priority) || 0,
        wfhAllowed: form.wfhAllowed,
        wfhRequiresApproval: form.wfhRequiresApproval,
        wfhMaxDaysPerMonth: num(form.wfhMaxDaysPerMonth),
        allowedStart: form.allowedStart,
        allowedEnd: form.allowedEnd,
        heartbeatTimeoutSec: Number(form.heartbeatTimeoutSec),
        resumeWindowMin: Number(form.resumeWindowMin),
        maxBreakMinutes: num(form.maxBreakMinutes),
        effectiveFrom: form.effectiveFrom,
      };
      return isNew
        ? workApi.createPolicy({ name: form.name, ...body })
        : workApi.changePolicy(editing.policy.id, body);
    },
    () => {
      qc.invalidateQueries({ queryKey: ['work'] });
      onClose();
      return null;
    },
  );
  const e = save.errors;
  return (
    <section
      aria-label={
        isNew ? t('workSettings.new') : t('workSettings.changeTitle', { name: editing.policy.name })
      }
      className="rounded-[var(--radius-card)] border border-primary/40 bg-surface"
    >
      <form
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          save.run();
        }}
        className="grid gap-4 p-5 sm:grid-cols-3"
      >
        <div className="sm:col-span-3">
          <h2 className="text-base font-semibold">
            {isNew ? t('workSettings.new') : t('workSettings.changeTitle', { name: editing.policy.name })}
          </h2>
          <p className="text-sm text-text-muted">
            {isNew ? t('workSettings.newHelp') : t('workSettings.versionHelp')}
          </p>
        </div>
        <div className="sm:col-span-3">
          <FormMessages action={save} />
        </div>
        {isNew && (
          <Field label={t('workSettings.f.name')} value={form.name} error={e.name} onChange={set('name')} />
        )}
        <SelectField
          label={t('leaveSettings.assign.appliesTo')}
          value={form.appliesTo}
          onChange={(ev) => setForm({ ...form, appliesTo: ev.target.value, targetId: '' })}
        >
          {TARGETS.map((k) => (
            <option key={k} value={k}>
              {t(`leaveSettings.assign.targets.${k}`)}
            </option>
          ))}
        </SelectField>
        {form.appliesTo !== 'COMPANY' ? (
          <SelectField
            label={t('leaveSettings.assign.target')}
            value={form.targetId}
            error={e.targetId}
            onChange={set('targetId')}
          >
            <option value="">{t('resource.choose')}</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectField>
        ) : (
          !isNew && <div />
        )}
        <Field
          label={t('workSettings.f.effectiveFrom')}
          type="date"
          min={todayYmd()}
          value={form.effectiveFrom}
          error={e.effectiveFrom}
          onChange={set('effectiveFrom')}
        />
        <Field
          label={t('workSettings.f.allowedStart')}
          type="time"
          value={form.allowedStart}
          error={e.allowedStart}
          onChange={set('allowedStart')}
        />
        <Field
          label={t('workSettings.f.allowedEnd')}
          value={form.allowedEnd}
          error={e.allowedEnd}
          hint={t('workSettings.f.allowedEndHint')}
          inputMode="numeric"
          onChange={set('allowedEnd')}
        />
        <Field
          label={t('workSettings.f.heartbeatTimeoutSec')}
          type="number"
          min={120}
          max={3600}
          value={form.heartbeatTimeoutSec}
          error={e.heartbeatTimeoutSec}
          hint={t('workSettings.f.heartbeatHint')}
          onChange={set('heartbeatTimeoutSec')}
        />
        <Field
          label={t('workSettings.f.resumeWindowMin')}
          type="number"
          min={5}
          max={720}
          value={form.resumeWindowMin}
          error={e.resumeWindowMin}
          hint={t('workSettings.f.resumeHint')}
          onChange={set('resumeWindowMin')}
        />
        <Field
          label={t('workSettings.f.maxBreakMinutes')}
          type="number"
          min={1}
          value={form.maxBreakMinutes}
          error={e.maxBreakMinutes}
          hint={t('workSettings.f.optional')}
          onChange={set('maxBreakMinutes')}
        />
        <Field
          label={t('workSettings.f.priority')}
          type="number"
          min={0}
          max={100}
          value={form.priority}
          error={e.priority}
          hint={t('workSettings.f.priorityHint')}
          onChange={set('priority')}
        />
        <fieldset className="flex flex-col gap-2 sm:col-span-3">
          <legend className="text-sm font-medium">{t('workSettings.f.wfh')}</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={form.wfhAllowed}
              onChange={set('wfhAllowed')}
            />
            {t('workSettings.f.wfhAllowed')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              disabled={!form.wfhAllowed}
              checked={form.wfhRequiresApproval}
              onChange={set('wfhRequiresApproval')}
            />
            {t('workSettings.f.wfhRequiresApproval')}
          </label>
        </fieldset>
        <Field
          label={t('workSettings.f.wfhMaxDaysPerMonth')}
          type="number"
          min={1}
          max={31}
          disabled={!form.wfhAllowed}
          value={form.wfhMaxDaysPerMonth}
          error={e.wfhMaxDaysPerMonth}
          hint={t('workSettings.f.optional')}
          onChange={set('wfhMaxDaysPerMonth')}
        />
        <div className="flex gap-2 sm:col-span-3">
          <Button type="submit" disabled={save.pending}>
            {isNew ? t('workSettings.create') : t('workSettings.saveVersion')}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </section>
  );
}
