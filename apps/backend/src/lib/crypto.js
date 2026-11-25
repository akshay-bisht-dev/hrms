// @ts-check
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** @param {string | Buffer} value @returns {string} */
export const sha256Hex = (value) => createHash('sha256').update(value).digest('hex');

/**
 * Keyed hash for stored secrets (refresh tokens, one-time tokens, recovery codes).
 * @param {string} pepper @param {string} value @returns {string} 64 hex chars
 */
export const hmacHex = (pepper, value) => createHmac('sha256', pepper).update(value).digest('hex');

/** @param {number} [bytes] @returns {string} URL-safe random token */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Constant-time string comparison. @param {string} a @param {string} b */
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * AES-256-GCM with a versioned envelope: "v1" | iv(12) | tag(16) | ciphertext.
 * The key comes from DATA_ENCRYPTION_KEY locally; production swaps in KMS data keys behind the same interface.
 * @param {Buffer} key 32 bytes
 */
export function createCipher(key) {
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');
  const VERSION = Buffer.from('v1');
  return {
    /** @param {string} plaintext @param {string} [aad] associated data, e.g. the owning user id @returns {Buffer} */
    encrypt(plaintext, aad = '') {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(aad));
      const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return Buffer.concat([VERSION, iv, cipher.getAuthTag(), ct]);
    },
    /** @param {Uint8Array} blob @param {string} [aad] @returns {string} */
    decrypt(blob, aad = '') {
      const buf = Buffer.from(blob);
      if (!buf.subarray(0, 2).equals(VERSION)) throw new Error('Unknown ciphertext version');
      const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(2, 14));
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(buf.subarray(14, 30));
      return Buffer.concat([decipher.update(buf.subarray(30)), decipher.final()]).toString('utf8');
    },
  };
}
