import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { days, leaveApi } from '@/services/leave';
import { employeesApi, fullName } from '@/services/employees';
import { orgApi } from '@/services/org';
import { ApiError } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { ResourceSection } from '@/components/resource/ResourceSection';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, SelectField } from '@/components/ui/field';
import { cn } from '@/utils/cn';
import { errorMessage } from '@/utils/errors';

const TABS = ['types', 'policies', 'assignments', 'balances', 'accruals'];
const card = 'rounded-[var(--radius-card)] border border-border bg-surface';
const thisYear = () => new Date().toISOString().slice(0, 4);

/** Form state for an action with field errors and a notice. */
function useFormAction(fn, onDone) {
  const { t } = useTranslation();
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const m = useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      setErrors({});
      setError(null);
      setNotice(onDone?.(data) ?? t('resource.updated'));
    },
    onError: (e) => {
      setNotice(null);
      if (e instanceof ApiError && e.errors.length) setErrors(e.fieldErrors());
      else setError(errorMessage(e, t));
    },
  });
  const run = (...args) => {
    setErrors({});
    setError(null);
    setNotice(null);
    m.mutate(...args);
  };
  return { run, pending: m.isPending, errors, error, notice };
}

function Messages({ action }) {
  return (
    <>
      {action.notice && <Alert tone="success">{action.notice}</Alert>}
      {action.error && <Alert tone="error">{action.error}</Alert>}
    </>
  );
}

export function LeaveSettingsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canConfig = can('leave.config.manage');
  const [tab, setTab] = useState(canConfig ? 'types' : 'balances');
  const visible = TABS.filter((k) => canConfig || k === 'balances');
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold">{t('leaveSettings.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('leaveSettings.subtitle')}</p>
      </header>
      <div
        role="tablist"
        aria-label={t('leaveSettings.title')}
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {visible.map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm',
              tab === k
                ? 'border-primary font-semibold text-primary-hover'
                : 'border-transparent text-text-muted hover:text-text',
            )}
          >
            {t(`leaveSettings.tabs.${k}`)}
          </button>
        ))}
      </div>
      {tab === 'types' && <Types />}
      {tab === 'policies' && <Policies />}
      {tab === 'assignments' && <Assignments />}
      {tab === 'balances' && <Balances canAdjust={can('leave.balance.adjust')} />}
      {tab === 'accruals' && <Accruals />}
    </div>
  );
}

function Types() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const starter = useFormAction(leaveApi.starterPack, (out) => {
    qc.invalidateQueries({ queryKey: ['leave'] });
    return out.created.length
      ? t('leaveSettings.starter.done', { list: out.created.join(', ') })
      : t('leaveSettings.starter.none');
  });
  return (
    <div className="flex flex-col gap-4">
      <div className={cn(card, 'flex flex-wrap items-center justify-between gap-3 p-5')}>
        <div>
          <h2 className="text-base font-semibold">{t('leaveSettings.starter.title')}</h2>
          <p className="text-sm text-text-muted">{t('leaveSettings.starter.help')}</p>
        </div>
        <Button variant="secondary" disabled={starter.pending} onClick={() => starter.run()}>
          {t('leaveSettings.starter.load')}
        </Button>
      </div>
      <Messages action={starter} />
      <ResourceSection
        title={t('leaveSettings.tabs.types')}
        endpoint="/api/v1/leaves/types"
        queryKey={['leave', 'types']}
        canWrite
        emptyText={t('leaveSettings.type.empty')}
        columns={[
          { key: 'name', label: t('leaveSettings.type.name') },
          { key: 'code', label: t('leaveSettings.type.code') },
          {
            key: 'isPaid',
            label: t('leaveSettings.type.paid'),
            render: (r) => (r.isPaid ? t('leaveSettings.yes') : t('leaveSettings.no')),
          },
          {
            key: 'doc',
            label: t('leaveSettings.type.document'),
            render: (r) =>
              r.requiresDocumentAfterDays
                ? t('leaveSettings.type.after', { n: r.requiresDocumentAfterDays })
                : '—',
          },
        ]}
        fields={[
          { name: 'name', label: t('leaveSettings.type.name') },
          { name: 'code', label: t('leaveSettings.type.code') },
          { name: 'isPaid', label: t('leaveSettings.type.paid'), type: 'checkbox', default: true },
          { name: 'allowNegative', label: t('leaveSettings.type.negative'), type: 'checkbox' },
          {
            name: 'requiresDocumentAfterDays',
            label: t('leaveSettings.type.documentDays'),
            type: 'number',
            optional: true,
          },
          { name: 'color', label: t('leaveSettings.type.color'), optional: true, hint: '#2563eb' },
        ]}
        fromRow={(r) => ({
          ...r,
          requiresDocumentAfterDays: r.requiresDocumentAfterDays ?? '',
          color: r.color ?? '',
        })}
      />
    </div>
  );
}

