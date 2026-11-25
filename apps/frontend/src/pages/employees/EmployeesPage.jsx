import { useState } from 'react';
import { Link } from 'react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, Plus, Upload } from 'lucide-react';
import { employeesApi, downloadFromApi, fullName } from '@/services/employees';
import { orgApi } from '@/services/org';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { errorMessage } from '@/utils/errors';

export const STATUS_TONE = {
  PREBOARDING: 'info',
  PROBATION: 'warning',
  ACTIVE: 'success',
  NOTICE: 'warning',
  EXITED: 'neutral',
};

export function EmployeesPage() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const [filters, setFilters] = useState({ q: '', departmentId: '', status: '', includeExited: false });
  const [exportError, setExportError] = useState(null);
  const departments = useQuery({
    queryKey: ['org', 'departments'],
    queryFn: () => orgApi.list('departments'),
  });
  const list = useInfiniteQuery({
    queryKey: ['employees', filters],
    queryFn: ({ pageParam }) =>
      employeesApi.list({
        limit: 50,
        q: filters.q,
        departmentId: filters.departmentId,
        status: filters.status,
        includeExited: filters.includeExited ? 'true' : '',
        cursor: pageParam,
      }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const filtered = Boolean(filters.q || filters.departmentId || filters.status);
  const fmt = (d) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(`${d}T00:00:00Z`));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('employees.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('employees.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('employee.bulk.export') && (
            <Button
              variant="secondary"
              onClick={() =>
                downloadFromApi('/api/v1/employees/export', 'employees.csv').catch((e) =>
                  setExportError(errorMessage(e, t)),
                )
              }
            >
              <Download aria-hidden="true" className="size-4" />
              {t('employees.export')}
            </Button>
          )}
          {can('employee.bulk.import') && (
            <Button asChild variant="secondary">
              <Link to="/employees/import">
                <Upload aria-hidden="true" className="size-4" />
                {t('employees.import')}
              </Link>
            </Button>
          )}
          {can('employee.profile.create') && (
            <Button asChild>
              <Link to="/employees/new">
                <Plus aria-hidden="true" className="size-4" />
                {t('employees.add')}
              </Link>
            </Button>
          )}
        </div>
      </header>
      {exportError && <Alert tone="error">{exportError}</Alert>}

      <div className="flex flex-wrap items-end gap-3">
        <input
          type="search"
          aria-label={t('employees.search')}
          placeholder={t('employees.search')}
          value={filters.q}
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          className="h-10 w-72 max-w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-sm"
        />
        <select
          aria-label={t('employees.col.department')}
          value={filters.departmentId}
          onChange={(e) => setFilters({ ...filters, departmentId: e.target.value })}
          className="h-10 rounded-[var(--radius-control)] border border-border-strong bg-surface px-2 text-sm"
        >
          <option value="">{t('employees.allDepartments')}</option>
          {(departments.data?.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          aria-label={t('employees.col.status')}
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          className="h-10 rounded-[var(--radius-control)] border border-border-strong bg-surface px-2 text-sm"
        >
          <option value="">{t('employees.allStatuses')}</option>
          {Object.keys(STATUS_TONE).map((s) => (
            <option key={s} value={s}>
              {t(`employees.status.${s}`)}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={filters.includeExited}
            onChange={(e) => setFilters({ ...filters, includeExited: e.target.checked })}
          />
          {t('employees.showExited')}
        </label>
      </div>

      <section
        aria-label={t('employees.title')}
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
          <p className="p-5 text-sm text-text-muted">
            {filtered ? t('employees.noMatches') : t('employees.empty')}
          </p>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="bg-bg text-xs font-semibold text-text-muted">
                  {['name', 'code', 'department', 'designation', 'manager', 'status', 'joined'].map((c) => (
                    <th key={c} scope="col" className="px-5 py-2.5 text-start">
                      {t(`employees.col.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100">
                    <td className="px-5 py-3">
                      <Link to={`/employees/${e.id}`} className="font-medium text-primary hover:underline">
                        {fullName(e)}
                      </Link>
                      {e.workEmail && <div className="text-xs text-text-muted">{e.workEmail}</div>}
                    </td>
                    <td className="tabular px-5 py-3">{e.employeeCode}</td>
                    <td className="px-5 py-3">{e.department?.name ?? '—'}</td>
                    <td className="px-5 py-3">{e.designation?.title ?? '—'}</td>
                    <td className="px-5 py-3">{e.manager?.name ?? '—'}</td>
                    <td className="px-5 py-3">
                      <Badge tone={STATUS_TONE[e.status]} withDot>
                        {t(`employees.status.${e.status}`)}
                      </Badge>
                    </td>
                    <td className="tabular whitespace-nowrap px-5 py-3">{fmt(e.dateOfJoining)}</td>
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
