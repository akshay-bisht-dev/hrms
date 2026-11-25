import express from 'express';
import { markAccess, listRoutes, assertRoutesDeclared } from '../src/lib/route-registry.js';
import { requireCsrf } from '../src/lib/cookies.js';
import request from 'supertest';
import cookieParser from 'cookie-parser';

describe('route registry (deny by default)', () => {
  test('routes with an access declaration pass', () => {
    const r = express.Router();
    r.get(
      '/a',
      markAccess((_q, _s, n) => n(), 'public'),
      (_q, s) => s.end(),
    );
    expect(() => assertRoutesDeclared(r)).not.toThrow();
    expect(listRoutes(r)).toEqual([{ method: 'GET', path: '/a', access: 'public' }]);
  });
  test('a route without a declaration fails startup', () => {
    const r = express.Router();
    r.post('/forgot-to-protect', (_q, s) => s.end());
    expect(() => assertRoutesDeclared(r)).toThrow(/POST \/forgot-to-protect/);
  });
  test('nested routers are checked too', () => {
    const inner = express.Router();
    inner.delete('/x', (_q, s) => s.end());
    const outer = express.Router();
    outer.use('/inner', inner);
    expect(() => assertRoutesDeclared(outer)).toThrow(/DELETE/);
  });
});

describe('CSRF guard for cookie endpoints', () => {
  const app = express();
  app.use(cookieParser());
  app.post('/refresh', requireCsrf({ secure: false, allowedOrigins: ['http://app.test'] }), (_q, s) =>
    s.json({ ok: true }),
  );
  app.use((err, _q, s, _n) => s.status(err.status).json({ code: err.code }));

  test('allowed origin + matching header and cookie passes', async () => {
    await request(app)
      .post('/refresh')
      .set('Origin', 'http://app.test')
      .set('Cookie', 'hrms_csrf=abc123')
      .set('X-CSRF-Token', 'abc123')
      .expect(200);
  });
  test('missing or foreign origin is rejected', async () => {
    const r1 = await request(app)
      .post('/refresh')
      .set('Cookie', 'hrms_csrf=abc123')
      .set('X-CSRF-Token', 'abc123');
    expect(r1.body.code).toBe('bad_origin');
    const r2 = await request(app)
      .post('/refresh')
      .set('Origin', 'https://evil.test')
      .set('Cookie', 'hrms_csrf=abc123')
      .set('X-CSRF-Token', 'abc123');
    expect(r2.body.code).toBe('bad_origin');
  });
  test('header that does not match the cookie is rejected', async () => {
    const r = await request(app)
      .post('/refresh')
      .set('Origin', 'http://app.test')
      .set('Cookie', 'hrms_csrf=abc123')
      .set('X-CSRF-Token', 'other');
    expect(r.body.code).toBe('csrf_failed');
  });
});
