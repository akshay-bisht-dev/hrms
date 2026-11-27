import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { fractionToPercent, percentToFraction } from '@hrms/shared/schemas/payroll';
import { payrollApi } from '@/services/payroll';
import { orgApi } from '@/services/org';
import { ResourceSection } from '@/components/resource/ResourceSection';
import { useFormAction, FormMessages } from '@/hooks/useFormAction';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, SelectField } from '@/components/ui/field';
import { cn } from '@/utils/cn';

const TABS = ['components', 'structures', 'statutory', 'settings'];
const KINDS = ['EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION', 'REIMBURSEMENT', 'INFORMATIONAL'];
const CALC = ['FIXED', 'PERCENTAGE', 'FORMULA', 'STATUTORY', 'INPUT'];
const card = 'rounded-[var(--radius-card)] border border-border bg-surface';

export function PayrollSettingsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('components');
  const entities = useQuery({
    queryKey: ['org', 'legal-entities'],
    queryFn: () => orgApi.list('legal-entities'),
  });
  const [leId, setLeId] = useState('');
  const le = (entities.data?.data ?? []).find((x) => x.id === leId) ?? entities.data?.data[0];
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('paySettings.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('paySettings.subtitle')}</p>
        </div>
        <SelectField
          label={t('payroll.legalEntity')}
          value={le?.id ?? ''}
          onChange={(e) => setLeId(e.target.value)}
        >
          {(entities.data?.data ?? []).map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} ({x.countryCode})
            </option>
          ))}
        </SelectField>
      </header>
      <div
        role="tablist"
        aria-label={t('paySettings.title')}
        className="flex flex-wrap gap-1 border-b border-border"
      >
        {TABS.map((k) => (
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
            {t(`paySettings.tabs.${k}`)}
          </button>
        ))}
      </div>
      {le && tab === 'components' && <Components le={le} />}
      {le && tab === 'structures' && <Structures le={le} />}
      {le && tab === 'statutory' && <Statutory le={le} />}
      {le && tab === 'settings' && <Settings le={le} />}
    </div>
  );
}

function Components({ le }) {
  const { t } = useTranslation();
  const keys = useQuery({
    queryKey: ['payroll', 'keys', le.id],
    queryFn: () => payrollApi.statutoryKeys(le.id),
  });
  const keyOptions = (keys.data?.keys ?? []).map((k) => ({ value: k.key, label: k.label }));
  return (
    <ResourceSection
      title={t('paySettings.tabs.components')}
      description={t('paySettings.components.help')}
      endpoint="/api/v1/payroll/components"
      queryKey={['payroll', 'components']}
      canWrite
      emptyText={t('paySettings.components.empty')}
      columns={[
        { key: 'code', label: t('paySettings.components.code') },
        { key: 'name', label: t('paySettings.components.name') },
        { key: 'kind', label: t('paySettings.components.kind'), render: (r) => t(`payroll.kind.${r.kind}`) },
        {
          key: 'calc',
          label: t('paySettings.components.calc'),
          render: (r) =>
            r.calcType === 'PERCENTAGE'
              ? `${fractionToPercent(r.rate)}% × ${r.percentOf}`
              : r.calcType === 'FORMULA'
                ? r.formula
                : r.calcType === 'STATUTORY'
                  ? (keyOptions.find((k) => k.value === r.statutoryKey)?.label ?? r.statutoryKey)
                  : r.calcType === 'FIXED'
                    ? r.fixedAmount
                    : t(`paySettings.calc.${r.calcType}`),
        },
      ]}
      fields={[
        { name: 'code', label: t('paySettings.components.code'), hint: t('paySettings.components.codeHint') },
        { name: 'name', label: t('paySettings.components.name') },
        {
          name: 'kind',
          label: t('paySettings.components.kind'),
          type: 'select',
          options: KINDS.map((k) => ({ value: k, label: t(`payroll.kind.${k}`) })),
        },
        {
          name: 'calcType',
          label: t('paySettings.components.calc'),
          type: 'select',
          options: CALC.map((k) => ({ value: k, label: t(`paySettings.calc.${k}`) })),
        },
        {
          name: 'ratePercent',
          label: t('paySettings.components.ratePercent'),
          optional: true,
          hint: t('paySettings.components.ratePercentHint'),
        },
        {
          name: 'percentOf',
          label: t('paySettings.components.percentOf'),
          optional: true,
          hint: t('paySettings.components.percentOfHint'),
        },
        { name: 'fixedAmount', label: t('paySettings.components.fixedAmount'), optional: true },
        {
          name: 'formula',
          label: t('paySettings.components.formula'),
          optional: true,
          hint: t('paySettings.components.formulaHint'),
        },
        {
          name: 'statutoryKey',
          label: t('paySettings.components.statutoryKey'),
          type: 'select',
          options: keyOptions,
          optional: true,
        },
        { name: 'taxable', label: t('paySettings.components.taxable'), type: 'checkbox', default: true },
      ]}
      fromRow={(r) => ({
        ...r,
        ratePercent: fractionToPercent(r.rate),
        percentOf: r.percentOf ?? '',
        fixedAmount: r.fixedAmount ?? '',
        formula: r.formula ?? '',
        statutoryKey: r.statutoryKey ?? '',
      })}
      toBody={({ ratePercent, ...f }) => ({
        ...f,
        rate: ratePercent ? percentToFraction(ratePercent) : null,
      })}
    />
  );
}