const DEFAULT_RULES = {
  method: 'MONTHLY',
  daysPerYear: '20',
  prorateForJoiners: true,
  yearStartMonth: 1,
  carryForwardMaxDays: '5',
  maxBalanceDays: '',
  allowHalfDay: true,
  countWeekends: false,
  countHolidays: false,
  sandwich: false,
  minNoticeDays: 0,
  maxConsecutiveDays: '',
  minTenureDays: 0,
  approvalLevels: 1,
};
const rulesToForm = (r) => ({
  method: r.accrual.method,
  daysPerYear: r.accrual.daysPerYear,
  prorateForJoiners: r.accrual.prorateForJoiners,
  yearStartMonth: r.yearStartMonth,
  carryForwardMaxDays: r.carryForwardMaxDays ?? '',
  maxBalanceDays: r.maxBalanceDays ?? '',
  allowHalfDay: r.allowHalfDay,
  countWeekends: r.countWeekends,
  countHolidays: r.countHolidays,
  sandwich: r.sandwich,
  minNoticeDays: r.minNoticeDays,
  maxConsecutiveDays: r.maxConsecutiveDays ?? '',
  minTenureDays: r.minTenureDays,
  approvalLevels: r.approvalLevels,
});
const formToRules = (f) => ({
  accrual: {
    method: f.method,
    daysPerYear: f.method === 'NONE' ? '0' : String(f.daysPerYear),
    prorateForJoiners: f.prorateForJoiners,
  },
  yearStartMonth: Number(f.yearStartMonth),
  carryForwardMaxDays: f.carryForwardMaxDays === '' ? null : String(f.carryForwardMaxDays),
  maxBalanceDays: f.maxBalanceDays === '' ? null : String(f.maxBalanceDays),
  allowHalfDay: f.allowHalfDay,
  countWeekends: f.countWeekends,
  countHolidays: f.countHolidays,
  sandwich: f.sandwich,
  minNoticeDays: Number(f.minNoticeDays),
  maxConsecutiveDays: f.maxConsecutiveDays === '' ? null : Number(f.maxConsecutiveDays),
  minTenureDays: Number(f.minTenureDays),
  approvalLevels: Number(f.approvalLevels),
});

