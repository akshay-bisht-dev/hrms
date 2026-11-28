import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/services/api';
import { workApi } from '@/services/work';

export const WORK_STATUS_KEY = ['work', 'status'];

/** The signed-in person's work status (read only; the shell sends the heartbeat). */
export const useWorkStatus = () =>
  useQuery({ queryKey: WORK_STATUS_KEY, queryFn: workApi.status, refetchInterval: 120_000 });

/**
 * The signed-in person's work status, plus the heartbeat while a session runs. Mounted once in the app shell, so
 * moving between pages does not look like a disconnection. Nothing is sent when no session is running, and the
 * heartbeat says only "the app is open": no activity, input, screen or page content.
 */
export function useWorkSession() {
  const qc = useQueryClient();
  const status = useWorkStatus();
  const activeId = status.data?.active?.id ?? null;
  const intervalSec = status.data?.heartbeatIntervalSec ?? 60;
  useEffect(() => {
    if (!activeId) return undefined;
    let stopped = false;
    const beat = async () => {
      try {
        const res = await workApi.heartbeat();
        if (!stopped && (res.reconnected || res.sessionId !== activeId))
          qc.invalidateQueries({ queryKey: ['work'] });
      } catch (e) {
        // The session was closed elsewhere (another tab, or automatically): show the real state.
        if (!stopped && e instanceof ApiError && e.code === 'no_active_session')
          qc.invalidateQueries({ queryKey: ['work'] });
      }
    };
    beat();
    const timer = setInterval(beat, intervalSec * 1000);
    // Background tabs throttle timers; send one as soon as the tab is visible again.
    const onVisible = () => document.visibilityState === 'visible' && beat();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [activeId, intervalSec, qc]);
  return status;
}

/** Offset of a time zone from UTC at an instant, in minutes. */
function offsetMinutes(date, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((wall - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

/** ISO instant for a local date and HH:MM in a time zone. */
export function zonedIso(ymd, hhmm, timeZone) {
  const guess = Date.parse(`${ymd}T${hhmm}:00Z`);
  let t = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  t = guess - offsetMinutes(new Date(t), timeZone) * 60_000; // settle across a DST change
  return new Date(t).toISOString();
}
