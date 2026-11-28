import { computeTimeline, paint } from '../src/modules/work/session-engine.js';

const T0 = Date.parse('2026-11-26T03:30:00.000Z'); // 09:00 IST
const at = (min, sec = 0) => new Date(T0 + min * 60_000 + sec * 1000);
const ev = (type, min, meta) => ({ type, serverTs: at(min), ...(meta ? { meta } : {}) });
const POLICY = { heartbeatTimeoutSec: 180, idleCounting: 'NOT_COUNTED' };
const beats = (from, to, every = 1) =>
  Array.from({ length: Math.floor((to - from) / every) + 1 }, (_, i) => ev('HEARTBEAT', from + i * every));
const run = (events, extra = {}) => computeTimeline({ events, policy: POLICY, now: at(600), ...extra });
const min = (sec) => sec / 60;

describe('scenarios', () => {
  test('a connected hour is an hour of work', () => {
    const t = run([ev('START', 0), ...beats(1, 59), ev('END', 60)]);
    expect(t.totals).toEqual({ workedSec: 3600, breakSec: 0, idleSec: 0, disconnectedSec: 0, removedSec: 0 });
    expect(t.endedAt).toEqual(at(60));
  });

  test('a gap longer than the timeout is disconnected from the last signal, and not work', () => {
    // Heartbeats to minute 20, nothing until minute 40, then again.
    const t = run([ev('START', 0), ...beats(1, 20), ev('RECONNECTED', 40), ...beats(41, 59), ev('END', 60)]);
    expect(min(t.totals.disconnectedSec)).toBe(20);
    expect(min(t.totals.workedSec)).toBe(40);
    expect(t.segments.map((s) => s.kind)).toEqual(['WORK', 'DISCONNECTED', 'WORK']);
  });

  test('a gap within the timeout is still work', () => {
    const t = run([ev('START', 0), ev('HEARTBEAT', 2), ev('HEARTBEAT', 5), ev('END', 7)]);
    expect(t.totals.disconnectedSec).toBe(0);
  });

  test('breaks are breaks even if the tab is closed during them', () => {
    const t = run([
      ev('START', 0),
      ...beats(1, 30),
      ev('BREAK_START', 30),
      ev('BREAK_END', 75),
      ...beats(76, 89),
      ev('END', 90),
    ]);
    expect(min(t.totals.breakSec)).toBe(45);
    expect(min(t.totals.workedSec)).toBe(45);
    expect(t.totals.disconnectedSec).toBe(0);
  });

  test('an open session whose browser closed: the tail after the last heartbeat is disconnected', () => {
    const t = run([ev('START', 0), ...beats(1, 30)], { now: at(50) });
    expect(t.endedAt).toBeNull();
    expect(min(t.totals.workedSec)).toBe(30);
    expect(min(t.totals.disconnectedSec)).toBe(20);
  });

  test('heartbeats kept only in the session row still count', () => {
    const t = run([ev('START', 0), ev('HEARTBEAT', 1)], { now: at(10), lastHeartbeatAt: at(9) });
    // Gap 1 → 9 is 8 minutes (> 3), so it counts as disconnected unless intermediate heartbeats were stored.
    expect(min(t.totals.disconnectedSec)).toBe(8);
    expect(min(t.totals.workedSec)).toBe(2);
  });

  test('idle is excluded unless the policy counts it', () => {
    const events = [ev('START', 0), ...beats(1, 60), ev('IDLE_START', 20), ev('IDLE_END', 35), ev('END', 60)];
    expect(min(run(events).totals.idleSec)).toBe(15);
    expect(min(run(events).totals.workedSec)).toBe(45);
    expect(
      min(
        computeTimeline({ events, policy: { ...POLICY, idleCounting: 'COUNTED' }, now: at(600) }).totals
          .workedSec,
      ),
    ).toBe(60);
    const threshold = computeTimeline({
      events,
      policy: { ...POLICY, idleCounting: 'COUNTED_UNTIL_THRESHOLD', idleThresholdSec: 300 },
      now: at(600),
    }).totals;
    expect(min(threshold.workedSec)).toBe(50);
    expect(min(threshold.idleSec)).toBe(10);
  });

  test('corrections are painted over the result without touching events', () => {
    const base = [ev('START', 0), ...beats(1, 20), ev('RECONNECTED', 40), ...beats(41, 59), ev('END', 60)];
    const disputed = run([
      ...base,
      ev('CORRECTION_APPLIED', 70, { kind: 'DISCONNECT_DISPUTE', fromTs: at(20), toTs: at(40) }),
    ]);
    expect(min(disputed.totals.workedSec)).toBe(60);
    const removed = run([
      ...base,
      ev('CORRECTION_APPLIED', 70, { kind: 'REMOVE_WORK_TIME', fromTs: at(50), toTs: at(60) }),
    ]);
    expect(min(removed.totals.workedSec)).toBe(30);
    expect(min(removed.totals.removedSec)).toBe(10);
    const asBreak = run([
      ...base,
      ev('CORRECTION_APPLIED', 70, { kind: 'MARK_BREAK', fromTs: at(0), toTs: at(10) }),
    ]);
    expect(min(asBreak.totals.breakSec)).toBe(10);
  });

  test('an automatic close ends the session at the recorded last sign of life', () => {
    const t = run([ev('START', 0), ...beats(1, 30), ev('AUTO_CLOSED', 160, { endAt: at(30) })]);
    expect(t.endedAt).toEqual(at(30));
    expect(min(t.totals.workedSec)).toBe(30);
    expect(t.totals.disconnectedSec).toBe(0);
  });

  test('a missing check-out correction extends an auto-closed session', () => {
    const autoClosed = [ev('START', 0), ...beats(1, 30), ev('AUTO_CLOSED', 30)];
    expect(min(run(autoClosed).totals.workedSec)).toBe(30);
    const fixed = run([
      ...autoClosed,
      ev('CORRECTION_APPLIED', 600, { kind: 'MISSING_CHECKOUT', fromTs: at(30), toTs: at(45) }),
    ]);
    expect(fixed.endedAt).toEqual(at(45));
    expect(min(fixed.totals.workedSec)).toBe(45);
  });

  test('paint merges neighbours and keeps segments contiguous', () => {
    let s = [{ from: 0, to: 100, kind: 'WORK' }];
    s = paint(s, 10, 20, 'BREAK');
    s = paint(s, 10, 20, 'WORK');
    expect(s).toEqual([{ from: 0, to: 100, kind: 'WORK' }]);
  });
});

