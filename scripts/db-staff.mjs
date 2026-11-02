// One-off, run by the owner: gives a signed-up user a staff row. The owner's own hand does it.
//   node scripts/db-staff.mjs their@email.com counter "Ada Demo" 5
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { buildCall, unwrap } from '../sim/lib.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [email, role, name, discount] = process.argv.slice(2);
if (!email || !role) {
  console.log('Usage: node scripts/db-staff.mjs <email> <role> ["Name"] [discount%]');
  process.exit(1);
}
const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
const url = env.match(/^SUPABASE_DB_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!url) {
  console.log('SUPABASE_DB_URL is not in .env.local yet.');
  process.exit(1);
}
const sql = postgres(url, { ssl: 'require', max: 1, onnotice: () => {} });
try {
  const owner = await sql`select id from staff where role = 'owner' order by created_at limit 1`;
  if (owner.length === 0) {
    console.log('No owner staff row yet.');
    process.exit(1);
  }
  const users = await sql`select id from auth.users where lower(email) = ${email.toLowerCase()}`;
  if (users.length === 0) {
    console.log(`No sign-up found for ${email}. Create the user in Authentication first.`);
    process.exit(1);
  }
  const rpc = (fn, args = {}) => sql.begin(async (t) => {
    await t.unsafe(`select set_config('request.jwt.claim.sub', $1, true)`, [owner[0].id]);
    await t.unsafe('set local role authenticated');
    const c = buildCall(fn, args);
    return unwrap([...(await t.unsafe(c.text, c.params))]);
  });
  await rpc('save_staff', { p_user: users[0].id, p_name: name || email, p_role: role, p_discount_limit: discount ? Number(discount) : 0 });
  console.log(`${email} is now ${role} (discount limit ${discount ?? 0}%).`);
} finally {
  await sql.end({ timeout: 5 });
}
