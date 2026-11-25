import { readFileSync, readdirSync } from 'node:fs';
import { GLOBAL_MODELS } from '../src/lib/db.js';

// Prisma 7's runtime DMMF omits required/unique flags, so the guard reads the schema source directly.
const dir = new URL('../prisma/schema/', import.meta.url);
const source = readdirSync(dir)
  .filter((f) => f.endsWith('.prisma'))
  .map((f) => readFileSync(new URL(f, dir), 'utf8'))
  .join('\n');

const models = [...source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map(([, name, body]) => ({
  name,
  requiredTenantId: /^\s*tenantId\s+String\s/m.test(body),
  hasId: /^\s*id\s+\S+\s+@id/m.test(body),
  tenantUniqueId: /@@unique\(\[tenantId, id\]\)/.test(body),
}));

describe('tenant model guard (TEN-04)', () => {
  test('schema parsed', () => {
    expect(models.length).toBeGreaterThan(100);
  });

  test('every model outside the global allowlist has a required tenantId', () => {
    const missing = models
      .filter((m) => !GLOBAL_MODELS.has(m.name) && !m.requiredTenantId)
      .map((m) => m.name);
    expect(missing).toEqual([]);
  });

  test('tenant models with an id that lack UNIQUE(tenantId, id) are reviewed leaf tables', () => {
    // Nothing may reference these by composite FK. Adding a model here is a reviewed change (snapshot diff).
    const leaf = models
      .filter((m) => !GLOBAL_MODELS.has(m.name) && m.hasId && !m.tenantUniqueId)
      .map((m) => m.name)
      .sort();
    expect(leaf).toMatchSnapshot();
  });

  test('global allowlist only names models that exist', () => {
    const names = new Set(models.map((m) => m.name));
    expect([...GLOBAL_MODELS].filter((n) => !names.has(n))).toEqual([]);
  });
});
