// Integration: real Redis (REDIS_URL). Runs a job through BullMQ end to end.
import { Queue, Worker, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { createSystemProcessor } from '../src/processors/system.js';

const url = process.env.REDIS_URL;
if (!url) throw new Error('REDIS_URL is required for integration tests');
const queueName = `system-test-${Date.now()}`;
// BullMQ does not close connections it is given, so every connection is tracked and closed here.
const connections = [];
const redis = () => {
  const c = new Redis(url, { maxRetriesPerRequest: null });
  connections.push(c);
  return c;
};
const connection = redis();

afterAll(async () => {
  await Promise.all(connections.map((c) => c.quit()));
});

test('a ping job is processed by the worker and its result stored', async () => {
  const queue = new Queue(queueName, { connection });
  const events = new QueueEvents(queueName, { connection: redis() });
  const worker = new Worker(queueName, createSystemProcessor({ logger: { debug() {} } }), {
    connection: redis(),
  });
  await events.waitUntilReady();
  const job = await queue.add('ping', { requestedAt: new Date().toISOString() }, { jobId: 'ping-1' });
  const result = await job.waitUntilFinished(events, 10_000);
  expect(result.pong).toBe(true);
  // Same jobId again is deduplicated by BullMQ (idempotent enqueue)
  const again = await queue.add('ping', { requestedAt: new Date().toISOString() }, { jobId: 'ping-1' });
  expect(again.id).toBe('ping-1');
  expect(await queue.getJobCounts('completed')).toEqual({ completed: 1 });
  await worker.close();
  await events.close();
  await queue.obliterate({ force: true });
  await queue.close();
});
