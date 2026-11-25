import request from 'supertest';
import { createApp } from '../src/app.js';
import { testEnv } from './helpers/test-env.js';
import { createLogger } from '../src/lib/logger.js';

const env = testEnv();
const logger = createLogger({ level: 'silent' });
const ok = () => Promise.resolve(1);
const app = (
  checks = [
    { name: 'mysql', check: ok },
    { name: 'redis', check: ok },
  ],
) => createApp({ env, logger, readinessChecks: checks });

describe('health', () => {
  test('GET /health/live returns ok', async () => {
    const res = await request(app()).get('/health/live').expect(200);
    expect(res.body.status).toBe('ok');
  });
  test('GET /health/ready returns 200 when all checks pass', async () => {
    const res = await request(app()).get('/health/ready').expect(200);
    expect(res.body.checks.map((c) => c.ok)).toEqual([true, true]);
    expect(res.headers['cache-control']).toBe('no-store');
  });
  test('GET /health/ready returns 503 without leaking error details', async () => {
    const res = await request(
      app([
        { name: 'mysql', check: () => Promise.reject(new Error('ECONNREFUSED 10.0.0.5:3306 secret-host')) },
      ]),
    )
      .get('/health/ready')
      .expect(503);
    expect(res.body.status).toBe('unavailable');
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|secret-host/);
  });
  test('a hanging check times out', async () => {
    const res = await request(app([{ name: 'redis', check: () => new Promise(() => {}) }]))
      .get('/health/ready')
      .expect(503);
    expect(res.body.checks[0].error).toBe('timeout');
  });
});

describe('request handling', () => {
  test('unknown routes return problem+json 404 with a request id', async () => {
    const res = await request(app()).get('/api/v1/nope').expect(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ status: 404, code: 'not_found' });
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });
  test('a safe incoming X-Request-Id is reused; an unsafe one is replaced', async () => {
    const safe = await request(app()).get('/health/live').set('X-Request-Id', 'abc12345-trace');
    expect(safe.headers['x-request-id']).toBe('abc12345-trace');
    const unsafe = await request(app()).get('/health/live').set('X-Request-Id', '<script>');
    expect(unsafe.headers['x-request-id']).not.toBe('<script>');
  });
  test('malformed JSON returns 400 problem+json', async () => {
    const res = await request(app())
      .post('/api/v1/anything')
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_json');
  });
  test('security headers are set and X-Powered-By is removed', async () => {
    const res = await request(app()).get('/health/live');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=63072000/);
    expect(res.headers['content-security-policy']).toMatch(/default-src 'none'/);
  });
  test('CORS allows only the configured frontend origin', async () => {
    const allowed = await request(app())
      .options('/api/v1/x')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const denied = await request(app())
      .options('/api/v1/x')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('API docs', () => {
  test('OpenAPI 3.1 document lists the health endpoints', async () => {
    const res = await request(app()).get('/api/docs/openapi.json').expect(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(Object.keys(res.body.paths)).toEqual(expect.arrayContaining(['/health/live', '/health/ready']));
  });
  test('Swagger UI is served at /api/docs', async () => {
    const res = await request(app()).get('/api/docs/').expect(200);
    expect(res.text).toMatch(/swagger-ui/i);
  });
  test('docs are disabled in production by default', async () => {
    const prod = testEnv({ NODE_ENV: 'production', COOKIE_SECURE: 'true' });
    await request(createApp({ env: prod, logger, readinessChecks: [] }))
      .get('/api/docs/openapi.json')
      .expect(404);
  });
});
