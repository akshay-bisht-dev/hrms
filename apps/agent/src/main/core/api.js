// @ts-check
/**
 * HTTPS client for the agent API. The access token lives in memory only; the refresh token is kept by the token
 * store (OS-encrypted). A 401 with an expired token refreshes once and retries; a revoked device or reused token
 * wipes the credentials and stops everything.
 */

export class RevokedError extends Error {
  /** @param {string} code */
  constructor(code) {
    super('This computer was disconnected. Pair it again from the web app.');
    this.code = code;
  }
}
export class ApiError extends Error {
  /** @param {number} status @param {any} body */
  constructor(status, body) {
    super(body?.title ?? `Request failed (${status})`);
    this.status = status;
    this.code = body?.code ?? 'http_error';
  }
}

/**
 * @param {{ baseUrl: string, tokens: { get: () => Promise<any>, save: (t: any) => Promise<void>, clear: () => Promise<void> },
 *           fetchImpl?: typeof fetch }} deps
 */
export function createApi({ baseUrl, tokens, fetchImpl = fetch }) {
  if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl))
    throw new Error('The API address must use HTTPS (plain HTTP is allowed only for localhost development)');
  /** @type {string | null} */
  let accessToken = null;

  const call = async (
    /** @type {string} */ method,
    /** @type {string} */ path,
    /** @type {any} */ body,
    /** @type {string | null} */ bearer,
  ) => {
    const res = await fetchImpl(`${baseUrl}/api/v1${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    return { status: res.status, data };
  };

  async function refresh() {
    const t = await tokens.get();
    if (!t?.refreshToken) throw new RevokedError('not_paired');
    const r = await call('POST', '/devices/token/refresh', { refreshToken: t.refreshToken }, null);
    if (r.status === 401) {
      await tokens.clear();
      accessToken = null;
      throw new RevokedError(r.data?.code ?? 'invalid_token');
    }
    if (r.status >= 400) throw new ApiError(r.status, r.data);
    await tokens.save({ ...t, refreshToken: r.data.refreshToken });
    accessToken = r.data.accessToken;
  }

  /** @param {string} method @param {string} path @param {any} [body] */
  async function request(method, path, body) {
    if (!accessToken) await refresh();
    let r = await call(method, path, body, accessToken);
    if (r.status === 401 && r.data?.code === 'invalid_token') {
      await refresh();
      r = await call(method, path, body, accessToken);
    }
    if (r.status === 401) {
      await tokens.clear();
      accessToken = null;
      throw new RevokedError(r.data?.code ?? 'device_revoked');
    }
    if (r.status >= 400) throw new ApiError(r.status, r.data);
    return r.data;
  }

  return {
    request,
    /** Pairs this computer with a code from the web app. @param {string} code @param {any} facts */
    async register(code, facts) {
      const r = await call('POST', '/devices/register', { code, ...facts }, null);
      if (r.status >= 400) throw new ApiError(r.status, r.data);
      await tokens.save({ deviceId: r.data.deviceId, refreshToken: r.data.refreshToken });
      accessToken = r.data.accessToken;
      return r.data;
    },
    async signOut() {
      accessToken = null;
      await tokens.clear();
    },
    /** Uploads bytes to a presigned URL (straight to private storage; never through the API). @param {{ url: string, headers: Record<string, string> }} upload @param {Buffer} body */
    async upload(upload, body) {
      if (!/^https:\/\//.test(upload.url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(upload.url))
        throw new Error('Refusing to upload over plain HTTP');
      const res = await fetchImpl(upload.url, {
        method: 'PUT',
        headers: upload.headers,
        body: new Uint8Array(body),
      });
      if (!res.ok) throw new ApiError(res.status, null);
    },
  };
}
