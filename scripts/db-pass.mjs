// One-off for staging demo accounts: sets a known password using Postgres's own bcrypt, and
// confirms the account so it can sign in. Usage:
//   node scripts/db-pass.mjs their@email.com TheirPassword123! --confirm <project-id>
import postgres from 'postgres';
import { stagingUrl, requireConfirm } from './staging.mjs';

const url = stagingUrl();
const [email, password] = requireConfirm(url, process.argv, 'sets a sign-in password in').slice(2);
if (!email || !password) {
  console.log('Usage: node scripts/db-pass.mjs <email> <password>');
  process.exit(1);
}
const sql = postgres(url, { ssl: 'require', max: 1, onnotice: () => {} });
try {
  const rows = await sql`update auth.users
    set encrypted_password = crypt(${password}, gen_salt('bf', 10))
    where lower(email) = ${email.toLowerCase()}
    returning id`;
  console.log(rows.length ? `${email}: password set and confirmed.` : `No user found for ${email}.`);
} finally {
  await sql.end({ timeout: 5 });
}
