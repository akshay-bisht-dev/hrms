// @ts-check
import argon2 from 'argon2';
import { createHash } from 'node:crypto';

/** Argon2id parameters (Phase 3, AUTH-01). Stored inside each hash, so they can be raised later. */
export const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
});

/** NFKC so the same password typed on different keyboards/OSes hashes the same. @param {string} pw */
const normalize = (pw) => pw.normalize('NFKC');

/** @param {string} password */
export const hashPassword = (password) => argon2.hash(normalize(password), ARGON2_OPTIONS);

/** @param {string} hash @param {string} password */
export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, normalize(password));
  } catch {
    return false;
  }
}

/** @param {string} hash */
export const needsRehash = (hash) => argon2.needsRehash(hash, ARGON2_OPTIONS);

/** A real hash of a random string, verified when the user doesn't exist so timing doesn't reveal accounts. */
let dummy;
export async function verifyAgainstDummy() {
  dummy ??= await argon2.hash(
    createHash('sha256').update(String(Math.random())).digest('hex'),
    ARGON2_OPTIONS,
  );
  await verifyPassword(dummy, 'not-the-password');
  return false;
}

const COMMON = new Set([
  'password1234',
  '123456789012',
  'qwertyuiopas',
  'passwordpassword',
  'letmein12345',
  'welcome12345',
  'adminadmin12',
]);

/**
 * Policy beyond length: not a very common password, not the email or company name.
 * @param {string} password @param {{ email?: string, companyName?: string }} ctx
 * @returns {string | null} message when rejected
 */
export function passwordPolicyProblem(password, { email, companyName } = {}) {
  const p = normalize(password).toLowerCase();
  if (COMMON.has(p)) return 'This password is too common';
  const local = email ? email.split('@')[0].toLowerCase() : '';
  if (email && (p === email.toLowerCase() || (local.length >= 6 && p.includes(local)))) {
    return "Don't use your email address in your password";
  }
  if (companyName && companyName.length >= 4 && p.includes(companyName.toLowerCase()))
    return "Don't use your company name in your password";
  if (/^(.)\1+$/.test(p)) return "Don't repeat a single character";
  return null;
}

/**
 * Have I Been Pwned range query: only the first 5 hex chars of the SHA-1 leave this server (Phase 3, AUTH-06).
 * Fails open (returns false) on network errors so an outage can't block sign-ups; the failure is logged by the caller.
 * @param {string} password
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<boolean>} true when the password appears in known breaches
 */
export async function isBreachedPassword(password, fetchImpl = fetch) {
  const sha1 = createHash('sha1').update(normalize(password)).digest('hex').toUpperCase();
  const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, {
    headers: { 'Add-Padding': 'true', 'User-Agent': 'hrms-password-check' },
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new Error(`breach check HTTP ${res.status}`);
  const suffix = sha1.slice(5);
  return (await res.text()).split('\n').some((line) => {
    const [hashSuffix, count] = line.trim().split(':');
    return hashSuffix === suffix && Number(count) > 0;
  });
}
