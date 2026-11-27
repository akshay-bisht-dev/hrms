import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarPlus } from 'lucide-react';
import { days, LEAVE_TONE, leaveApi } from '@/services/leave';
import { uploadDocument } from '@/services/employees';
import { ApiError } from '@/services/api';
import { attendanceApi } from '@/services/attendance';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, SelectField } from '@/components/ui/field';
import { errorMessage } from '@/utils/errors';

/** Waits until the user stops typing before asking the API for a preview. */
function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function MyLeavePage() {
  const { t } = useTranslation();
  const status = useQuery({ queryKey: ['attendance', 'status'], queryFn: attendanceApi.status });
  const balances = useQuery({
    queryKey: ['leave', 'balances', 'me'],
    queryFn: leaveApi.myBalances,
    enabled: Boolean(status.data?.hasEmployeeRecord),
  });
  const [applying, setApplying] = useState(false);

  if (status.isPending) return <p role="status">{t('common.loading')}</p>;
  if (status.isError) return <Alert tone="error">{errorMessage(status.error, t)}</Alert>;
  if (!status.data.hasEmployeeRecord)
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold">{t('leave.title')}</h1>
        <Alert tone="info">{t('leave.noRecord')}</Alert>
      </div>
    );
  const rows = balances.data?.data ?? [];
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{t('leave.title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('leave.subtitle')}</p>
        </div>
        {rows.length > 0 && !applying && (
          <Button onClick={() => setApplying(true)}>
            <CalendarPlus aria-hidden="true" className="size-4" />
            {t('leave.apply')}
          </Button>
        )}
      </header>
      {balances.isError && <Alert tone="error">{errorMessage(balances.error, t)}</Alert>}
      {balances.isSuccess && rows.length === 0 && <Alert tone="info">{t('leave.noPolicies')}</Alert>}
      {rows.length > 0 && (
        <section aria-label={t('leave.balances')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((b) => (
            <div
              key={b.leaveType.id}
              data-testid={`balance-${b.leaveType.code}`}
              className="flex flex-col gap-1 rounded-[var(--radius-card)] border border-border bg-surface p-4"
            >
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-full"
                  style={{ background: b.leaveType.color ?? '#64748b' }}
                />
                {b.leaveType.name}
                {!b.leaveType.isPaid && <Badge>{t('leave.unpaid')}</Badge>}
              </div>
              {b.leaveType.isPaid ? (
                <>
                  <div className="tabular text-2xl font-bold">
                    {days(b.available)}{' '}
                    <span className="text-sm font-normal text-text-muted">{t('leave.daysAvailable')}</span>
                  </div>
                  <div className="text-xs text-text-muted">
                    {t('leave.balanceLine', {
                      balance: days(b.balance),
                      pending: days(b.pending),
                      used: days(b.usedThisYear),
                    })}
                  </div>
                </>
              ) : (
                <div className="text-sm text-text-muted">
                  {t('leave.unpaidLine', { used: days(b.usedThisYear) })}
                </div>
              )}
            </div>
          ))}
        </section>
      )}
      {applying && (
        <ApplyForm
          balances={rows}
          employeeId={status.data.employee.id}
          today={status.data.workDate}
          onClose={() => setApplying(false)}
        />
      )}
      <MyRequests />
    </div>
  );
}

