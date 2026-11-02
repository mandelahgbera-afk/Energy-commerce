// The gate before every commit. It fails if a locked file changed, or if a baseline test went missing or stopped passing.
// New tests are welcome and don't need to be on the baseline. It prints only failures and totals, to keep output small.
//   node check.mjs          locked files, then every rule scene on PGlite
//   node check.mjs --full   also the same scenes on real Postgres, then the race tests, then cleans up temp folders
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const full = process.argv.includes('--full');
const baseline = JSON.parse(fs.readFileSync(path.join(here, 'baseline.json'), 'utf8'));
const problems = [];

// Line endings are ignored, so a Windows checkout doesn't trip this.
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
for (const [rel, want] of Object.entries(baseline.locked)) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) problems.push(`locked file is gone: ${rel}`);
  else if (hash(file) !== want) problems.push(`locked file changed: ${rel}. Add a new migration instead, or ask the owner.`);
}

function suite(label, script, args, names) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: here, encoding: 'utf8', timeout: 570000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  const lines = (r.stdout ?? '').split(/\r?\n/);
  const passed = new Set(lines.filter((l) => l.startsWith('pass  ')).map((l) => l.slice(6).split('  (')[0]));
  lines.forEach((l, i) => {
    if (l.startsWith('FAIL  ')) problems.push(`${label}: ${l.slice(6)}\n    ${(lines[i + 1] ?? '').trim()}`);
  });
  for (const name of names) {
    if (!passed.has(name) && !lines.some((l) => l === `FAIL  ${name}`)) problems.push(`${label}: baseline test missing: ${name}`);
  }
  const total = lines.find((l) => / of \d+ passed on /.test(l)) ?? `did not finish: ${(r.stderr ?? '').trim().split(/\r?\n/).slice(-3).join(' | ')}`;
  console.log(`${label}: ${total}`);
  if (r.status !== 0 && !lines.some((l) => l.startsWith('FAIL  '))) problems.push(`${label}: exited with code ${r.status}`);
}

suite('rules', 'edge.mjs', [], baseline.edge);
if (full) {
  suite('rules on real Postgres', 'edge.mjs', ['--real'], baseline.edge);
  suite('races', 'race.mjs', [], baseline.race);
  spawnSync(process.execPath, [path.join(os.homedir(), '.claude', 'tools', 'dev-clean.mjs'), '--yes'], { stdio: 'ignore', windowsHide: true });
}

if (problems.length) {
  console.log(`\nNOT OK, ${problems.length} problem${problems.length === 1 ? '' : 's'}:`);
  for (const p of problems) console.log(`- ${p}`);
  process.exit(1);
}
console.log(`\nOK. Locked files unchanged (${Object.keys(baseline.locked).length}), baseline tests all pass (${baseline.edge.length} rules${full ? `, ${baseline.race.length} races` : ''}).`);
