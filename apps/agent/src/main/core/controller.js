// @ts-check
/**
 * The agent's brain, with every effect injected so it can be tested without Electron.
 *
 * It keeps the server's view fresh (GET /agent/me), sends a heartbeat while a session runs, reports idle (system
 * idle time only: no keyboard or mouse hooks), and, only when the server says capture is allowed on this
 * computer, takes screenshots on a jittered timer after checking every precondition again. The tray reflects the
 * state at all times; capture stops immediately on a break, on lock, when idle, when the session ends, or when
 * the server stops saying yes.
 */
import { createHash } from 'node:crypto';
import { RevokedError } from './api.js';
import { capturePreconditions, nextDelayMs, readPolicy } from './policy.js';

const HEARTBEAT_MS = 60_000;
const REFRESH_MS = 60_000;
const IDLE_POLL_MS = 15_000;

/**
 * @param {{
 *   api: { request: Function, upload: Function },
 *   capture: (opts: { captureMode: string, blurZones: any[] }) => Promise<Buffer>,
 *   foregroundApp: () => Promise<string | null>,
 *   idleSeconds: () => number,
 *   isLocked: () => boolean,
 *   onChange: (state: any) => void,
 *   timers?: { setTimeout: typeof setTimeout, clearTimeout: typeof clearTimeout, setInterval: typeof setInterval, clearInterval: typeof clearInterval },
 *   now?: () => Date,
 *   random?: () => number,
 *   firstCaptureMs?: number | null,
 *   log?: (msg: string, extra?: object) => void,
 * }} deps
 */
