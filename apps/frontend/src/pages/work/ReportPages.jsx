import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDaysYmd, clock } from '@/services/attendance';
import { REVIEW_TONE, tasksApi } from '@/services/tasks';
import { hms } from '@/services/work';
import { useWorkStatus } from '@/hooks/useWorkSession';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/utils/errors';

const card = 'rounded-[var(--radius-card)] border border-border bg-surface';

function Stepper({ label, value, onPrev, onNext, nextDisabled }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={onPrev} aria-label={t('reports.previous')}>
        <ChevronLeft aria-hidden="true" className="size-4" />
      </Button>
      <span className="min-w-44 text-center text-sm font-medium" aria-live="polite">
        {label ?? value}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onNext}
        disabled={nextDisabled}
        aria-label={t('reports.next')}
      >
        <ChevronRight aria-hidden="true" className="size-4" />
      </Button>
    </div>
  );
}

function Totals({ items }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-[var(--radius-control)] bg-bg px-3 py-2">
          <dt className="text-xs text-text-muted">{label}</dt>
          <dd className="tabular text-lg font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One day's report: built from sessions and task time; the person adds notes and submits. */
export function DailyReportPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const status = useWorkStatus();
  const today = status.data?.workDate;
  const tz = status.data?.employee?.timezone;
  const [date, setDate] = useState(null);
  useEffect(() => {
    if (today && !date) setDate(today);
  }, [today, date]);
  const report = useQuery({
    queryKey: ['reports', 'me', date],
    queryFn: () => tasksApi.myReport(date),
    enabled: Boolean(date),
  });
  const [notes, setNotes] = useState('');
  useEffect(() => setNotes(report.data?.notes ?? ''), [report.data?.notes, date]);
  const [message, setMessage] = useState(null);
  const act = useMutation({
    mutationFn: (fn) => fn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports'] }),
  });
  if (status.isPending || !date) return <p role="status">{t('common.loading')}</p>;
  if (status.data && !status.data.hasEmployeeRecord)
    return <Alert tone="info">{t('attendance.noRecord')}</Alert>;
  const r = report.data;
  const s = r?.summary;
  const label = new Intl.DateTimeFormat(i18n.language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('reports.dailyTitle')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('reports.dailySubtitle')}</p>
        </div>
        <Stepper
          label={label}
          onPrev={() => setDate(addDaysYmd(date, -1))}
          onNext={() => setDate(addDaysYmd(date, 1))}
          nextDisabled={date >= today}
        />
      </header>
      {report.isError && <Alert tone="error">{errorMessage(report.error, t)}</Alert>}
      {r && (
        <section aria-label={t('reports.dailyTitle')} className={`${card} flex flex-col gap-4 p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge tone={REVIEW_TONE[r.status]} withDot>
              {t(`reports.status.${r.status}`)}
            </Badge>
            {r.reviewComment && (
              <span className="text-sm text-text-muted">
                {t('reports.reviewNote')}: {r.reviewComment}
              </span>
            )}
          </div>
          <Totals
            items={[
              [t('reports.worked'), hms(s?.workedSec)],
              [t('reports.onTasks'), hms(s?.taskSec)],
              [t('reports.breaks'), hms(s?.breakSec)],
              [t('reports.disconnected'), hms(s?.disconnectedSec)],
            ]}
          />
          <div>
            <h2 className="text-sm font-semibold">{t('reports.sessions')}</h2>
            {(s?.sessions ?? []).length === 0 ? (
              <p className="text-sm text-text-muted">{t('reports.noSessions')}</p>
            ) : (
              <ul className="mt-1 text-sm">
                {s.sessions.map((x) => (
                  <li key={x.id}>
                    {clock(x.startedAt, tz, i18n.language)} –{' '}
                    {x.endedAt ? clock(x.endedAt, tz, i18n.language) : t('work.today.now')} · {x.location} ·{' '}
                    {hms(x.workedSec)}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h2 className="text-sm font-semibold">{t('reports.tasks')}</h2>
            {(s?.tasks ?? []).length === 0 ? (
              <p className="text-sm text-text-muted">{t('reports.noTasks')}</p>
            ) : (
              <ul className="mt-1 text-sm">
                {s.tasks.map((x) => (
                  <li key={x.taskId}>
                    {x.project ? `${x.project} · ` : ''}
                    {x.title} · <span className="tabular">{hms(x.sec)}</span>
                  </li>
                ))}
              </ul>
            )}
            {s?.completed?.length > 0 && (
              <p className="mt-1 text-sm text-text-muted">
                {t('reports.completed')}: {s.completed.map((c) => c.title).join(', ')}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="report-notes" className="text-sm font-medium">
              {t('reports.notes')}
            </label>
            <textarea
              id="report-notes"
              rows={4}
              value={notes}
              readOnly={!r.canEdit}
              onChange={(e) => setNotes(e.target.value)}
              className="rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 py-2 text-sm read-only:bg-bg"
            />
          </div>
          {act.isError && <Alert tone="error">{errorMessage(act.error, t)}</Alert>}
          {message && !act.isError && <Alert tone="success">{message}</Alert>}
          {r.canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={act.isPending}
                onClick={() => {
                  setMessage(t('reports.saved'));
                  act.mutate(() => tasksApi.saveReport(date, notes));
                }}
              >
                {t('reports.save')}
              </Button>
              <Button
                disabled={act.isPending}
                onClick={() => {
                  setMessage(t('reports.submitted'));
                  act.mutate(async () => {
                    await tasksApi.saveReport(date, notes);
                    return tasksApi.submitReport(date);
                  });
                }}
              >
                {t('reports.submit')}
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** One week's timesheet: totals per day and per task, built from the record; the person submits it. */
export function TimesheetPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const status = useWorkStatus();
  const today = status.data?.workDate;
  const [week, setWeek] = useState(null);
  useEffect(() => {
    if (today && !week) setWeek(today);
  }, [today, week]);
  const sheet = useQuery({
    queryKey: ['timesheets', 'me', week],
    queryFn: () => tasksApi.myTimesheet(week),
    enabled: Boolean(week),
  });
  const submit = useMutation({
    mutationFn: () => tasksApi.submitTimesheet(sheet.data.weekStart),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timesheets'] }),
  });
  if (status.isPending || !week) return <p role="status">{t('common.loading')}</p>;
  if (status.data && !status.data.hasEmployeeRecord)
    return <Alert tone="info">{t('attendance.noRecord')}</Alert>;
  const s = sheet.data;
  const b = s?.breakdown;
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
          <h1 className="text-3xl font-bold">{t('reports.timesheetTitle')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('reports.timesheetSubtitle')}</p>
        </div>
        {s && (
          <Stepper
            label={t('reports.weekOf', { date: fmt(s.weekStart) })}
            onPrev={() => setWeek(addDaysYmd(s.weekStart, -7))}
            onNext={() => setWeek(addDaysYmd(s.weekStart, 7))}
            nextDisabled={addDaysYmd(s.weekStart, 7) > today}
          />
        )}
      </header>
      {sheet.isError && <Alert tone="error">{errorMessage(sheet.error, t)}</Alert>}
      {s && b && (
        <section aria-label={t('reports.timesheetTitle')} className={`${card} flex flex-col gap-4 p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Badge tone={REVIEW_TONE[s.status]} withDot>
              {t(`reports.status.${s.status}`)}
            </Badge>
            {s.comment && (
              <span className="text-sm text-text-muted">
                {t('reports.reviewNote')}: {s.comment}
              </span>
            )}
          </div>
          <Totals
            items={[
              [t('reports.worked'), hms(b.totalSec)],
              [t('reports.onTasks'), hms(b.taskSec)],
              [t('reports.unallocated'), hms(b.unallocatedSec)],
              [t('reports.disconnected'), hms(b.disconnectedSec)],
            ]}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="bg-bg text-xs font-semibold text-text-muted">
                  <th scope="col" className="px-3 py-2 text-start">
                    {t('reports.task')}
                  </th>
                  {b.days.map((d) => (
                    <th key={d.date} scope="col" className="px-3 py-2 text-end">
                      {fmt(d.date)}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2 text-end">
                    {t('reports.total')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {b.tasks.map((x) => (
                  <tr key={x.taskId} className="border-t border-slate-100">
                    <th scope="row" className="px-3 py-2 text-start font-normal">
                      {x.project ? `${x.project} · ` : ''}
                      {x.title}
                    </th>
                    {b.days.map((d) => (
                      <td key={d.date} className="tabular px-3 py-2 text-end">
                        {x.perDay[d.date] ? hms(x.perDay[d.date]) : '—'}
                      </td>
                    ))}
                    <td className="tabular px-3 py-2 text-end font-semibold">{hms(x.sec)}</td>
                  </tr>
                ))}
                <tr className="border-t border-border font-semibold">
                  <th scope="row" className="px-3 py-2 text-start">
                    {t('reports.worked')}
                  </th>
                  {b.days.map((d) => (
                    <td key={d.date} className="tabular px-3 py-2 text-end">
                      {d.workedSec ? hms(d.workedSec) : '—'}
                    </td>
                  ))}
                  <td className="tabular px-3 py-2 text-end">{hms(b.totalSec)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {submit.isError && <Alert tone="error">{errorMessage(submit.error, t)}</Alert>}
          {s.sessionRunning && <Alert tone="info">{t('reports.endSessionFirst')}</Alert>}
          {s.canSubmit && (
            <div>
              <Button disabled={submit.isPending || s.sessionRunning} onClick={() => submit.mutate()}>
                {t('reports.submitWeek')}
              </Button>
              <p className="mt-2 text-xs text-text-muted">{t('reports.lockNote')}</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
