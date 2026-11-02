// One-off, run by the owner: applies every migration in supabase/migrations to the staging
// database named by SUPABASE_DB_URL in .env.local (which this script reads itself, and never
// prints). The test stubs in sim/stubs.sql are never applied. Re-running is safe: Postgres
// re-runs the files in order, and each migration is written to tolerate a second run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
const url = env.match(/^SUPABASE_DB_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!url) {
  console.log('SUPABASE_DB_URL is not in .env.local yet. Fill it in and run again.');
  process.exit(1);
}

const sql = postgres(url, { ssl: 'require', max: 1, onnotice: () => {} });
const files = fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((n) => n.endsWith('.sql')).sort();
try {
  for (const f of files) {
    await sql.unsafe(fs.readFileSync(path.join(root, 'supabase', 'migrations', f), 'utf8'));
    console.log(`applied ${f}`);
  }
  console.log(`done: ${files.length} migrations applied to staging.`);
} finally {
  await sql.end({ timeout: 5 });
}
