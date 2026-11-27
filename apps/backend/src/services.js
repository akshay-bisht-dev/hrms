// @ts-check
import { cookieSecure, corsOrigins } from './config/env.js';
import { createCipher } from './lib/crypto.js';
import { platformDb } from './lib/db.js';
import { access } from './middleware/auth.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { createJwtService } from './modules/auth/jwt.js';
import { createMembersService } from './modules/members/members.service.js';
import { hkdfSync } from 'node:crypto';
import { createS3, storage } from './lib/storage.js';
import { createEmployeesService } from './modules/employees/employees.service.js';
import { createImportsService } from './modules/employees/imports.js';
import { createAttendanceService } from './modules/attendance/attendance.service.js';
import { createLeaveService } from './modules/leave/leave.service.js';

/**
 * Builds module services from infrastructure clients. Shared by server.js and the integration tests,
 * so tests exercise exactly the production wiring.
 * @param {{ env: Readonly<import('./config/env.js').Env>, logger: import('pino').Logger, redis: import('ioredis').Redis,
 *           queues: { notifications: import('bullmq').Queue, files?: import('bullmq').Queue, imports?: import('bullmq').Queue, workSessions?: import('bullmq').Queue },
 *           breachCheck?: (pw: string) => Promise<boolean>, files?: ReturnType<typeof storage> }} infra
 */
export function buildServices({ env, logger, redis, queues, breachCheck, files }) {
  const jwt = createJwtService({
    privateKeyB64: env.JWT_ACCESS_PRIVATE_KEY,
    previousPublicKeysB64: env.JWT_ACCESS_PUBLIC_KEYS,
    region: env.CELL_REGION,
  });
  const cipher = createCipher(Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64'));
  const accessControl = access({ jwt, platformDb, redis, mfaEnforce: env.MFA_ENFORCE_FOR_SENSITIVE ?? true });
  const auth = createAuthService({ env, platformDb, jwt, redis, queues, cipher, logger, breachCheck });
  const files_ = files ?? storage(createS3(env));
  const buckets = { documents: env.S3_BUCKET_DOCUMENTS, reports: env.S3_BUCKET_REPORTS };
  const employees = createEmployeesService({
    cipher,
    blindIndexKey: blindIndexKeyFrom(env),
    files: files_,
    buckets,
    queues,
    redis,
    revokeMember: (userId, tenantId, reason) => auth.revokeUserSessionsInTenant(userId, tenantId, reason),
  });
  const imports = createImportsService({ employees, files: files_, buckets, queues });
  const members = createMembersService({ env, auth, redis, queues, employees });
  const attendance = createAttendanceService({ queues });
  const leave = createLeaveService({ attendance, queues });
  return {
    jwt,
    auth,
    members,
    employees,
    imports,
    attendance,
    leave,
    files: files_,
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
      membersRoutes: { access: accessControl, members, employees },
      employeesRoutes: { access: accessControl, employees, imports },
      attendanceRoutes: { access: accessControl, attendance },
      leaveRoutes: { access: accessControl, leave },
    },
  };
}

/**
 * Key for blind indexes (searchable hashes of encrypted values), derived from the data key so no extra secret is
 * needed locally; production can supply a separate key through the same function (Phase 3, CRY-04).
 * @param {{ DATA_ENCRYPTION_KEY: string }} env
 */
export function blindIndexKeyFrom(env) {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64'),
      Buffer.alloc(0),
      'hrms/blind-index/v1',
      32,
    ),
  );
}
