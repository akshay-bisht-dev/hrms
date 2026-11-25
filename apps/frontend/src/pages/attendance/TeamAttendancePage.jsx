import { useState } from 'react';
import { Link } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { attendanceApi, clock, DAY_TONE, hm } from '@/services/attendance';
import { orgApi } from '@/services/org';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { cn } from '@/utils/cn';
import { errorMessage } from '@/utils/errors';

const FILTERS = ['', 'PRESENT', 'WFH', 'HALF_DAY', 'ABSENT', 'PENDING', 'NOT_RECORDED'];

/** Everyone the viewer may see on one date (attendance.view scope), with counts by status. */
export function TeamAttendancePage() {
  const { t, i18n } = useTranslation();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const departments = useQuery({
    queryKey: ['org', 'departments'],
    queryFn: () => orgApi.list('departments'),
  });
  const list = useInfiniteQuery({
    queryKey: ['attendance', 'team', date, status, departmentId],
    queryFn: ({ pageParam }) =>
      attendanceApi.team({ date, status, departmentId, limit: 100, cursor: pageParam }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(date),
  });
  const counts = list.data?.pages[0]?.counts ?? {};
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold">{t('attendance.team.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('attendance.team.subtitle')}</p>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label={t('attendance.team.date')}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
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
      <div role="group" aria-label={t('attendance.team.filter')} className="flex flex-wrap gap-2">
        {FILTERS.map((s) => (
          <button
            key={s || 'all'}
            type="button"
            aria-pressed={status === s}
            onClick={() => setStatus(s)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm',
              status === s
                ? 'border-primary bg-primary-soft font-semibold text-primary-hover'
                : 'border-border bg-surface',
            )}
          >
            {s ? t(`attendance.status.${s}`) : t('attendance.team.all')}{' '}
            <span className="tabular text-text-muted">{s ? (counts[s] ?? 0) : (counts.total ?? 0)}</span>
          </button>
        ))}
      </div>
      <section
        aria-label={t('attendance.team.title')}
        className="rounded-[var(--radius-card)] border border-border bg-surface"
      >
        {list.isPending && (
          <p role="status" className="p-5 text-sm text-text-muted">
            {t('common.loading')}
          </p>
        )}
        {list.isError && (
          <div className="p-5">
            <Alert tone="error">{errorMessage(list.error, t)}</Alert>
          </div>
        )}
        {list.isSuccess && rows.length === 0 && (
          <p className="p-5 text-sm text-text-muted">{t('attendance.team.empty')}</p>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="bg-bg text-xs font-semibold text-text-muted">
                  {['name', 'department', 'status', 'in', 'out', 'worked', 'late'].map((c) => (
                    <th key={c} scope="col" className="px-4 py-2.5 text-start">
                      {t(`attendance.col.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ employee, day }) => (
                  <tr key={employee.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <Link
                        to={`/attendance/employees/${employee.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {employee.name}
                      </Link>
                      <div className="text-xs text-text-muted">{employee.code}</div>
                    </td>
                    <td className="px-4 py-3">{employee.department ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge tone={DAY_TONE[day?.status ?? 'NOT_RECORDED']} withDot>
                        {t(`attendance.status.${day?.status ?? 'NOT_RECORDED'}`)}
                      </Badge>
                    </td>
                    <td className="tabular px-4 py-3">
                      {clock(day?.firstInAt, employee.timezone, i18n.language)}
                    </td>
                    <td className="tabular px-4 py-3">
                      {clock(day?.lastOutAt, employee.timezone, i18n.language)}
                    </td>
                    <td className="tabular px-4 py-3">{day ? hm(day.workedMinutes) : '—'}</td>
                    <td className="tabular px-4 py-3">{day?.lateMinutes ? hm(day.lateMinutes) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.hasNextPage && (
          <div className="border-t border-border p-3 text-center">
            <Button variant="ghost" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              {t('employees.loadMore')}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
