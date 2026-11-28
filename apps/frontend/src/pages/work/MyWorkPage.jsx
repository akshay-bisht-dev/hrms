import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Coffee, Eye, EyeOff, Home, Play, Square, Wrench } from 'lucide-react';
import { clock, REQUEST_TONE } from '@/services/attendance';
import { hms, SEGMENT_CLASS, SESSION_TONE, workApi } from '@/services/work';
import { useWorkStatus, WORK_STATUS_KEY, zonedIso } from '@/hooks/useWorkSession';
import { FormMessages, useFormAction } from '@/hooks/useFormAction';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, SelectField } from '@/components/ui/field';
import { errorMessage } from '@/utils/errors';

const card = 'rounded-[var(--radius-card)] border border-border bg-surface';

export function MyWorkPage() {
  const { t } = useTranslation();
  const status = useWorkStatus();
  if (status.isPending) return <p role="status">{t('common.loading')}</p>;
  if (status.isError) return <Alert tone="error">{errorMessage(status.error, t)}</Alert>;
  const s = status.data;
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold">{t('work.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">
          {s.hasEmployeeRecord ? t('work.subtitle', { tz: s.employee.timezone }) : t('work.subtitleNoRecord')}
        </p>
      </header>
      {s.hasEmployeeRecord ? (
        <MyWork status={s} />
      ) : (
        <>
          <Alert tone="info">{t('attendance.noRecord')}</Alert>
          <Disclosure status={s} />
        </>
      )}
    </div>
  );
}

function MyWork({ status }) {
  const [fixing, setFixing] = useState(null);
  return (
    <>
      <SessionCard status={status} />
      <Disclosure status={status} />
      <Today status={status} onFix={setFixing} />
      {fixing && (
        <CorrectionForm session={fixing} tz={status.employee.timezone} onClose={() => setFixing(null)} />
      )}
      <WfhRequests status={status} />
      <MyCorrections tz={status.employee.timezone} />
    </>
  );
}

/** Live seconds for the running session: the server's totals plus time since the last fetch, while working. */
function useLiveSeconds(active, fetchedAt) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [active]);
  if (!active) return { worked: 0, onBreak: 0 };
  const since = Math.max(0, Math.floor((now - fetchedAt) / 1000));
  return {
    worked: active.workedSec + (active.status === 'ACTIVE' ? since : 0),
    onBreak: active.breakSec + (active.status === 'ON_BREAK' ? since : 0),
  };
}

