import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { clock } from '@/services/attendance';
import { hms, WORK_STATE_TONE, workApi } from '@/services/work';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { SelectField } from '@/components/ui/field';
import { errorMessage } from '@/utils/errors';

const STATES = ['WORKING', 'ON_BREAK', 'DISCONNECTED', 'FINISHED', 'NOT_STARTED'];

/** Who is working right now, for people in the viewer's scope. Status and totals only. */
export function TeamWorkPage() {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState('');
  const team = useQuery({
    queryKey: ['work', 'team', state],
    queryFn: () => workApi.team({ status: state }),
    refetchInterval: 30_000,
  });
  const rows = team.data?.data ?? [];
  const relative = (iso) => {
    if (!iso) return '—';
    const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
    return new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' }).format(-min, 'minute');
  };
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-3xl font-bold">{t('teamWork.title')}</h1>
        <p className="mt-1 text-sm text-text-muted">{t('teamWork.subtitle')}</p>
      </header>
      {team.data && (
        <ul aria-label={t('teamWork.counts')} className="flex flex-wrap gap-2">
          {STATES.map((k) => (
            <li key={k}>
              <Badge tone={WORK_STATE_TONE[k]} withDot>
                {t(`teamWork.state.${k}`)} <span className="tabular">{team.data.counts[k]}</span>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <section
        aria-label={t('teamWork.title')}
        className="rounded-[var(--radius-card)] border border-border bg-surface"
      >
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-5 py-4">
          <SelectField label={t('teamWork.filter')} value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">{t('teamWork.everyone')}</option>
            {STATES.map((k) => (
              <option key={k} value={k}>
                {t(`teamWork.state.${k}`)}
              </option>
            ))}
          </SelectField>
          {team.data && (
            <p className="text-xs text-text-muted" aria-live="polite">
              {t('teamWork.asOf', { time: clock(team.data.asOf, undefined, i18n.language) })}
            </p>
          )}
        </div>
        {team.isPending && (
          <p role="status" className="p-5 text-sm text-text-muted">
            {t('common.loading')}
          </p>
        )}
        {team.isError && (
          <div className="p-5">
            <Alert tone="error">{errorMessage(team.error, t)}</Alert>
          </div>
        )}
        {team.isSuccess && rows.length === 0 && (
          <p className="p-5 text-sm text-text-muted">{t('teamWork.none')}</p>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="bg-bg text-xs font-semibold text-text-muted">
                  {['person', 'state', 'since', 'location', 'worked', 'breaks', 'signal'].map((c) => (
                    <th key={c} scope="col" className="px-4 py-2.5 text-start">
                      {t(`teamWork.col.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.employee.id}
                    className="border-t border-slate-100"
                    data-testid={`team-${r.employee.code}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.employee.name}</div>
                      <div className="text-xs text-text-muted">
                        {r.employee.code}
                        {r.employee.department ? ` · ${r.employee.department}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={WORK_STATE_TONE[r.state]} withDot>
                        {t(`teamWork.state.${r.state}`)}
                      </Badge>
                    </td>
                    <td className="tabular px-4 py-3">
                      {r.session ? clock(r.session.startedAt, undefined, i18n.language) : '—'}
                    </td>
                    <td className="px-4 py-3">{r.session?.location.name ?? '—'}</td>
                    <td className="tabular px-4 py-3">{hms(r.today.workedSec)}</td>
                    <td className="tabular px-4 py-3">{hms(r.today.breakSec)}</td>
                    <td className="px-4 py-3 text-text-muted">
                      {r.session ? relative(r.session.lastHeartbeatAt) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-xs text-text-muted">{t('teamWork.privacy')}</p>
    </div>
  );
}
