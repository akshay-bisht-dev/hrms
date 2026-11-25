// @ts-check
import { createServer } from 'node:http';
import { env as loadEnv } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { initDb, platformDb, closeDb } from './lib/db.js';
import { createRedis } from './lib/redis.js';
import { createApp } from './app.js';
import { createQueues } from './lib/queues.js';
import { buildServices } from './services.js';

const env = loadEnv();
const logger = createLogger({ level: env.LOG_LEVEL, name: 'hrms-api' });

initDb(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
redis.on('error', (err) => logger.warn({ err }, 'Redis connection error'));
const queueRedis = createRedis(env.REDIS_QUEUE_URL ?? env.REDIS_URL, { forQueues: true });
queueRedis.on('error', (err) => logger.warn({ err }, 'Queue Redis connection error'));
const queues = createQueues(queueRedis);
const services = buildServices({ env, logger, redis, queues });

const app = createApp({
  env,
  logger,
  services: services.routes,
  readinessChecks: [
    { name: 'mysql', check: () => platformDb().$queryRaw`SELECT 1` },
    {
      name: 'redis',
      check: async () => {
        if (redis.status === 'wait' || redis.status === 'end') await redis.connect();
        return redis.ping();
      },
    },
  ],
});

const server = createServer(app);
server.keepAliveTimeout = 65_000; // longer than the ALB idle timeout (60 s)
server.headersTimeout = 66_000;
server.listen(env.PORT, () => logger.info({ port: env.PORT, region: env.CELL_REGION }, 'API listening'));

let shuttingDown = false;
/** @param {string} signal */
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');
  const force = setTimeout(() => {
    logger.error('Forced exit after shutdown timeout');
    process.exit(1);
  }, env.SHUTDOWN_TIMEOUT_MS);
  force.unref();
  server.close(async () => {
    await Promise.allSettled([closeDb(), queues.close().then(() => queueRedis.quit()), redis.quit()]);
    logger.info('Shutdown complete');
    process.exit(0);
  });
  server.closeIdleConnections();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  void shutdown('unhandledRejection');
});
