import { loadEnv, corsOrigins, cookieSecure } from '../src/config/env.js';
import { testEnv } from './helpers/test-env.js';

const t = testEnv();
const base = {
  DATABASE_URL: 'mysql://u:p@localhost:3306/hrms',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_PRIVATE_KEY: t.JWT_ACCESS_PRIVATE_KEY,
  JWT_REFRESH_PEPPER: t.JWT_REFRESH_PEPPER,
  DATA_ENCRYPTION_KEY: t.DATA_ENCRYPTION_KEY,
};

describe('environment validation', () => {
  test('applies defaults', () => {
    const e = loadEnv(base);
    expect(e.PORT).toBe(3000);
    expect(e.NODE_ENV).toBe('development');
    expect(e.SCREENSHOT_RETENTION_DAYS).toBe(30);
    expect(Object.isFrozen(e)).toBe(true);
  });
  test('lists every problem in one error', () => {
    expect(() => loadEnv({ PORT: 'abc', REDIS_URL: 'http://x' })).toThrow(
      /DATABASE_URL[\s\S]*REDIS_URL|REDIS_URL[\s\S]*DATABASE_URL/,
    );
  });
  test('rejects screenshot retention outside the 7–90 day guardrail', () => {
    expect(() => loadEnv({ ...base, SCREENSHOT_RETENTION_DAYS: '365' })).toThrow(/SCREENSHOT_RETENTION_DAYS/);
  });
  test('empty values from .env are treated as unset', () => {
    const e = loadEnv({ ...base, CORS_ORIGINS: '', REDIS_QUEUE_URL: '', PORT: ' ' });
    expect(e.PORT).toBe(3000);
    expect(e.REDIS_QUEUE_URL).toBeUndefined();
    expect(corsOrigins(e)).toEqual(['http://localhost:5173']);
  });
  test('CORS origins default to FRONTEND_URL and accept a list', () => {
    expect(corsOrigins(loadEnv(base))).toEqual(['http://localhost:5173']);
    expect(corsOrigins(loadEnv({ ...base, CORS_ORIGINS: 'https://a.example, https://b.example' }))).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });
  test('auth secrets are required and validated', () => {
    expect(() => loadEnv({ ...base, JWT_REFRESH_PEPPER: 'short' })).toThrow(/JWT_REFRESH_PEPPER/);
    expect(() => loadEnv({ ...base, DATA_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow(
      /DATA_ENCRYPTION_KEY/,
    );
  });
  test('secure cookies cannot be turned off in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toThrow(
      /COOKIE_SECURE/,
    );
    expect(cookieSecure(loadEnv({ ...base, NODE_ENV: 'production' }))).toBe(true);
    expect(cookieSecure(loadEnv({ ...base, NODE_ENV: 'development' }))).toBe(false);
  });
});
