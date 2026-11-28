import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Download, Trash2 } from 'lucide-react';
import { payrollApi, money, RUN_TONE, STEPS } from '@/services/payroll';
import { employeesApi, fullName, downloadFromApi } from '@/services/employees';
import { useAuth } from '@/context/AuthContext';
import { useFormAction, FormMessages } from '@/hooks/useFormAction';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, SelectField } from '@/components/ui/field';
import { cn } from '@/utils/cn';
import { errorMessage } from '@/utils/errors';

const card = 'rounded-[var(--radius-card)] border border-border bg-surface';

export function PayrollRunPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { can } = useAuth();
  const qc = useQueryClient();
  const run = useQuery({
    queryKey: ['payroll', 'run', id],
    queryFn: () => payrollApi.run(id),
    refetchInterval: (q) => (q.state.data?.status === 'CALCULATING' ? 2000 : false),
  });
  const [comment, setComment] = useState('');
  const act = useFormAction(
    ({ action, body }) => payrollApi.action(id, action, body),
    () => {
      qc.invalidateQueries({ queryKey: ['payroll'] });
      setComment('');
      return null;
    },
  );
  const [downloadError, setDownloadError] = useState(null);
  if (run.isPending) return <p role="status">{t('common.loading')}</p>;
  if (run.isError) return <Alert tone="error">{errorMessage(run.error, t)}</Alert>;
  const r = run.data;
  const hasResults = ['CALCULATED', 'REVIEWED', 'APPROVED', 'FINALIZED', 'PAID'].includes(r.status);
  const button = (action, perm, label, variant = 'primary', body = undefined) =>
    can(perm) && (
      <Button key={action} variant={variant} disabled={act.pending} onClick={() => act.run({ action, body })}>
        {label}
      </Button>
    );
  const actions = {
    DRAFT: [
      button('lock', 'payroll.run.create', t('payroll.actions.lock')),
      button('cancel', 'payroll.run.create', t('payroll.actions.cancel'), 'ghost'),
    ],
    INPUTS_LOCKED: [
      button('calculate', 'payroll.run.create', t('payroll.actions.calculate')),
      button('unlock', 'payroll.run.create', t('payroll.actions.unlock'), 'secondary'),
      button('cancel', 'payroll.run.create', t('payroll.actions.cancel'), 'ghost'),
    ],
    CALCULATED: [
      button('review', 'payroll.run.review', t('payroll.actions.review')),
      button('calculate', 'payroll.run.create', t('payroll.actions.recalculate'), 'secondary'),
      button('unlock', 'payroll.run.create', t('payroll.actions.unlock'), 'secondary'),
    ],
    REVIEWED: [
      button('approve', 'payroll.run.approve', t('payroll.actions.approve')),
      button('unlock', 'payroll.run.create', t('payroll.actions.unlock'), 'secondary'),
    ],
    APPROVED: [button('finalize', 'payroll.run.approve', t('payroll.actions.finalize'))],
    FINALIZED: [button('mark-paid', 'payroll.run.approve', t('payroll.actions.markPaid'))],
  }[r.status];
  const canReject = ['REVIEWED', 'APPROVED'].includes(r.status) && can('payroll.run.approve');
  const stepIndex = STEPS.indexOf(r.status === 'CALCULATING' ? 'INPUTS_LOCKED' : r.status);
  return (
    <div className="flex flex-col gap-6">
      <Link to="/payroll" className="flex items-center gap-1 text-sm text-primary hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('payroll.title')}
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('payroll.runTitle', { month: r.period.month })}</h1>
          <p className="mt-1 text-sm text-text-muted">
            {r.legalEntity.name} · {t('payroll.payDate', { date: r.period.payDate })}
          </p>
        </div>
        <Badge tone={RUN_TONE[r.status]} withDot>
          {t(`payroll.status.${r.status}`)}
        </Badge>
      </header>
      {r.status !== 'CANCELLED' && (
        <ol aria-label={t('payroll.progress')} className="flex flex-wrap gap-2 text-xs">
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={i === stepIndex ? 'step' : undefined}
              className={cn(
                'rounded-full border px-3 py-1',
                i < stepIndex
                  ? 'border-green-200 bg-success-soft'
                  : i === stepIndex
                    ? 'border-primary bg-primary-soft font-semibold'
                    : 'border-border text-text-muted',
              )}
            >
              {t(`payroll.status.${s}`)}
            </li>
          ))}
        </ol>
      )}
      {r.ruleVersionsPinned && (
        <p className="text-xs text-text-muted">
          {t('payroll.rulesPinned', {
            pack: r.ruleVersionsPinned.pack,
            version: r.ruleVersionsPinned.ruleVersion,
          })}{' '}
          {!r.ruleVersionsPinned.reviewed && <strong>{t('payroll.notReviewed')}</strong>}
        </p>
      )}
      {r.status === 'CALCULATING' && <Alert tone="info">{t('payroll.calculating')}</Alert>}
      {r.totals?.failed && <Alert tone="error">{t('payroll.failed', { message: r.totals.failed })}</Alert>}
      {(r.counts?.ERROR ?? 0) > 0 && (
        <Alert tone="error">{t('payroll.hasErrors', { count: r.counts.ERROR })}</Alert>
      )}
      {r.status === 'REVIEWED' && r.reviewedBy && can('payroll.run.approve') && (
        <Alert tone="info">{t('payroll.makerChecker')}</Alert>
      )}
      <FormMessages action={act} />
      {downloadError && <Alert tone="error">{downloadError}</Alert>}
      <div className="flex flex-wrap items-end gap-2">
        {actions}
        {canReject && (
          <>
            <input
              aria-label={t('payroll.rejectNote')}
              placeholder={t('payroll.rejectNote')}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="h-10 w-64 max-w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-sm"
            />
            <Button
              variant="secondary"
              disabled={act.pending || comment.trim().length < 3}
              onClick={() => act.run({ action: 'reject', body: { comment } })}
            >
              {t('payroll.actions.reject')}
            </Button>
          </>
        )}
        {hasResults && can('payroll.salary.view') && (
          <Button
            variant="ghost"
            onClick={() =>
              downloadFromApi(payrollApi.registerPath(id), `payroll-register-${r.period.month}.csv`).catch(
                (e) => setDownloadError(errorMessage(e, t)),
              )
            }
          >
            <Download aria-hidden="true" className="size-4" />
            {t('payroll.register')}
          </Button>
        )}
        {['FINALIZED', 'PAID'].includes(r.status) && can('payroll.bank.view') && (
          <Button
            variant="ghost"
            onClick={() =>
              downloadFromApi(payrollApi.bankFilePath(id), `bank-transfer-${r.period.month}.csv`).catch((e) =>
                setDownloadError(errorMessage(e, t)),
              )
            }
          >
            <Download aria-hidden="true" className="size-4" />
            {t('payroll.bankFile')}
          </Button>
        )}
      </div>
      {r.totals?.gross && (
        <section aria-label={t('payroll.totals')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ['employees', `${r.totals.calculated} / ${r.totals.employees}`],
            ['gross', money(r.totals.gross, r.currency)],
            ['deductions', money(r.totals.deductions, r.currency)],
            ['net', money(r.totals.net, r.currency)],
            ['employerCost', money(r.totals.employerCost, r.currency)],
          ].map(([k, v]) => (
            <div key={k} className={cn(card, 'p-4')}>
              <div className="text-xs text-text-muted">{t(`payroll.total.${k}`)}</div>
              <div className="tabular text-lg font-semibold">{v}</div>
            </div>
          ))}
        </section>
      )}
      <Inputs run={r} editable={r.status === 'DRAFT' && can('payroll.run.create')} />
      {hasResults && <Results run={r} />}
      {hasResults && <Variance run={r} />}
    </div>
  );
}

