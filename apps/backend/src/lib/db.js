// @ts-check
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { requireTenantId } from './context.js';

/**
 * Models that are not tenant-owned. Every other model MUST have a `tenantId` field;
 * test/tenant-models.test.js fails if a model is added without one and is not listed here.
 */
export const GLOBAL_MODELS = new Set([
  'User',
  'PlatformAdmin',
  'RefreshToken',
  'MfaFactor',
  'RecoveryCode',
  'AuthToken',
  'Permission',
  'Plan',
  'PlanPrice',
  'CountryProfile',
  'Currency',
  'FxRate',
  'StatutoryRulePack',
  'StatutoryRuleVersion',
  'JurisdictionPolicy',
  'PublicHolidaySet',
  'FeatureFlag',
  'PaymentWebhookEvent',
  'Tenant',
  'AuditLog',
  'OutboxEvent',
  'MessageTemplate',
]);

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

/**
 * Adds the current tenant to a create payload; rejects a payload that names another tenant.
 * @param {Record<string, unknown>} data
 * @param {string} tenantId
 */
function withTenant(data, tenantId) {
  if (data.tenantId !== undefined && data.tenantId !== tenantId) {
    throw new Error('Cross-tenant write rejected');
  }
  return { ...data, tenantId };
}

/**
 * Prisma extension that scopes every operation on tenant-owned models to the tenant in the
 * AsyncLocalStorage context (Phase 3, TEN-02/TEN-03). Fails closed when no tenant is set.
 */
export const tenantScope = Prisma.defineExtension({
  name: 'tenant-scope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (GLOBAL_MODELS.has(model)) return query(args);
        const tenantId = requireTenantId();
        /** @type {any} */
        const a = args ?? {};
        if (operation === 'create') a.data = withTenant(a.data, tenantId);
        if (operation === 'createMany' || operation === 'createManyAndReturn') {
          a.data = [].concat(a.data).map((d) => withTenant(d, tenantId));
        }
        if (WHERE_OPERATIONS.has(operation)) {
          a.where = { ...a.where, tenantId };
          if (operation === 'upsert') a.create = withTenant(a.create, tenantId);
        }
        return query(a);
      },
    },
  },
});

/** @type {PrismaClient | undefined} */
let baseClient;
/** @type {ReturnType<typeof createTenantClient> | undefined} */
let tenantClient;

/** @param {string} url @returns {PrismaClient} */
export function createBaseClient(url) {
  return new PrismaClient({ adapter: new PrismaMariaDb(url) });
}

/** @param {PrismaClient} client */
export function createTenantClient(client) {
  return client.$extends(tenantScope);
}

/** Initializes the shared clients once per process. @param {string} url */
export function initDb(url) {
  baseClient ??= createBaseClient(url);
  tenantClient ??= createTenantClient(baseClient);
}

/** Tenant-scoped client: the only client module repositories may use. */
export function db() {
  if (!tenantClient) throw new Error('Database not initialised: call initDb() at startup');
  return tenantClient;
}

/** Unscoped client for the Platform module, seeds, health checks and migrations. Callers audit their use. */
export function platformDb() {
  if (!baseClient) throw new Error('Database not initialised: call initDb() at startup');
  return baseClient;
}

export async function closeDb() {
  await baseClient?.$disconnect();
  baseClient = undefined;
  tenantClient = undefined;
}

export { Prisma };
