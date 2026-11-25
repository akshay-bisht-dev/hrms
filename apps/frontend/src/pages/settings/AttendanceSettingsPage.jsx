import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { attendanceApi, hm, minutesToHm } from '@/services/attendance';
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

const TABS = ['shifts', 'assignments', 'overtime', 'policy', 'locations', 'recalculate'];
const LOCATION_TYPES = ['OFFICE', 'WFH', 'HYBRID', 'REMOTE', 'CLIENT_SITE', 'TRAVEL', 'CUSTOM'];
const today = () => new Date().toISOString().slice(0, 10);

export function AttendanceSettingsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const canManage = can('attendance.manage');
  const [tab, setTab] = useState('shifts');
  const legalEntities = useQuery({
    queryKey: ['org', 'legal-entities'],
    queryFn: () => orgApi.list('legal-entities'),
  });
  const entityOptions = (legalEntities.data?.data ?? []).map((e) => ({ value: e.id, label: e.name }));

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold">{t('attSettings.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('attSettings.subtitle')}</p>
      </header>
      <div
        role="tablist"
        aria-label={t('attSettings.title')}
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
            {t(`attSettings.tabs.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'shifts' && (
        <ResourceSection
          title={t('attSettings.tabs.shifts')}
          description={t('attSettings.shift.help')}
          endpoint="/api/v1/attendance/shifts"
          queryKey={['attendance', 'shifts']}
          canWrite={canManage}
          emptyText={t('attSettings.shift.empty')}
          columns={[
            { key: 'name', label: t('attSettings.shift.name') },
            {
              key: 'hours',
              label: t('attSettings.shift.hours'),
              render: (r) =>
                `${minutesToHm(r.startMin)}–${minutesToHm(r.endMin)}${r.crossesMidnight ? ` (${t('attSettings.shift.nextDay')})` : ''}`,
            },
            { key: 'breakMinutes', label: t('attSettings.shift.break'), render: (r) => hm(r.breakMinutes) },
            {
              key: 'grace',
              label: t('attSettings.shift.grace'),
              render: (r) => `${r.graceLateMin} / ${r.graceEarlyMin} min`,
            },
          ]}
          fields={[
            { name: 'name', label: t('attSettings.shift.name') },
            { name: 'startTime', label: t('attSettings.shift.start'), type: 'time' },
            {
              name: 'endTime',
              label: t('attSettings.shift.end'),
              type: 'time',
              hint: t('attSettings.shift.endHint'),
            },
            { name: 'breakMinutes', label: t('attSettings.shift.breakMinutes'), type: 'number', default: 60 },
            { name: 'graceLateMin', label: t('attSettings.shift.graceLate'), type: 'number', default: 10 },
            { name: 'graceEarlyMin', label: t('attSettings.shift.graceEarly'), type: 'number', default: 10 },
          ]}
          fromRow={(r) => ({ ...r, startTime: minutesToHm(r.startMin), endTime: minutesToHm(r.endMin) })}
          toBody={(f) => ({
            ...f,
            breakMinutes: f.breakMinutes ?? 0,
            graceLateMin: f.graceLateMin ?? 0,
            graceEarlyMin: f.graceEarlyMin ?? 0,
          })}
        />
      )}
      {tab === 'assignments' && <Assignments canManage={canManage} />}
      {tab === 'overtime' && (
        <ResourceSection
          title={t('attSettings.tabs.overtime')}
          description={t('attSettings.ot.help')}
          endpoint="/api/v1/attendance/overtime-rules"
          queryKey={['attendance', 'overtime-rules']}
          canWrite={canManage}
          emptyText={t('attSettings.ot.empty')}
          columns={[
            { key: 'name', label: t('attSettings.ot.name') },
            {
              key: 'legalEntityId',
              label: t('attSettings.ot.entity'),
              render: (r) =>
                entityOptions.find((o) => o.value === r.legalEntityId)?.label ??
                t('attSettings.ot.allEntities'),
            },
            {
              key: 'thresholds',
              label: t('attSettings.ot.thresholds'),
              render: (r) =>
                [
                  r.dailyThresholdMin !== null
                    ? t('attSettings.ot.daily', { time: hm(r.dailyThresholdMin) })
                    : null,
                  r.weeklyThresholdMin !== null
                    ? t('attSettings.ot.weekly', { time: hm(r.weeklyThresholdMin) })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || '—',
            },
            {
              key: 'multiplier',
              label: t('attSettings.ot.multiplier'),
              render: (r) => `×${Number(r.multiplier)}`,
            },
            {
              key: 'effectiveFrom',
              label: t('attSettings.ot.from'),
              render: (r) => r.effectiveFrom.slice(0, 10),
            },
          ]}
          fields={[
            { name: 'name', label: t('attSettings.ot.name') },
            {
              name: 'legalEntityId',
              label: t('attSettings.ot.entity'),
              type: 'select',
              options: entityOptions,
              optional: true,
            },
            {
              name: 'dailyThresholdMin',
              label: t('attSettings.ot.dailyMin'),
              type: 'number',
              optional: true,
              default: 480,
            },
            {
              name: 'weeklyThresholdMin',
              label: t('attSettings.ot.weeklyMin'),
              type: 'number',
              optional: true,
            },
            {
              name: 'multiplier',
              label: t('attSettings.ot.multiplier'),
              hint: t('attSettings.ot.multiplierHint'),
              default: '1.5',
            },
            { name: 'effectiveFrom', label: t('attSettings.ot.from'), type: 'date' },
            { name: 'effectiveTo', label: t('attSettings.ot.to'), type: 'date', optional: true },
            {
              name: 'requiresApproval',
              label: t('attSettings.ot.requiresApproval'),
              type: 'checkbox',
              default: true,
            },
            {
              name: 'restDayAllOvertime',
              label: t('attSettings.ot.restDay'),
              type: 'checkbox',
              default: true,
            },
          ]}
          fromRow={(r) => ({
            ...r,
            legalEntityId: r.legalEntityId ?? '',
            dailyThresholdMin: r.dailyThresholdMin ?? '',
            weeklyThresholdMin: r.weeklyThresholdMin ?? '',
            multiplier: String(Number(r.multiplier)),
            effectiveFrom: r.effectiveFrom.slice(0, 10),
            effectiveTo: r.effectiveTo ? r.effectiveTo.slice(0, 10) : '',
          })}
        />
      )}
      {tab === 'policy' && <Policy canManage={canManage} entityOptions={entityOptions} />}
      {tab === 'locations' && (
        <ResourceSection
          title={t('attSettings.tabs.locations')}
          description={t('attSettings.loc.help')}
          endpoint="/api/v1/companies/work-locations"
          queryKey={['org', 'work-locations']}
          canWrite={can('company.org.manage')}
          emptyText={t('attSettings.loc.empty')}
          columns={[
            { key: 'name', label: t('attSettings.loc.name') },
            {
              key: 'type',
              label: t('attSettings.loc.type'),
              render: (r) => t(`attSettings.loc.types.${r.type}`),
            },
            {
              key: 'flags',
              label: t('attSettings.loc.status'),
              render: (r) =>
                [
                  r.isActive ? t('attSettings.loc.active') : t('attSettings.loc.inactive'),
                  r.requiresApproval ? t('attSettings.loc.needsApproval') : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
            },
          ]}
          fields={[
            { name: 'name', label: t('attSettings.loc.name') },
            {
              name: 'type',
              label: t('attSettings.loc.type'),
              type: 'select',
              options: LOCATION_TYPES.map((v) => ({ value: v, label: t(`attSettings.loc.types.${v}`) })),
            },
            { name: 'isActive', label: t('attSettings.loc.active'), type: 'checkbox', default: true },
            { name: 'requiresApproval', label: t('attSettings.loc.needsApproval'), type: 'checkbox' },
          ]}
        />
      )}
      {tab === 'recalculate' && <Recalculate canManage={canManage} />}
    </div>
  );
}

function Assignments({ canManage }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const shifts = useQuery({ queryKey: ['attendance', 'shifts', ''], queryFn: attendanceApi.shifts });
  const list = useQuery({
    queryKey: ['attendance', 'assignments'],
    queryFn: () => attendanceApi.assignments(),
  });
  const [q, setQ] = useState('');
  const people = useQuery({
    queryKey: ['employees', 'pick', q],
    queryFn: () => employeesApi.list({ limit: 50, q }),
    enabled: canManage,
  });
  const [form, setForm] = useState({ shiftId: '', effectiveFrom: today(), effectiveTo: '' });
  const [picked, setPicked] = useState(() => new Map());
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const assign = useMutation({
    mutationFn: () =>
      attendanceApi.assign({
        shiftId: form.shiftId,
        employeeIds: [...picked.keys()],
        effectiveFrom: form.effectiveFrom,
        ...(form.effectiveTo ? { effectiveTo: form.effectiveTo } : {}),
      }),
    onSuccess: (out) => {
      setNotice(t('attSettings.assign.done', { count: out.created }));
      setPicked(new Map());
      qc.invalidateQueries({ queryKey: ['attendance', 'assignments'] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors.length) setErrors(e.fieldErrors());
      else setError(errorMessage(e, t));
    },
  });
  const remove = useMutation({
    mutationFn: (id) => attendanceApi.unassign(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance', 'assignments'] }),
    onError: (e) => setError(errorMessage(e, t)),
  });
  const toggle = (e) =>
    setPicked((m) => {
      const next = new Map(m);
      if (next.has(e.id)) next.delete(e.id);
      else next.set(e.id, fullName(e));
      return next;
    });
  const rows = list.data?.data ?? [];
  return (
    <div className="flex flex-col gap-6">
      {canManage && (
        <section
          aria-label={t('attSettings.assign.title')}
          className="rounded-[var(--radius-card)] border border-border bg-surface"
        >
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              setErrors({});
              setError(null);
              setNotice(null);
              assign.mutate();
            }}
            className="grid gap-4 p-5 sm:grid-cols-3"
          >
            <div className="sm:col-span-3">
              <h2 className="text-base font-semibold">{t('attSettings.assign.title')}</h2>
              <p className="text-sm text-text-muted">{t('attSettings.assign.help')}</p>
            </div>
            {notice && (
              <div className="sm:col-span-3">
                <Alert tone="success">{notice}</Alert>
              </div>
            )}
            {error && (
              <div className="sm:col-span-3">
                <Alert tone="error">{error}</Alert>
              </div>
            )}
            <SelectField
              label={t('attSettings.assign.shift')}
              value={form.shiftId}
              error={errors.shiftId}
              onChange={(e) => setForm({ ...form, shiftId: e.target.value })}
            >
              <option value="">{t('resource.choose')}</option>
              {(shifts.data?.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({minutesToHm(s.startMin)}–{minutesToHm(s.endMin)})
                </option>
              ))}
            </SelectField>
            <Field
              label={t('attSettings.assign.from')}
              type="date"
              value={form.effectiveFrom}
              error={errors.effectiveFrom}
              onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
            />
            <Field
              label={t('attSettings.assign.to')}
              type="date"
              value={form.effectiveTo}
              error={errors.effectiveTo}
              hint={t('attSettings.assign.toHint')}
              onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })}
            />
            <fieldset className="flex flex-col gap-2 sm:col-span-3">
              <legend className="text-sm font-medium">
                {t('attSettings.assign.people')} <span className="text-text-muted">({picked.size})</span>
              </legend>
              <input
                type="search"
                aria-label={t('employees.search')}
                placeholder={t('employees.search')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="h-10 w-72 max-w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-sm"
              />
              <div className="flex max-h-56 flex-col overflow-y-auto rounded-[var(--radius-control)] border border-border">
                {(people.data?.data ?? []).map((e) => (
                  <label
                    key={e.id}
                    className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-0"
                  >
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={picked.has(e.id)}
                      onChange={() => toggle(e)}
                    />
                    {fullName(e)} <span className="text-text-muted">{e.employeeCode}</span>
                  </label>
                ))}
              </div>
              {errors.employeeIds && <span className="text-xs text-red-700">{errors.employeeIds}</span>}
            </fieldset>
            <div className="sm:col-span-3">
              <Button type="submit" disabled={assign.isPending || picked.size === 0 || !form.shiftId}>
                {t('attSettings.assign.submit', { count: picked.size })}
              </Button>
            </div>
          </form>
        </section>
      )}
      <section
        aria-label={t('attSettings.assign.current')}
        className="rounded-[var(--radius-card)] border border-border bg-surface"
      >
        <h2 className="border-b border-border px-5 py-4 text-base font-semibold">
          {t('attSettings.assign.current')}
        </h2>
        {list.isError && (
          <div className="p-5">
            <Alert tone="error">{errorMessage(list.error, t)}</Alert>
          </div>
        )}
        {list.isSuccess && rows.length === 0 && (
          <p className="p-5 text-sm text-text-muted">{t('attSettings.assign.empty')}</p>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="bg-bg text-xs font-semibold text-text-muted">
                  <th scope="col" className="px-4 py-2.5 text-start">
                    {t('attendance.col.name')}
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-start">
                    {t('attSettings.assign.shift')}
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-start">
                    {t('attSettings.assign.from')}
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-start">
                    {t('attSettings.assign.to')}
                  </th>
                  <th scope="col" className="px-4 py-2.5">
                    <span className="sr-only">{t('attendance.col.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">{a.employee.name}</td>
                    <td className="px-4 py-3">{a.shift.name}</td>
                    <td className="tabular px-4 py-3">{a.effectiveFrom}</td>
                    <td className="tabular px-4 py-3">{a.effectiveTo ?? t('attSettings.assign.open')}</td>
                    <td className="px-4 py-3 text-end">
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('attSettings.assign.remove', { name: a.employee.name })}
                          onClick={() => remove.mutate(a.id)}
                        >
                          <Trash2 aria-hidden="true" className="size-4" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Policy({ canManage, entityOptions }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [legalEntityId, setLegalEntityId] = useState('');
  const policy = useQuery({
    queryKey: ['attendance', 'policy', legalEntityId],
    queryFn: () => attendanceApi.policy(legalEntityId || undefined),
  });
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (policy.data) setForm(policy.data);
  }, [policy.data]);
  const save = useMutation({
    mutationFn: () =>
      attendanceApi.savePolicy({
        legalEntityId: legalEntityId || null,
        presentPercent: Number(form.presentPercent),
        halfDayPercent: Number(form.halfDayPercent),
        autoDeductBreak: form.autoDeductBreak,
        captureIp: form.captureIp,
        captureGeo: form.captureGeo,
        regularizationWindowDays: Number(form.regularizationWindowDays),
      }),
    onSuccess: () => {
      setNotice(t('resource.updated'));
      qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors.length) setErrors(e.fieldErrors());
      else setError(errorMessage(e, t));
    },
  });
  const sourceText = useMemo(
    () => (policy.data ? t(`attSettings.policy.source.${policy.data.source}`) : ''),
    [policy.data, t],
  );
  if (!form) return <p role="status">{t('common.loading')}</p>;
  const box = (name, label, hint) => (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 size-4"
        disabled={!canManage}
        checked={Boolean(form[name])}
        onChange={(e) => setForm({ ...form, [name]: e.target.checked })}
      />
      <span>
        {label}
        {hint && <span className="block text-xs text-text-muted">{hint}</span>}
      </span>
    </label>
  );
  return (
    <section
      aria-label={t('attSettings.tabs.policy')}
      className="rounded-[var(--radius-card)] border border-border bg-surface"
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setErrors({});
          setError(null);
          setNotice(null);
          save.mutate();
        }}
        className="grid gap-4 p-5 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <h2 className="text-base font-semibold">{t('attSettings.tabs.policy')}</h2>
          <p className="text-sm text-text-muted">{t('attSettings.policy.help')}</p>
        </div>
        <SelectField
          label={t('attSettings.policy.appliesTo')}
          value={legalEntityId}
          onChange={(e) => setLegalEntityId(e.target.value)}
        >
          <option value="">{t('attSettings.policy.company')}</option>
          {entityOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
        <p className="self-end pb-3 text-sm text-text-muted">{sourceText}</p>
        {notice && (
          <div className="sm:col-span-2">
            <Alert tone="success">{notice}</Alert>
          </div>
        )}
        {error && (
          <div className="sm:col-span-2">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
        <Field
          label={t('attSettings.policy.present')}
          type="number"
          disabled={!canManage}
          value={form.presentPercent}
          error={errors.presentPercent}
          hint={t('attSettings.policy.presentHint')}
          onChange={(e) => setForm({ ...form, presentPercent: e.target.value })}
        />
        <Field
          label={t('attSettings.policy.halfDay')}
          type="number"
          disabled={!canManage}
          value={form.halfDayPercent}
          error={errors.halfDayPercent}
          onChange={(e) => setForm({ ...form, halfDayPercent: e.target.value })}
        />
        <Field
          label={t('attSettings.policy.window')}
          type="number"
          disabled={!canManage}
          value={form.regularizationWindowDays}
          error={errors.regularizationWindowDays}
          onChange={(e) => setForm({ ...form, regularizationWindowDays: e.target.value })}
        />
        <div />
        {box('autoDeductBreak', t('attSettings.policy.autoBreak'), t('attSettings.policy.autoBreakHint'))}
        {box('captureIp', t('attSettings.policy.captureIp'), t('attSettings.policy.captureHint'))}
        {box('captureGeo', t('attSettings.policy.captureGeo'), t('attSettings.policy.captureHint'))}
        {canManage && (
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.isPending}>
              {t('attSettings.policy.save')}
            </Button>
          </div>
        )}
      </form>
    </section>
  );
}

function Recalculate({ canManage }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ from: today().slice(0, 8) + '01', to: today() });
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const run = useMutation({
    mutationFn: () => attendanceApi.recalculate(form),
    onSuccess: () => setNotice(t('attSettings.recalc.queued')),
    onError: (e) => {
      if (e instanceof ApiError && e.errors.length) setErrors(e.fieldErrors());
      else setError(errorMessage(e, t));
    },
  });
  if (!canManage) return <Alert tone="info">{t('attSettings.noAccess')}</Alert>;
  return (
    <section
      aria-label={t('attSettings.tabs.recalculate')}
      className="rounded-[var(--radius-card)] border border-border bg-surface"
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setErrors({});
          setError(null);
          setNotice(null);
          run.mutate();
        }}
        className="grid gap-4 p-5 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <h2 className="text-base font-semibold">{t('attSettings.tabs.recalculate')}</h2>
          <p className="text-sm text-text-muted">{t('attSettings.recalc.help')}</p>
        </div>
        {notice && (
          <div className="sm:col-span-2">
            <Alert tone="success">{notice}</Alert>
          </div>
        )}
        {error && (
          <div className="sm:col-span-2">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
        <Field
          label={t('attSettings.recalc.from')}
          type="date"
          value={form.from}
          error={errors.from}
          onChange={(e) => setForm({ ...form, from: e.target.value })}
        />
        <Field
          label={t('attSettings.recalc.to')}
          type="date"
          value={form.to}
          error={errors.to}
          onChange={(e) => setForm({ ...form, to: e.target.value })}
        />
        <div className="sm:col-span-2">
          <Button type="submit" disabled={run.isPending}>
            {t('attSettings.recalc.submit')}
          </Button>
        </div>
      </form>
    </section>
  );
}
