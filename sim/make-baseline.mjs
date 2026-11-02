// Records today's passing tests and locked files as the bar check.mjs holds later work to.
// Every migration on the baseline is locked: once reviewed (and maybe applied to staging), a file never changes.
// The owner runs this, or a reviewer they trust. OpenCode is denied it on purpose: a new bar should never be set by the one being measured.
//   node make-baseline.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

function passes(script) {
  const r = spawnSync(process.execPath, [script], { cwd: here, encoding: 'utf8', timeout: 570000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  const lines = (r.stdout ?? '').split(/\r?\n/);
  const failed = lines.filter((l) => l.startsWith('FAIL  '));
  if (r.status !== 0 || failed.length) throw new Error(`${script} is not clean, so it can't become the bar:\n${failed.join('\n') || r.stderr}`);
  return lines.filter((l) => l.startsWith('pass  ')).map((l) => l.slice(6).split('  (')[0]);
}

const locked = {};
const migrations = path.join(root, 'supabase', 'migrations');
for (const f of fs.readdirSync(migrations).filter((n) => n.endsWith('.sql')).sort()) {
  locked[`supabase/migrations/${f}`] = crypto.createHash('sha256').update(fs.readFileSync(path.join(migrations, f), 'utf8').replace(/\r\n/g, '\n')).digest('hex');
}
locked['sim/stubs.sql'] = crypto.createHash('sha256').update(fs.readFileSync(path.join(here, 'stubs.sql'), 'utf8').replace(/\r\n/g, '\n')).digest('hex');

const out = { locked, edge: passes('edge.mjs'), race: passes('race.mjs') };
fs.writeFileSync(path.join(here, 'baseline.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log(`Baseline written: ${Object.keys(locked).length} locked files, ${out.edge.length} rule scenes, ${out.race.length} race scenes.`);
