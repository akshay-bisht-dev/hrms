// @ts-check
import { createHmac, randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 (no padding). @param {Buffer} buf */
export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** @param {string} str */
export function base32Decode(str) {
  const clean = str.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret, base32 — the size RFC 4226 recommends for HMAC-SHA1. */
export const generateTotpSecret = () => base32Encode(randomBytes(20));

/**
 * HOTP value (RFC 4226) for a counter.
 * @param {Buffer} key @param {number} counter @param {number} [digits]
 */
export function hotp(key, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(msg).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const bin =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** Time step (RFC 6238, 30 s). @param {number} nowMs */
export const totpStep = (nowMs) => Math.floor(nowMs / 1000 / 30);

/**
 * Verifies a TOTP code within ±1 step and rejects reuse of a step already accepted (replay protection).
 * @param {{ secret: string, code: string, nowMs?: number, lastUsedStep?: bigint | number | null }} args
 * @returns {{ ok: true, step: number } | { ok: false }}
 */
export function verifyTotp({ secret, code, nowMs = Date.now(), lastUsedStep = null }) {
  const key = base32Decode(secret);
  const current = totpStep(nowMs);
  for (const step of [current - 1, current, current + 1]) {
    if (lastUsedStep !== null && lastUsedStep !== undefined && step <= Number(lastUsedStep)) continue;
    if (hotp(key, step) === code) return { ok: true, step };
  }
  return { ok: false };
}

/**
 * otpauth:// URI for authenticator apps (shown as a QR code).
 * @param {{ issuer: string, account: string, secret: string }} args
 */
export function otpauthUri({ issuer, account, secret }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params}`;
}