// Seeded pseudo-random generator (mulberry32) so property failures are reproducible.
const rng = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** A random but valid session: heartbeats with random gaps, optional breaks and idle, maybe ended. */
function randomSession(r) {
  const events = [{ type: 'START', serverTs: at(0) }];
  let t = 0;
  let onBreak = false;
  const length = 30 + Math.floor(r() * 400);
  while (t < length) {
    t += r() < 0.1 ? 3 + r() * 20 : r() * 2.5; // mostly connected, sometimes a long gap
    const roll = r();
    const type =
      roll < 0.05
        ? onBreak
          ? 'BREAK_END'
          : 'BREAK_START'
        : roll < 0.08
          ? 'IDLE_START'
          : roll < 0.11
            ? 'IDLE_END'
            : 'HEARTBEAT';
    if (type === 'BREAK_START') onBreak = true;
    if (type === 'BREAK_END') onBreak = false;
    events.push({ type, serverTs: at(t) });
  }
  const ended = r() < 0.7;
  if (ended) events.push({ type: 'END', serverTs: at(t + r()) });
  return { events, now: at(t + 1 + r() * 30) };
}

describe('properties (500 random sessions each)', () => {
  const policies = [POLICY, { heartbeatTimeoutSec: 60, idleCounting: 'COUNTED' }];
  test('segments cover the session exactly once, in order, with no gaps or overlaps', () => {
    const r = rng(42);
    for (let i = 0; i < 500; i++) {
      const s = randomSession(r);
      const t = computeTimeline({ ...s, policy: policies[i % 2] });
      const end = (t.endedAt ?? s.now).getTime();
      expect(t.segments[0].from.getTime()).toBe(t.startedAt.getTime());
      expect(t.segments.at(-1).to.getTime()).toBe(end);
      for (let k = 1; k < t.segments.length; k++)
        expect(t.segments[k].from.getTime()).toBe(t.segments[k - 1].to.getTime());
      for (const seg of t.segments) expect(seg.to.getTime()).toBeGreaterThan(seg.from.getTime());
    }
  });

  test('totals are never negative and never exceed the session length', () => {
    const r = rng(7);
    for (let i = 0; i < 500; i++) {
      const s = randomSession(r);
      const t = computeTimeline({ ...s, policy: POLICY });
      const length = Math.floor(((t.endedAt ?? s.now).getTime() - t.startedAt.getTime()) / 1000);
      const { workedSec, breakSec, idleSec, disconnectedSec, removedSec } = t.totals;
      for (const v of Object.values(t.totals)) expect(v).toBeGreaterThanOrEqual(0);
      expect(workedSec + breakSec + idleSec + disconnectedSec + removedSec).toBeLessThanOrEqual(length);
      expect(workedSec + breakSec + idleSec + disconnectedSec + removedSec).toBeGreaterThanOrEqual(
        length - 5,
      ); // per-kind second flooring
    }
  });

  test('more heartbeats never mean less work or more disconnection', () => {
    const r = rng(2026);
    for (let i = 0; i < 500; i++) {
      const s = randomSession(r);
      const before = computeTimeline({ ...s, policy: POLICY }).totals;
      const end = (s.events.find((e) => e.type === 'END')?.serverTs ?? s.now).getTime();
      const extra = { type: 'HEARTBEAT', serverTs: new Date(T0 + r() * (end - T0)) };
      const after = computeTimeline({ ...s, events: [...s.events, extra], policy: POLICY }).totals;
      expect(after.disconnectedSec).toBeLessThanOrEqual(before.disconnectedSec);
      expect(after.workedSec).toBeGreaterThanOrEqual(before.workedSec);
    }
  });

  test('applying the same correction twice changes nothing more', () => {
    const r = rng(99);
    for (let i = 0; i < 200; i++) {
      const s = randomSession(r);
      const c = {
        type: 'CORRECTION_APPLIED',
        serverTs: s.now,
        meta: { kind: 'ADD_WORK_TIME', fromTs: at(r() * 20), toTs: at(20 + r() * 20) },
      };
      const once = computeTimeline({ ...s, events: [...s.events, c], policy: POLICY }).totals;
      const twice = computeTimeline({ ...s, events: [...s.events, c, c], policy: POLICY }).totals;
      expect(twice).toEqual(once);
    }
  });
});