function Structures({ le }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['payroll', 'structures'], queryFn: payrollApi.structures });
  const comps = useQuery({ queryKey: ['payroll', 'components'], queryFn: payrollApi.components });
  const mine = (list.data?.data ?? []).filter((s) => s.legalEntityId === le.id);
  const [selected, setSelected] = useState(null);
  const [rows, setRows] = useState([]);
  const structure = useQuery({
    queryKey: ['payroll', 'structure', selected],
    queryFn: () => payrollApi.structure(selected),
    enabled: Boolean(selected),
  });
  useEffect(() => {
    if (structure.data)
      setRows(
        structure.data.components.map((c) => ({ componentId: c.componentId, code: c.code, name: c.name })),
      );
  }, [structure.data]);
  const starter = useFormAction(
    () => payrollApi.indiaStarter(le.id),
    (out) => {
      qc.invalidateQueries({ queryKey: ['payroll'] });
      setSelected(out.structure.id);
      return t('paySettings.structures.starterDone', { count: out.createdComponents.length });
    },
  );
  const [newName, setNewName] = useState('');
  const create = useFormAction(
    () =>
      payrollApi.createStructure({
        legalEntityId: le.id,
        name: newName,
        currency: le.currency,
        effectiveFrom: `${new Date().getFullYear()}-01-01`,
      }),
    (s) => {
      qc.invalidateQueries({ queryKey: ['payroll', 'structures'] });
      setSelected(s.id);
      setNewName('');
      return null;
    },
  );
  const save = useFormAction(
    () =>
      payrollApi.setStructureComponents(
        selected,
        rows.map((r, i) => ({ componentId: r.componentId, sequence: (i + 1) * 10 })),
      ),
    () => {
      qc.invalidateQueries({ queryKey: ['payroll', 'structure', selected] });
      return t('resource.updated');
    },
  );
  const move = (i, d) =>
    setRows((rs) => {
      const next = [...rs];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      return next;
    });
  const available = (comps.data?.data ?? []).filter(
    (c) => c.isActive && !rows.some((r) => r.componentId === c.id),
  );
  return (
    <div className="flex flex-col gap-4">
      <section aria-label={t('paySettings.tabs.structures')} className={cn(card, 'flex flex-col gap-3 p-5')}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SelectField
            label={t('paySettings.structures.pick')}
            value={selected ?? ''}
            onChange={(e) => setSelected(e.target.value || null)}
          >
            <option value="">{t('resource.choose')}</option>
            {mine.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
          <div className="flex flex-wrap items-end gap-2">
            <Field
              label={t('paySettings.structures.newName')}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button
              variant="secondary"
              disabled={!newName.trim() || create.pending}
              onClick={() => create.run()}
            >
              {t('resource.create')}
            </Button>
            {le.countryCode === 'IN' && (
              <Button disabled={starter.pending} onClick={() => starter.run()}>
                {t('paySettings.structures.loadStarter')}
              </Button>
            )}
          </div>
        </div>
        <FormMessages action={starter} />
        <FormMessages action={create} />
      </section>
      {selected && (
        <section aria-label={t('paySettings.structures.order')} className={card}>
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold">{t('paySettings.structures.order')}</h2>
            <p className="text-sm text-text-muted">{t('paySettings.structures.orderHelp')}</p>
          </div>
          <ol className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <li key={r.componentId} className="flex items-center justify-between px-5 py-2 text-sm">
                <span>
                  <span className="tabular text-text-muted">{i + 1}.</span> {r.name}{' '}
                  <span className="text-text-muted">{r.code}</span>
                </span>
                <span className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={i === 0}
                    aria-label={t('paySettings.structures.up', { name: r.name })}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp aria-hidden="true" className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={i === rows.length - 1}
                    aria-label={t('paySettings.structures.down', { name: r.name })}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown aria-hidden="true" className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('paySettings.structures.remove', { name: r.name })}
                    onClick={() => setRows(rows.filter((x) => x !== r))}
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-end gap-2 border-t border-border p-5">
            <SelectField
              label={t('paySettings.structures.add')}
              value=""
              onChange={(e) => {
                const c = available.find((x) => x.id === e.target.value);
                if (c) setRows([...rows, { componentId: c.id, code: c.code, name: c.name }]);
              }}
            >
              <option value="">{t('resource.choose')}</option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </SelectField>
            <Button disabled={save.pending || rows.length === 0} onClick={() => save.run()}>
              {t('paySettings.structures.save')}
            </Button>
          </div>
          <div className="px-5 pb-4">
            <FormMessages action={save} />
          </div>
        </section>
      )}
    </div>
  );
}

