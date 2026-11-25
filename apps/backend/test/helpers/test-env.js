import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { loadEnv } from '../../src/config/env.js';

/** Fresh, valid environment for tests (new keys every call). */
export function testEnv(overrides = {}) {
  const { privateKey } = generateKeyPairSync('ed25519');
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL ?? 'mysql://u:p@localhost:3306/hrms',
    REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
    JWT_ACCESS_PRIVATE_KEY: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString(
      'base64',
    ),
    JWT_REFRESH_PEPPER: randomBytes(32).toString('base64url'),
    DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    COOKIE_SECURE: 'false',
    ...overrides,
  });
}