function SessionCard({ status }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const tz = status.employee.timezone;
  const active = status.active;
  const available = status.locations.filter((l) => l.available);
  const [locationId, setLocationId] = useState(available[0]?.id ?? '');
  const [breakType, setBreakType] = useState('REGULAR');
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  useEffect(() => setFetchedAt(Date.now()), [status]);
  useEffect(() => {
    if (!locationId && available[0]) setLocationId(available[0].id);
  }, [available, locationId]);
  const live = useLiveSeconds(active, fetchedAt);
  const act = useMutation({
    mutationFn: (fn) => fn(),
    onSuccess: (next) => {
      setError(null);
      qc.setQueryData(WORK_STATUS_KEY, next);
      qc.invalidateQueries({ queryKey: ['work'] });
      qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (e) => {
      setError(errorMessage(e, t));
      qc.invalidateQueries({ queryKey: ['work'] });
    },
  });
  const worked = status.totals.workedSec - (active?.workedSec ?? 0) + live.worked;
  const policy = status.policy;
  return (
    <section aria-label={t('work.session.title')} className={`${card} flex flex-col gap-4 p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {active
              ? t('work.session.since', { time: clock(active.startedAt, tz, i18n.language) })
              : t('work.session.none')}
            {active && (
              <Badge tone={SESSION_TONE[active.status]} withDot>
                {t(`work.sessionStatus.${active.status}`)}
              </Badge>
            )}
          </h2>
          {active && (
            <p className="text-sm text-text-muted">
              {active.location.name}
              {active.openBreak &&
                ` · ${t('work.session.onBreakSince', { time: clock(active.openBreak.startedAt, tz, i18n.language) })}`}
            </p>
          )}
          <p className="text-sm" aria-live="polite">
            {t('work.session.workedToday')}: <span className="tabular font-semibold">{hms(worked)}</span>
            {status.totals.disconnectedSec > 0 && (
              <span className="text-text-muted">
                {' '}
                · {t('work.session.disconnected')}:{' '}
                <span className="tabular">{hms(status.totals.disconnectedSec)}</span>
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {!active && (
            <>
              <SelectField
                label={t('work.session.location')}
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                {status.locations.map((l) => (
                  <option key={l.id} value={l.id} disabled={!l.available}>
                    {l.available ? l.name : t('work.session.needsApproval', { name: l.name })}
                  </option>
                ))}
              </SelectField>
              <Button
                size="lg"
                disabled={act.isPending || !locationId}
                onClick={() => act.mutate(() => workApi.start(locationId))}
              >
                <Play aria-hidden="true" className="size-4" />
                {t('work.session.start')}
              </Button>
            </>
          )}
          {active && active.status !== 'ON_BREAK' && (
            <>
              <SelectField
                label={t('work.session.breakType')}
                value={breakType}
                onChange={(e) => setBreakType(e.target.value)}
              >
                {['REGULAR', 'MEAL', 'PERSONAL'].map((k) => (
                  <option key={k} value={k}>
                    {t(`work.breakType.${k}`)}
                  </option>
                ))}
              </SelectField>
              <Button
                variant="secondary"
                disabled={act.isPending}
                onClick={() => act.mutate(() => workApi.startBreak(breakType))}
              >
                <Coffee aria-hidden="true" className="size-4" />
                {t('work.session.startBreak')}
              </Button>
            </>
          )}
          {active?.status === 'ON_BREAK' && (
            <Button disabled={act.isPending} onClick={() => act.mutate(() => workApi.endBreak())}>
              <Play aria-hidden="true" className="size-4" />
              {t('work.session.endBreak')}
            </Button>
          )}
          {active && (
            <Button
              variant="secondary"
              disabled={act.isPending}
              onClick={() => act.mutate(() => workApi.end())}
            >
              <Square aria-hidden="true" className="size-4" />
              {t('work.session.end')}
            </Button>
          )}
        </div>
      </div>
      {active && <Timeline segments={active.segments} tz={tz} />}
      {error && <Alert tone="error">{error}</Alert>}
      <p className="text-xs text-text-muted">
        {t('work.session.policyNote', {
          timeout: Math.round(policy.heartbeatTimeoutSec / 60),
          window: policy.resumeWindowMin,
          from: policy.allowedStart,
          to: policy.allowedEnd,
        })}
      </p>
    </section>
  );
}

/** Coloured bar of the session: worked, break, disconnected… with a text list for screen readers. */
function Timeline({ segments, tz }) {
  const { t, i18n } = useTranslation();
  if (!segments?.length) return null;
  const start = Date.parse(segments[0].from);
  const total = Math.max(1, Date.parse(segments.at(-1).to) - start);
  return (
    <figure className="flex flex-col gap-2">
      <div aria-hidden="true" className="flex h-3 w-full overflow-hidden rounded-full bg-bg">
        {segments.map((s) => (
          <span
            key={s.from}
            className={SEGMENT_CLASS[s.kind]}
            style={{ width: `${((Date.parse(s.to) - Date.parse(s.from)) / total) * 100}%` }}
          />
        ))}
      </div>
      <figcaption className="sr-only">
        <ul>
          {segments.map((s) => (
            <li key={s.from}>
              {t(`work.segment.${s.kind}`)}: {clock(s.from, tz, i18n.language)} –{' '}
              {clock(s.to, tz, i18n.language)}
            </li>
          ))}
        </ul>
      </figcaption>
      <ul aria-hidden="true" className="flex flex-wrap gap-3 text-xs text-text-muted">
        {[...new Set(segments.map((s) => s.kind))].map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className={`size-2.5 rounded-full ${SEGMENT_CLASS[k]}`} />
            {t(`work.segment.${k}`)}
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** What is and is not recorded, in plain words. Shown before anyone starts a session. */
function Disclosure({ status }) {
  const { t } = useTranslation();
  const d = status.disclosure;
  return (
    <section aria-label={t('work.disclosure.title')} className={`${card} grid gap-4 p-5 sm:grid-cols-2`}>
      <h2 className="text-base font-semibold sm:col-span-2">{t('work.disclosure.title')}</h2>
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Eye aria-hidden="true" className="size-4" />
          {t('work.disclosure.recorded')}
        </h3>
        <ul className="mt-2 list-disc ps-5 text-sm">
          {d.recorded.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <EyeOff aria-hidden="true" className="size-4" />
          {t('work.disclosure.notRecorded')}
        </h3>
        <ul className="mt-2 list-disc ps-5 text-sm">
          {d.notRecorded.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </div>
      <p className="text-sm text-text-muted sm:col-span-2">{d.disconnected}</p>
    </section>
  );
}

function Today({ status, onFix }) {
  const { t, i18n } = useTranslation();
  const tz = status.employee.timezone;
  const rows = [...status.today].reverse();
  return (
    <section aria-label={t('work.today.title')} className={card}>
      <h2 className="border-b border-border px-5 py-4 text-base font-semibold">{t('work.today.title')}</h2>
      {rows.length === 0 && <p className="p-5 text-sm text-text-muted">{t('work.today.none')}</p>}
      <ul className="divide-y divide-slate-100">
        {rows.map((s) => (
          <li
            key={s.id}
            data-testid={`session-${s.id}`}
            className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"
          >
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">
                {clock(s.startedAt, tz, i18n.language)} –{' '}
                {s.endedAt ? clock(s.endedAt, tz, i18n.language) : t('work.today.now')} · {s.location.name}
              </span>
              <span className="text-text-muted">
                {t('work.today.totals', {
                  worked: hms(s.workedSec),
                  breaks: hms(s.breakSec),
                  lost: hms(s.disconnectedSec),
                })}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={SESSION_TONE[s.status]} withDot>
                {t(`work.sessionStatus.${s.status}`)}
              </Badge>
              {s.needsReview && <Badge tone="warning">{t('work.today.needsReview')}</Badge>}
              {s.endedAt && (
                <Button size="sm" variant="ghost" onClick={() => onFix(s)}>
                  <Wrench aria-hidden="true" className="size-4" />
                  {t('work.today.fix')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const hhmmIn = (iso, tz) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

function CorrectionForm({ session, tz, onClose }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const autoClosed = session.status === 'AUTO_CLOSED';
  const [form, setForm] = useState({
    kind: autoClosed ? 'MISSING_CHECKOUT' : 'DISCONNECT_DISPUTE',
    from: hhmmIn(session.startedAt, tz),
    to: hhmmIn(session.endedAt, tz),
    reason: '',
  });
  const missing = form.kind === 'MISSING_CHECKOUT';
  const toIso = (hhmm, after) => {
    const iso = zonedIso(session.workDate, hhmm, tz);
    // A time earlier than the start means the next morning (a session that crossed midnight).
    return after && Date.parse(iso) < Date.parse(after)
      ? new Date(Date.parse(iso) + 86_400_000).toISOString()
      : iso;
  };
  const save = useFormAction(
    () => {
      const fromTs = missing ? session.endedAt : toIso(form.from, session.startedAt);
      return workApi.requestCorrection({
        sessionId: session.id,
        kind: form.kind,
        fromTs,
        toTs: toIso(form.to, fromTs),
        reason: form.reason,
      });
    },
    () => {
      qc.invalidateQueries({ queryKey: ['work'] });
      onClose();
      return null;
    },
  );
  const kinds = autoClosed
    ? ['MISSING_CHECKOUT', 'DISCONNECT_DISPUTE', 'ADD_WORK_TIME', 'REMOVE_WORK_TIME', 'MARK_BREAK']
    : ['DISCONNECT_DISPUTE', 'ADD_WORK_TIME', 'REMOVE_WORK_TIME', 'MARK_BREAK'];
  return (
    <section
      aria-label={t('work.correction.title')}
      className="rounded-[var(--radius-card)] border border-primary/40 bg-surface"
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save.run();
        }}
        className="grid gap-4 p-5 sm:grid-cols-3"
      >
        <div className="sm:col-span-3">
          <h2 className="text-base font-semibold">{t('work.correction.title')}</h2>
          <p className="text-sm text-text-muted">{t('work.correction.help')}</p>
        </div>
        <div className="sm:col-span-3">
          <FormMessages action={save} />
        </div>
        <SelectField
          label={t('work.correction.kind')}
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value })}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {t(`work.correctionKind.${k}`)}
            </option>
          ))}
        </SelectField>
        {missing ? (
          <Field
            label={t('work.correction.from')}
            value={hhmmIn(session.endedAt, tz)}
            readOnly
            hint={t('work.correction.closedAt')}
          />
        ) : (
          <Field
            label={t('work.correction.from')}
            type="time"
            value={form.from}
            error={save.errors.fromTs}
            onChange={(e) => setForm({ ...form, from: e.target.value })}
          />
        )}
        <Field
          label={missing ? t('work.correction.stoppedAt') : t('work.correction.to')}
          type="time"
          value={form.to}
          error={save.errors.toTs}
          onChange={(e) => setForm({ ...form, to: e.target.value })}
        />
        <div className="flex flex-col gap-1.5 sm:col-span-3">
          <label htmlFor="work-correction-reason" className="text-sm font-medium">
            {t('work.correction.reason')}
          </label>
          <textarea
            id="work-correction-reason"
            rows={3}
            value={form.reason}
            aria-invalid={save.errors.reason ? true : undefined}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            className="rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 py-2 text-sm"
          />
          {save.errors.reason && <span className="text-xs text-red-700">{save.errors.reason}</span>}
        </div>
        <div className="flex gap-2 sm:col-span-3">
          <Button type="submit" disabled={save.pending}>
            {t('work.correction.submit')}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </section>
  );
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

function WfhRequests({ status }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const needing = status.locations.filter((l) => l.needsApproval);
  const [form, setForm] = useState({
    workLocationId: needing[0]?.id ?? '',
    fromDate: status.workDate,
    toDate: status.workDate,
    weekdays: [],
    reason: '',
  });
  const list = useQuery({ queryKey: ['work', 'wfh', 'mine'], queryFn: () => workApi.wfh({ view: 'mine' }) });
  const save = useFormAction(
    () =>
      workApi.requestWfh({
        workLocationId: form.workLocationId,
        fromDate: form.fromDate,
        toDate: form.toDate,
        ...(form.weekdays.length ? { weekdays: form.weekdays } : {}),
        ...(form.reason ? { reason: form.reason } : {}),
      }),
    (r) => {
      qc.invalidateQueries({ queryKey: ['work'] });
      return t('work.wfh.sent', { count: r.days.length });
    },
  );
  const cancel = useMutation({
    mutationFn: (id) => workApi.cancelWfh(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work'] }),
  });
  const dayName = (d) =>
    new Intl.DateTimeFormat(i18n.language, { weekday: 'short', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2026, 10, 1 + d)),
    );
  const rows = list.data?.data ?? [];
  if (!status.policy.wfhAllowed && rows.length === 0) return null;
  return (
    <section aria-label={t('work.wfh.title')} className={card}>
      <div className="border-b border-border px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Home aria-hidden="true" className="size-4" />
          {t('work.wfh.title')}
        </h2>
        <p className="text-sm text-text-muted">
          {status.policy.wfhMaxDaysPerMonth
            ? t('work.wfh.helpLimit', { count: status.policy.wfhMaxDaysPerMonth })
            : t('work.wfh.help')}
        </p>
      </div>
      {needing.length > 0 && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save.run();
          }}
          className="grid gap-4 border-b border-border p-5 sm:grid-cols-3"
        >
          <div className="sm:col-span-3">
            <FormMessages action={save} />
          </div>
          <SelectField
            label={t('work.wfh.location')}
            value={form.workLocationId}
            error={save.errors.workLocationId}
            onChange={(e) => setForm({ ...form, workLocationId: e.target.value })}
          >
            {needing.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </SelectField>
          <Field
            label={t('work.wfh.from')}
            type="date"
            min={status.workDate}
            value={form.fromDate}
            error={save.errors.fromDate}
            onChange={(e) =>
              setForm({
                ...form,
                fromDate: e.target.value,
                toDate: e.target.value > form.toDate ? e.target.value : form.toDate,
              })
            }
          />
          <Field
            label={t('work.wfh.to')}
            type="date"
            min={form.fromDate}
            value={form.toDate}
            error={save.errors.toDate}
            onChange={(e) => setForm({ ...form, toDate: e.target.value })}
          />
          <fieldset className="flex flex-col gap-2 sm:col-span-3">
            <legend className="text-sm font-medium">{t('work.wfh.weekdays')}</legend>
            <div className="flex flex-wrap gap-3">
              {WEEKDAYS.map((d) => (
                <label key={d} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={form.weekdays.includes(d)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        weekdays: e.target.checked
                          ? [...form.weekdays, d]
                          : form.weekdays.filter((x) => x !== d),
                      })
                    }
                  />
                  {dayName(d)}
                </label>
              ))}
            </div>
            <span className="text-xs text-text-muted">{t('work.wfh.weekdaysHint')}</span>
            {save.errors.weekdays && <span className="text-xs text-red-700">{save.errors.weekdays}</span>}
          </fieldset>
          <Field
            className="sm:col-span-3"
            label={t('work.wfh.reason')}
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
          />
          <div className="sm:col-span-3">
            <Button type="submit" disabled={save.pending || !form.workLocationId}>
              {t('work.wfh.submit')}
            </Button>
          </div>
        </form>
      )}
      {list.isSuccess && rows.length === 0 && (
        <p className="p-5 text-sm text-text-muted">{t('work.wfh.none')}</p>
      )}
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">
                {r.location.name} · {r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} – ${r.toDate}`}
              </span>
              <span className="text-text-muted">
                {t('work.wfh.days', { count: r.days })}
                {r.weekdays ? ` · ${r.weekdays.map(dayName).join(', ')}` : ''}
                {r.reason ? ` · ${r.reason}` : ''}
              </span>
              {r.decisionNote && (
                <span className="text-text-muted">
                  {t('attendance.decisionNote')}: {r.decisionNote}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={REQUEST_TONE[r.status]} withDot>
                {t(`attendance.request.${r.status}`)}
              </Badge>
              {['PENDING', 'APPROVED'].includes(r.status) && r.toDate >= status.workDate && !r.inUse && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(r.id)}
                >
                  {t('attendance.cancelRequest')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {cancel.isError && (
        <div className="px-5 pb-4">
          <Alert tone="error">{errorMessage(cancel.error, t)}</Alert>
        </div>
      )}
    </section>
  );
}

function MyCorrections({ tz }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['work', 'corrections', 'mine'],
    queryFn: () => workApi.corrections({ view: 'mine' }),
  });
  const cancel = useMutation({
    mutationFn: (id) => workApi.cancelCorrection(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['work'] }),
  });
  const rows = list.data?.data ?? [];
  if (list.isSuccess && rows.length === 0) return null;
  return (
    <section aria-label={t('work.correction.mine')} className={card}>
      <h2 className="border-b border-border px-5 py-4 text-base font-semibold">
        {t('work.correction.mine')}
      </h2>
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">
                {r.session?.workDate} · {t(`work.correctionKind.${r.kind}`)} ·{' '}
                {clock(r.fromTs, tz, i18n.language)} – {clock(r.toTs, tz, i18n.language)}
              </span>
              <span className="text-text-muted">{r.reason}</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={REQUEST_TONE[r.status]} withDot>
                {t(`attendance.request.${r.status}`)}
              </Badge>
              {r.status === 'PENDING' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(r.id)}
                >
                  {t('attendance.cancelRequest')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
