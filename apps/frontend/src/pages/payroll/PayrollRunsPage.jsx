import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { payrollApi, money, RUN_TONE } from '@/services/payroll';
import { orgApi } from '@/services/org';
import { useAuth } from '@/context/AuthContext';
import { useFormAction, FormMessages } from '@/hooks/useFormAction';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, SelectField } from '@/components/ui/field';
import { cn } from '@/utils/cn';
import { errorMessage } from '@/utils/errors';

const card = 'rounded-[var(--radius-card)] border border-border bg-surface';

export function PayrollRunsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [tab, setTab] = useState('runs');
  const tabs = ['runs', ...(can('payroll.tax.review') ? ['declarations'] : [])];
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold">{t('payroll.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('payroll.subtitle')}</p>
      </header>
      {tabs.length > 1 && (
        <div role="tablist" aria-label={t('payroll.title')} className="flex gap-1 border-b border-border">
          {tabs.map((k) => (
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
                  : 'border-transparent text-text-muted',
              )}
            >
              {t(`payroll.tabs.${k}`)}
            </button>
          ))}
        </div>
      )}
      {tab === 'runs' ? <Runs canCreate={can('payroll.run.create')} /> : <Declarations />}
    </div>
  );
}

function Runs({ canCreate }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const entities = useQuery({
    queryKey: ['org', 'legal-entities'],
    queryFn: () => orgApi.list('legal-entities'),
  });
  const runs = useQuery({ queryKey: ['payroll', 'runs'], queryFn: () => payrollApi.runs() });
  const [form, setForm] = useState({ legalEntityId: '', month: new Date().toISOString().slice(0, 7) });
  const create = useFormAction(
    () =>
      payrollApi.createRun({
        legalEntityId: form.legalEntityId || entities.data?.data[0]?.id,
        month: form.month,
      }),
    (run) => {
      qc.invalidateQueries({ queryKey: ['payroll', 'runs'] });
      navigate(`/payroll/runs/${run.id}`);
    },
  );
  const rows = runs.data?.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      {canCreate && (
        <section aria-label={t('payroll.newRun')} className={card}>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              create.run();
            }}
            className="flex flex-wrap items-end gap-3 p-5"
          >
            <SelectField
              label={t('payroll.legalEntity')}
              value={form.legalEntityId}
              onChange={(e) => setForm({ ...form, legalEntityId: e.target.value })}
            >
              {(entities.data?.data ?? []).map((le) => (
                <option key={le.id} value={le.id}>
                  {le.name}
                </option>
              ))}
            </SelectField>
            <Field
              label={t('payroll.month')}
              type="month"
              value={form.month}
              error={create.errors.month}
              onChange={(e) => setForm({ ...form, month: e.target.value })}
            />
            <Button type="submit" disabled={create.pending}>
              <Plus aria-hidden="true" className="size-4" />
              {t('payroll.newRun')}
            </Button>
          </form>
          <div className="px-5 pb-4">
            <FormMessages action={create} />
          </div>
        </section>
      )}
      <section aria-label={t('payroll.runs')} className={card}>
        <h2 className="border-b border-border px-5 py-4 text-base font-semibold">{t('payroll.runs')}</h2>
        {runs.isError && (
          <div className="p-5">
            <Alert tone="error">{errorMessage(runs.error, t)}</Alert>
          </div>
        )}
        {runs.isSuccess && rows.length === 0 && (
          <p className="p-5 text-sm text-text-muted">{t('payroll.noRuns')}</p>
        )}
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <Link to={`/payroll/runs/${r.id}`} className="font-medium text-primary hover:underline">
                {r.period.month} · {r.legalEntity.name}
              </Link>
              <span className="flex items-center gap-3">
                {r.totals?.net && (
                  <span className="tabular text-text-muted">
                    {t('payroll.netTotal', { amount: money(r.totals.net, r.currency) })}
                  </span>
                )}
                <Badge tone={RUN_TONE[r.status]} withDot>
                  {t(`payroll.status.${r.status}`)}
                </Badge>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Declarations() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['payroll', 'declarations'],
    queryFn: () => payrollApi.declarations('SUBMITTED'),
  });
  const review = useFormAction(
    ({ id, decision }) => payrollApi.reviewDeclaration(id, decision),
    () => {
      qc.invalidateQueries({ queryKey: ['payroll', 'declarations'] });
      return t('resource.updated');
    },
  );
  const rows = list.data?.data ?? [];
  return (
    <section aria-label={t('payroll.tabs.declarations')} className={card}>
      <h2 className="border-b border-border px-5 py-4 text-base font-semibold">
        {t('payroll.declarationsToReview')}
      </h2>
      <div className="px-5 pt-3">
        <FormMessages action={review} />
      </div>
      {list.isSuccess && rows.length === 0 && (
        <p className="p-5 text-sm text-text-muted">{t('approvals.none')}</p>
      )}
      <ul className="divide-y divide-slate-100">
        {rows.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
            <span>
              <span className="font-medium">
                {d.employee.firstName} {d.employee.lastName ?? ''}
              </span>{' '}
              · {d.fiscalYear} · {t(`payslips.regime.${d.regime}`)} ·{' '}
              {Object.entries(d.declarations ?? {})
                .map(([k, v]) => `${k} ${money(v)}`)
                .join(', ') || t('payslips.noDeductions')}
            </span>
            <span className="flex gap-2">
              <Button
                size="sm"
                disabled={review.pending}
                onClick={() => review.run({ id: d.id, decision: 'VERIFIED' })}
              >
                {t('payroll.verify')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={review.pending}
                onClick={() => review.run({ id: d.id, decision: 'REJECTED' })}
              >
                {t('approvals.reject')}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
