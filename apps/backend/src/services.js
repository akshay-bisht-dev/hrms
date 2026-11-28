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
import { createPayrollConfigService } from './modules/payroll/config.service.js';
import { createPayrollRunService } from './modules/payroll/run.service.js';
import { createWorkService } from './modules/work/work.service.js';
import { createTasksService } from './modules/tasks/tasks.service.js';
import { createTimesheetsService } from './modules/timesheets/timesheets.service.js';
import { createDashboardsService } from './modules/dashboards/dashboards.service.js';
import { createGovernanceService } from './modules/monitoring/governance.service.js';
import { createDevicesService, deviceAccess } from './modules/monitoring/devices.service.js';
import { createScreenshotsService } from './modules/monitoring/screenshots.service.js';

/**
 * Builds module services from infrastructure clients. Shared by server.js and the integration tests,
 * so tests exercise exactly the production wiring.
 * @param {{ env: Readonly<import('./config/env.js').Env>, logger: import('pino').Logger, redis: import('ioredis').Redis,
 *           queues: { notifications: import('bullmq').Queue, files?: import('bullmq').Queue, imports?: import('bullmq').Queue, workSessions?: import('bullmq').Queue, screenshots?: import('bullmq').Queue },
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
  const payrollConfig = createPayrollConfigService();
  const payrollRuns = createPayrollRunService({
    config: payrollConfig,
    cipher,
    files: files_,
    buckets,
    queues,
  });
  const work = createWorkService({ attendance, mfaEnforce: env.MFA_ENFORCE_FOR_SENSITIVE ?? true });
  const tasks = createTasksService();
  const timesheets = createTimesheetsService({ work, mfaEnforce: env.MFA_ENFORCE_FOR_SENSITIVE ?? true });
  const dashboards = createDashboardsService({ work, tasks, timesheets });
  const mfaEnforce = env.MFA_ENFORCE_FOR_SENSITIVE ?? true;
  const governance = createGovernanceService();
  const devices = createDevicesService({ jwt, governance });
  const screenshots = createScreenshotsService({
    governance,
    files: files_,
    bucket: env.S3_BUCKET_SCREENSHOTS,
    queues: { screenshots: queues.screenshots },
    mfaEnforce,
  });
  const device = deviceAccess({ jwt });
  return {
    jwt,
    auth,
    members,
    employees,
    imports,
    attendance,
    leave,
    payrollConfig,
    payrollRuns,
    work,
    tasks,
    timesheets,
    dashboards,
    governance,
    devices,
    screenshots,
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
      payrollRoutes: { access: accessControl, config: payrollConfig, runs: payrollRuns },
      workRoutes: { access: accessControl, work },
      projectsRoutes: { access: accessControl, tasks },
      tasksRoutes: { access: accessControl, tasks },
      workReportsRoutes: { access: accessControl, timesheets },
      timesheetsRoutes: { access: accessControl, timesheets },
      dashboardsRoutes: { access: accessControl, dashboards },
      monitoringRoutes: { access: accessControl, governance },
      devicesRoutes: {
        access: accessControl,
        devices,
        redis,
        registerLimitPerMin: env.AUTH_IP_LIMIT_PER_MIN,
      },
      agentRoutes: { device, governance, work, screenshots },
      screenshotsRoutes: { access: accessControl, screenshots },
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