/** The rules part of a policy form. Errors arrive with paths like rules.accrual.daysPerYear → key 'daysPerYear'. */
function RulesFields({ value, onChange, errors }) {
  const { t } = useTranslation();
  const set = (k) => (e) =>
    onChange({ ...value, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const box = (k) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" className="size-4" checked={Boolean(value[k])} onChange={set(k)} />
      {t(`leaveSettings.rules.${k}`)}
    </label>
  );
  return (
    <>
      <SelectField label={t('leaveSettings.rules.method')} value={value.method} onChange={set('method')}>
        {['MONTHLY', 'ANNUAL_UPFRONT', 'NONE'].map((m) => (
          <option key={m} value={m}>
            {t(`leaveSettings.rules.methods.${m}`)}
          </option>
        ))}
      </SelectField>
      {value.method !== 'NONE' ? (
        <Field
          label={t('leaveSettings.rules.daysPerYear')}
          value={value.daysPerYear}
          error={errors.daysPerYear}
          onChange={set('daysPerYear')}
        />
      ) : (
        <div />
      )}
      <Field
        label={t('leaveSettings.rules.carryForward')}
        hint={t('leaveSettings.rules.carryForwardHint')}
        value={value.carryForwardMaxDays}
        error={errors.carryForwardMaxDays}
        onChange={set('carryForwardMaxDays')}
      />
      <Field
        label={t('leaveSettings.rules.maxBalance')}
        hint={t('leaveSettings.rules.emptyNoLimit')}
        value={value.maxBalanceDays}
        error={errors.maxBalanceDays}
        onChange={set('maxBalanceDays')}
      />
      <Field
        label={t('leaveSettings.rules.yearStartMonth')}
        type="number"
        min={1}
        max={12}
        value={value.yearStartMonth}
        error={errors.yearStartMonth}
        onChange={set('yearStartMonth')}
      />
      <Field
        label={t('leaveSettings.rules.minNotice')}
        type="number"
        min={0}
        value={value.minNoticeDays}
        error={errors.minNoticeDays}
        onChange={set('minNoticeDays')}
      />
      <Field
        label={t('leaveSettings.rules.maxConsecutive')}
        hint={t('leaveSettings.rules.emptyNoLimit')}
        type="number"
        value={value.maxConsecutiveDays}
        error={errors.maxConsecutiveDays}
        onChange={set('maxConsecutiveDays')}
      />
      <Field
        label={t('leaveSettings.rules.minTenure')}
        type="number"
        min={0}
        value={value.minTenureDays}
        error={errors.minTenureDays}
        onChange={set('minTenureDays')}
      />
      <SelectField
        label={t('leaveSettings.rules.approvalLevels')}
        value={value.approvalLevels}
        onChange={set('approvalLevels')}
      >
        <option value={1}>{t('leaveSettings.rules.levels1')}</option>
        <option value={2}>{t('leaveSettings.rules.levels2')}</option>
      </SelectField>
      <div className="flex flex-col gap-2 sm:col-span-2">
        {box('prorateForJoiners')}
        {box('allowHalfDay')}
        {box('countWeekends')}
        {box('countHolidays')}
        {box('sandwich')}
      </div>
    </>
  );
}

function Policies() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const types = useQuery({ queryKey: ['leave', 'types', 'all'], queryFn: leaveApi.types });
  const entities = useQuery({
    queryKey: ['org', 'legal-entities'],
    queryFn: () => orgApi.list('legal-entities'),
  });
  const list = useQuery({ queryKey: ['leave', 'policies'], queryFn: leaveApi.policies });
  const [form, setForm] = useState(null); // null | { mode: 'new' } | { mode: 'version', policy }
  const [base, setBase] = useState({
    name: '',
    leaveTypeId: '',
    legalEntityId: '',
    effectiveFrom: `${thisYear()}-01-01`,
  });
  const [rules, setRules] = useState(DEFAULT_RULES);
  const save = useFormAction(
    () =>
      form.mode === 'new'
        ? leaveApi.createPolicy({
            name: base.name,
            leaveTypeId: base.leaveTypeId,
            legalEntityId: base.legalEntityId || null,
            rules: formToRules(rules),
            effectiveFrom: base.effectiveFrom,
          })
        : leaveApi.newVersion(form.policy.id, {
            rules: formToRules(rules),
            effectiveFrom: base.effectiveFrom,
          }),
    () => {
      qc.invalidateQueries({ queryKey: ['leave'] });
      setForm(null);
      return t('resource.created');
    },
  );
  const typeName = (id) => types.data?.data.find((x) => x.id === id)?.name ?? '—';
  const accrualText = (r) =>
    r.accrual.method === 'NONE'
      ? t('leaveSettings.rules.methods.NONE')
      : `${t(`leaveSettings.rules.methods.${r.accrual.method}`)} · ${days(r.accrual.daysPerYear)} ${t('leaveSettings.perYear')}`;
  const rows = list.data?.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      <Messages action={save} />
      {form && (
        <section aria-label={t('leaveSettings.policy.formTitle')} className={card}>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              save.run();
            }}
            className="grid gap-4 p-5 sm:grid-cols-2"
          >
            <h2 className="text-base font-semibold sm:col-span-2">
              {form.mode === 'new'
                ? t('leaveSettings.policy.new')
                : t('leaveSettings.policy.versionOf', { name: form.policy.name })}
            </h2>
            {form.mode === 'new' && (
              <>
                <Field
                  label={t('leaveSettings.policy.name')}
                  value={base.name}
                  error={save.errors.name}
                  onChange={(e) => setBase({ ...base, name: e.target.value })}
                />
                <SelectField
                  label={t('leaveSettings.policy.type')}
                  value={base.leaveTypeId}
                  error={save.errors.leaveTypeId}
                  onChange={(e) => setBase({ ...base, leaveTypeId: e.target.value })}
                >
                  <option value="">{t('resource.choose')}</option>
                  {(types.data?.data ?? []).map((ty) => (
                    <option key={ty.id} value={ty.id}>
                      {ty.name}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label={t('leaveSettings.policy.entity')}
                  value={base.legalEntityId}
                  onChange={(e) => setBase({ ...base, legalEntityId: e.target.value })}
                >
                  <option value="">{t('attSettings.ot.allEntities')}</option>
                  {(entities.data?.data ?? []).map((le) => (
                    <option key={le.id} value={le.id}>
                      {le.name}
                    </option>
                  ))}
                </SelectField>
              </>
            )}
            <Field
              label={t('leaveSettings.policy.from')}
              type="date"
              value={base.effectiveFrom}
              error={save.errors.effectiveFrom}
              onChange={(e) => setBase({ ...base, effectiveFrom: e.target.value })}
            />
            <RulesFields value={rules} onChange={setRules} errors={save.errors} />
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={save.pending}>
                {t('resource.create')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setForm(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        </section>
      )}
      <section aria-label={t('leaveSettings.tabs.policies')} className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">{t('leaveSettings.tabs.policies')}</h2>
            <p className="text-sm text-text-muted">{t('leaveSettings.policy.help')}</p>
          </div>
          {!form && (
            <Button
              size="sm"
              onClick={() => {
                setRules(DEFAULT_RULES);
                setForm({ mode: 'new' });
              }}
            >
              {t('resource.add')}
            </Button>
          )}
        </div>
        {list.isSuccess && rows.length === 0 && (
          <p className="p-5 text-sm text-text-muted">{t('leaveSettings.policy.empty')}</p>
        )}
        <ul className="divide-y divide-slate-100">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <div className="flex flex-col">
                <span className="font-medium">
                  {p.name} <span className="text-text-muted">v{p.version}</span>
                </span>
                <span className="text-text-muted">
                  {typeName(p.leaveTypeId)} · {accrualText(p.rules)} · {p.effectiveFrom.slice(0, 10)}
                  {p.effectiveTo ? ` – ${p.effectiveTo.slice(0, 10)}` : ''}
                </span>
              </div>
              {!p.effectiveTo && !form && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setRules(rulesToForm(p.rules));
                    setBase({ ...base, effectiveFrom: `${Number(thisYear()) + 1}-01-01` });
                    setForm({ mode: 'version', policy: p });
                  }}
                >
                  {t('leaveSettings.policy.newVersion')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Assignments() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const policies = useQuery({ queryKey: ['leave', 'policies'], queryFn: leaveApi.policies });
  const list = useQuery({ queryKey: ['leave', 'assignments'], queryFn: leaveApi.assignments });
  const [form, setForm] = useState({
    policyId: '',
    appliesTo: 'COMPANY',
    targetId: '',
    effectiveFrom: `${thisYear()}-01-01`,
    effectiveTo: '',
  });
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
  const save = useFormAction(
    () =>
      leaveApi.assign({
        policyId: form.policyId,
        appliesTo: form.appliesTo,
        targetId: form.appliesTo === 'COMPANY' ? null : form.targetId || null,
        effectiveFrom: form.effectiveFrom,
        ...(form.effectiveTo ? { effectiveTo: form.effectiveTo } : {}),
      }),
    () => {
      qc.invalidateQueries({ queryKey: ['leave'] });
      return t('resource.created');
    },
  );
  const remove = useMutation({
    mutationFn: (id) => leaveApi.unassign(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leave'] }),
  });
  const rows = list.data?.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      <section aria-label={t('leaveSettings.assign.title')} className={card}>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save.run();
          }}
          className="grid gap-4 p-5 sm:grid-cols-3"
        >
          <div className="sm:col-span-3">
            <h2 className="text-base font-semibold">{t('leaveSettings.assign.title')}</h2>
            <p className="text-sm text-text-muted">{t('leaveSettings.assign.help')}</p>
          </div>
          <div className="sm:col-span-3">
            <Messages action={save} />
          </div>
          <SelectField
            label={t('leaveSettings.assign.policy')}
            value={form.policyId}
            error={save.errors.policyId}
            onChange={(e) => setForm({ ...form, policyId: e.target.value })}
          >
            <option value="">{t('resource.choose')}</option>
            {(policies.data?.data ?? [])
              .filter((p) => !p.effectiveTo)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} v{p.version}
                </option>
              ))}
          </SelectField>
          <SelectField
            label={t('leaveSettings.assign.appliesTo')}
            value={form.appliesTo}
            onChange={(e) => setForm({ ...form, appliesTo: e.target.value, targetId: '' })}
          >
            {['COMPANY', 'LEGAL_ENTITY', 'BRANCH', 'DEPARTMENT', 'EMPLOYEE'].map((k) => (
              <option key={k} value={k}>
                {t(`leaveSettings.assign.targets.${k}`)}
              </option>
            ))}
          </SelectField>
          {form.appliesTo !== 'COMPANY' ? (
            <SelectField
              label={t('leaveSettings.assign.target')}
              value={form.targetId}
              error={save.errors.targetId}
              onChange={(e) => setForm({ ...form, targetId: e.target.value })}
            >
              <option value="">{t('resource.choose')}</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </SelectField>
          ) : (
            <div />
          )}
          <Field
            label={t('leaveSettings.policy.from')}
            type="date"
            value={form.effectiveFrom}
            error={save.errors.effectiveFrom}
            onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
          />
          <Field
            label={t('attSettings.assign.to')}
            type="date"
            value={form.effectiveTo}
            error={save.errors.effectiveTo}
            onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })}
          />
          <div className="self-end">
            <Button type="submit" disabled={save.pending || !form.policyId}>
              {t('leaveSettings.assign.submit')}
            </Button>
          </div>
        </form>
      </section>
      <section aria-label={t('leaveSettings.assign.current')} className={card}>
        <h2 className="border-b border-border px-5 py-4 text-base font-semibold">
          {t('leaveSettings.assign.current')}
        </h2>
        {list.isSuccess && rows.length === 0 && (
          <p className="p-5 text-sm text-text-muted">{t('leaveSettings.assign.empty')}</p>
        )}
        <ul className="divide-y divide-slate-100">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <span>
                <span className="font-medium">
                  {a.policy.name} v{a.policy.version}
                </span>{' '}
                · {t(`leaveSettings.assign.targets.${a.appliesTo}`)} · {a.effectiveFrom}
                {a.effectiveTo ? ` – ${a.effectiveTo}` : ''}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('leaveSettings.assign.remove', { name: a.policy.name })}
                onClick={() => remove.mutate(a.id)}
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Balances({ canAdjust }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [employee, setEmployee] = useState(null);
  const people = useQuery({
    queryKey: ['employees', 'pick', q],
    queryFn: () => employeesApi.list({ limit: 20, q }),
  });
  const balances = useQuery({
    queryKey: ['leave', 'balances', employee?.id],
    queryFn: () => leaveApi.balances(employee.id),
    enabled: Boolean(employee),
  });
  const ledger = useQuery({
    queryKey: ['leave', 'ledger', employee?.id],
    queryFn: () => leaveApi.ledger(employee.id),
    enabled: Boolean(employee),
  });
  const types = useQuery({ queryKey: ['leave', 'types', 'all'], queryFn: leaveApi.types });
  const [form, setForm] = useState({
    leaveTypeId: '',
    entryType: 'ADJUSTMENT',
    quantity: '',
    postedOn: new Date().toISOString().slice(0, 10),
    note: '',
  });
  const adjust = useFormAction(
    () => leaveApi.adjust({ ...form, employeeId: employee.id }),
    (out) => {
      qc.invalidateQueries({ queryKey: ['leave'] });
      return t('leaveSettings.balance.saved', { balance: days(out.balance) });
    },
  );
  return (
    <div className="flex flex-col gap-4">
      <section aria-label={t('leaveSettings.balance.pick')} className={cn(card, 'flex flex-col gap-3 p-5')}>
        <h2 className="text-base font-semibold">{t('leaveSettings.balance.pick')}</h2>
        <input
          type="search"
          aria-label={t('employees.search')}
          placeholder={t('employees.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-10 w-72 max-w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-sm"
        />
        <div className="flex flex-wrap gap-2">
          {(people.data?.data ?? []).map((e) => (
            <Button
              key={e.id}
              size="sm"
              variant={employee?.id === e.id ? 'primary' : 'secondary'}
              onClick={() => setEmployee(e)}
            >
              {fullName(e)}
            </Button>
          ))}
        </div>
      </section>
      {employee && (
        <>
          <section
            aria-label={t('leaveSettings.balance.title', { name: fullName(employee) })}
            className={card}
          >
            <h2 className="border-b border-border px-5 py-4 text-base font-semibold">
              {t('leaveSettings.balance.title', { name: fullName(employee) })}
            </h2>
            {balances.isError && (
              <div className="p-5">
                <Alert tone="error">{errorMessage(balances.error, t)}</Alert>
              </div>
            )}
            <ul className="divide-y divide-slate-100">
              {(balances.data?.data ?? []).map((b) => (
                <li key={b.leaveType.id} className="flex justify-between px-5 py-2.5 text-sm">
                  <span>{b.leaveType.name}</span>
                  <span className="tabular">
                    {days(b.balance)} · {t('leaveSettings.balance.pending', { n: days(b.pending) })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          {canAdjust && (
            <section aria-label={t('leaveSettings.balance.adjust')} className={card}>
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  adjust.run();
                }}
                className="grid gap-4 p-5 sm:grid-cols-3"
              >
                <div className="sm:col-span-3">
                  <h2 className="text-base font-semibold">{t('leaveSettings.balance.adjust')}</h2>
                  <p className="text-sm text-text-muted">{t('leaveSettings.balance.adjustHelp')}</p>
                </div>
                <div className="sm:col-span-3">
                  <Messages action={adjust} />
                </div>
                <SelectField
                  label={t('leaveSettings.policy.type')}
                  value={form.leaveTypeId}
                  error={adjust.errors.leaveTypeId}
                  onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}
                >
                  <option value="">{t('resource.choose')}</option>
                  {(types.data?.data ?? []).map((ty) => (
                    <option key={ty.id} value={ty.id}>
                      {ty.name}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  label={t('leaveSettings.balance.kind')}
                  value={form.entryType}
                  onChange={(e) => setForm({ ...form, entryType: e.target.value })}
                >
                  <option value="ADJUSTMENT">{t('leaveSettings.balance.kinds.ADJUSTMENT')}</option>
                  <option value="OPENING_BALANCE">{t('leaveSettings.balance.kinds.OPENING_BALANCE')}</option>
                </SelectField>
                <Field
                  label={t('leaveSettings.balance.quantity')}
                  hint={t('leaveSettings.balance.quantityHint')}
                  value={form.quantity}
                  error={adjust.errors.quantity}
                  onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                />
                <Field
                  label={t('leaveSettings.balance.postedOn')}
                  type="date"
                  value={form.postedOn}
                  error={adjust.errors.postedOn}
                  onChange={(e) => setForm({ ...form, postedOn: e.target.value })}
                />
                <Field
                  className="sm:col-span-2"
                  label={t('leaveSettings.balance.note')}
                  value={form.note}
                  error={adjust.errors.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
                <div className="sm:col-span-3">
                  <Button type="submit" disabled={adjust.pending}>
                    {t('leaveSettings.balance.post')}
                  </Button>
                </div>
              </form>
            </section>
          )}
          <section aria-label={t('leaveSettings.balance.ledger')} className={card}>
            <h2 className="border-b border-border px-5 py-4 text-base font-semibold">
              {t('leaveSettings.balance.ledger')}
            </h2>
            {ledger.isSuccess && ledger.data.data.length === 0 && (
              <p className="p-5 text-sm text-text-muted">{t('leaveSettings.balance.noEntries')}</p>
            )}
            {(ledger.data?.data.length ?? 0) > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="bg-bg text-xs font-semibold text-text-muted">
                      {['date', 'type', 'entry', 'quantity', 'balance', 'note'].map((c) => (
                        <th key={c} scope="col" className="px-4 py-2.5 text-start">
                          {t(`leaveSettings.balance.col.${c}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...ledger.data.data].reverse().map((e) => (
                      <tr key={e.id} className="tabular border-t border-slate-100">
                        <td className="px-4 py-2.5">{e.postedOn}</td>
                        <td className="px-4 py-2.5">{e.leaveType.name}</td>
                        <td className="px-4 py-2.5">{t(`leaveSettings.balance.entries.${e.entryType}`)}</td>
                        <td className="px-4 py-2.5">{days(e.quantity)}</td>
                        <td className="px-4 py-2.5">{days(e.balanceAfter)}</td>
                        <td className="px-4 py-2.5 text-text-muted">{e.note ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Accruals() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const run = useFormAction(
    () => leaveApi.runAccruals(month),
    () => t('leaveSettings.accruals.queued', { month }),
  );
  return (
    <section aria-label={t('leaveSettings.tabs.accruals')} className={card}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          run.run();
        }}
        className="flex flex-col gap-4 p-5"
      >
        <div>
          <h2 className="text-base font-semibold">{t('leaveSettings.tabs.accruals')}</h2>
          <p className="text-sm text-text-muted">{t('leaveSettings.accruals.help')}</p>
        </div>
        <Messages action={run} />
        <label className="flex w-56 flex-col gap-1.5 text-sm font-medium">
          {t('attendance.month')}
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="h-11 rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-sm font-normal"
          />
        </label>
        <div>
          <Button type="submit" disabled={run.pending}>
            {t('leaveSettings.accruals.run')}
          </Button>
        </div>
      </form>
    </section>
  );
}
