// Lists sign-up emails on staging (demo data only) — helps the owner see what was created.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
const url = env.match(/^SUPABASE_DB_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
const sql = postgres(url, { ssl: 'require', max: 1, onnotice: () => {} });
try {
  const rows = await sql`select email, confirmed_at is not null as confirmed from auth.users order by created_at`;
  for (const r of rows) console.log(`${r.email}  confirmed=${r.confirmed}`);
} finally {
  await sql.end({ timeout: 5 });
}
