import { generateKeyPairSync } from 'node:crypto';
import { SignJWT } from 'jose';
import {
  base32Decode,
  base32Encode,
  hotp,
  verifyTotp,
  otpauthUri,
  totpStep,
} from '../src/modules/auth/totp.js';
import { createCipher, hmacHex, safeEqual } from '../src/lib/crypto.js';
import { createJwtService } from '../src/modules/auth/jwt.js';
import {
  hashPassword,
  verifyPassword,
  passwordPolicyProblem,
  isBreachedPassword,
} from '../src/modules/auth/password.js';
import { mergeGrants, isSensitivePermission } from '../src/modules/rbac/access.js';

const keyB64 = () =>
  Buffer.from(generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' })).toString(
    'base64',
  );

describe('TOTP (RFC 4226 / RFC 6238)', () => {
  const rfcSecret = base32Encode(Buffer.from('12345678901234567890'));
  test('base32 round-trips', () => {
    expect(base32Decode(rfcSecret).toString()).toBe('12345678901234567890');
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });
  test('HOTP matches RFC 4226 appendix D', () => {
    const key = Buffer.from('12345678901234567890');
    expect([0, 1, 2, 9].map((c) => hotp(key, c))).toEqual(['755224', '287082', '359152', '520489']);
  });
  test('TOTP matches RFC 6238 appendix B (SHA-1, last 6 digits)', () => {
    const key = Buffer.from('12345678901234567890');
    expect(hotp(key, totpStep(59_000), 8)).toBe('94287082');
    expect(hotp(key, totpStep(1111111109_000), 8)).toBe('07081804');
    expect(hotp(key, totpStep(20000000000_000), 8)).toBe('65353130');
  });
  test('accepts ±1 step and rejects replay of an already-used step', () => {
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    const key = base32Decode(rfcSecret);
    const code = hotp(key, step - 1);
    const first = verifyTotp({ secret: rfcSecret, code, nowMs: now });
    expect(first).toEqual({ ok: true, step: step - 1 });
    expect(verifyTotp({ secret: rfcSecret, code, nowMs: now, lastUsedStep: step - 1 })).toEqual({
      ok: false,
    });
    expect(verifyTotp({ secret: rfcSecret, code: hotp(key, step - 2), nowMs: now }).ok).toBe(false);
  });
  test('otpauth URI is well-formed', () => {
    const uri = otpauthUri({ issuer: 'Workforce HRMS', account: 'p@example.com', secret: 'ABC' });
    expect(uri).toMatch(
      /^otpauth:\/\/totp\/Workforce%20HRMS%3Ap%40example\.com\?secret=ABC&issuer=Workforce\+HRMS/,
    );
  });
});

