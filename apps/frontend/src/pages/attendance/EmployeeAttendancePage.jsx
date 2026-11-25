import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { attendanceApi, clock, DAY_TONE, hm, monthRange } from '@/services/attendance';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/utils/errors';

/** One employee's month, for managers and HR within attendance.view scope. Times show in the employee's zone. */
export function EmployeeAttendancePage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const { from, to } = monthRange(`${month}-01`);
  const q = useQuery({
    queryKey: ['attendance', 'employee', id, month],
    queryFn: () => attendanceApi.employeeDays(id, from, to),
  });
  const tz = q.data?.employee.timezone ?? 'UTC';
  return (
    <div className="flex flex-col gap-6">
      <Link to="/attendance/team" className="flex items-center gap-1 text-sm text-primary hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('attendance.team.title')}
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{q.data?.employee.name ?? t('attendance.title')}</h1>
          {q.data && (
            <p className="mt-1 text-sm text-text-muted">
              {q.data.employee.code} · {t('attendance.subtitle', { tz })}
            </p>
          )}
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('attendance.month')}
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="h-11 rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-sm font-normal"
          />
        </label>
      </header>
      {q.isPending && <p role="status">{t('common.loading')}</p>}
      {q.isError && <Alert tone="error">{errorMessage(q.error, t)}</Alert>}
      {q.isSuccess && (
        <section className="rounded-[var(--radius-card)] border border-border bg-surface">
          {q.data.data.length === 0 ? (
            <p className="p-5 text-sm text-text-muted">{t('attendance.noDays')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="bg-bg text-xs font-semibold text-text-muted">
                    {['date', 'status', 'in', 'out', 'worked', 'late', 'overtime', 'punches'].map((c) => (
                      <th key={c} scope="col" className="px-4 py-2.5 text-start">
                        {t(`attendance.col.${c}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...q.data.data].reverse().map((d) => (
                    <tr key={d.workDate} className="border-t border-slate-100 align-top">
                      <td className="whitespace-nowrap px-4 py-3">{d.workDate}</td>
                      <td className="px-4 py-3">
                        <Badge tone={DAY_TONE[d.status]} withDot>
                          {t(`attendance.status.${d.status}`)}
                        </Badge>
                      </td>
                      <td className="tabular px-4 py-3">{clock(d.firstInAt, tz, i18n.language)}</td>
                      <td className="tabular px-4 py-3">{clock(d.lastOutAt, tz, i18n.language)}</td>
                      <td className="tabular px-4 py-3">{hm(d.workedMinutes)}</td>
                      <td className="tabular px-4 py-3">{d.lateMinutes ? hm(d.lateMinutes) : '—'}</td>
                      <td className="tabular px-4 py-3">
                        {d.overtimeMinutes
                          ? `${hm(d.overtimeMinutes)} · ${t(`attendance.request.${d.overtimeStatus}`)}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-text-muted">
                        {d.punches.map((p) => (
                          <div key={p.id}>
                            {p.type} {clock(p.at, tz, i18n.language)}
                            {p.source === 'CORRECTION' ? ` (${t('attendance.flag.CORRECTED')})` : ''}
                            {p.workLocation ? ` · ${p.workLocation.name}` : ''}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      <div>
        <Button variant="ghost" onClick={() => window.history.back()}>
          {t('common.close')}
        </Button>
      </div>
    </div>
  );
}
