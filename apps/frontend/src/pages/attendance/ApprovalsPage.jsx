import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import { attendanceApi, clock, hm } from '@/services/attendance';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/utils/errors';

/** Corrections and overtime waiting for the viewer: their direct reports, plus anyone in their approval scope. */
export function ApprovalsPage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold">{t('approvals.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('approvals.subtitle')}</p>
      </header>
      <Corrections />
      <Overtime />
    </div>
  );
}

/** Approve / reject with an optional note (required when rejecting). */
function DecisionControls({ onDecide, pending, label }) {
  const { t } = useTranslation();
  const [comment, setComment] = useState('');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        aria-label={t('approvals.comment', { what: label })}
        placeholder={t('approvals.commentPlaceholder')}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        className="h-9 w-56 max-w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-sm"
      />
      <Button
        size="sm"
        disabled={pending}
        onClick={() => onDecide({ decision: 'APPROVED', ...(comment ? { comment } : {}) })}
        aria-label={t('approvals.approveWhat', { what: label })}
      >
        <Check aria-hidden="true" className="size-4" />
        {t('approvals.approve')}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        disabled={pending || !comment.trim()}
        title={comment.trim() ? undefined : t('approvals.rejectNeedsNote')}
        onClick={() => onDecide({ decision: 'REJECTED', comment })}
        aria-label={t('approvals.rejectWhat', { what: label })}
      >
        <X aria-hidden="true" className="size-4" />
        {t('approvals.reject')}
      </Button>
    </div>
  );
}

function Corrections() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const list = useQuery({
    queryKey: ['attendance', 'corrections', 'approvals'],
    queryFn: () => attendanceApi.corrections({ view: 'approvals', status: 'PENDING' }),
  });
  const decide = useMutation({
    mutationFn: ({ id, body }) => attendanceApi.decideCorrection(id, body),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (e) => setError(errorMessage(e, t)),
  });
  const rows = list.data?.data ?? [];
  return (
    <section
      aria-label={t('approvals.corrections')}
      className="rounded-[var(--radius-card)] border border-border bg-surface"
    >
      <h2 className="border-b border-border px-5 py-4 text-base font-semibold">
        {t('approvals.corrections')} <span className="tabular text-text-muted">{rows.length}</span>
      </h2>
      {error && (
        <div className="px-5 pt-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      {list.isError && (
        <div className="p-5">
          <Alert tone="error">{errorMessage(list.error, t)}</Alert>
        </div>
      )}
      {list.isSuccess && rows.length === 0 && (
        <p className="p-5 text-sm text-text-muted">{t('approvals.none')}</p>
      )}
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => {
          const tz = r.employee.timezone;
          const label = `${r.employee.name} ${r.workDate}`;
          return (
            <li key={r.id} className="flex flex-col gap-3 px-5 py-4 text-sm">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">
                  {r.employee.name} · {r.workDate}
                </span>
                <span>
                  {t('approvals.recorded')}:{' '}
                  {r.day?.firstInAt || r.day?.lastOutAt
                    ? `${clock(r.day?.firstInAt, tz, i18n.language)} – ${clock(r.day?.lastOutAt, tz, i18n.language)}`
                    : t('approvals.nothingRecorded')}{' '}
                  · {t('approvals.requested')}:{' '}
                  <strong>
                    {clock(r.requestedIn, tz, i18n.language)} – {clock(r.requestedOut, tz, i18n.language)}
                  </strong>
                </span>
                <span className="text-text-muted">“{r.reason}”</span>
              </div>
              <DecisionControls
                label={label}
                pending={decide.isPending}
                onDecide={(body) => decide.mutate({ id: r.id, body })}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Overtime() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const list = useQuery({ queryKey: ['attendance', 'overtime'], queryFn: () => attendanceApi.overtime() });
  const decide = useMutation({
    mutationFn: ({ id, body }) => attendanceApi.decideOvertime(id, body),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['attendance'] });
    },
    onError: (e) => setError(errorMessage(e, t)),
  });
  const rows = list.data?.data ?? [];
  return (
    <section
      aria-label={t('approvals.overtime')}
      className="rounded-[var(--radius-card)] border border-border bg-surface"
    >
      <h2 className="border-b border-border px-5 py-4 text-base font-semibold">
        {t('approvals.overtime')} <span className="tabular text-text-muted">{rows.length}</span>
      </h2>
      {error && (
        <div className="px-5 pt-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      {list.isSuccess && rows.length === 0 && (
        <p className="p-5 text-sm text-text-muted">{t('approvals.none')}</p>
      )}
      <ul className="divide-y divide-slate-100">
        {rows.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm">
            <span>
              <span className="font-medium">{d.employee.name}</span> · {d.workDate} ·{' '}
              {t('approvals.overtimeLine', { overtime: hm(d.overtimeMinutes), worked: hm(d.workedMinutes) })}
            </span>
            <DecisionControls
              label={`${d.employee.name} ${d.workDate}`}
              pending={decide.isPending}
              onDecide={(body) => decide.mutate({ id: d.id, body })}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
