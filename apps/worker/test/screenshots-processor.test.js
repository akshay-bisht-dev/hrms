import { createScreenshotsProcessor } from '../src/processors/screenshots.js';
import { currentContext } from '@hrms/backend/lib/context.js';

const T1 = '01a21400-0000-7000-8000-000000000001';
const S1 = '01a21400-0000-7000-8000-0000000000b1';

function setup() {
  const added = [];
  const calls = [];
  const deps = {
    platformDb: () => ({ tenant: { findMany: async () => [{ id: T1 }] } }),
    queue: { add: async (name, data, opts) => added.push({ name, data, jobId: opts.jobId }) },
    screenshots: {
      process: async (id) => {
        calls.push(['process', currentContext().tenantId, id]);
        return { id, status: 'AVAILABLE' };
      },
      retentionSweep: async () => {
        calls.push(['retention', currentContext().tenantId]);
        return { deleted: 2, expiredSlots: 0 };
      },
    },
    logger: { info() {}, warn() {} },
    now: () => new Date('2026-11-28T02:00:00Z'),
  };
  return { process: createScreenshotsProcessor(deps), added, calls };
}

test('processing runs in the screenshot’s tenant', async () => {
  const { process, calls } = setup();
  expect(
    await process({ id: '1', name: 'screenshot-process', data: { tenantId: T1, screenshotId: S1 } }),
  ).toEqual({
    id: S1,
    status: 'AVAILABLE',
  });
  expect(calls).toEqual([['process', T1, S1]]);
});

test('retention fans out once a day per live company, then sweeps inside each', async () => {
  const { process, added, calls } = setup();
  expect(await process({ id: '2', name: 'screenshot-retention', data: {} })).toEqual({ tenants: 1 });
  expect(added).toEqual([
    { name: 'screenshot-retention-tenant', data: { tenantId: T1 }, jobId: `ss-retention-${T1}-20261128` },
  ]);
  await process({ id: '3', name: 'screenshot-retention-tenant', data: { tenantId: T1 } });
  expect(calls).toEqual([['retention', T1]]);
});

test('bad payloads and unknown jobs are refused', async () => {
  const { process } = setup();
  await expect(process({ id: '4', name: 'screenshot-process', data: { tenantId: 'x' } })).rejects.toThrow();
  await expect(process({ id: '5', name: 'nope', data: {} })).rejects.toThrow(/Unknown screenshots job/);
});
