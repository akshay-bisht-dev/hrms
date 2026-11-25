import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { days, LEAVE_TONE, leaveApi } from '@/services/leave';
import { monthRange } from '@/services/attendance';
import { orgApi } from '@/services/org';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { errorMessage } from '@/utils/errors';

/** Approved and pending leave in a month, for everyone in the viewer's leave.request.view scope. */
export function WhosAwayPage() {
  const { t, i18n } = useTranslation();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [departmentId, setDepartmentId] = useState('');
  const range = monthRange(`${month}-01`);
  const departments = useQuery({
    queryKey: ['org', 'departments'],
    queryFn: () => orgApi.list('departments'),
  });
  const q = useQuery({
    queryKey: ['leave', 'calendar', month, departmentId],
    queryFn: () => leaveApi.calendar({ ...range, departmentId }),
  });
  const fmt = (d) =>
    new Intl.DateTimeFormat(i18n.language, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${d}T00:00:00Z`));
  const rows = q.data?.data ?? [];
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold">{t('whosAway.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('whosAway.subtitle')}</p>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('attendance.month')}
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && setMonth(e.target.value)}
            className="h-11 rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-sm font-normal"
          />
        </label>
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
        aria-label={t('whosAway.title')}
        className="rounded-[var(--radius-card)] border border-border bg-surface"
      >
        {q.isPending && (
          <p role="status" className="p-5 text-sm text-text-muted">
            {t('common.loading')}
          </p>
        )}
        {q.isError && (
          <div className="p-5">
            <Alert tone="error">{errorMessage(q.error, t)}</Alert>
          </div>
        )}
        {q.isSuccess && rows.length === 0 && (
          <p className="p-5 text-sm text-text-muted">{t('whosAway.empty')}</p>
        )}
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full"
                  style={{ background: r.leaveType.color ?? '#64748b' }}
                />
                <div className="flex flex-col">
                  <span className="font-medium">{r.employee.name}</span>
                  <span className="text-text-muted">
                    {r.leaveType.name} · {fmt(r.fromDate)}
                    {r.toDate !== r.fromDate ? ` – ${fmt(r.toDate)}` : ''} ·{' '}
                    {t('leave.daysCount', { count: Number(r.quantity), n: days(r.quantity) })}
                  </span>
                </div>
              </div>
              <Badge tone={LEAVE_TONE[r.status]} withDot>
                {t(`leave.status.${r.status}`)}
              </Badge>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