function Statutory({ le }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['payroll', 'statutory', le.id],
    queryFn: () => payrollApi.statutorySettings(le.id),
  });
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (q.data)
      setForm({
        ...q.data.settings,
        pfWageCodes: (q.data.settings.pfWageCodes ?? []).join(', '),
        ptState: q.data.settings.ptState ?? '',
        registrationNumbers: q.data.registrationNumbers ?? {},
        effectiveFrom: new Date().toISOString().slice(0, 10),
      });
  }, [q.data]);
  const save = useFormAction(
    () =>
      payrollApi.saveStatutorySettings(le.id, {
        settings: {
          pfEnabled: form.pfEnabled,
          pfOnActualWages: form.pfOnActualWages,
          esiEnabled: form.esiEnabled,
          ptState: form.ptState || null,
          pfWageCodes: form.pfWageCodes
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        },
        registrationNumbers: form.registrationNumbers,
        effectiveFrom: form.effectiveFrom,
      }),
    () => t('resource.updated'),
  );
  if (q.isSuccess && !q.data.pack)
    return <Alert tone="info">{t('paySettings.statutory.noPack', { country: le.countryCode })}</Alert>;
  if (!form) return <p role="status">{t('common.loading')}</p>;
  const box = (k) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4"
        checked={Boolean(form[k])}
        onChange={(e) => setForm({ ...form, [k]: e.target.checked })}
      />
      {t(`paySettings.statutory.${k}`)}
    </label>
  );
  const reg = (k) => (
    <Field
      key={k}
      label={t(`paySettings.statutory.reg.${k}`)}
      value={form.registrationNumbers[k] ?? ''}
      onChange={(e) =>
        setForm({ ...form, registrationNumbers: { ...form.registrationNumbers, [k]: e.target.value } })
      }
    />
  );
  return (
    <section aria-label={t('paySettings.tabs.statutory')} className={card}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.run();
        }}
        className="grid gap-4 p-5 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <h2 className="text-base font-semibold">
            {t('paySettings.statutory.title', { pack: q.data.pack.code, version: q.data.pack.ruleVersion })}
          </h2>
          {!q.data.pack.reviewed && (
            <Alert tone="warning" className="mt-2">
              {t('paySettings.statutory.notReviewed')}
            </Alert>
          )}
        </div>
        <div className="sm:col-span-2">
          <FormMessages action={save} />
        </div>
        <div className="flex flex-col gap-2">
          {box('pfEnabled')}
          {box('pfOnActualWages')}
          {box('esiEnabled')}
        </div>
        <div className="flex flex-col gap-3">
          <SelectField
            label={t('paySettings.statutory.ptState')}
            value={form.ptState}
            error={save.errors.ptState}
            onChange={(e) => setForm({ ...form, ptState: e.target.value })}
          >
            <option value="">{t('paySettings.statutory.noPt')}</option>
            {q.data.ptStates.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </SelectField>
          <Field
            label={t('paySettings.statutory.pfWageCodes')}
            hint={t('paySettings.statutory.pfWageCodesHint')}
            value={form.pfWageCodes}
            error={save.errors.pfWageCodes}
            onChange={(e) => setForm({ ...form, pfWageCodes: e.target.value })}
          />
        </div>
        {['pf', 'esi', 'pt', 'tan'].map(reg)}
        <Field
          label={t('paySettings.statutory.from')}
          type="date"
          value={form.effectiveFrom}
          error={save.errors.effectiveFrom}
          onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
        />
        <div className="self-end">
          <Button type="submit" disabled={save.pending}>
            {t('paySettings.statutory.save')}
          </Button>
        </div>
      </form>
    </section>
  );
}

