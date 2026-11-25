import { jest } from '@jest/globals';
import { apiFetch, ApiError } from '../src/services/api';

afterEach(() => {
  delete global.fetch;
});

test('parses problem+json into ApiError', async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: false,
      status: 422,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            code: 'validation_failed',
            title: 'Some fields are invalid',
            requestId: 'r1',
            errors: [{ path: 'body.name', message: 'Required' }],
          }),
        ),
    }),
  );
  const err = await apiFetch('/api/v1/x', { method: 'POST', json: {} }).catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status: 422, code: 'validation_failed', requestId: 'r1' });
  expect(err.errors[0].path).toBe('body.name');
});

test('sends JSON bodies with the right content type', async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"ok":true}') }),
  );
  await expect(apiFetch('/api/v1/x', { method: 'POST', json: { a: 1 } })).resolves.toEqual({ ok: true });
  const [, init] = global.fetch.mock.calls[0];
  expect(init.headers['Content-Type']).toBe('application/json');
  expect(init.body).toBe('{"a":1}');
});

test('non-JSON error bodies still produce an ApiError', async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: false, status: 502, text: () => Promise.resolve('<html>Bad gateway</html>') }),
  );
  const err = await apiFetch('/health/ready').catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err.status).toBe(502);
});
