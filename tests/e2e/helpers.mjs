import { createHmac } from 'node:crypto';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

/** Waits for the newest email to `to` whose subject matches, and returns its plain-text body. */
export async function waitForEmail(to, subjectRe, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages = [] } = await res.json();
    const hit = messages.find((m) => subjectRe.test(m.Subject));
    if (hit) {
      const msg = await (await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json();
      return msg.Text;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No email matching ${subjectRe} for ${to}`);
}

/** First URL in a text body that contains `path`. */
export const linkIn = (text, path) => text.match(new RegExp(`https?://\\S*${path}\\S*`))[0];

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const base32Decode = (s) => {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of s.toUpperCase()) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

/** The TOTP an authenticator app would show (RFC 6238), optionally for a later 30-second step. */
export function totp(secret, stepOffset = 0) {
  const step = Math.floor(Date.now() / 30_000) + stepOffset;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = mac[mac.length - 1] & 0xf;
  const bin = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}
