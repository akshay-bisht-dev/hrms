// Runs `node --check` on every backend/worker/shared JavaScript file (frontend JSX is checked by the Vite build).
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = new URL('../../', import.meta.url).pathname;
const targets = [
  'apps/backend/src',
  'apps/backend/prisma',
  'apps/worker/src',
  'packages/shared/src',
  'infrastructure/scripts',
];
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(js|mjs)$/.test(name)) files.push(full);
  }
};
targets.forEach((t) => walk(join(root, t)));

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    failed++;
    console.error(String(e.stderr));
  }
}
if (failed) process.exit(1);
console.log(`check:syntax passed — ${files.length} files.`);
