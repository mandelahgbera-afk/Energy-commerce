// One-liner for the owner: are staging's books clean? Reads .env.local itself, prints no secrets.
//   node scripts/check-staging.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
const url = env.match(/^SUPABASE_DB_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!url) {
  console.log('SUPABASE_DB_URL is not in .env.local yet.');
  process.exit(1);
}
const sql = postgres(url, { ssl: 'require', max: 1, onnotice: () => {} });
try {
  const books = (await sql.unsafe('select i_books_check() as b'))[0].b;
  const products = (await sql.unsafe('select count(*)::int n from products'))[0].n;
  const owners = (await sql.unsafe(`select count(*)::int n from staff where role = 'owner'`))[0].n;
  console.log(`staging: books ${books.ok ? 'agree' : 'DISAGREE: ' + books.problems.join('; ')} | products ${products} | owners ${owners}`);
  if (!books.ok) process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
