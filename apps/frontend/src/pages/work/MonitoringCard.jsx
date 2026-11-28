import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Camera, Laptop } from 'lucide-react';
import { DEVICE_TONE, monitoringApi } from '@/services/monitoring';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/utils/errors';

const card = 'rounded-[var(--radius-card)] border border-border bg-surface';

/** Screen monitoring as it applies to you right now, the notice to read, and your connected computers. */
export function MonitoringCard() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['monitoring', 'me'], queryFn: monitoringApi.me });
  const devices = useQuery({ queryKey: ['devices', 'me'], queryFn: monitoringApi.myDevices });
  const [code, setCode] = useState(null);
  const ack = useMutation({
    mutationFn: () => monitoringApi.acknowledge(status.data.activation.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['monitoring'] }),
  });
  const pair = useMutation({ mutationFn: monitoringApi.pairingCode, onSuccess: setCode });
  const revoke = useMutation({
    mutationFn: (id) => monitoringApi.revokeMine(id, 'Disconnected by me'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices'] }),
  });
  if (status.isPending) return null;
  const s = status.data;
  const on = s?.enabled;
  const when = (iso) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  return (
    <section aria-label={t('monitoring.card.title')} className={`${card} flex flex-col gap-4 p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Camera aria-hidden="true" className="size-4" />
          {t('monitoring.card.title')}
        </h2>
        <Badge tone={on ? 'warning' : 'success'} withDot>
          {on ? t('monitoring.card.on') : t('monitoring.card.off')}
        </Badge>
      </div>
      <p className="text-sm" data-testid="monitoring-reason">
        {on
          ? t('monitoring.card.onText', { interval: s.policy.intervalMin, days: s.policy.retentionDays })
          : t(`monitoring.reason.${s.reason}`, { date: s.startsOn ?? '', country: s.country ?? '' })}
      </p>
      {on && s.legalReviewed === false && (
        <p className="text-xs text-text-muted">{t('monitoring.card.companyResponsible')}</p>
      )}
      {s.reason === 'ACK_REQUIRED' && s.notice && (
        <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-amber-200 bg-warning-soft p-4 text-sm">
          <h3 className="font-semibold">{t('monitoring.card.noticeTitle')}</h3>
          <p className="whitespace-pre-wrap">{s.notice.text}</p>
          <p>
            <strong>{t('monitoring.card.purpose')}:</strong> {s.notice.purpose}
          </p>
          <p className="text-text-muted">
            {t('monitoring.card.contacts', {
              name: s.notice.contacts?.privacyContactName,
              email: s.notice.contacts?.privacyContactEmail,
              grievance: s.notice.contacts?.grievanceEmail,
            })}
          </p>
          {ack.isError && <Alert tone="error">{errorMessage(ack.error, t)}</Alert>}
          <div>
            <Button disabled={ack.isPending} onClick={() => ack.mutate()}>
              {t('monitoring.card.acknowledge')}
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Laptop aria-hidden="true" className="size-4" />
          {t('monitoring.devices.title')}
        </h3>
        {(devices.data?.data ?? []).length === 0 && (
          <p className="text-sm text-text-muted">{t('monitoring.devices.none')}</p>
        )}
        <ul className="flex flex-col gap-2 text-sm">
          {(devices.data?.data ?? []).map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {t(`monitoring.os.${d.os}`)} · {t(`monitoring.ownership.${d.ownership}`)}
                {d.lastSeenAt ? ` · ${t('monitoring.devices.lastSeen', { time: when(d.lastSeenAt) })}` : ''}
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={DEVICE_TONE[d.status]}>{t(`monitoring.deviceStatus.${d.status}`)}</Badge>
                {d.status !== 'REVOKED' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(d.id)}
                  >
                    {t('monitoring.devices.disconnect')}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {code ? (
          <div role="status" className="rounded-[var(--radius-control)] bg-bg p-3 text-sm">
            {t('monitoring.devices.codeHelp')}{' '}
            <strong className="tabular font-mono text-lg tracking-widest" data-testid="pairing-code">
              {code.code}
            </strong>
            <div className="text-xs text-text-muted">
              {t('monitoring.devices.codeExpires', { time: when(code.expiresAt) })}
            </div>
          </div>
        ) : (
          <div>
            <Button size="sm" variant="secondary" disabled={pair.isPending} onClick={() => pair.mutate()}>
              {t('monitoring.devices.connect')}
            </Button>
          </div>
        )}
        {pair.isError && <Alert tone="error">{errorMessage(pair.error, t)}</Alert>}
      </div>
      <Link to="/work/screenshots" className="text-sm text-primary underline">
        {t('monitoring.card.myScreenshots')}
      </Link>
    </section>
  );
}
