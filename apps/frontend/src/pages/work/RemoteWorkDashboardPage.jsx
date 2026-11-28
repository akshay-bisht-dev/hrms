import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { addDaysYmd } from '@/services/attendance';
import { tasksApi } from '@/services/tasks';
import { hms } from '@/services/work';
import { Alert } from '@/components/ui/alert';
import { Field } from '@/components/ui/field';
import { errorMessage } from '@/utils/errors';

const card = 'rounded-[var(--radius-card)] border border-border bg-surface';

/** Company remote-work figures for a period: aggregates only, never people's names or activity. */
export function RemoteWorkDashboardPage() {
  const { t, i18n } = useTranslation();
  const today = new Date().toISOString().slice(0, 10);
  const [range, setRange] = useState({ from: addDaysYmd(today, -6), to: today });
  const data = useQuery({
    queryKey: ['dashboards', 'remote-work', range],
    queryFn: () => tasksApi.remoteWork(range),
  });
  const d = data.data;
  const pct = (v) => `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(v)}%`;
  const tile = (label, value, hint) => (
    <div key={label} className={`${card} p-4`}>
      <div className="text-xs text-text-muted">{label}</div>
      <div className="tabular text-2xl font-semibold">{value}</div>
      {hint && <div className="text-xs text-text-muted">{hint}</div>}
    </div>
  );
  const fmt = (ymd) =>
    new Intl.DateTimeFormat(i18n.language, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${ymd}T00:00:00Z`));
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('remoteDash.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('remoteDash.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Field
            label={t('remoteDash.from')}
            type="date"
            value={range.from}
            max={range.to}
            onChange={(e) => setRange({ ...range, from: e.target.value })}
          />
          <Field
            label={t('remoteDash.to')}
            type="date"
            value={range.to}
            min={range.from}
            onChange={(e) => setRange({ ...range, to: e.target.value })}
          />
        </div>
      </header>
      {data.isPending && <p role="status">{t('common.loading')}</p>}
      {data.isError && <Alert tone="error">{errorMessage(data.error, t)}</Alert>}
      {d && (
        <>
          <section aria-label={t('remoteDash.now')} className="grid gap-3 sm:grid-cols-4">
            {tile(t('remoteDash.headcount'), d.headcount)}
            {tile(t('remoteDash.workingNow'), d.now.working)}
            {tile(t('remoteDash.onBreakNow'), d.now.onBreak)}
            {tile(t('remoteDash.disconnectedNow'), d.now.disconnected)}
          </section>
          <section aria-label={t('remoteDash.period')} className="grid gap-3 sm:grid-cols-4">
            {tile(
              t('remoteDash.avgDay'),
              hms(d.period.avgWorkedSecPerPersonDay),
              t('remoteDash.personDays', { count: d.period.personDays }),
            )}
            {tile(t('remoteDash.remoteShare'), pct(d.period.remoteSharePct))}
            {tile(t('remoteDash.disconnectedShare'), pct(d.period.disconnectedSharePct))}
            {tile(
              t('remoteDash.autoClosed'),
              d.period.autoClosedSessions,
              t('remoteDash.needsReview', { count: d.period.sessionsNeedingReview }),
            )}
          </section>
          <section aria-label={t('remoteDash.daily')} className={card}>
            <h2 className="border-b border-border px-5 py-4 text-base font-semibold">
              {t('remoteDash.daily')}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="bg-bg text-xs font-semibold text-text-muted">
                    {['date', 'people', 'remotePeople', 'worked', 'remote'].map((c) => (
                      <th
                        key={c}
                        scope="col"
                        className={`px-4 py-2.5 ${c === 'date' ? 'text-start' : 'text-end'}`}
                      >
                        {t(`remoteDash.col.${c}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.daily.map((row) => (
                    <tr key={row.date} className="border-t border-slate-100">
                      <th scope="row" className="px-4 py-2.5 text-start font-normal">
                        {fmt(row.date)}
                      </th>
                      <td className="tabular px-4 py-2.5 text-end">{row.people}</td>
                      <td className="tabular px-4 py-2.5 text-end">{row.remotePeople}</td>
                      <td className="tabular px-4 py-2.5 text-end">{hms(row.workedSec)}</td>
                      <td className="tabular px-4 py-2.5 text-end">{hms(row.remoteSec)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section aria-label={t('remoteDash.pending')} className={`${card} p-5`}>
            <h2 className="text-base font-semibold">{t('remoteDash.pending')}</h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-4">
              {Object.entries(d.pending).map(([k, n]) => (
                <li key={k} className="rounded-[var(--radius-control)] bg-bg px-3 py-2">
                  <div className="tabular text-lg font-semibold">{n}</div>
                  <div className="text-xs text-text-muted">{t(`teamWork.waitingFor.${k}`)}</div>
                </li>
              ))}
            </ul>
          </section>
          <p className="text-xs text-text-muted">{t('remoteDash.privacy')}</p>
        </>
      )}
    </div>
  );
}
