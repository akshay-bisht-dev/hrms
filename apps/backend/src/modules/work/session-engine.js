// @ts-check
/**
 * Work-session timeline (Phase 1 §5.5). Pure: the event log is the source of truth, and every total is derived
 * from it, so recalculating always gives the same answer and a correction never edits an event.
 *
 * Rules:
 *  1. Only server timestamps count.
 *  2. Time is "verified" while presence signals (start, heartbeats, break/idle changes, reconnect, end) arrive within
 *     the heartbeat timeout. A longer gap is DISCONNECTED from the last signal to the next one and is not work.
 *  3. Break time is break, whether or not the tab is connected.
 *  4. Idle time (reported by the desktop agent) is work when the policy says COUNTED; with COUNTED_UNTIL_THRESHOLD
 *     the first idleThresholdSec of each idle stretch is work and the rest is idle.
 *  5. Approved corrections are painted over the result, in the order they were approved.
 */

export const SIGNALS = new Set([
  'START',
  'HEARTBEAT',
  'BREAK_START',
  'BREAK_END',
  'IDLE_START',
  'IDLE_END',
  'RECONNECTED',
  'END',
]);
export const KINDS = /** @type {const} */ (['WORK', 'BREAK', 'IDLE', 'DISCONNECTED', 'REMOVED']);
const CORRECTION_KIND = {
  ADD_WORK_TIME: 'WORK',
  DISCONNECT_DISPUTE: 'WORK',
  IDLE_DISPUTE: 'WORK',
  MISSING_CHECKOUT: 'WORK',
  REMOVE_WORK_TIME: 'REMOVED',
  MARK_BREAK: 'BREAK',
};

/** @typedef {{ from: number, to: number, kind: string }} Segment */

/**
 * Paints [from, to) with `kind`, splitting existing segments. Segments stay sorted and contiguous.
 * @param {Segment[]} segs @param {number} from @param {number} to @param {string} kind
 */
export function paint(segs, from, to, kind) {
  if (to <= from) return segs;
  /** @type {Segment[]} */
  const out = [];
  for (const s of segs) {
    if (s.to <= from || s.from >= to) out.push(s);
    else {
      if (s.from < from) out.push({ from: s.from, to: from, kind: s.kind });
      if (s.to > to) out.push({ from: to, to: s.to, kind: s.kind });
    }
  }
  out.push({ from, to, kind });
  out.sort((a, b) => a.from - b.from);
  // Merge neighbours of the same kind.
  /** @type {Segment[]} */
  const merged = [];
  for (const s of out) {
    const last = merged.at(-1);
    if (last && last.kind === s.kind && last.to === s.from) last.to = s.to;
    else merged.push({ ...s });
  }
  return merged;
}

/**
 * @param {object} input
 * @param {{ type: string, serverTs: Date, meta?: any }[]} input.events in server order
 * @param {{ heartbeatTimeoutSec: number, idleThresholdSec?: number, idleCounting: 'NOT_COUNTED' | 'COUNTED' | 'COUNTED_UNTIL_THRESHOLD' }} input.policy
 * @param {Date} input.now
 * @param {Date | null} [input.lastHeartbeatAt] latest heartbeat even if it was not stored as an event
 */
export function computeTimeline({ events, policy, now, lastHeartbeatAt = null }) {
  const sorted = [...events].sort((a, b) => a.serverTs.getTime() - b.serverTs.getTime());
  const startEv = sorted.find((e) => e.type === 'START');
  if (!startEv) throw new Error('A session needs a START event');
  const start = startEv.serverTs.getTime();
  const closing = sorted.find((e) => e.type === 'END' || e.type === 'AUTO_CLOSED');
  let end = closing ? closing.serverTs.getTime() : Math.max(start, now.getTime());
  const corrections = sorted.filter((e) => e.type === 'CORRECTION_APPLIED' && e.meta);
  for (const c of corrections)
    if (c.meta.kind === 'MISSING_CHECKOUT' && closing) end = Math.max(end, new Date(c.meta.toTs).getTime());
  const timeoutMs = policy.heartbeatTimeoutSec * 1000;

  // 1. Phases from break/idle changes.
  /** @type {Segment[]} */
  let segs = [{ from: start, to: end, kind: 'WORK' }];
  let phase = 'WORK';
  let phaseFrom = start;
  const setPhase = (/** @type {string} */ next, /** @type {number} */ at) => {
    const t = Math.min(Math.max(at, start), end);
    // COUNTED_UNTIL_THRESHOLD: the first idleThresholdSec of each idle stretch is still work.
    const from =
      phase === 'IDLE' && policy.idleCounting === 'COUNTED_UNTIL_THRESHOLD'
        ? phaseFrom + (policy.idleThresholdSec ?? 0) * 1000
        : phaseFrom;
    if (phase !== 'WORK') segs = paint(segs, Math.min(from, t), t, phase);
    phase = next;
    phaseFrom = t;
  };
  for (const e of sorted) {
    const t = e.serverTs.getTime();
    if (e.type === 'BREAK_START' && phase !== 'BREAK') setPhase('BREAK', t);
    else if (e.type === 'BREAK_END' && phase === 'BREAK') setPhase('WORK', t);
    else if (e.type === 'IDLE_START' && phase === 'WORK') setPhase('IDLE', t);
    else if (e.type === 'IDLE_END' && phase === 'IDLE') setPhase('WORK', t);
  }
  setPhase('WORK', end);

  // 2. Disconnections: any gap between presence signals (or from the last one to the end) longer than the
  //    timeout is DISCONNECTED, except where the person was on a break.
  const signals = sorted.filter((e) => SIGNALS.has(e.type)).map((e) => e.serverTs.getTime());
  if (lastHeartbeatAt) signals.push(lastHeartbeatAt.getTime());
  const points = [...new Set(signals.filter((t) => t >= start && t <= end))].sort((a, b) => a - b);
  points.push(end);
  const gaps = [];
  for (let i = 0; i + 1 < points.length; i++)
    if (points[i + 1] - points[i] > timeoutMs) gaps.push([points[i], points[i + 1]]);
  for (const [a, b] of gaps) {
    for (const s of segs.filter((x) => x.kind === 'WORK' || x.kind === 'IDLE')) {
      const from = Math.max(a, s.from);
      const to = Math.min(b, s.to);
      if (to > from) segs = paint(segs, from, to, 'DISCONNECTED');
    }
  }

  // 3. Approved corrections, in approval order.
  for (const c of corrections) {
    const kind = /** @type {any} */ (CORRECTION_KIND)[c.meta.kind];
    if (!kind) continue;
    const from = Math.max(start, new Date(c.meta.fromTs).getTime());
    const to = Math.min(end, new Date(c.meta.toTs).getTime());
    if (to > from) segs = paint(segs, from, to, kind);
  }

  const ms = Object.fromEntries(KINDS.map((k) => [k, 0]));
  for (const s of segs) ms[s.kind] += s.to - s.from;
  const sec = (/** @type {number} */ v) => Math.floor(v / 1000);
  const idleCounts = policy.idleCounting === 'COUNTED';
  return {
    startedAt: new Date(start),
    endedAt: closing ? new Date(end) : null,
    segments: segs.map((s) => ({ from: new Date(s.from), to: new Date(s.to), kind: s.kind })),
    totals: {
      workedSec: sec(ms.WORK + (idleCounts ? ms.IDLE : 0)),
      breakSec: sec(ms.BREAK),
      idleSec: sec(ms.IDLE),
      disconnectedSec: sec(ms.DISCONNECTED),
      removedSec: sec(ms.REMOVED),
    },
  };
}