export function createController(deps) {
  const timers = deps.timers ?? { setTimeout, clearTimeout, setInterval, clearInterval };
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  /** @type {any} */
  const state = {
    paired: true,
    online: true,
    me: null,
    decision: { capture: false, reason: 'LOADING' },
    idle: false,
    lastCaptureAt: null,
    nextCaptureAt: null,
    lastSkip: null,
    error: null,
  };
  /** @type {any} */
  let captureTimer = null;
  /** @type {any[]} */
  const intervals = [];
  let stopped = false;

  const emit = () => deps.onChange({ ...state, monitoringOn: monitoringOn() });
  const session = () => state.me?.work?.active ?? null;
  /** Capture is "on" only when the server allows it on this computer and a session is actively running. */
  const monitoringOn = () =>
    Boolean(state.paired && state.decision.capture && session()?.status === 'ACTIVE');

  async function guarded(/** @type {() => Promise<any>} */ fn) {
    try {
      const out = await fn();
      if (!state.online) {
        state.online = true;
        emit();
      }
      return out;
    } catch (err) {
      if (err instanceof RevokedError) {
        // Forget everything the server said: nothing may run on a disconnected computer.
        state.paired = false;
        state.me = null;
        state.decision = { capture: false, reason: 'NOT_PAIRED' };
        stop();
        emit();
        throw err;
      }
      if (/** @type {any} */ (err)?.status === undefined) {
        state.online = false; // network error
        emit();
      }
      throw err;
    }
  }

  async function refreshMe() {
    state.me = await guarded(() => deps.api.request('GET', '/agent/me'));
    const before = state.decision.capture;
    state.decision = readPolicy(state.me.monitoring);
    state.error = null;
    if (before !== state.decision.capture)
      log(`capture ${state.decision.capture ? 'allowed' : 'not allowed'}`);
    reschedule();
    emit();
    return state.me;
  }

  function reschedule() {
    if (stopped) return;
    if (!monitoringOn()) {
      if (captureTimer) timers.clearTimeout(captureTimer);
      captureTimer = null;
      state.nextCaptureAt = null;
      return;
    }
    if (captureTimer) return;
    const p = /** @type {any} */ (state.decision).policy;
    const delay =
      state.lastCaptureAt || deps.firstCaptureMs === null || deps.firstCaptureMs === undefined
        ? nextDelayMs(p.intervalMin, p.jitterPct, deps.random)
        : deps.firstCaptureMs;
    state.nextCaptureAt = new Date(now().getTime() + delay);
    captureTimer = timers.setTimeout(() => {
      captureTimer = null;
      tick().catch((e) => log('capture failed', { error: String(e?.message ?? e) }));
    }, delay);
  }

  /** One scheduled capture attempt. */
  async function tick() {
    try {
      await refreshMe(); // the server's answer right now, not the one from a minute ago
    } catch {
      /* offline or revoked: preconditions below fail */
    }
    const s = session();
    const pre = capturePreconditions({
      decision: state.decision,
      session: s,
      online: state.online,
      locked: deps.isLocked(),
      idle: state.idle,
      foregroundApp: state.decision.capture ? await deps.foregroundApp().catch(() => null) : null,
    });
    if (!pre.ok) {
      state.lastSkip = { reason: pre.reason, at: now() };
      if (pre.report && s)
        await guarded(() =>
          deps.api.request('POST', '/agent/screenshots/skips', {
            sessionId: s.id,
            reason: pre.reason,
            occurredAt: now().toISOString(),
          }),
        ).catch(() => {});
    } else {
      const p = /** @type {any} */ (state.decision).policy;
      const slot = await guarded(() =>
        deps.api.request('POST', '/agent/screenshots/slots', {
          sessionId: s.id,
          policyId: p.id,
          policyVersion: p.version,
          capturedAt: now().toISOString(),
        }),
      );
      const image = await deps.capture({ captureMode: slot.captureMode, blurZones: slot.blurZones ?? [] });
      if (image.length > slot.maxBytes) throw new Error('Screenshot too large');
      await deps.api.upload(slot.upload, image);
      await guarded(() =>
        deps.api.request('POST', `/agent/screenshots/${slot.screenshotId}/confirm`, {
          sha256: createHash('sha256').update(image).digest('hex'),
          bytes: image.length,
        }),
      );
      state.lastCaptureAt = now();
    }
    reschedule();
    emit();
  }

  async function heartbeat() {
    if (!session()) return;
    try {
      const r = await guarded(() =>
        deps.api.request('POST', '/agent/sessions/current/heartbeat', { clientTs: now().toISOString() }),
      );
      if (r?.reconnected) await refreshMe();
    } catch (err) {
      if (/** @type {any} */ (err)?.code === 'no_active_session') await refreshMe().catch(() => {});
    }
  }

  async function pollIdle() {
    const s = session();
    if (!s || s.status === 'ON_BREAK') return;
    const threshold = state.me?.work?.policy?.idleThresholdSec ?? 300;
    const idleNow = deps.idleSeconds() >= threshold || deps.isLocked();
    if (idleNow === state.idle) return;
    state.idle = idleNow;
    emit();
    await guarded(() =>
      deps.api.request('POST', '/agent/sessions/current/idle', {
        state: idleNow ? 'IDLE_START' : 'IDLE_END',
      }),
    ).catch(() => {});
  }

  function stop() {
    stopped = true;
    if (captureTimer) timers.clearTimeout(captureTimer);
    captureTimer = null;
    for (const i of intervals) timers.clearInterval(i);
    intervals.length = 0;
  }

  /** Runs a user action, then refreshes the state from the server. @param {() => Promise<any>} fn */
  const act = async (fn) => {
    try {
      await guarded(fn);
      state.error = null;
    } catch (err) {
      state.error = /** @type {any} */ (err)?.message ?? 'Something went wrong';
      emit();
      throw err;
    }
    return refreshMe();
  };

  return {
    state: () => ({ ...state, monitoringOn: monitoringOn() }),
    async start() {
      stopped = false;
      intervals.push(timers.setInterval(() => heartbeat().catch(() => {}), HEARTBEAT_MS));
      intervals.push(timers.setInterval(() => refreshMe().catch(() => {}), REFRESH_MS));
      intervals.push(timers.setInterval(() => pollIdle().catch(() => {}), IDLE_POLL_MS));
      await refreshMe();
    },
    stop,
    refresh: refreshMe,
    tick,
    heartbeat,
    pollIdle,
    /** Screen locked or system suspended: stop capture at once and report idle. */
    async onLock() {
      if (captureTimer) timers.clearTimeout(captureTimer);
      captureTimer = null;
      state.nextCaptureAt = null;
      await pollIdle();
      emit();
    },
    acknowledge: (/** @type {string} */ activationId) =>
      act(() => deps.api.request('POST', '/agent/me/acknowledge', { activationId, locale: 'en' })),
    startSession: (/** @type {string} */ workLocationId) =>
      act(() => deps.api.request('POST', '/agent/sessions', { workLocationId })),
    startBreak: () => {
      // Stop capture before telling the server, so nothing can be taken during the break.
      if (captureTimer) timers.clearTimeout(captureTimer);
      captureTimer = null;
      return act(() => deps.api.request('POST', '/agent/sessions/current/break/start', { type: 'REGULAR' }));
    },
    endBreak: () => act(() => deps.api.request('POST', '/agent/sessions/current/break/end', {})),
    endSession: () => {
      if (captureTimer) timers.clearTimeout(captureTimer);
      captureTimer = null;
      return act(() => deps.api.request('POST', '/agent/sessions/current/end', {}));
    },
  };
}
