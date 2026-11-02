// Applies new migrations to staging, each one once, and remembers what ran.
//   node scripts/db-apply.mjs          shows what would run, and changes nothing
//   node scripts/db-apply.mjs --yes    runs it
// Each file runs in its own transaction, so a failure leaves the database as it was. A file that
// changed after it ran is refused rather than skipped: change behaviour with a new migration.
// The test stubs in sim/stubs.sql are never applied.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { root, stagingUrl, projectRef } from './staging.mjs';

const apply = process.argv.includes('--yes');
const url = stagingUrl();
const dir = path.join(root, 'supabase', 'migrations');
const files = fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort();
const text = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const hash = (f) => crypto.createHash('sha256').update(text(f).replace(/\r\n/g, '\n')).digest('hex');
// The first new thing a file creates (not a replacement) shows whether it is in a database that
// was set up before this record existed. A file that only replaces functions has no such sign.
const probe = (f) => text(f).match(/create\s+(function|table|policy|type)\s+(?:public\.)?(\w+)/i);
const throughAt = process.argv.indexOf('--already-applied-through');
const through = throughAt >= 0 ? process.argv[throughAt + 1] : null;
const exists = async (kind, name) => {
  const n = name.toLowerCase();
  if (kind === 'table') return (await sql`select to_regclass(${'public.' + n}) is not null as yes`)[0].yes;
  if (kind === 'policy') return (await sql`select exists (select 1 from pg_policies where schemaname = 'public' and policyname = ${n}) as yes`)[0].yes;
  if (kind === 'type') return (await sql`select to_regtype(${'public.' + n}) is not null as yes`)[0].yes;
  return (await sql`select exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = ${n}) as yes`)[0].yes;
};

const sql = postgres(url, { ssl: 'require', max: 1, onnotice: () => {} });
try {
  const tracked = (await sql`select to_regclass('ops.applied_migrations') is not null as yes`)[0].yes;
  const done = new Map();
  if (tracked) for (const r of await sql`select name, sha256 from ops.applied_migrations`) done.set(r.name, r.sha256);

  // First run on a database that already has the schema: the owner says which file it is up to,
  // and every file's own sign is checked against that, so a wrong answer is refused.
  const found = [];
  if (!tracked && (await sql`select to_regclass('public.staff') is not null as yes`)[0].yes) {
    const signs = [];
    for (const f of files) {
      const p = probe(f);
      signs.push({ f, there: p ? await exists(p[1].toLowerCase(), p[2]) : null });
    }
    if (!through || !files.includes(through)) {
      console.log('This database was set up before migrations were recorded. Say which file it is up to:');
      console.log('  node scripts/db-apply.mjs --already-applied-through <file>');
      for (const s of signs) console.log(`  ${s.f}: ${s.there === null ? 'no sign to check' : s.there ? 'its tables or functions are there' : 'not there'}`);
      process.exit(1);
    }
    for (const s of signs) {
      const claimed = s.f <= through;
      if (s.there === true && !claimed) throw new Error(`${s.f} looks applied, but comes after ${through}.`);
      if (s.there === false && claimed) throw new Error(`${s.f} does not look applied, but comes before ${through}.`);
      if (claimed) found.push(s.f);
    }
  }

  const changed = files.filter((f) => done.has(f) && done.get(f) !== hash(f));
  if (changed.length) {
    console.log(`Refusing: these ran before and have changed since: ${changed.join(', ')}. Put the change in a new migration.`);
    process.exit(1);
  }
  const pending = files.filter((f) => !done.has(f) && !found.includes(f));
  console.log(`Staging project ${projectRef(url) ?? '(unknown)'}: ${files.length} migrations, ${done.size + found.length} already in, ${pending.length} to run.`);
  for (const f of found) console.log(`  already there, will be recorded: ${f}`);
  for (const f of pending) console.log(`  to run: ${f}`);
  if (!apply) {
    console.log(pending.length || found.length ? 'Nothing changed. Run again with --yes to apply.' : 'Up to date.');
    process.exit(0);
  }

  await sql.unsafe(`create schema if not exists ops;
    revoke all on schema ops from public;
    create table if not exists ops.applied_migrations (name text primary key, sha256 text not null, applied_at timestamptz not null default now(), how text not null)`);
  for (const f of found) {
    await sql`insert into ops.applied_migrations (name, sha256, how) values (${f}, ${hash(f)}, 'found already applied') on conflict do nothing`;
  }
  for (const f of pending) {
    await sql.begin(async (t) => {
      await t.unsafe(text(f));
      await t`insert into ops.applied_migrations (name, sha256, how) values (${f}, ${hash(f)}, 'applied')`;
    });
    console.log(`applied ${f}`);
  }
  console.log('Up to date.');
} finally {
  await sql.end({ timeout: 5 });
}
