// Fails if any name raised in the migrations has no plain words in lib/errors.ts,
// and reports words that outlived their error. The error table cannot drift.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const raised = new Set();
for (const f of fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((n) => n.endsWith('.sql'))) {
  const text = fs.readFileSync(path.join(root, 'supabase', 'migrations', f), 'utf8');
  for (const m of text.matchAll(/raise exception '([a-z_0-9]+)/g)) raised.add(m[1]);
}
const table = fs.readFileSync(path.join(root, 'lib', 'errors.ts'), 'utf8');
const missing = [...raised].filter((n) => !new RegExp(`^\\s*${n}:`, 'm').test(table)).sort();
const extra = [...table.matchAll(/^\s*([a-z_0-9]+):/gm)].map((m) => m[1]).filter((n) => !raised.has(n)).sort();
if (missing.length) {
  console.log(`NOT OK: no plain words for: ${missing.join(', ')}`);
  process.exit(1);
}
if (extra.length) console.log(`note: words exist for names no longer raised: ${extra.join(', ')}`);
console.log(`OK: ${raised.size} raised names all have plain words in lib/errors.ts`);
