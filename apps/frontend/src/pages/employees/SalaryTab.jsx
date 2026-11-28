import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { payrollApi, money } from '@/services/payroll';
import { useFormAction, FormMessages } from '@/hooks/useFormAction';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, SelectField } from '@/components/ui/field';
import { errorMessage } from '@/utils/errors';

const card = 'rounded-[var(--radius-card)] border border-border bg-surface p-5';

/** Salary history and changes for one employee (payroll.salary.view / .manage; both sensitive and audited). */
export function SalaryTab({ e, canManage }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const history = useQuery({
    queryKey: ['payroll', 'salaries', e.id],
    queryFn: () => payrollApi.salaries(e.id),
  });
  const structures = useQuery({
    queryKey: ['payroll', 'structures'],
    queryFn: payrollApi.structures,
    enabled: canManage,
  });
  const options = (structures.data?.data ?? []).filter((s) => s.legalEntityId === e.legalEntity?.id);
  const [form, setForm] = useState({
    structureId: '',
    annualCtc: '',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    reason: 'REVISION',
  });
  const structureId = form.structureId || options[0]?.id || '';
  const validCtc = /^\d{1,15}(\.\d{1,4})?$/.test(form.annualCtc);
  const preview = useQuery({
    queryKey: ['payroll', 'preview', structureId, form.annualCtc],
    queryFn: () => payrollApi.preview(structureId, form.annualCtc),
    enabled: canManage && Boolean(structureId) && validCtc,
  });
  const save = useFormAction(
    () => payrollApi.setSalary(e.id, { ...form, structureId }),
    () => {
      qc.invalidateQueries({ queryKey: ['payroll', 'salaries', e.id] });
      return t('salary.saved');
    },
  );
  const rows = history.data?.data ?? [];
  const currency = rows[0]?.currency ?? options.find((s) => s.id === structureId)?.currency ?? 'INR';
  return (
    <div className="flex flex-col gap-4">
      <section aria-label={t('salary.history')} className={card}>
        <h2 className="text-base font-semibold">{t('salary.history')}</h2>
        {history.isError && <Alert tone="error">{errorMessage(history.error, t)}</Alert>}
        {history.isSuccess && rows.length === 0 && (
          <p className="mt-2 text-sm text-text-muted">{t('salary.none')}</p>
        )}
        <ol className="mt-3 flex flex-col gap-2">
          {rows.map((s) => (
            <li key={s.id} className="border-s-2 border-border ps-3 text-sm">
              <span className="tabular font-medium">
                {t('salary.ctcLine', { amount: money(s.annualCtc, s.currency) })}
              </span>{' '}
              · {s.structure.name} · {t(`salary.reasons.${s.reason}`)}
              <div className="text-text-muted">
                {s.effectiveFrom}
                {s.effectiveTo ? ` – ${s.effectiveTo}` : ` · ${t('employees.job.current')}`}
              </div>
            </li>
          ))}
        </ol>
      </section>
      {canManage && (
        <section aria-label={t('salary.change')} className={card}>
          <form
            noValidate
            onSubmit={(ev) => {
              ev.preventDefault();
              save.run();
            }}
            className="grid gap-4 sm:grid-cols-2"
          >
            <h2 className="text-base font-semibold sm:col-span-2">{t('salary.change')}</h2>
            <div className="sm:col-span-2">
              <FormMessages action={save} />
            </div>
            <SelectField
              label={t('salary.structure')}
              value={structureId}
              error={save.errors.structureId}
              onChange={(ev) => setForm({ ...form, structureId: ev.target.value })}
            >
              {options.length === 0 && <option value="">{t('salary.noStructures')}</option>}
              {options.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectField>
            <Field
              label={t('salary.annualCtc')}
              inputMode="decimal"
              value={form.annualCtc}
              error={save.errors.annualCtc}
              onChange={(ev) => setForm({ ...form, annualCtc: ev.target.value })}
            />
            <Field
              label={t('salary.from')}
              type="date"
              value={form.effectiveFrom}
              error={save.errors.effectiveFrom}
              onChange={(ev) => setForm({ ...form, effectiveFrom: ev.target.value })}
            />
            <SelectField
              label={t('salary.reason')}
              value={form.reason}
              onChange={(ev) => setForm({ ...form, reason: ev.target.value })}
            >
              {['JOINING', 'REVISION', 'PROMOTION', 'CORRECTION'].map((r) => (
                <option key={r} value={r}>
                  {t(`salary.reasons.${r}`)}
                </option>
              ))}
            </SelectField>
            {preview.data && (
              <div className="sm:col-span-2" aria-live="polite">
                <h3 className="mb-2 text-sm font-semibold">{t('salary.preview')}</h3>
                <table className="w-full text-sm">
                  <tbody>
                    {preview.data.lines
                      .filter((l) => l.amount !== '0.0000')
                      .map((l) => (
                        <tr key={l.code} className="border-t border-slate-100">
                          <td className="py-1">{l.label}</td>
                          <td className="py-1 text-text-muted">{t(`payroll.kind.${l.kind}`)}</td>
                          <td className="tabular py-1 text-end">{money(l.amount, currency)}</td>
                        </tr>
                      ))}
                    <tr className="border-t border-border font-semibold">
                      <td className="py-1.5">{t('salary.netMonthly')}</td>
                      <td />
                      <td className="tabular py-1.5 text-end">{money(preview.data.totals.net, currency)}</td>
                    </tr>
                  </tbody>
                </table>
                {preview.data.errors.map((er) => (
                  <p key={er.message} className="text-sm text-red-700">
                    {er.message}
                  </p>
                ))}
              </div>
            )}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={save.pending || !structureId}>
                {t('salary.save')}
              </Button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
