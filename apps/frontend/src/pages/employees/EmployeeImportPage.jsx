import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { downloadFromApi, employeesApi, openSignedUrl, startImport } from '@/services/employees';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { errorMessage } from '@/utils/errors';

const TONE = { QUEUED: 'info', RUNNING: 'info', SUCCEEDED: 'success', PARTIAL: 'warning', FAILED: 'danger' };

export function EmployeeImportPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const jobs = useQuery({
    queryKey: ['imports'],
    queryFn: employeesApi.imports,
    // Poll while anything is still running.
    refetchInterval: (q) =>
      q.state.data?.data.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING') ? 1500 : false,
  });
  // When a running import finishes, the directory is out of date: refresh it.
  const wasRunning = useRef(false);
  useEffect(() => {
    const running = Boolean(jobs.data?.data.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING'));
    if (wasRunning.current && !running) qc.invalidateQueries({ queryKey: ['employees'] });
    wasRunning.current = running;
  }, [jobs.data, qc]);
  const run = useMutation({
    mutationFn: () => startImport(file),
    onSuccess: () => {
      setFile(null);
      setError(null);
      wasRunning.current = true;
      qc.invalidateQueries({ queryKey: ['imports'] });
    },
    onError: (err) => setError(errorMessage(err, t)),
  });
  const fmt = (d) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d));
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold">{t('employees.importPage.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">{t('employees.importPage.subtitle')}</p>
      </header>
      <section className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-5">
        <div>
          <Button
            variant="secondary"
            onClick={() =>
              downloadFromApi('/api/v1/employees/imports/template', 'employee-import-template.csv')
            }
          >
            <Download aria-hidden="true" className="size-4" />
            {t('employees.importPage.template')}
          </Button>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          {t('employees.importPage.choose')}
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm font-normal"
          />
        </label>
        <div>
          <Button onClick={() => run.mutate()} disabled={!file || run.isPending}>
            {run.isPending ? t('employees.importPage.running') : t('employees.importPage.start')}
          </Button>
        </div>
      </section>
      <section
        aria-labelledby="recent-h"
        className="rounded-[var(--radius-card)] border border-border bg-surface p-5"
      >
        <h2 id="recent-h" className="text-base font-semibold">
          {t('employees.importPage.recent')}
        </h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {(jobs.data?.data ?? []).map((j) => (
            <li key={j.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div>
                <Badge tone={TONE[j.status]} withDot>
                  {t(`employees.importPage.status.${j.status}`)}
                </Badge>{' '}
                <span className="text-text-muted">{fmt(j.createdAt)}</span>
                {j.totalRows !== null && (
                  <div className="mt-1 text-xs text-text-muted">
                    {t('employees.importPage.counts', {
                      ok: j.okRows,
                      failed: j.errorRows,
                      total: j.totalRows,
                    })}
                  </div>
                )}
              </div>
              {j.hasResult && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => openSignedUrl((await employeesApi.importResultUrl(j.id)).url)}
                >
                  {t('employees.importPage.result')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
