import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { days, leaveApi } from '@/services/leave';
import { downloadFromApi } from '@/services/employees';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { errorMessage } from '@/utils/errors';

/** Leave taken in a period and current balance, per person and leave type. */
export function LeaveReportPage() {
  const { t } = useTranslation();
  const year = new Date().toISOString().slice(0, 4);
  const [range, setRange] = useState({ from: `${year}-01-01`, to: `${year}-12-31` });
  const [downloadError, setDownloadError] = useState(null);
  const report = useQuery({
    queryKey: ['leave', 'report', range],
    queryFn: () => leaveApi.summary(range),
    enabled: Boolean(range.from && range.to && range.from <= range.to),
  });
  const types = report.data?.leaveTypes ?? [];
  const rows = report.data?.data ?? [];
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('leaveReport.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('leaveReport.subtitle')}</p>
        </div>
        <Button
          variant="secondary"
          disabled={!report.isSuccess}
          onClick={() =>
            downloadFromApi(leaveApi.summaryCsvPath(range), `leave-${range.from}-to-${range.to}.csv`).catch(
              (e) => setDownloadError(errorMessage(e, t)),
            )
          }
        >
          <Download aria-hidden="true" className="size-4" />
          {t('attReport.download')}
        </Button>
      </header>
      {downloadError && <Alert tone="error">{downloadError}</Alert>}
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label={t('attReport.from')}
          type="date"
          value={range.from}
          onChange={(e) => setRange({ ...range, from: e.target.value })}
        />
        <Field
          label={t('attReport.to')}
          type="date"
          value={range.to}
          onChange={(e) => setRange({ ...range, to: e.target.value })}
        />
      </div>
      <section
        aria-label={t('leaveReport.title')}
        className="rounded-[var(--radius-card)] border border-border bg-surface"
      >
        {report.isError && (
          <div className="p-5">
            <Alert tone="error">{errorMessage(report.error, t)}</Alert>
          </div>
        )}
        {report.isSuccess && rows.length === 0 && (
          <p className="p-5 text-sm text-text-muted">{t('attReport.empty')}</p>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="bg-bg text-xs font-semibold text-text-muted">
                  <th scope="col" className="px-4 py-2.5 text-start">
                    {t('attendance.col.name')}
                  </th>
                  {types.map((ty) => (
                    <th key={ty.id} scope="col" className="px-4 py-2.5 text-end">
                      {ty.name}
                      <div className="font-normal">{t('leaveReport.takenBalance')}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employee.id} className="tabular border-t border-slate-100">
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.employee.name}</div>
                      <div className="text-xs text-text-muted">{r.employee.code}</div>
                    </td>
                    {types.map((ty) => (
                      <td key={ty.id} className="px-4 py-3 text-end">
                        {days(r.byType[ty.code].taken)} / {days(r.byType[ty.code].balance)}
                      </td>
                    ))}
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