function Inputs({ run, editable }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['payroll', 'inputs', run.id],
    queryFn: () => payrollApi.inputs(run.id),
  });
  const comps = useQuery({
    queryKey: ['payroll', 'components'],
    queryFn: payrollApi.components,
    enabled: editable,
  });
  const people = useQuery({
    queryKey: ['employees', 'pick-all'],
    queryFn: () => employeesApi.list({ limit: 200 }),
    enabled: editable,
  });
  const [form, setForm] = useState({ employeeId: '', componentId: '', amount: '', note: '' });
  const add = useFormAction(
    () => payrollApi.addInput(run.id, { ...form, ...(form.note ? {} : { note: undefined }) }),
    () => {
      qc.invalidateQueries({ queryKey: ['payroll', 'inputs', run.id] });
      setForm({ ...form, amount: '', note: '' });
      return null;
    },
  );
  const remove = useFormAction(
    (inputId) => payrollApi.removeInput(run.id, inputId),
    () => qc.invalidateQueries({ queryKey: ['payroll', 'inputs', run.id] }) && null,
  );
  const rows = list.data?.data ?? [];
  if (!editable && rows.length === 0) return null;
  return (
    <section aria-label={t('payroll.inputs')} className={card}>
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">{t('payroll.inputs')}</h2>
        <p className="text-sm text-text-muted">{t('payroll.inputsHelp')}</p>
      </div>
      {editable && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            add.run();
          }}
          className="grid gap-3 border-b border-border p-5 sm:grid-cols-4"
        >
          <SelectField
            label={t('payroll.employee')}
            value={form.employeeId}
            error={add.errors.employeeId}
            onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
          >
            <option value="">{t('resource.choose')}</option>
            {(people.data?.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {fullName(p)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={t('payroll.component')}
            value={form.componentId}
            error={add.errors.componentId}
            onChange={(e) => setForm({ ...form, componentId: e.target.value })}
          >
            <option value="">{t('resource.choose')}</option>
            {(comps.data?.data ?? [])
              .filter((c) => c.calcType === 'INPUT')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </SelectField>
          <Field
            label={t('payroll.amount')}
            value={form.amount}
            error={add.errors.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
          <div className="flex items-end">
            <Button type="submit" disabled={add.pending}>
              {t('resource.add')}
            </Button>
          </div>
          <div className="sm:col-span-4">
            <FormMessages action={add} />
          </div>
        </form>
      )}
      <ul className="divide-y divide-slate-100">
        {rows.map((i) => (
          <li key={i.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
            <span>
              {i.employee.name} · {i.component.name} ·{' '}
              <span className="tabular">{money(i.amount, run.currency)}</span>
              {i.note ? ` · ${i.note}` : ''}
            </span>
            {editable && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('payroll.removeInput', { name: i.employee.name })}
                onClick={() => remove.run(i.id)}
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Results({ run }) {
  const { t } = useTranslation();
  const list = useQuery({
    queryKey: ['payroll', 'employees', run.id, run.calculatedAt],
    queryFn: () => payrollApi.runEmployees(run.id),
  });
  const [open, setOpen] = useState(null);
  const detail = useQuery({
    queryKey: ['payroll', 'employee', run.id, open],
    queryFn: () => payrollApi.runEmployee(run.id, open),
    enabled: Boolean(open),
  });
  const tone = { OK: 'success', WARNING: 'warning', ERROR: 'danger', EXCLUDED: 'neutral' };
  return (
    <section aria-label={t('payroll.results')} className={card}>
      <h2 className="border-b border-border px-5 py-4 text-base font-semibold">{t('payroll.results')}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="bg-bg text-xs font-semibold text-text-muted">
              {['name', 'status', 'paidDays', 'gross', 'deductions', 'net'].map((c) => (
                <th
                  key={c}
                  scope="col"
                  className={cn(
                    'px-4 py-2.5',
                    ['gross', 'deductions', 'net', 'paidDays'].includes(c) ? 'text-end' : 'text-start',
                  )}
                >
                  {t(`payroll.col.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(list.data?.data ?? []).map((e) => (
              <tr key={e.id} className="border-t border-slate-100 align-top">
                <td className="px-4 py-3">
                  <button
                    type="button"
                    className="font-medium text-primary hover:underline"
                    aria-expanded={open === e.id}
                    onClick={() => setOpen(open === e.id ? null : e.id)}
                  >
                    {e.employee.name}
                  </button>
                  <div className="text-xs text-text-muted">{e.employee.code}</div>
                  {e.errors.map((er) => (
                    <div key={er.message} className="text-xs text-red-700">
                      {er.message}
                    </div>
                  ))}
                  {open === e.id && detail.data && (
                    <table className="mt-3 w-full text-xs">
                      <tbody>
                        {detail.data.lines.map((l) => (
                          <tr key={l.code} className="border-t border-slate-100">
                            <td className="py-1 pe-3">{l.label}</td>
                            <td className="py-1 pe-3 text-text-muted">{t(`payroll.kind.${l.kind}`)}</td>
                            <td className="tabular py-1 pe-3 text-end">{money(l.amount, run.currency)}</td>
                            <td className="py-1">
                              <details>
                                <summary className="cursor-pointer text-primary">{t('payroll.how')}</summary>
                                <pre className="max-w-md whitespace-pre-wrap break-words text-[11px] text-text-muted">
                                  {JSON.stringify(l.trace, null, 1)}
                                </pre>
                              </details>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={tone[e.status]}>{t(`payroll.rowStatus.${e.status}`)}</Badge>
                </td>
                <td className="tabular px-4 py-3 text-end">
                  {e.paidDays}
                  {Number(e.lopDays) > 0 && (
                    <div className="text-xs text-text-muted">{t('payroll.lop', { days: e.lopDays })}</div>
                  )}
                </td>
                <td className="tabular px-4 py-3 text-end">{money(e.gross, run.currency)}</td>
                <td className="tabular px-4 py-3 text-end">{money(e.deductions, run.currency)}</td>
                <td className="tabular px-4 py-3 text-end font-semibold">{money(e.net, run.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Variance({ run }) {
  const { t } = useTranslation();
  const v = useQuery({
    queryKey: ['payroll', 'variance', run.id, run.calculatedAt],
    queryFn: () => payrollApi.variance(run.id),
  });
  if (!v.data?.previousRun) return null;
  const changed = v.data.data.filter((r) => r.change !== '0.0000');
  return (
    <section aria-label={t('payroll.variance')} className={card}>
      <h2 className="border-b border-border px-5 py-4 text-base font-semibold">
        {t('payroll.varianceTitle', { month: v.data.previousRun.month })}
      </h2>
      {changed.length === 0 && <p className="p-5 text-sm text-text-muted">{t('payroll.noChanges')}</p>}
      <ul className="divide-y divide-slate-100">
        {changed.map((r) => (
          <li key={r.employee.id} className="flex justify-between px-5 py-2.5 text-sm">
            <span>{r.employee.name}</span>
            <span className="tabular">
              {r.note
                ? t(r.note === 'New this period' ? 'payroll.newThisPeriod' : 'payroll.notThisPeriod')
                : `${money(r.previousNet, run.currency)} → ${money(r.net, run.currency)}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
