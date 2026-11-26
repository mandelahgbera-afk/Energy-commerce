// One-off for staging: changes an account's sign-in email the way GoTrue's own admin does it —
// the user row, its email identity, and any pending email-change fields, in one transaction.
// The password is untouched, and the new email is marked confirmed, so it signs in straight away.
// Usage:
//   node scripts/db-change-email.mjs <old-email> <new-email> --confirm <project-id>
import postgres from 'postgres';
import { stagingUrl, requireConfirm } from './staging.mjs';

const url = stagingUrl();
const [oldEmail, newEmail] = requireConfirm(url, process.argv, 'changes a sign-in email in').slice(2);
if (!oldEmail || !newEmail) {
  console.log('Usage: node scripts/db-change-email.mjs <old-email> <new-email> --confirm <project-id>');
  process.exit(1);
}
const oldE = oldEmail.trim().toLowerCase();
const newE = newEmail.trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newE)) {
  console.log(`"${newE}" does not look like an email address. Nothing changed.`);
  process.exit(1);
}
if (oldE === newE) {
  console.log('The old and new emails are the same. Nothing to do.');
  process.exit(0);
}

const sql = postgres(url, { ssl: 'require', max: 1, onnotice: () => {} });
try {
  await sql.begin(async (t) => {
    const users = await t`select id, email from auth.users where lower(email) = ${oldE}`;
    if (users.length === 0) {
      console.log(`No account found for ${oldE}. Nothing changed.`);
      return;
    }
    if (users.length > 1) {
      console.log(`More than one account matches ${oldE}. Nothing changed.`);
      return;
    }
    const taken = await t`select 1 from auth.users where lower(email) = ${newE}`;
    if (taken.length) {
      console.log(`${newE} already has an account. Nothing changed.`);
      return;
    }
    const id = users[0].id;
    await t`update auth.users set email = ${newE}, email_confirmed_at = now(), updated_at = now() where id = ${id}`;
    const uCols = new Set((await t`select column_name c from information_schema.columns where table_schema = 'auth' and table_name = 'users'`).map((r) => r.c));
    const clears = ['email_change', 'email_change_token_current', 'email_change_confirm_status'].filter((c) => uCols.has(c));
    if (clears.length) {
      const set = clears.map((c) => `${c} = ${c === 'email_change_confirm_status' ? '0' : "''"}`).join(', ');
      await t.unsafe(`update auth.users set ${set} where id = $1::uuid`, [id]);
    }
    await t`update auth.identities set identity_data = identity_data || jsonb_build_object('email', ${newE}::text) where user_id = ${id} and provider = 'email'`;
    const iEmail = (await t`select is_generated g from information_schema.columns where table_schema = 'auth' and table_name = 'identities' and column_name = 'email'`)[0];
    if (iEmail && iEmail.g === 'NEVER') await t`update auth.identities set email = ${newE} where user_id = ${id} and provider = 'email'`;
    console.log(`Changed ${users[0].email} to ${newE}. Password unchanged; the new email is confirmed and signs in now.`);
  });
} finally {
  await sql.end({ timeout: 5 });
}
