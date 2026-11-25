// Local E2E runs share one client IP (localhost), so per-IP rate-limit counters from earlier runs are cleared first.
// Only ever touches a Redis on localhost.
import { Redis } from 'ioredis';

export default async function globalSetup() {
  const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  if (!/^redis:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/\d+)?$/.test(url)) return;
  const redis = new Redis(url);
  const keys = await redis.keys('rl:*');
  if (keys.length) await redis.del(...keys);
  await redis.quit();
}
