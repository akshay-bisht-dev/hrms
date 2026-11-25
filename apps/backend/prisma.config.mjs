// Prisma CLI configuration (JavaScript). Prisma 7 does not read .env by itself, so load it when present.
import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

const envFile = new URL('../../.env', import.meta.url).pathname;
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);

export default defineConfig({
  schema: 'prisma/schema',
  migrations: { path: 'prisma/migrations' },
  // A placeholder keeps `prisma generate` / `validate` working without a database (e.g. on `npm install`).
  datasource: {
    url: process.env.DATABASE_URL ?? 'mysql://placeholder:placeholder@localhost:3306/placeholder',
  },
});
