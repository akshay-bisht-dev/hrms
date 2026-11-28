import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { payrollApi, money, currentFiscalYear } from '@/services/payroll';
import { openSignedUrl } from '@/services/employees';
import { useFormAction, FormMessages } from '@/hooks/useFormAction';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, SelectField } from '@/components/ui/field';
import { errorMessage } from '@/utils/errors';

const card = 'rounded-[var(--radius-card)] border border-border bg-surface';
const SECTIONS = ['80C', '80D', '80CCD1B', '24B'];

export function MyPayslipsPage() {
  const { t, i18n } = useTranslation();
  const slips = useQuery({ queryKey: ['payroll', 'payslips', 'me'], queryFn: payrollApi.myPayslips });
  const download = useFormAction(async (id) => openSignedUrl((await payrollApi.payslipUrl(id)).url));
  const label = (month) =>
    new Intl.DateTimeFormat(i18n.language, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
      new Date(`${month}-01T00:00:00Z`),
    );
  const rows = slips.data?.data ?? [];
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold">{t('payslips.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('payslips.subtitle')}</p>
      </header>
      <section aria-label={t('payslips.title')} className={card}>
        {slips.isError && (
          <div className="p-5">
            <Alert tone="error">{errorMessage(slips.error, t)}</Alert>
          </div>
        )}
        {slips.isSuccess && rows.length === 0 && (
          <p className="p-5 text-sm text-text-muted">{t('payslips.none')}</p>
        )}
        <div className="px-5 pt-3">
          <FormMessages action={download} />
        </div>
        <ul className="divide-y divide-slate-100">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <span>
                <span className="font-medium">{label(p.month)}</span>
                <span className="text-text-muted"> · {t('payslips.paidOn', { date: p.payDate })}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="tabular font-semibold">{money(p.net, p.currency)}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={download.pending}
                  onClick={() => download.run(p.id)}
                  aria-label={t('payslips.downloadFor', { month: label(p.month) })}
                >
                  <Download aria-hidden="true" className="size-4" />
                  {t('payslips.download')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <TaxDeclaration />
    </div>
  );
}

function TaxDeclaration() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fy = currentFiscalYear();
  const q = useQuery({
    queryKey: ['payroll', 'declaration', fy],
    queryFn: () => payrollApi.myDeclaration(fy),
    retry: false,
  });
  const [form, setForm] = useState({ regime: 'NEW', deductions: {} });
  useEffect(() => {
    if (q.data) setForm({ regime: q.data.regime ?? 'NEW', deductions: q.data.declarations ?? {} });
  }, [q.data]);
  const save = useFormAction(
    () =>
      payrollApi.saveMyDeclaration(fy, {
        regime: form.regime,
        deductions: Object.fromEntries(
          Object.entries(form.deductions).filter(([, v]) => v !== '' && v !== null && v !== undefined),
        ),
      }),
    () => {
      qc.invalidateQueries({ queryKey: ['payroll', 'declaration', fy] });
      return t('payslips.declarationSaved');
    },
  );
  if (q.isError) return null; // no employee record: nothing to declare
  const locked = q.data?.status === 'VERIFIED';
  return (
    <section aria-label={t('payslips.declaration')} className={card}>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.run();
        }}
        className="grid gap-4 p-5 sm:grid-cols-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
          <div>
            <h2 className="text-base font-semibold">{t('payslips.declarationTitle', { fy })}</h2>
            <p className="text-sm text-text-muted">{t('payslips.declarationHelp')}</p>
          </div>
          {q.data?.status && (
            <Badge
              tone={
                { VERIFIED: 'success', SUBMITTED: 'warning', REJECTED: 'danger', DRAFT: 'neutral' }[
                  q.data.status
                ]
              }
            >
              {t(`payslips.declStatus.${q.data.status}`)}
            </Badge>
          )}
        </div>
        <div className="sm:col-span-2">
          <FormMessages action={save} />
        </div>
        <SelectField
          label={t('payslips.regimeLabel')}
          value={form.regime}
          disabled={locked}
          onChange={(e) => setForm({ ...form, regime: e.target.value })}
        >
          <option value="NEW">{t('payslips.regime.NEW')}</option>
          <option value="OLD">{t('payslips.regime.OLD')}</option>
        </SelectField>
        <div />
        {form.regime === 'OLD' &&
          SECTIONS.map((s) => (
            <Field
              key={s}
              label={t(`payslips.section.${s}`)}
              value={form.deductions[s] ?? ''}
              disabled={locked}
              error={save.errors[s]}
              onChange={(e) => setForm({ ...form, deductions: { ...form.deductions, [s]: e.target.value } })}
            />
          ))}
        {!locked && (
          <div className="sm:col-span-2">
            <Button type="submit" disabled={save.pending}>
              {t('payslips.submitDeclaration')}
            </Button>
          </div>
        )}
      </form>
    </section>
  );
}
