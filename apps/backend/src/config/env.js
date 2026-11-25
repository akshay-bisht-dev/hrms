// @ts-check
import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

/**
 * Environment schema. Sprint 1 requires only what the foundation uses; later sprints add their keys here
 * (JWT, KMS, S3, email, payment) so a missing secret fails at startup, not at first use.
 */
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    CELL_REGION: z.string().min(2).default('local'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    FRONTEND_URL: z.url().default('http://localhost:5173'),
    CORS_ORIGINS: z.string().optional(),
    DATABASE_URL: z.string().regex(/^mysql:\/\//, 'DATABASE_URL must start with mysql://'),
    REDIS_URL: z.string().regex(/^rediss?:\/\//, 'REDIS_URL must start with redis:// or rediss://'),
    REDIS_QUEUE_URL: z
      .string()
      .regex(/^rediss?:\/\//)
      .optional(),
    ENABLE_API_DOCS: bool,
    SCREENSHOT_RETENTION_DAYS: z.coerce.number().int().min(7).max(90).default(30),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(25000),

    // ── Sprint 2: authentication ──
    /** Base URL used in emailed links (verification, password reset). */
    APP_URL: z.url().optional(),
    /** base64 of the Ed25519 private key PEM (PKCS#8). Generate: npm run keys:dev -w apps/backend */
    JWT_ACCESS_PRIVATE_KEY: z.string().min(40),
    /** Comma-separated base64 SPKI PEMs of previous keys still accepted during rotation (optional). */
    JWT_ACCESS_PUBLIC_KEYS: z.string().optional(),
    /** Secret mixed into refresh/one-time token hashes so a leaked DB alone can't be replayed. */
    JWT_REFRESH_PEPPER: z.string().min(32),
    /** base64 of 32 random bytes; encrypts MFA secrets (local stand-in for KMS envelope keys). */
    DATA_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be base64 of 32 bytes'),
    ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_IDLE_TTL_SEC: z.coerce.number().int().min(300).default(86400),
    REFRESH_ABSOLUTE_TTL_SEC: z.coerce.number().int().min(3600).default(1209600),
    COOKIE_SECURE: bool,
    MFA_ISSUER: z.string().min(1).max(60).default('Workforce HRMS'),
    /** Enforce MFA for anyone holding a sensitive permission (Phase 3, AUTH-07). */
    MFA_ENFORCE_FOR_SENSITIVE: bool,
    /** Breached-password check: 'hibp' sends only the first 5 SHA-1 hex characters (k-anonymity). */
    PASSWORD_BREACH_CHECK: z.enum(['off', 'hibp']).default('off'),
    TRIAL_DAYS: z.coerce.number().int().min(0).max(90).default(14),
    /** Per-IP limit on sign-in endpoints. Offices share one IP, so per-account lockout is the main brute-force control. */
    AUTH_IP_LIMIT_PER_MIN: z.coerce.number().int().min(5).max(10000).default(60),
    /** Per-IP limit on endpoints that send email (register, forgot password, resend). */
    // ── Sprint 4: object storage (S3; SeaweedFS locally) ──
    AWS_REGION: z.string().min(1).default('ap-south-1'),
    /** Only for S3-compatible stores (local SeaweedFS). Empty in AWS. */
    S3_ENDPOINT: z.url().optional(),
    /** Explicit keys for the local S3-compatible store, so ambient AWS credentials are never used against it. */
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_BUCKET_DOCUMENTS: z.string().min(3).default('hrms-documents'),
    S3_BUCKET_REPORTS: z.string().min(3).default('hrms-reports'),
    S3_BUCKET_SCREENSHOTS: z.string().min(3).default('hrms-screenshots'),
    AUTH_EMAIL_IP_LIMIT_PER_HOUR: z.coerce.number().int().min(3).max(10000).default(30),
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === 'production' && e.COOKIE_SECURE === false) {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'must be true in production' });
    }
  });

/** @typedef {z.infer<typeof EnvSchema>} Env */

/**
 * `KEY=` lines in .env files arrive as empty strings; treat them as unset so defaults apply
 * (otherwise an empty CORS_ORIGINS would silently allow no origins).
 * @param {Record<string, string | undefined>} source
 * @returns {Record<string, string>}
 */
export function withoutEmpty(source) {
  return Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''));
}

/**
 * Parses and freezes an environment object. Throws one readable error listing every problem.
 * @param {Record<string, string | undefined>} source
 * @returns {Readonly<Env>}
 */
export function loadEnv(source) {
  const result = EnvSchema.safeParse(withoutEmpty(source));
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return Object.freeze(result.data);
}

/** @type {Readonly<Env> | undefined} */
let cached;

/** @returns {Readonly<Env>} validated process environment (memoized) */
export function env() {
  cached ??= loadEnv(process.env);
  return cached;
}

/** Secure cookies: forced in production, configurable for plain-HTTP localhost. @param {Readonly<Env>} e */
export function cookieSecure(e) {
  return e.COOKIE_SECURE ?? e.NODE_ENV === 'production';
}

/** @param {Readonly<Env>} e */
export function appUrl(e) {
  return (e.APP_URL ?? e.FRONTEND_URL).replace(/\/$/, '');
}

/** @param {Readonly<Env>} e @returns {string[]} allowed browser origins */
export function corsOrigins(e) {
  return (e.CORS_ORIGINS ?? e.FRONTEND_URL)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
