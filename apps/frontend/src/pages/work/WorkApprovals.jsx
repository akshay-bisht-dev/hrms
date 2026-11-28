import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { clock } from '@/services/attendance';
import { hms, workApi } from '@/services/work';
import { Alert } from '@/components/ui/alert';
import { errorMessage } from '@/utils/errors';

/** Pending work-from-home requests and work-session corrections for the viewer to decide. */
export function WorkApprovals({ DecisionControls }) {
  return (
    <>
      <WfhApprovals DecisionControls={DecisionControls} />
      <CorrectionApprovals DecisionControls={DecisionControls} />
    </>
  );
}

function useDecision(fn) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const m = useMutation({
    mutationFn: ({ id, body }) => fn(id, body),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ['work'] });
    },
    onError: (e) => setError(errorMessage(e, t)),
  });
  return { ...m, error };
}

function Section({ title, query, error, children }) {
  const { t } = useTranslation();
  const rows = query.data?.data ?? [];
  return (
    <section aria-label={title} className="rounded-[var(--radius-card)] border border-border bg-surface">
      <h2 className="border-b border-border px-5 py-4 text-base font-semibold">
        {title} <span className="tabular text-text-muted">{rows.length}</span>
      </h2>
      {error && (
        <div className="px-5 pt-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}
      {query.isError && (
        <div className="p-5">
          <Alert tone="error">{errorMessage(query.error, t)}</Alert>
        </div>
      )}
      {query.isSuccess && rows.length === 0 && (
        <p className="p-5 text-sm text-text-muted">{t('approvals.none')}</p>
      )}
      <ul className="divide-y divide-slate-100">{rows.map(children)}</ul>
    </section>
  );
}

function WfhApprovals({ DecisionControls }) {
  const { t } = useTranslation();
  const list = useQuery({
    queryKey: ['work', 'wfh', 'approvals'],
    queryFn: () => workApi.wfh({ view: 'approvals', status: 'PENDING' }),
  });
  const decide = useDecision(workApi.decideWfh);
  return (
    <Section title={t('approvals.wfh')} query={list} error={decide.error}>
      {(r) => {
        const when = r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} – ${r.toDate}`;
        return (
          <li key={r.id} className="flex flex-col gap-3 px-5 py-4 text-sm">
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">
                {r.employee.name} · {r.location.name} · {when}
              </span>
              <span className="text-text-muted">
                {t('work.wfh.days', { count: r.days })}
                {r.reason ? ` · ${r.reason}` : ''}
              </span>
            </div>
            <DecisionControls
              label={`${r.employee.name} ${when}`}
              pending={decide.isPending}
              onDecide={(body) => decide.mutate({ id: r.id, body })}
            />
          </li>
        );
      }}
    </Section>
  );
}

function CorrectionApprovals({ DecisionControls }) {
  const { t, i18n } = useTranslation();
  const list = useQuery({
    queryKey: ['work', 'corrections', 'approvals'],
    queryFn: () => workApi.corrections({ view: 'approvals', status: 'PENDING' }),
  });
  const decide = useDecision(workApi.decideCorrection);
  return (
    <Section title={t('approvals.workCorrections')} query={list} error={decide.error}>
      {(r) => {
        const tz = r.employee.timezone;
        const label = `${r.employee.name} ${r.session?.workDate ?? ''}`;
        return (
          <li key={r.id} className="flex flex-col gap-3 px-5 py-4 text-sm">
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">
                {r.employee.name} · {r.session?.workDate} · {t(`work.correctionKind.${r.kind}`)}
              </span>
              <span>
                {t('approvals.sessionWas', {
                  from: clock(r.session?.startedAt, tz, i18n.language),
                  to: clock(r.session?.endedAt, tz, i18n.language),
                })}{' '}
                · {t('approvals.requested')}:{' '}
                <strong>
                  {clock(r.fromTs, tz, i18n.language)} – {clock(r.toTs, tz, i18n.language)} (
                  {hms((Date.parse(r.toTs) - Date.parse(r.fromTs)) / 1000)})
                </strong>
              </span>
              <span className="text-text-muted">{r.reason}</span>
            </div>
            <DecisionControls
              label={label}
              pending={decide.isPending}
              onDecide={(body) => decide.mutate({ id: r.id, body })}
            />
          </li>
        );
      }}
    </Section>
  );
}
