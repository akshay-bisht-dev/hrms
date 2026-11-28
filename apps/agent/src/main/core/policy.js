// @ts-check
/**
 * The agent never takes commands from the server, only this declarative policy. Anything outside the allowlist is
 * dropped; anything malformed turns capture off (Phase 1 §5.2 step 5).
 */

const CAPTURE_MODES = new Set(['FULL_SCREEN', 'ACTIVE_WINDOW', 'BLURRED']);
const isInt = (/** @type {unknown} */ v, /** @type {number} */ min, /** @type {number} */ max) =>
  Number.isInteger(v) && /** @type {number} */ (v) >= min && /** @type {number} */ (v) <= max;

/**
 * @typedef {{ capture: false, reason: string } | { capture: true, policy: { id: string, version: number, intervalMin: number,
 *   jitterPct: number, captureMode: string, excludedApps: string[], blurZones: { x: number, y: number, w: number, h: number }[] } }} Decision
 */

/**
 * Reads the monitoring part of GET /agent/me.
 * @param {any} m
 * @returns {Decision}
 */
export function readPolicy(m) {
  if (!m || typeof m !== 'object') return { capture: false, reason: 'NO_POLICY' };
  if (m.enabled !== true || m.captureAllowedOnThisDevice !== true)
    return { capture: false, reason: typeof m.reason === 'string' ? m.reason.slice(0, 40) : 'OFF' };
  const p = m.policy;
  if (
    !p ||
    typeof p.id !== 'string' ||
    !isInt(p.version, 1, 1_000_000) ||
    !isInt(p.intervalMin, 5, 240) ||
    !isInt(p.jitterPct, 0, 50) ||
    !CAPTURE_MODES.has(p.captureMode) ||
    !Array.isArray(p.excludedApps)
  )
    return { capture: false, reason: 'POLICY_INVALID' };
  const zones = Array.isArray(p.blurZones) ? p.blurZones : [];
  const unit = (/** @type {unknown} */ n) => typeof n === 'number' && n >= 0 && n <= 1;
  return {
    capture: true,
    policy: {
      id: p.id,
      version: p.version,
      intervalMin: p.intervalMin,
      jitterPct: p.jitterPct,
      captureMode: p.captureMode,
      excludedApps: p.excludedApps
        .filter((/** @type {unknown} */ a) => typeof a === 'string' && a.length <= 120)
        .slice(0, 200),
      blurZones: zones
        .filter((/** @type {any} */ z) => z && unit(z.x) && unit(z.y) && unit(z.w) && unit(z.h))
        .slice(0, 10)
        .map((/** @type {any} */ z) => ({ x: z.x, y: z.y, w: z.w, h: z.h })),
    },
  };
}

/**
 * Milliseconds until the next capture: the interval, moved randomly by up to ±jitter%.
 * @param {number} intervalMin @param {number} jitterPct @param {() => number} [random]
 */
export function nextDelayMs(intervalMin, jitterPct, random = Math.random) {
  const base = intervalMin * 60_000;
  const spread = (base * jitterPct) / 100;
  return Math.round(base - spread + random() * 2 * spread);
}

/**
 * Whether a capture may happen now. Every condition must hold; otherwise the reason is reported (reason only, no
 * image). Unknown foreground app = skip: exclusions can't be checked, so we don't capture.
 * @param {{ decision: Decision, session: { id: string, status: string } | null, online: boolean, locked: boolean,
 *           idle: boolean, foregroundApp: string | null }} s
 * @returns {{ ok: true } | { ok: false, reason: string, report: boolean }} report=false when no session exists to report against
 */
export function capturePreconditions(s) {
  if (!s.decision.capture) return { ok: false, reason: 'POLICY_OUTDATED', report: false };
  if (!s.session) return { ok: false, reason: 'OTHER', report: false };
  if (!s.online) return { ok: false, reason: 'OFFLINE', report: false };
  if (s.session.status === 'ON_BREAK') return { ok: false, reason: 'ON_BREAK', report: true };
  if (s.session.status !== 'ACTIVE') return { ok: false, reason: 'OTHER', report: false };
  if (s.locked) return { ok: false, reason: 'SCREEN_LOCKED', report: true };
  if (s.idle) return { ok: false, reason: 'IDLE', report: true };
  if (s.decision.policy.captureMode === 'ACTIVE_WINDOW') return { ok: false, reason: 'OTHER', report: true }; // not supported yet: never fall back to full screen
  if (!s.foregroundApp) return { ok: false, reason: 'OTHER', report: true };
  if (isExcluded(s.foregroundApp, s.decision.policy.excludedApps))
    return { ok: false, reason: 'EXCLUDED_APP', report: true };
  return { ok: true };
}

/** Case-insensitive match on the app name, ignoring ".exe"/".app" and spaces. @param {string} app @param {string[]} list */
export function isExcluded(app, list) {
  const norm = (/** @type {string} */ s) =>
    s
      .toLowerCase()
      .replace(/\.(exe|app)$/, '')
      .replace(/[\s_-]+/g, '');
  const a = norm(app);
  return list.some((x) => {
    const n = norm(x);
    return n.length > 0 && (a === n || a.includes(n));
  });
}
