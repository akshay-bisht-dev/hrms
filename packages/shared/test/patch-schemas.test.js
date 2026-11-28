import { z } from 'zod';
import { patchOf } from '../src/schemas/patch.js';

const MODULES = ['attendance', 'employee', 'leave', 'org', 'payroll', 'tasks', 'work', 'members', 'auth'];

test('a PATCH body never gains fields the caller did not send (no defaults sneak in)', async () => {
  const offenders = [];
  let checked = 0;
  for (const m of MODULES) {
    const mod = await import(`../src/schemas/${m}.js`);
    for (const [name, schema] of Object.entries(mod)) {
      if (!/Patch$/.test(name) || typeof schema?.safeParse !== 'function') continue;
      checked++;
      const r = schema.safeParse({});
      if (r.success && Object.keys(r.data).length) offenders.push(`${m}.${name} → ${JSON.stringify(r.data)}`);
    }
  }
  expect(checked).toBeGreaterThanOrEqual(9);
  expect(offenders).toEqual([]);
});

test('patchOf keeps validation and unknown-key rejection', () => {
  const s = patchOf(z.object({ name: z.string().min(2), active: z.boolean().default(true) }).strict());
  expect(s.parse({ name: 'ok' })).toEqual({ name: 'ok' });
  expect(s.safeParse({ name: 'x' }).success).toBe(false);
  expect(s.safeParse({ other: 1 }).success).toBe(false);
  expect(s.parse({ active: false })).toEqual({ active: false });
});
