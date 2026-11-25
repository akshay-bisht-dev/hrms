import { createSystemProcessor } from '../src/processors/system.js';
import { loadWorkerConfig } from '../src/config.js';

const logger = { debug() {}, info() {} };
const fixed = () => new Date('2026-11-25T10:00:00.000Z');

describe('system processor', () => {
  const run = createSystemProcessor({ logger, now: fixed });
  test('ping echoes the request time and reports processing time', async () => {
    const out = await run({ id: '1', name: 'ping', data: { requestedAt: '2026-11-25T09:59:59.000Z' } });
    expect(out).toEqual({
      pong: true,
      requestedAt: '2026-11-25T09:59:59.000Z',
      processedAt: '2026-11-25T10:00:00.000Z',
    });
  });
  test('invalid payloads are rejected', async () => {
    await expect(run({ id: '2', name: 'ping', data: { requestedAt: 'yesterday' } })).rejects.toThrow();
    await expect(
      run({ id: '3', name: 'ping', data: { requestedAt: '2026-11-25T09:59:59.000Z', extra: 1 } }),
    ).rejects.toThrow();
  });
  test('unknown job names are rejected', async () => {
    await expect(run({ id: '4', name: 'rm -rf', data: {} })).rejects.toThrow(/Unknown system job/);
  });
});

describe('worker config', () => {
  test('queue Redis falls back to REDIS_URL', () => {
    const c = loadWorkerConfig({ REDIS_URL: 'redis://localhost:6379', DATABASE_URL: 'mysql://u:p@h:3306/d' });
    expect(c.queueRedisUrl).toBe('redis://localhost:6379');
  });
  test('an empty REDIS_QUEUE_URL falls back to REDIS_URL', () => {
    const c = loadWorkerConfig({
      REDIS_URL: 'redis://localhost:6379',
      REDIS_QUEUE_URL: '',
      DATABASE_URL: 'mysql://u:p@h:3306/d',
    });
    expect(c.queueRedisUrl).toBe('redis://localhost:6379');
  });
  test('missing Redis URL fails fast', () => {
    expect(() => loadWorkerConfig({ DATABASE_URL: 'mysql://u:p@h:3306/d' })).toThrow(/REDIS_URL/);
  });
});
