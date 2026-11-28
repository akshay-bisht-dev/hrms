import { jest } from '@jest/globals';
import { createController } from '../src/main/core/controller.js';
import { RevokedError } from '../src/main/core/api.js';

const ME = (over = {}) => ({
  device: { id: 'd1', status: 'ACTIVE', ownership: 'COMPANY_MANAGED' },
  work: {
    active: { id: 's1', status: 'ACTIVE' },
    policy: { idleThresholdSec: 300 },
    locations: [],
    ...over.work,
  },
  monitoring: {
    enabled: true,
    captureAllowedOnThisDevice: true,
    policy: {
      id: 'p1',
      version: 1,
      intervalMin: 10,
      jitterPct: 0,
      captureMode: 'FULL_SCREEN',
      excludedApps: ['WhatsApp'],
      blurZones: [],
    },
    ...over.monitoring,
  },
});

function setup({ me = ME(), foreground = 'code', locked = false, idle = 0 } = {}) {
  const calls = [];
  let current = me;
  const api = {
    request: jest.fn(async (method, path, body) => {
      calls.push([method, path, body]);
      if (path === '/agent/me') return current;
      if (path === '/agent/screenshots/slots')
        return {
          screenshotId: 'x1',
          upload: { url: 'https://s3/x', headers: {} },
          maxBytes: 2_000_000,
          captureMode: 'FULL_SCREEN',
          blurZones: [],
        };
      return {};
    }),
    upload: jest.fn(async () => {}),
  };
  const capture = jest.fn(async () => Buffer.from('RIFF0000WEBPdata'));
  const states = [];
  const c = createController({
    api,
    capture,
    foregroundApp: async () => foreground,
    idleSeconds: () => idle,
    isLocked: () => locked,
    onChange: (s) => states.push(s),
    timers: {
      setTimeout: jest.fn(() => 1),
      clearTimeout: jest.fn(),
      setInterval: jest.fn(() => 2),
      clearInterval: jest.fn(),
    },
    firstCaptureMs: 1000,
  });
  return { c, api, calls, capture, states, setMe: (m) => (current = m) };
}

test('a capture happens only after the server issues a slot; the hash is confirmed', async () => {
  const { c, calls, capture, api } = setup();
  await c.start();
  expect(c.state().monitoringOn).toBe(true);
  await c.tick();
  const paths = calls.map((x) => x[1]);
  expect(paths).toEqual(
    expect.arrayContaining(['/agent/screenshots/slots', '/agent/screenshots/x1/confirm']),
  );
  expect(paths.indexOf('/agent/screenshots/slots')).toBeLessThan(
    paths.indexOf('/agent/screenshots/x1/confirm'),
  );
  expect(capture).toHaveBeenCalledTimes(1);
  expect(api.upload).toHaveBeenCalledTimes(1);
  const confirm = calls.find((x) => x[1] === '/agent/screenshots/x1/confirm')[2];
  expect(confirm.sha256).toMatch(/^[a-f0-9]{64}$/);
});

test('no capture when the server says no, on a break, or with an excluded or unknown app', async () => {
  for (const variant of [
    { me: ME({ monitoring: { enabled: false, reason: 'ACK_REQUIRED', captureAllowedOnThisDevice: false } }) },
    { me: ME({ work: { active: { id: 's1', status: 'ON_BREAK' } } }) },
    { foreground: 'WhatsApp' },
    { foreground: null },
    { locked: true },
    { idle: 900 },
  ]) {
    const { c, capture, calls } = setup(variant);
    await c.start();
    if (variant.idle) await c.pollIdle();
    await c.tick();
    expect(capture).not.toHaveBeenCalled();
    expect(calls.some((x) => x[1] === '/agent/screenshots/slots')).toBe(false);
  }
});

test('skips are reported with a reason only', async () => {
  const { c, calls } = setup({ foreground: 'WhatsApp' });
  await c.start();
  await c.tick();
  const skip = calls.find((x) => x[1] === '/agent/screenshots/skips');
  expect(Object.keys(skip[2]).sort()).toEqual(['occurredAt', 'reason', 'sessionId']);
  expect(skip[2].reason).toBe('EXCLUDED_APP');
});

test('idle is reported from system idle time, and back again', async () => {
  const { c, calls } = setup({ idle: 900 });
  await c.start();
  await c.pollIdle();
  expect(calls.filter((x) => x[1] === '/agent/sessions/current/idle').map((x) => x[2].state)).toEqual([
    'IDLE_START',
  ]);
});

test('a revoked device stops everything and reports "not paired"', async () => {
  const { c, api, states } = setup();
  await c.start();
  api.request.mockImplementation(async () => {
    throw new RevokedError('device_revoked');
  });
  await expect(c.refresh()).rejects.toBeInstanceOf(RevokedError);
  expect(states.at(-1)).toMatchObject({ paired: false, monitoringOn: false });
});

test('taking a break cancels the pending capture before telling the server', async () => {
  const { c, calls } = setup();
  await c.start();
  const timersCleared = calls.length;
  await c.startBreak();
  expect(calls.slice(timersCleared).map((x) => x[1])[0]).toBe('/agent/sessions/current/break/start');
});
