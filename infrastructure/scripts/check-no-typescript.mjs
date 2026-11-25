// Fails if any TypeScript source file exists in the repository (JavaScript-only rule).
// Type declaration files (.d.ts) shipped inside node_modules are not our source and are ignored.
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage']);
const offenders = [];

(function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(ts|tsx|mts|cts)$/.test(name)) offenders.push(relative(root, full));
  }
})(root);

if (offenders.length) {
  console.error(
    'TypeScript files are not allowed (JavaScript-only project):\n' +
      offenders.map((f) => `  - ${f}`).join('\n'),
  );
  process.exit(1);
}
console.log('check:no-ts passed — no TypeScript source files found.');