function Settings({ le }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['payroll', 'settings', le.id], queryFn: () => payrollApi.settings(le.id) });
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (q.data) setForm({ ...q.data, payDayOfMonth: q.data.payDayOfMonth ?? '' });
  }, [q.data]);
  const save = useFormAction(
    () =>
      payrollApi.saveSettings(le.id, {
        paidDaysBasis: form.paidDaysBasis,
        lopFromAbsence: form.lopFromAbsence,
        payDayOfMonth: form.payDayOfMonth === '' ? null : Number(form.payDayOfMonth),
      }),
    () => t('resource.updated'),
  );
  if (!form) return <p role="status">{t('common.loading')}</p>;
  return (
    <section aria-label={t('paySettings.tabs.settings')} className={card}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.run();
        }}
        className="grid gap-4 p-5 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <FormMessages action={save} />
        </div>
        <SelectField
          label={t('paySettings.settings.basis')}
          value={form.paidDaysBasis}
          onChange={(e) => setForm({ ...form, paidDaysBasis: e.target.value })}
        >
          <option value="CALENDAR">{t('paySettings.settings.calendar')}</option>
          <option value="FIXED_30">{t('paySettings.settings.fixed30')}</option>
        </SelectField>
        <Field
          label={t('paySettings.settings.payDay')}
          hint={t('paySettings.settings.payDayHint')}
          type="number"
          min={1}
          max={31}
          value={form.payDayOfMonth}
          error={save.errors.payDayOfMonth}
          onChange={(e) => setForm({ ...form, payDayOfMonth: e.target.value })}
        />
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            className="size-4"
            checked={form.lopFromAbsence}
            onChange={(e) => setForm({ ...form, lopFromAbsence: e.target.checked })}
          />
          {t('paySettings.settings.lopFromAbsence')}
        </label>
        <div>
          <Button type="submit" disabled={save.pending}>
            {t('resource.save')}
          </Button>
        </div>
      </form>
    </section>
  );
}
