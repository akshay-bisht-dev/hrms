import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Clock, LogIn, LogOut, Wrench } from 'lucide-react';
import {
  attendanceApi,
  clock,
  DAY_TONE,
  hm,
  minutesToHm,
  monthRange,
  REQUEST_TONE,
} from '@/services/attendance';
import { ApiError } from '@/services/api';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, SelectField } from '@/components/ui/field';
import { errorMessage } from '@/utils/errors';

/** Asks the browser for a position only when the company turned location capture on. Never blocks clocking in. */
function currentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(undefined);
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracyM: Math.round(p.coords.accuracy),
        }),
      () => resolve(undefined),
      { timeout: 8000, maximumAge: 60_000 },
    );
  });
}

export function MyAttendancePage() {
  const { t } = useTranslation();
  const status = useQuery({
    queryKey: ['attendance', 'status'],
    queryFn: attendanceApi.status,
    refetchInterval: 60_000,
  });
  if (status.isPending) return <p role="status">{t('common.loading')}</p>;
  if (status.isError) return <Alert tone="error">{errorMessage(status.error, t)}</Alert>;
  if (!status.data.hasEmployeeRecord)
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold">{t('attendance.title')}</h1>
        <Alert tone="info">{t('attendance.noRecord')}</Alert>
      </div>
    );
  return <MyAttendance status={status.data} />;
}

function MyAttendance({ status }) {
  const { t } = useTranslation();
  const tz = status.employee.timezone;
  const [month, setMonth] = useState(status.workDate.slice(0, 7));
  const [correctionFor, setCorrectionFor] = useState(null);
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold">{t('attendance.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('attendance.subtitle', { tz })}</p>
      </header>
      <ClockCard status={status} />
      <MonthTable
        tz={tz}
        month={month}
        setMonth={setMonth}
        today={status.workDate}
        onFix={(ymd) => setCorrectionFor(ymd)}
      />
      {correctionFor !== null && (
        <CorrectionForm
          workDate={correctionFor}
          today={status.workDate}
          onClose={() => setCorrectionFor(null)}
        />
      )}
      <MyRequests tz={tz} onNew={() => setCorrectionFor(status.workDate)} />
    </div>
  );
}

