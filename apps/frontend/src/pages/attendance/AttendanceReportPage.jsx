import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { attendanceApi, hm, monthRange } from '@/services/attendance';
import { downloadFromApi } from '@/services/employees';
import { orgApi } from '@/services/org';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { errorMessage } from '@/utils/errors';

const COLS = ['present', 'wfh', 'halfDay', 'absent', 'lateDays', 'missingOut', 'worked', 'overtime'];

/** Per-person totals for a period within the viewer's attendance.view scope, with a CSV download. */
export function AttendanceReportPage() {
  const { t } = useTranslation();
  const initial = monthRange(new Date().toISOString().slice(0, 10));
  const [range, setRange] = useState(initial);
  const [departmentId, setDepartmentId] = useState('');
  const [downloadError, setDownloadError] = useState(null);
  const departments = useQuery({
    queryKey: ['org', 'departments'],
    queryFn: () => orgApi.list('departments'),
  });
  const params = { ...range, departmentId };
  const report = useQuery({
    queryKey: ['attendance', 'report', params],
    queryFn: () => attendanceApi.summary(params),
    enabled: Boolean(range.from && range.to && range.from <= range.to),
  });
  const rows = report.data?.data ?? [];
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('attReport.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('attReport.subtitle')}</p>
        </div>
        <Button
          variant="secondary"
          disabled={!report.isSuccess}
          onClick={() =>
            downloadFromApi(
              attendanceApi.summaryCsvPath(params),
              `attendance-${range.from}-to-${range.to}.csv`,
            ).catch((e) => setDownloadError(errorMessage(e, t)))
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
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('employees.col.department')}
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="h-11 rounded-[var(--radius-control)] border border-border-strong bg-surface px-2 text-sm font-normal"
          >
            <option value="">{t('employees.allDepartments')}</option>
            {(departments.data?.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <section
        aria-label={t('attReport.title')}
        className="rounded-[var(--radius-card)] border border-border bg-surface"
      >
        {report.isPending && report.fetchStatus !== 'idle' && (
          <p role="status" className="p-5 text-sm text-text-muted">
            {t('common.loading')}
          </p>
        )}
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
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="bg-bg text-xs font-semibold text-text-muted">
                  <th scope="col" className="px-4 py-2.5 text-start">
                    {t('attendance.col.name')}
                  </th>
                  {COLS.map((c) => (
                    <th key={c} scope="col" className="px-4 py-2.5 text-end">
                      {t(`attReport.col.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employee.id} className="tabular border-t border-slate-100">
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.employee.name}</div>
                      <div className="text-xs text-text-muted">
                        {r.employee.code}
                        {r.employee.department ? ` · ${r.employee.department}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-end">{r.present}</td>
                    <td className="px-4 py-3 text-end">{r.wfh}</td>
                    <td className="px-4 py-3 text-end">{r.halfDay}</td>
                    <td className="px-4 py-3 text-end">{r.absent}</td>
                    <td className="px-4 py-3 text-end">{r.lateDays}</td>
                    <td className="px-4 py-3 text-end">{r.missingOut}</td>
                    <td className="px-4 py-3 text-end">{hm(r.workedMinutes)}</td>
                    <td className="px-4 py-3 text-end">
                      {hm(r.overtimeApprovedMinutes)}
                      {r.overtimePendingMinutes > 0 && (
                        <div className="text-xs text-text-muted">
                          {t('attReport.pendingOt', { time: hm(r.overtimePendingMinutes) })}
                        </div>
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
