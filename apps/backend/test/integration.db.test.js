// Integration tests: need DATABASE_URL pointing at a migrated, disposable database (CI service / local Docker).
import { initDb, db, platformDb, closeDb } from '../src/lib/db.js';
import { runWithContext } from '../src/lib/context.js';
import { newId } from '@hrms/shared';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required for integration tests');

beforeAll(() => initDb(url));
afterAll(() => closeDb());

async function makeTenant(slug) {
  const p = platformDb();
  await p.countryProfile.upsert({
    where: { code: 'IN' },
    create: {
      code: 'IN',
      name: 'India',
      defaultCurrency: 'INR',
      defaultLocale: 'en-IN',
      weekendDays: [0],
      fieldRules: {},
      nationalIdTypes: [],
      bankFieldFormat: {},
      addressFormat: {},
    },
    update: {},
  });
  return p.tenant.create({
    data: {
      id: newId(),
      slug: `${slug}-${Date.now()}`,
      name: slug,
      region: 'local',
      countryCode: 'IN',
      defaultCurrency: 'INR',
      timezone: 'Asia/Kolkata',
    },
  });
}

describe('tenant-scoped Prisma client (integration)', () => {
  let a;
  let b;
  beforeAll(async () => {
    a = await makeTenant('ta');
    b = await makeTenant('tb');
  });
  // Prisma queries are lazy: they must be awaited INSIDE the context, so the helper awaits.
  const asTenant = (tenantId, fn) => runWithContext({ requestId: 'test', tenantId }, async () => await fn());

  test('create injects the tenant from context', async () => {
    const dept = await asTenant(a.id, () =>
      db().department.create({
        data: { id: newId(), name: 'Engineering', code: `ENG${Date.now() % 100000}` },
      }),
    );
    expect(dept.tenantId).toBe(a.id);
  });

  test('reads are scoped: tenant B cannot see tenant A rows, even by primary key', async () => {
    const dept = await asTenant(a.id, () =>
      db().department.create({ data: { id: newId(), name: 'Sales', code: `SAL${Date.now() % 100000}` } }),
    );
    const fromB = await asTenant(b.id, () => db().department.findUnique({ where: { id: dept.id } }));
    expect(fromB).toBeNull();
    const listB = await asTenant(b.id, () => db().department.findMany({ where: { id: dept.id } }));
    expect(listB).toEqual([]);
  });

  test('updates and deletes cannot reach another tenant', async () => {
    const dept = await asTenant(a.id, () =>
      db().department.create({ data: { id: newId(), name: 'Ops', code: `OPS${Date.now() % 100000}` } }),
    );
    await expect(
      asTenant(b.id, () => db().department.update({ where: { id: dept.id }, data: { name: 'Hacked' } })),
    ).rejects.toThrow();
    const res = await asTenant(b.id, () => db().department.deleteMany({ where: { id: dept.id } }));
    expect(res.count).toBe(0);
    const still = await asTenant(a.id, () => db().department.findUnique({ where: { id: dept.id } }));
    expect(still.name).toBe('Ops');
  });

  test('a create that names another tenant is rejected', async () => {
    await expect(
      asTenant(b.id, () =>
        db().department.create({ data: { id: newId(), tenantId: a.id, name: 'X', code: 'X1' } }),
      ),
    ).rejects.toThrow(/Cross-tenant/);
  });

  test('querying a tenant model without tenant context fails closed', async () => {
    await expect(
      runWithContext({ requestId: 'test' }, async () => await db().department.findMany()),
    ).rejects.toThrow(/Tenant context required/);
  });

  test('global models work without tenant context', async () => {
    const n = await runWithContext({ requestId: 'test' }, async () => await db().countryProfile.count());
    expect(n).toBeGreaterThan(0);
  });
});