function ApplyForm({ balances, employeeId, today, onClose }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    leaveTypeId: balances[0].leaveType.id,
    fromDate: today,
    toDate: today,
    fromHalfDay: false,
    toHalfDay: false,
    reason: '',
  });
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const chosen = balances.find((b) => b.leaveType.id === form.leaveTypeId);
  const body = {
    leaveTypeId: form.leaveTypeId,
    fromDate: form.fromDate,
    toDate: form.toDate,
    fromHalfDay: form.fromHalfDay,
    toHalfDay: form.fromDate === form.toDate ? false : form.toHalfDay,
  };
  const debounced = useDebounced(body);
  const preview = useQuery({
    queryKey: ['leave', 'preview', debounced],
    queryFn: () => leaveApi.preview(debounced),
    enabled: Boolean(debounced.fromDate && debounced.toDate && debounced.toDate >= debounced.fromDate),
    retry: false,
  });
  const needsDocument =
    chosen?.leaveType.requiresDocumentAfterDays &&
    preview.data &&
    Number(preview.data.quantity) > chosen.leaveType.requiresDocumentAfterDays;
  const submit = useMutation({
    mutationFn: async () => {
      let documentId;
      if (file) documentId = (await uploadDocument(employeeId, file, 'MEDICAL')).id;
      return leaveApi.apply({
        ...body,
        ...(form.reason ? { reason: form.reason } : {}),
        ...(documentId ? { documentId } : {}),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leave'] });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.errors.length) setErrors(e.fieldErrors());
      else setError(errorMessage(e, t));
    },
  });
  const set = (k) => (e) =>
    setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const problems = preview.data?.errors ?? [];
  return (
    <section
      aria-label={t('leave.form.title')}
      className="rounded-[var(--radius-card)] border border-primary/40 bg-surface"
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setErrors({});
          setError(null);
          submit.mutate();
        }}
        className="grid gap-4 p-5 sm:grid-cols-2"
      >
        <h2 className="text-base font-semibold sm:col-span-2">{t('leave.form.title')}</h2>
        {error && (
          <div className="sm:col-span-2">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
        <SelectField
          label={t('leave.form.type')}
          value={form.leaveTypeId}
          error={errors.leaveTypeId}
          onChange={set('leaveTypeId')}
        >
          {balances.map((b) => (
            <option key={b.leaveType.id} value={b.leaveType.id}>
              {b.leaveType.name}
            </option>
          ))}
        </SelectField>
        <div />
        <div className="flex flex-col gap-2">
          <Field
            label={t('leave.form.from')}
            type="date"
            value={form.fromDate}
            error={errors.fromDate}
            onChange={set('fromDate')}
          />
          {chosen?.policy.allowHalfDay && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={form.fromHalfDay}
                onChange={set('fromHalfDay')}
              />
              {form.fromDate === form.toDate ? t('leave.form.halfDayOnly') : t('leave.form.fromHalf')}
            </label>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Field
            label={t('leave.form.to')}
            type="date"
            min={form.fromDate}
            value={form.toDate}
            error={errors.toDate}
            onChange={set('toDate')}
          />
          {chosen?.policy.allowHalfDay && form.fromDate !== form.toDate && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={form.toHalfDay}
                onChange={set('toHalfDay')}
              />
              {t('leave.form.toHalf')}
            </label>
          )}
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="leave-reason" className="text-sm font-medium">
            {t('leave.form.reason')}
          </label>
          <textarea
            id="leave-reason"
            rows={2}
            value={form.reason}
            onChange={set('reason')}
            className="rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 py-2 text-sm"
          />
        </div>
        {(needsDocument || file) && (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="leave-doc" className="text-sm font-medium">
              {t('leave.form.document', { days: chosen.leaveType.requiresDocumentAfterDays })}
            </label>
            <input
              id="leave-doc"
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
            {errors.documentId && <span className="text-xs text-red-700">{errors.documentId}</span>}
          </div>
        )}
        <div aria-live="polite" className="sm:col-span-2">
          {preview.data && (
            <div className="flex flex-col gap-2 rounded-[var(--radius-control)] bg-bg px-4 py-3 text-sm">
              <span>
                {t('leave.form.preview', {
                  quantity: days(preview.data.quantity),
                  available: days(preview.data.available),
                })}
                {preview.data.approvalLevels === 2 ? ` ${t('leave.form.twoLevels')}` : ''}
              </span>
              {problems
                .filter((p) => !(p.path === 'body.documentId' && file))
                .map((p) => (
                  <span key={p.path + p.message} className="text-red-700">
                    {p.message}
                  </span>
                ))}
            </div>
          )}
          {preview.isError && <Alert tone="error">{errorMessage(preview.error, t)}</Alert>}
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" disabled={submit.isPending}>
            {t('leave.form.submit')}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </section>
  );
}

function MyRequests() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const list = useQuery({
    queryKey: ['leave', 'requests', 'mine'],
    queryFn: () => leaveApi.requests({ view: 'mine' }),
  });
  const cancel = useMutation({
    mutationFn: (id) => leaveApi.cancel(id),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['leave'] });
    },
    onError: (e) => setError(errorMessage(e, t)),
  });
  const fmt = (d) =>
    new Intl.DateTimeFormat(i18n.language, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${d}T00:00:00Z`));
  const today = new Date().toISOString().slice(0, 10);
  const rows = list.data?.data ?? [];
  return (
    <section
      aria-label={t('leave.myRequests')}
      className="rounded-[var(--radius-card)] border border-border bg-surface"
    >
      <h2 className="border-b border-border px-5 py-4 text-base font-semibold">{t('leave.myRequests')}</h2>
      {error && (
        <div className="px-5 pt-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      {list.isSuccess && rows.length === 0 && (
        <p className="p-5 text-sm text-text-muted">{t('leave.noRequests')}</p>
      )}
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => {
          const decided = r.steps.filter((s) => s.comment);
          return (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">
                  {r.leaveType.name} · {fmt(r.fromDate)}
                  {r.toDate !== r.fromDate ? ` – ${fmt(r.toDate)}` : ''} ·{' '}
                  {t('leave.daysCount', { count: Number(r.quantity), n: days(r.quantity) })}
                </span>
                {r.reason && <span className="text-text-muted">{r.reason}</span>}
                {r.status === 'PENDING' && r.steps.length > 1 && (
                  <span className="text-text-muted">
                    {t('leave.stepOf', { step: r.currentStep, total: r.steps.length })}
                  </span>
                )}
                {decided.map((s) => (
                  <span key={s.stepNo} className="text-text-muted">
                    {t('attendance.decisionNote')}: {s.comment}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={LEAVE_TONE[r.status]} withDot>
                  {t(`leave.status.${r.status}`)}
                </Badge>
                {(r.status === 'PENDING' || (r.status === 'APPROVED' && r.fromDate > today)) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate(r.id)}
                  >
                    {t('leave.cancel')}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
