// Peek at the latest orders and payments on staging — the simulation's own verification step.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
const url = env.match(/^SUPABASE_DB_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
const sql = postgres(url, { ssl: 'require', max: 1, onnotice: () => {} });
try {
  const orders = await sql.unsafe('select invoice_no, total_kobo, money_status, goods_status from orders order by created_at desc limit 3');
  const payments = await sql.unsafe('select method, amount_kobo, status from payments order by created_at desc limit 3');
  const books = (await sql.unsafe('select i_books_check() as b'))[0].b;
  console.log('orders:', JSON.stringify(orders));
  console.log('payments:', JSON.stringify(payments));
  console.log('books ok:', books.ok, books.ok ? '' : books.problems.join('; '));
} finally {
  await sql.end({ timeout: 5 });
}
