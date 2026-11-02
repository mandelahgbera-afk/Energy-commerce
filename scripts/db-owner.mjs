// One-off, run by the owner after the first person signs up in the app: makes that person the
// owner staff row. Usage: node scripts/db-owner.mjs their@email.com
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!email) {
  console.log('Usage: node scripts/db-owner.mjs their@email.com');
  process.exit(1);
}
const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
const url = env.match(/^SUPABASE_DB_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!url) {
  console.log('SUPABASE_DB_URL is not in .env.local yet. Fill it in and run again.');
  process.exit(1);
}

const sql = postgres(url, { ssl: 'require', max: 1, onnotice: () => {} });
try {
  const users = await sql`select id from auth.users where lower(email) = ${email}`;
  if (users.length === 0) {
    console.log(`No sign-up found for ${email}. Sign in once in the app first.`);
    process.exit(1);
  }
  await sql`insert into staff (id, name, role) values (${users[0].id}, 'Owner', 'owner') on conflict (id) do nothing`;
  console.log(`${email} is now the owner staff row.`);
} finally {
  await sql.end({ timeout: 5 });
}
