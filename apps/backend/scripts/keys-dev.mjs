// Generates local development secrets and writes them into the repo-root .env when they are empty.
// Never use these for production: production keys live in AWS Secrets Manager.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const envPath = new URL('../../../.env', import.meta.url).pathname;
if (!existsSync(envPath)) {
  console.error('No .env found. Run: cp .env.example .env');
  process.exit(1);
}
const { privateKey } = generateKeyPairSync('ed25519');
const values = {
  JWT_ACCESS_PRIVATE_KEY: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64'),
  JWT_REFRESH_PEPPER: randomBytes(32).toString('base64url'),
  DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};

let text = readFileSync(envPath, 'utf8');
const written = [];
for (const [key, value] of Object.entries(values)) {
  const re = new RegExp(`^${key}=(.*)$`, 'm');
  const m = text.match(re);
  if (m && m[1].trim() !== '') continue; // keep existing secrets
  text = m ? text.replace(re, `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
  written.push(key);
}
writeFileSync(envPath, text);
console.log(
  written.length
    ? `Wrote ${written.join(', ')} to .env`
    : 'All development secrets already set; nothing changed.',
);
