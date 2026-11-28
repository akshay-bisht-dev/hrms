import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Download, Eye, Flag, X } from 'lucide-react';
import { monitoringApi } from '@/services/monitoring';
import { employeesApi } from '@/services/employees';
import { useAuth } from '@/context/AuthContext';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, SelectField } from '@/components/ui/field';
import { errorMessage } from '@/utils/errors';

const card = 'rounded-[var(--radius-card)] border border-border bg-surface';
const todayYmd = () => new Date().toISOString().slice(0, 10);
const fullName = (e) => [e.firstName, e.lastName].filter(Boolean).join(' ');

/** Loads a thumbnail through a fresh 60-second link (each load is logged as a view). */
function Thumb({ id, label }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let live = true;
    monitoringApi
      .viewUrl(id, true)
      .then((r) => live && setSrc(r.url))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id]);
  return src ? (
    <img
      src={src}
      alt={label}
      className="aspect-video w-full rounded-[var(--radius-control)] border border-border object-cover"
      referrerPolicy="no-referrer"
    />
  ) : (
    <div className="aspect-video w-full rounded-[var(--radius-control)] bg-bg" aria-hidden="true" />
  );
}

/** A day of screenshots with view, and (by role) dispute, download and delete. */
function Gallery({ employeeId, own }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { can, me } = useAuth();
  const [date, setDate] = useState(todayYmd());
  const [open, setOpen] = useState(null);
  const [full, setFull] = useState(null);
  const [reason, setReason] = useState('');
  const list = useQuery({
    queryKey: ['screenshots', employeeId ?? 'me', date],
    queryFn: () => monitoringApi.screenshots({ employeeId, date }),
    refetchOnMount: 'always',
  });
  const log = useQuery({
    queryKey: ['screenshots', 'log', open],
    queryFn: () => monitoringApi.accessLog(open),
    enabled: Boolean(open && own),
  });
  const act = useMutation({
    mutationFn: (fn) => fn(),
    onSuccess: () => {
      setReason('');
      qc.invalidateQueries({ queryKey: ['screenshots'] });
    },
  });
  const time = (iso) => new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' }).format(new Date(iso));
  const rows = list.data?.data ?? [];
  const selected = rows.find((r) => r.id === open);
  const view = async (id) => {
    setOpen(id);
    setFull(null);
    try {
      setFull((await monitoringApi.viewUrl(id)).url);
    } catch {
      setFull(null);
    }
  };
  return (
    <section aria-label={t('screenshots.gallery')} className={`${card} flex flex-col gap-4 p-5`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field
          label={t('screenshots.date')}
          type="date"
          max={todayYmd()}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <span className="text-sm text-text-muted">{t('screenshots.count', { count: rows.length })}</span>
      </div>
      {list.isError && <Alert tone="error">{errorMessage(list.error, t)}</Alert>}
      {list.isSuccess && rows.length === 0 && (
        <p className="text-sm text-text-muted">{t('screenshots.none')}</p>
      )}
      {(list.data?.skipped ?? []).length > 0 && (
        <p className="text-xs text-text-muted">
          {t('screenshots.skipped')}:{' '}
          {list.data.skipped.map((s) => `${t(`screenshots.skip.${s.reason}`)} (${s.count})`).join(', ')}
        </p>
      )}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => view(r.id)}
              aria-label={t('screenshots.viewAt', { time: time(r.capturedAt) })}
              className="text-start"
            >
              {r.status === 'AVAILABLE' || r.status === 'UNDER_DISPUTE' ? (
                <Thumb id={r.id} label={t('screenshots.at', { time: time(r.capturedAt) })} />
              ) : (
                <div className="aspect-video w-full rounded-[var(--radius-control)] bg-bg" />
              )}
            </button>
            <span className="flex flex-wrap items-center gap-1 text-xs">
              {time(r.capturedAt)}
              {r.status !== 'AVAILABLE' && (
                <Badge tone={r.status === 'UNDER_DISPUTE' ? 'warning' : 'neutral'}>
                  {t(`screenshots.status.${r.status}`)}
                </Badge>
              )}
            </span>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-primary/40 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {t('screenshots.at', { time: time(selected.capturedAt) })}
            </h3>
            <Button size="sm" variant="ghost" onClick={() => setOpen(null)} aria-label={t('common.close')}>
              <X aria-hidden="true" className="size-4" />
            </Button>
          </div>
          {full && (
            <img
              src={full}
              alt={t('screenshots.at', { time: time(selected.capturedAt) })}
              className="w-full rounded-[var(--radius-control)] border border-border"
              referrerPolicy="no-referrer"
            />
          )}
          {act.isError && <Alert tone="error">{errorMessage(act.error, t)}</Alert>}
          <div className="flex flex-wrap items-end gap-2">
            {(own || can('manage_monitoring_policy')) && (
              <Field
                className="min-w-64 flex-1"
                label={t('screenshots.reason')}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
            {own && selected.status === 'AVAILABLE' && (
              <Button
                size="sm"
                variant="secondary"
                disabled={act.isPending || reason.trim().length < 5}
                onClick={() => act.mutate(() => monitoringApi.dispute(selected.id, reason.trim()))}
              >
                <Flag aria-hidden="true" className="size-4" />
                {t('screenshots.dispute')}
              </Button>
            )}
            {!own && can('download_screenshots') && (
              <Button
                size="sm"
                variant="secondary"
                disabled={act.isPending}
                onClick={() => act.mutate(() => monitoringApi.download(selected.id))}
              >
                <Download aria-hidden="true" className="size-4" />
                {t('screenshots.download')}
              </Button>
            )}
            {can('manage_monitoring_policy') && (
              <Button
                size="sm"
                variant="ghost"
                disabled={act.isPending || reason.trim().length < 3}
                onClick={() => act.mutate(() => monitoringApi.remove(selected.id, reason.trim()))}
              >
                {t('screenshots.delete')}
              </Button>
            )}
          </div>
          {own && (
            <div className="text-sm">
              <h4 className="flex items-center gap-2 font-semibold">
                <Eye aria-hidden="true" className="size-4" />
                {t('screenshots.whoViewed')}
              </h4>
              <ul className="mt-1 text-text-muted">
                {(log.data?.data ?? []).map((l) => (
                  <li key={l.id}>
                    {t(`screenshots.action.${l.action}`)} ·{' '}
                    {new Intl.DateTimeFormat(i18n.language, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    }).format(new Date(l.at))}
                    {' · '}
                    {l.actorUserId === me?.user?.id ? t('screenshots.byYou') : t('screenshots.bySomeone')}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Your own screenshots, who looked at them, and privacy reports. */
export function MyScreenshotsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const disputes = useQuery({ queryKey: ['screenshots', 'disputes'], queryFn: monitoringApi.disputes });
  const report = useMutation({
    mutationFn: () => monitoringApi.reportIncident({ description: text.trim() }),
    onSuccess: () => {
      setText('');
      qc.invalidateQueries({ queryKey: ['screenshots'] });
    },
  });
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold">{t('screenshots.mineTitle')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('screenshots.mineSubtitle')}</p>
      </header>
      <Gallery own />
      <section aria-label={t('screenshots.myDisputes')} className={`${card} p-5`}>
        <h2 className="text-base font-semibold">{t('screenshots.myDisputes')}</h2>
        {(disputes.data?.data ?? []).length === 0 && (
          <p className="text-sm text-text-muted">{t('screenshots.noDisputes')}</p>
        )}
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {(disputes.data?.data ?? []).map((d) => (
            <li key={d.id}>
              {d.reason} ·{' '}
              <Badge tone={d.status === 'OPEN' ? 'warning' : 'neutral'}>
                {t(`screenshots.disputeStatus.${d.status}`)}
              </Badge>
              {d.resolution ? <span className="text-text-muted"> · {d.resolution}</span> : null}
            </li>
          ))}
        </ul>
      </section>
      <section aria-label={t('screenshots.incident')} className={`${card} flex flex-col gap-3 p-5`}>
        <h2 className="text-base font-semibold">{t('screenshots.incident')}</h2>
        <p className="text-sm text-text-muted">{t('screenshots.incidentHelp')}</p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="incident-text" className="text-sm font-medium">
            {t('screenshots.whatHappened')}
          </label>
          <textarea
            id="incident-text"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 py-2 text-sm"
          />
        </div>
        {report.isSuccess && <Alert tone="success">{t('screenshots.incidentSent')}</Alert>}
        {report.isError && <Alert tone="error">{errorMessage(report.error, t)}</Alert>}
        <div>
          <Button disabled={report.isPending || text.trim().length < 10} onClick={() => report.mutate()}>
            {t('screenshots.send')}
          </Button>
        </div>
      </section>
    </div>
  );
}

/** Screenshots of people in your viewing scope (view_team_screenshots + a viewer role from the checklist). */
export function ScreenshotReviewPage() {
  const { t } = useTranslation();
  const people = useQuery({
    queryKey: ['employees', 'pick-all'],
    queryFn: () => employeesApi.list({ limit: 200 }),
  });
  const [employeeId, setEmployeeId] = useState('');
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold">{t('screenshots.reviewTitle')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('screenshots.reviewSubtitle')}</p>
      </header>
      <SelectField
        label={t('screenshots.person')}
        value={employeeId}
        onChange={(e) => setEmployeeId(e.target.value)}
      >
        <option value="">{t('resource.choose')}</option>
        {(people.data?.data ?? []).map((e) => (
          <option key={e.id} value={e.id}>
            {fullName(e)} · {e.employeeCode}
          </option>
        ))}
      </SelectField>
      {employeeId && <Gallery key={employeeId} employeeId={employeeId} own={false} />}
    </div>
  );
}