function ClockCard({ status }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const tz = status.employee.timezone;
  const [locationId, setLocationId] = useState(status.locations[0]?.id ?? '');
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!status.clockedIn) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [status.clockedIn]);
  const punch = useMutation({
    mutationFn: async (type) =>
      attendanceApi.punch({
        type,
        clientTs: new Date().toISOString(),
        ...(type === 'IN' && locationId ? { workLocationId: locationId } : {}),
        ...(status.capture.geo ? { geo: await currentPosition() } : {}),
      }),
    onSuccess: (next) => {
      setError(null);
      qc.setQueryData(['attendance', 'status'], next);
      qc.invalidateQueries({ queryKey: ['attendance', 'days'] });
    },
    onError: (e) => setError(errorMessage(e, t)),
  });
  const plan = status.plan;
  const planText =
    plan.kind === 'HOLIDAY'
      ? t('attendance.plan.holiday', { name: plan.holidayName })
      : plan.kind === 'WEEKEND'
        ? t('attendance.plan.weekend')
        : plan.startMin !== null && plan.startMin !== undefined
          ? t('attendance.plan.fixed', { start: minutesToHm(plan.startMin), end: minutesToHm(plan.endMin) })
          : plan.expectedMinutes
            ? t('attendance.plan.flexible', { hours: hm(plan.expectedMinutes) })
            : t('attendance.plan.none');
  const openMinutes = status.openSince
    ? Math.max(0, Math.floor((now - Date.parse(status.openSince)) / 60_000))
    : 0;
  const workedToday = (status.today?.workedMinutes ?? 0) + openMinutes;
  const captured = [t('attendance.capture.time')];
  if (status.capture.ip) captured.push(t('attendance.capture.ip'));
  if (status.capture.geo) captured.push(t('attendance.capture.geo'));

  return (
    <section
      aria-label={t('attendance.clock.title')}
      className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Clock aria-hidden="true" className="size-4" />
            {status.clockedIn
              ? t('attendance.clock.inSince', { time: clock(status.openSince, tz, i18n.language) })
              : t('attendance.clock.out')}
          </h2>
          <p className="text-sm text-text-muted">{planText}</p>
          <p className="text-sm" aria-live="polite">
            {t('attendance.clock.workedToday')}:{' '}
            <span className="tabular font-semibold">{hm(workedToday)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {!status.clockedIn && status.locations.length > 0 && (
            <SelectField
              label={t('attendance.clock.location')}
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">{t('attendance.clock.noLocation')}</option>
              {status.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </SelectField>
          )}
          <Button
            size="lg"
            variant={status.clockedIn ? 'secondary' : 'primary'}
            disabled={punch.isPending}
            onClick={() => punch.mutate(status.clockedIn ? 'OUT' : 'IN')}
          >
            {status.clockedIn ? (
              <LogOut aria-hidden="true" className="size-4" />
            ) : (
              <LogIn aria-hidden="true" className="size-4" />
            )}
            {status.clockedIn ? t('attendance.clock.clockOut') : t('attendance.clock.clockIn')}
          </Button>
        </div>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <p className="text-xs text-text-muted">
        {t('attendance.capture.notice', {
          items: new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(captured),
        })}
      </p>
    </section>
  );
}

function MonthTable({ tz, month, setMonth, today, onFix }) {
  const { t, i18n } = useTranslation();
  const { from, to } = monthRange(`${month}-01`);
  const days = useQuery({
    queryKey: ['attendance', 'days', 'me', month],
    queryFn: () => attendanceApi.myDays(from, to),
  });
  const shift = (n) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };
  const monthLabel = new Intl.DateTimeFormat(i18n.language, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T00:00:00Z`));
  const fmtDay = (ymd) =>
    new Intl.DateTimeFormat(i18n.language, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(`${ymd}T00:00:00Z`));
  const rows = [...(days.data?.data ?? [])].reverse();
  return (
    <section
      aria-label={t('attendance.history')}
      className="rounded-[var(--radius-card)] border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">{t('attendance.history')}</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => shift(-1)} aria-label={t('attendance.prevMonth')}>
            <ChevronLeft aria-hidden="true" className="size-4" />
          </Button>
          <span className="min-w-36 text-center text-sm font-medium" aria-live="polite">
            {monthLabel}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => shift(1)}
            disabled={month >= today.slice(0, 7)}
            aria-label={t('attendance.nextMonth')}
          >
            <ChevronRight aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </div>
      {days.isPending && (
        <p role="status" className="p-5 text-sm text-text-muted">
          {t('common.loading')}
        </p>
      )}
      {days.isError && (
        <div className="p-5">
          <Alert tone="error">{errorMessage(days.error, t)}</Alert>
        </div>
      )}
      {days.isSuccess && rows.length === 0 && (
        <p className="p-5 text-sm text-text-muted">{t('attendance.noDays')}</p>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="bg-bg text-xs font-semibold text-text-muted">
                {['date', 'status', 'in', 'out', 'worked', 'late', 'overtime', ''].map((c) => (
                  <th key={c || 'actions'} scope="col" className="px-4 py-2.5 text-start">
                    {c ? (
                      t(`attendance.col.${c}`)
                    ) : (
                      <span className="sr-only">{t('attendance.col.actions')}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.workDate} className="border-t border-slate-100" data-testid={`day-${d.workDate}`}>
                  <td className="whitespace-nowrap px-4 py-3">{fmtDay(d.workDate)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={DAY_TONE[d.status]} withDot>
                        {t(`attendance.status.${d.status}`)}
                      </Badge>
                      {d.flags
                        .filter((f) => ['MISSING_OUT', 'CORRECTED'].includes(f))
                        .map((f) => (
                          <Badge key={f} tone={f === 'MISSING_OUT' ? 'warning' : 'info'}>
                            {t(`attendance.flag.${f}`)}
                          </Badge>
                        ))}
                    </div>
                  </td>
                  <td className="tabular px-4 py-3">{clock(d.firstInAt, tz, i18n.language)}</td>
                  <td className="tabular px-4 py-3">{clock(d.lastOutAt, tz, i18n.language)}</td>
                  <td className="tabular px-4 py-3">
                    {hm(d.workedMinutes)}
                    {d.expectedMinutes ? (
                      <span className="text-text-muted"> / {hm(d.expectedMinutes)}</span>
                    ) : null}
                  </td>
                  <td className="tabular px-4 py-3">
                    {d.lateMinutes ? t('attendance.lateBy', { time: hm(d.lateMinutes) }) : '—'}
                  </td>
                  <td className="tabular px-4 py-3">
                    {d.overtimeMinutes ? (
                      <span className="flex flex-wrap items-center gap-1">
                        {hm(d.overtimeMinutes)}
                        {d.overtimeStatus !== 'NONE' && (
                          <Badge tone={REQUEST_TONE[d.overtimeStatus]}>
                            {t(`attendance.request.${d.overtimeStatus}`)}
                          </Badge>
                        )}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {!d.isLocked && !d.requests.some((r) => r.status === 'PENDING') && (
                      <Button variant="ghost" size="sm" onClick={() => onFix(d.workDate)}>
                        <Wrench aria-hidden="true" className="size-4" />
                        {t('attendance.fix')}
                      </Button>
                    )}
                    {d.requests.some((r) => r.status === 'PENDING') && (
                      <Badge tone="warning">{t('attendance.correctionPending')}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function CorrectionForm({ workDate, today, onClose }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState({ workDate, inTime: '', outTime: '', outNextDay: false, reason: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  useEffect(() => setForm((f) => ({ ...f, workDate })), [workDate]);
  const save = useMutation({
    mutationFn: () =>
      attendanceApi.requestCorrection({
        workDate: form.workDate,
        ...(form.inTime ? { inTime: form.inTime } : {}),
        ...(form.outTime ? { outTime: form.outTime } : {}),
        outNextDay: form.outNextDay,
        reason: form.reason,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance'] });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors.length) setErrors(e.fieldErrors());
      else setError(errorMessage(e, t));
    },
  });
  return (
    <section
      aria-label={t('attendance.correction.title')}
      className="rounded-[var(--radius-card)] border border-primary/40 bg-surface"
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setErrors({});
          setError(null);
          save.mutate();
        }}
        className="grid gap-4 p-5 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <h2 className="text-base font-semibold">{t('attendance.correction.title')}</h2>
          <p className="text-sm text-text-muted">{t('attendance.correction.help')}</p>
        </div>
        {error && (
          <div className="sm:col-span-2">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
        <Field
          label={t('attendance.correction.date')}
          type="date"
          max={today}
          value={form.workDate}
          error={errors.workDate}
          onChange={(e) => setForm({ ...form, workDate: e.target.value })}
        />
        <div />
        <Field
          label={t('attendance.correction.in')}
          type="time"
          value={form.inTime}
          error={errors.inTime}
          onChange={(e) => setForm({ ...form, inTime: e.target.value })}
        />
        <div className="flex flex-col gap-2">
          <Field
            label={t('attendance.correction.out')}
            type="time"
            value={form.outTime}
            error={errors.outTime}
            onChange={(e) => setForm({ ...form, outTime: e.target.value })}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={form.outNextDay}
              onChange={(e) => setForm({ ...form, outNextDay: e.target.checked })}
            />
            {t('attendance.correction.nextDay')}
          </label>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="correction-reason" className="text-sm font-medium">
            {t('attendance.correction.reason')}
          </label>
          <textarea
            id="correction-reason"
            rows={3}
            value={form.reason}
            aria-invalid={errors.reason ? true : undefined}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            className="rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 py-2 text-sm"
          />
          {errors.reason && <span className="text-xs text-red-700">{errors.reason}</span>}
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={save.isPending}>
            {t('attendance.correction.submit')}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </section>
  );
}

function MyRequests({ tz, onNew }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['attendance', 'corrections', 'mine'],
    queryFn: () => attendanceApi.corrections({ view: 'mine' }),
  });
  const cancel = useMutation({
    mutationFn: (id) => attendanceApi.cancelCorrection(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance'] }),
  });
  const rows = list.data?.data ?? [];
  return (
    <section
      aria-label={t('attendance.myRequests')}
      className="rounded-[var(--radius-card)] border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">{t('attendance.myRequests')}</h2>
        <Button size="sm" variant="secondary" onClick={onNew}>
          {t('attendance.newCorrection')}
        </Button>
      </div>
      {list.isError && (
        <div className="p-5">
          <Alert tone="error">{errorMessage(list.error, t)}</Alert>
        </div>
      )}
      {list.isSuccess && rows.length === 0 && (
        <p className="p-5 text-sm text-text-muted">{t('attendance.noRequests')}</p>
      )}
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">
                {r.workDate} · {clock(r.requestedIn, tz, i18n.language)} –{' '}
                {clock(r.requestedOut, tz, i18n.language)}
              </span>
              <span className="text-text-muted">{r.reason}</span>
              {r.decisionComment && (
                <span className="text-text-muted">
                  {t('attendance.decisionNote')}: {r.decisionComment}
                </span>
              )}
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
