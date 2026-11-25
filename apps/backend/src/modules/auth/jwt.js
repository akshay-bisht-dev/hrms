// @ts-check
import { createPrivateKey, createPublicKey, createHash } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';

const ISSUER = 'hrms-api';

/** Key id = first 16 hex of SHA-256 of the SPKI DER. @param {import('node:crypto').KeyObject} pub */
const kidOf = (pub) =>
  createHash('sha256')
    .update(pub.export({ type: 'spki', format: 'der' }))
    .digest('hex')
    .slice(0, 16);

/** @param {string} b64 base64 of a PEM */
const pemFromB64 = (b64) => Buffer.from(b64, 'base64').toString('utf8');

/**
 * EdDSA (Ed25519) signer/verifier with key rotation (Phase 3, AUTH-08).
 * The current private key signs; its public key plus any previous public keys verify.
 * @param {{ privateKeyB64: string, previousPublicKeysB64?: string, region: string }} cfg
 */
export function createJwtService({ privateKeyB64, previousPublicKeysB64, region }) {
  const privateKey = createPrivateKey(pemFromB64(privateKeyB64));
  if (privateKey.asymmetricKeyType !== 'ed25519')
    throw new Error('JWT_ACCESS_PRIVATE_KEY must be an Ed25519 key');
  const currentPublic = createPublicKey(privateKey);
  const currentKid = kidOf(currentPublic);
  /** @type {Map<string, import('node:crypto').KeyObject>} */
  const verifyKeys = new Map([[currentKid, currentPublic]]);
  for (const b64 of (previousPublicKeysB64 ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const pub = createPublicKey(pemFromB64(b64));
    verifyKeys.set(kidOf(pub), pub);
  }
  // Tokens are bound to the regional cell: a token from another cell is rejected (Phase 1, 06 §3).
  const issuer = `${ISSUER}:${region}`;

  return {
    kid: currentKid,
    /**
     * @param {Record<string, unknown>} claims
     * @param {{ subject: string, audience: string, ttlSec: number }} opts
     */
    async sign(claims, { subject, audience, ttlSec }) {
      return new SignJWT(claims)
        .setProtectedHeader({ alg: 'EdDSA', kid: currentKid, typ: 'JWT' })
        .setIssuer(issuer)
        .setSubject(subject)
        .setAudience(audience)
        .setIssuedAt()
        .setJti(randomUUID())
        .setExpirationTime(`${ttlSec}s`)
        .sign(privateKey);
    },
    /**
     * @param {string} token @param {string} audience @param {Date} [currentDate] clock override for tests
     * @returns {Promise<import('jose').JWTPayload>}
     */
    async verify(token, audience, currentDate) {
      const { payload } = await jwtVerify(
        token,
        async (header) => {
          const key = header.kid ? verifyKeys.get(header.kid) : undefined;
          if (!key) throw new Error('Unknown signing key');
          return key;
        },
        { issuer, audience, algorithms: ['EdDSA'], clockTolerance: 5, currentDate },
      );
      return payload;
    },
  };
}