describe('crypto', () => {
  const cipher = createCipher(Buffer.alloc(32, 7));
  test('AES-GCM round-trips and binds associated data', () => {
    const blob = cipher.encrypt('JBSWY3DPEHPK3PXP', 'user-1');
    expect(cipher.decrypt(blob, 'user-1')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => cipher.decrypt(blob, 'user-2')).toThrow();
  });
  test('tampering is detected', () => {
    const blob = cipher.encrypt('secret', 'a');
    blob[blob.length - 1] ^= 1;
    expect(() => cipher.decrypt(blob, 'a')).toThrow();
  });
  test('the same plaintext encrypts differently each time', () => {
    expect(cipher.encrypt('x').equals(cipher.encrypt('x'))).toBe(false);
  });
  test('hmac and constant-time compare', () => {
    expect(hmacHex('pepper', 'token')).toHaveLength(64);
    expect(hmacHex('pepper', 'token')).not.toBe(hmacHex('other', 'token'));
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('JWT service', () => {
  const svc = createJwtService({ privateKeyB64: keyB64(), region: 'in' });
  test('signs and verifies with audience, issuer and kid', async () => {
    const t = await svc.sign(
      { tid: 't1', sid: 's1', mfa: false },
      { subject: 'u1', audience: 'web', ttlSec: 60 },
    );
    const claims = await svc.verify(t, 'web');
    expect(claims).toMatchObject({ sub: 'u1', tid: 't1', sid: 's1', iss: 'hrms-api:in', aud: 'web' });
    expect(JSON.parse(Buffer.from(t.split('.')[0], 'base64url')).kid).toBe(svc.kid);
  });
  test('rejects wrong audience (an MFA challenge is not an access token)', async () => {
    const t = await svc.sign({}, { subject: 'u1', audience: 'mfa-challenge', ttlSec: 60 });
    await expect(svc.verify(t, 'web')).rejects.toThrow();
  });
  test('rejects tokens from another regional cell and from unknown keys', async () => {
    const other = createJwtService({ privateKeyB64: keyB64(), region: 'eu' });
    await expect(
      svc.verify(await other.sign({}, { subject: 'u', audience: 'web', ttlSec: 60 }), 'web'),
    ).rejects.toThrow();
  });
  test('rejects expired tokens', async () => {
    const t = await svc.sign({}, { subject: 'u1', audience: 'web', ttlSec: 1 });
    await expect(svc.verify(t, 'web', new Date(Date.now() + 10_000))).rejects.toThrow();
    await expect(svc.verify(t, 'web')).resolves.toBeTruthy();
  });
  test('rejects alg=none and HS256 forgeries', async () => {
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', kid: svc.kid })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'u', aud: 'web', iss: 'hrms-api:in' })).toString('base64url')}.`;
    await expect(svc.verify(none, 'web')).rejects.toThrow();
    const hs = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256', kid: svc.kid })
      .setAudience('web')
      .setIssuer('hrms-api:in')
      .setSubject('u')
      .setExpirationTime('1m')
      .sign(new TextEncoder().encode('x'.repeat(32)));
    await expect(svc.verify(hs, 'web')).rejects.toThrow();
  });
  test('key rotation: tokens from the previous key still verify', async () => {
    const oldKey = keyB64();
    const oldSvc = createJwtService({ privateKeyB64: oldKey, region: 'in' });
    const { createPublicKey, createPrivateKey } = await import('node:crypto');
    const oldPub = Buffer.from(
      createPublicKey(createPrivateKey(Buffer.from(oldKey, 'base64').toString())).export({
        type: 'spki',
        format: 'pem',
      }),
    ).toString('base64');
    const newSvc = createJwtService({ privateKeyB64: keyB64(), previousPublicKeysB64: oldPub, region: 'in' });
    const t = await oldSvc.sign({}, { subject: 'u', audience: 'web', ttlSec: 60 });
    await expect(newSvc.verify(t, 'web')).resolves.toMatchObject({ sub: 'u' });
  });
});

describe('passwords', () => {
  test('Argon2id hash verifies, normalizes Unicode, rejects wrong password', async () => {
    const h = await hashPassword('correct horse ﬁ battery');
    expect(h).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    expect(await verifyPassword(h, 'correct horse fi battery')).toBe(true); // NFKC: ﬁ → fi
    expect(await verifyPassword(h, 'wrong horse battery')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
  test('policy blocks common, email-based and company-based passwords', () => {
    expect(passwordPolicyProblem('password1234')).toMatch(/common/);
    expect(passwordPolicyProblem('priyasharma-2026', { email: 'priyasharma@example.com' })).toMatch(/email/);
    expect(passwordPolicyProblem('acmesoftware99', { companyName: 'AcmeSoftware' })).toMatch(/company/);
    expect(passwordPolicyProblem('aaaaaaaaaaaa')).toMatch(/repeat/);
    expect(passwordPolicyProblem('violet-tractor-91-lamp')).toBeNull();
  });
  test('breach check sends only a 5-character hash prefix', async () => {
    let calledUrl;
    const fakeFetch = async (url) => {
      calledUrl = url;
      // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
      return {
        ok: true,
        text: async () =>
          '1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\n0018A45C4D1DEF81644B54AB7F969B88D65:0',
      };
    };
    expect(await isBreachedPassword('password', fakeFetch)).toBe(true);
    expect(calledUrl).toBe('https://api.pwnedpasswords.com/range/5BAA6');
    expect(await isBreachedPassword('a-unique-passphrase-xyz', fakeFetch)).toBe(false);
  });
});

describe('RBAC grants', () => {
  test('broadest scope wins when roles overlap', () => {
    expect(
      mergeGrants([
        { permissionCode: 'leave.request.approve', scope: 'TEAM' },
        { permissionCode: 'leave.request.approve', scope: 'DEPARTMENT' },
        { permissionCode: 'attendance.view', scope: 'OWN' },
      ]),
    ).toEqual({ 'leave.request.approve': 'DEPARTMENT', 'attendance.view': 'OWN' });
  });
  test('sensitive permission lookup', () => {
    expect(isSensitivePermission('view_team_screenshots')).toBe(true);
    expect(isSensitivePermission('attendance.view')).toBe(false);
  });
});
