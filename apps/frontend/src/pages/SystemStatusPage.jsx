import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { fetchReadiness } from '@/services/system';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

/** Live readiness of the backend. Polls every 15 s; every state (loading, error, degraded, ok) is explicit. */
export function SystemStatusPage() {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ['system', 'readiness'],
    queryFn: fetchReadiness,
    refetchInterval: 15_000,
    retry: 1,
  });

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('status.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('status.subtitle')}</p>
        </div>
        <Button variant="secondary" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw aria-hidden="true" className={isFetching ? 'size-4 animate-spin' : 'size-4'} />
          {t('status.refresh')}
        </Button>
      </header>

      {isPending && (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-5"
        >
          <span className="sr-only">{t('status.checking')}</span>
          <div className="h-4 w-1/3 rounded bg-border" />
          <div className="h-10 w-full rounded bg-slate-100" />
          <div className="h-10 w-full rounded bg-slate-100" />
        </div>
      )}

      {isError && (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] border border-red-200 bg-danger-soft p-5"
        >
          <p className="font-semibold text-red-800">{t('status.loadError')}</p>
          <p className="text-sm text-red-900">{t('status.loadErrorDetail')}</p>
          <Button variant="secondary" size="sm" onClick={() => refetch()}>
            {t('status.retry')}
          </Button>
        </div>
      )}

      {data && (
        <section
          aria-labelledby="overall"
          className="rounded-[var(--radius-card)] border border-border bg-surface"
        >
          <div className="flex items-center gap-3 border-b border-border px-5 py-4">
            <h2 id="overall" className="text-base font-semibold">
              {data.status === 'ok' ? t('status.overallOk') : t('status.overallDegraded')}
            </h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {data.checks.map((c) => (
              <li key={c.name} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                <span className="text-sm font-medium">
                  {t(`status.service.${c.name}`, { defaultValue: c.name })}
                </span>
                <span className="flex items-center gap-3">
                  <span className="tabular text-xs text-text-muted">
                    {t('status.latency', { ms: c.latencyMs })}
                  </span>
                  <Badge tone={c.ok ? 'success' : 'danger'} withDot>
                    {c.ok
                      ? t('status.ok')
                      : `${t('status.down')} · ${t(`status.errorReason.${c.error}`, { defaultValue: c.error })}`}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
