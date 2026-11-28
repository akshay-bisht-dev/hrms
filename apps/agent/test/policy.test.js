import { capturePreconditions, isExcluded, nextDelayMs, readPolicy } from '../src/main/core/policy.js';

const ON = {
  enabled: true,
  captureAllowedOnThisDevice: true,
  policy: {
    id: 'p1',
    version: 2,
    intervalMin: 10,
    jitterPct: 20,
    captureMode: 'FULL_SCREEN',
    excludedApps: ['1Password', 'WhatsApp'],
    blurZones: [],
  },
};

test('the server must say yes, for this computer, with a valid policy', () => {
  expect(readPolicy(ON)).toMatchObject({ capture: true, policy: { id: 'p1', version: 2 } });
  expect(readPolicy({ ...ON, captureAllowedOnThisDevice: false })).toMatchObject({ capture: false });
  expect(readPolicy({ enabled: false, reason: 'ACK_REQUIRED' })).toEqual({
    capture: false,
    reason: 'ACK_REQUIRED',
  });
  expect(readPolicy({ ...ON, policy: { ...ON.policy, intervalMin: 1 } })).toEqual({
    capture: false,
    reason: 'POLICY_INVALID',
  });
  expect(readPolicy({ ...ON, policy: { ...ON.policy, captureMode: 'KEYLOG' } })).toEqual({
    capture: false,
    reason: 'POLICY_INVALID',
  });
  expect(readPolicy(null)).toEqual({ capture: false, reason: 'NO_POLICY' });
});

test('only allowlisted policy fields survive (no commands, no URLs)', () => {
  const d = readPolicy({
    ...ON,
    policy: {
      ...ON.policy,
      uploadUrl: 'https://evil',
      run: 'rm -rf /',
      blurZones: [
        { x: 0, y: 0, w: 2, h: 1 },
        { x: 0.5, y: 0, w: 0.5, h: 0.1 },
      ],
    },
  });
  expect(Object.keys(d.policy).sort()).toEqual([
    'blurZones',
    'captureMode',
    'excludedApps',
    'id',
    'intervalMin',
    'jitterPct',
    'version',
  ]);
  expect(d.policy.blurZones).toEqual([{ x: 0.5, y: 0, w: 0.5, h: 0.1 }]);
});

test('the next capture stays within ±jitter of the interval', () => {
  expect(nextDelayMs(10, 20, () => 0)).toBe(480_000);
  expect(nextDelayMs(10, 20, () => 1)).toBe(720_000);
  expect(nextDelayMs(10, 0, () => 0.3)).toBe(600_000);
});

test('every precondition must hold; unknown foreground app means no capture', () => {
  const decision = readPolicy(ON);
  const base = {
    decision,
    session: { id: 's', status: 'ACTIVE' },
    online: true,
    locked: false,
    idle: false,
    foregroundApp: 'code',
  };
  expect(capturePreconditions(base)).toEqual({ ok: true });
  expect(capturePreconditions({ ...base, session: null })).toMatchObject({ ok: false, report: false });
  expect(capturePreconditions({ ...base, session: { id: 's', status: 'ON_BREAK' } })).toMatchObject({
    reason: 'ON_BREAK',
  });
  expect(capturePreconditions({ ...base, session: { id: 's', status: 'DISCONNECTED' } })).toMatchObject({
    ok: false,
  });
  expect(capturePreconditions({ ...base, locked: true })).toMatchObject({ reason: 'SCREEN_LOCKED' });
  expect(capturePreconditions({ ...base, idle: true })).toMatchObject({ reason: 'IDLE' });
  expect(capturePreconditions({ ...base, online: false })).toMatchObject({ reason: 'OFFLINE' });
  expect(capturePreconditions({ ...base, foregroundApp: null })).toMatchObject({
    ok: false,
    reason: 'OTHER',
  });
  expect(capturePreconditions({ ...base, foregroundApp: 'WhatsApp.exe' })).toMatchObject({
    reason: 'EXCLUDED_APP',
  });
  expect(capturePreconditions({ ...base, decision: readPolicy({ enabled: false }) })).toMatchObject({
    ok: false,
  });
  const activeWindow = readPolicy({ ...ON, policy: { ...ON.policy, captureMode: 'ACTIVE_WINDOW' } });
  expect(capturePreconditions({ ...base, decision: activeWindow })).toMatchObject({ ok: false }); // never falls back to full screen
});

test('exclusions match app names loosely', () => {
  expect(isExcluded('1password', ['1Password'])).toBe(true);
  expect(isExcluded('KeePassXC', ['KeePass'])).toBe(true);
  expect(isExcluded('Visual Studio Code', ['1Password', ''])).toBe(false);
});
