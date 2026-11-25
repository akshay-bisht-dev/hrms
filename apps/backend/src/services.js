// @ts-check
import { cookieSecure, corsOrigins } from './config/env.js';
import { createCipher } from './lib/crypto.js';
import { platformDb } from './lib/db.js';
import { access } from './middleware/auth.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { createJwtService } from './modules/auth/jwt.js';
import { createMembersService } from './modules/members/members.service.js';

/**
 * Builds module services from infrastructure clients. Shared by server.js and the integration tests,
 * so tests exercise exactly the production wiring.
 * @param {{ env: Readonly<import('./config/env.js').Env>, logger: import('pino').Logger, redis: import('ioredis').Redis,
 *           queues: { notifications: import('bullmq').Queue }, breachCheck?: (pw: string) => Promise<boolean> }} infra
 */
export function buildServices({ env, logger, redis, queues, breachCheck }) {
  const jwt = createJwtService({
    privateKeyB64: env.JWT_ACCESS_PRIVATE_KEY,
    previousPublicKeysB64: env.JWT_ACCESS_PUBLIC_KEYS,
    region: env.CELL_REGION,
  });
  const cipher = createCipher(Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64'));
  const accessControl = access({ jwt, platformDb, redis, mfaEnforce: env.MFA_ENFORCE_FOR_SENSITIVE ?? true });
  const auth = createAuthService({ env, platformDb, jwt, redis, queues, cipher, logger, breachCheck });
  const members = createMembersService({ env, auth, redis, queues });
  return {
    jwt,
    auth,
    members,
    access: accessControl,
    routes: {
      authRoutes: {
        auth,
        access: accessControl,
        env,
        secureCookies: cookieSecure(env),
        allowedOrigins: corsOrigins(env),
        redis,
      },
      referenceRoutes: { access: accessControl, platformDb },
      companyRoutes: { access: accessControl },
      membersRoutes: { access: accessControl, members },
    },
  };
}
