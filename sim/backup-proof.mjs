// The local proof from plan section 9: a backup made today restores into a blank database and the
// numbers match, including i_books_check(). Two throwaway embedded Postgres servers: the source
// runs a whole shop day through the real functions, then is dumped, wiped in spirit by pointing
// the restore at a fresh server, and compared table by table. A tampered dump refuses to open,
// and the restored shop takes new writes (identity sequences fixed).
//   node backup-proof.mjs          prints one line of proof and cleans up after itself
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';
import { startPostgres } from './testpg.mjs';
import { schemaSql, buildCall, unwrap, N, USERS, seedPeople, postgresOptions } from './lib.mjs';
import { dumpTo } from './db-dump.mjs';
import { restoreFrom } from './db-restore.mjs';

const { OWNER, COUNTER, COUNTER2, STORE, ACCOUNT } = USERS;
const keyHex = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'power-backup-'));
const file = path.join(tmp, 'power-shop.dump.enc');

const srcPg = await startPostgres({ port: 54421, password: 'test', database: 'power_backup_src' });
const dstPg = await startPostgres({ port: 54422, password: 'test', database: 'power_backup_dst' });
const src = postgres(postgresOptions(54421, 'test', 'power_backup_src', 4));
const dst = postgres(postgresOptions(54422, 'test', 'power_backup_dst', 4));
try {
  for (const part of schemaSql()) await src.unsafe(part);
  const admin = { query: async (t, p = []) => [...(await src.unsafe(t, p))] };
  await seedPeople(admin);

  let seq = 0;
  const k = (p) => `${p}-${++seq}`;
  const val = async (t, p = []) => { const r = (await admin.query(t, p))[0]; return r ? Object.values(r)[0] : null; };
  const rpc = (who, fn, args = {}) => src.begin(async (t) => {
    await t.unsafe(`select set_config('request.jwt.claim.sub', $1, true)`, [who]);
    await t.unsafe('set local role authenticated');
    const c = buildCall(fn, args);
    return unwrap([...(await t.unsafe(c.text, c.params))]);
  });
  const rpcDst = (who, fn, args = {}) => dst.begin(async (t) => {
    await t.unsafe(`select set_config('request.jwt.claim.sub', $1, true)`, [who]);
    await t.unsafe('set local role authenticated');
    const c = buildCall(fn, args);
    return unwrap([...(await t.unsafe(c.text, c.params))]);
  });

  // A whole shop day, through the same functions the screens will call.
  for (const [u, n, r] of [[COUNTER, 'Ada', 'counter'], [COUNTER2, 'Bayo', 'counter'], [STORE, 'Chidi', 'storekeeper'], [ACCOUNT, 'Fatima', 'accountant']]) {
    await rpc(OWNER, 'save_staff', { p_user: u, p_name: n, p_role: r });
  }
  const shop = await rpc(OWNER, 'save_location', { p_name: 'Main shop' });
  const back = await rpc(OWNER, 'save_location', { p_name: 'Back store', p_kind: 'warehouse' });
  const sup = await rpc(OWNER, 'save_supplier', { p_name: 'Lagos Batteries' });
  await rpc(COUNTER, 'save_customer', { p_phone: '08030000001', p_name: 'Ngozi' });
  const ngozi = await val(`select id from customers where phone = normalize_phone('08030000001')`);
  await rpc(OWNER, 'set_customer_terms', { p_customer: ngozi, p_kind: 'retail', p_credit_limit: 5000000 });
  await rpc(COUNTER, 'save_customer', { p_phone: '08030000002', p_name: 'Installer Ike' });
  const ike = await val(`select id from customers where phone = normalize_phone('08030000002')`);
  await rpc(OWNER, 'set_customer_terms', { p_customer: ike, p_kind: 'installer', p_credit_limit: 0 });

  const product = async ({ sku, name, price, cost, qty = 0, unit = 'each', vat = 0, trade = null, tracking = 'count', at = shop, serials = [], part = null, size = null }) => {
    const id = await rpc(OWNER, 'save_product', { p_sku: sku, p_name: name, p_price: price, p_trade: trade, p_unit: unit, p_vat_bp: vat, p_tracking: tracking });
    await rpc(OWNER, 'set_last_cost', { p_product: id, p_cost: cost });
    if (part) await rpc(OWNER, 'save_part_details', { p_product: id, p_part_number: part, p_bore: size?.[0], p_outside: size?.[1], p_width: size?.[2] });
    if (qty > 0) await rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: at, p_lines: [{ product_id: id, qty, serials }] });
    return id;
  };
  const panel = await product({ sku: 'S-PANEL', name: 'Solar panel 550W', price: 10000000, cost: 6000000, qty: 2, tracking: 'serial', serials: ['SP-1', 'SP-2'] });
  const battery = await product({ sku: 'S-BATT', name: 'Battery 12V 200Ah', price: 1000000, cost: 600000, qty: 10, part: '6205 2RS', size: [25, 52, 15] });
  const belt = await product({ sku: 'S-BELT', name: 'Belt B40', price: 3333, cost: 2000, qty: 20, unit: 'metre', vat: 750, at: back });

  // Quotes: one accepted (becomes a waiting order), one cancelled.
  const q1 = await rpc(COUNTER, 'create_quote', { p_key: k('q'), p_location: shop, p_lines: [{ product_id: battery, qty: 2 }] });
  const q2 = await rpc(COUNTER, 'revise_quote', { p_key: k('q'), p_quote: q1, p_lines: [{ product_id: battery, qty: 3 }] });
  await rpc(COUNTER, 'accept_quote', { p_quote: q2 });
  const qc = await rpc(COUNTER, 'create_quote', { p_key: k('q'), p_location: shop, p_lines: [{ product_id: belt, qty: 2.5 }], p_customer: ike });
  await rpc(COUNTER, 'cancel_quote', { p_quote: qc, p_reason: 'Customer walked' });

  // Money in the till and the safe, and the day's sales.
  await rpc(OWNER, 'owner_money_in', { p_key: k('in'), p_account: 'cash', p_amount: 5000000, p_what: 'Owner top-up' });
  await rpc(COUNTER, 'open_till', { p_float: 50000 });
  await rpc(COUNTER, 'counter_sale', { p_key: k('sale'), p_location: shop, p_lines: [{ product_id: panel, qty: 1, serials: ['SP-1'] }], p_method: 'cash' });
  await rpc(COUNTER, 'counter_sale', { p_key: k('sale'), p_location: shop, p_lines: [{ product_id: battery, qty: 1 }], p_method: 'pos' });
  const posPay = await val(`select id from payments where status = 'pending' order by created_at desc limit 1`);
  const bl = await rpc(ACCOUNT, 'add_bank_line', { p_key: k('bl'), p_on: await val('select shop_today()::text'), p_amount: 1000000 });
  await rpc(ACCOUNT, 'confirm_payment', { p_payment: posPay, p_bank_line: bl });
  const o3 = await rpc(COUNTER, 'create_order', { p_key: k('ord'), p_location: shop, p_lines: [{ product_id: battery, qty: 2 }] });
  await rpc(COUNTER, 'take_payment', { p_key: k('pay'), p_order: o3, p_method: 'cash', p_amount: 2000000 });
  await rpc(COUNTER, 'deliver_order', { p_key: k('go'), p_order: o3 });
  const o4 = await rpc(COUNTER, 'create_order', { p_key: k('ord'), p_location: shop, p_lines: [{ product_id: battery, qty: 1 }], p_phone: '08030000001', p_on_credit: true });
  await rpc(COUNTER, 'deliver_order', { p_key: k('go'), p_order: o4 });
  const o5 = await rpc(COUNTER, 'create_order', { p_key: k('ord'), p_location: shop, p_lines: [{ product_id: panel, qty: 1, serials: ['SP-2'] }] });
  await rpc(COUNTER, 'take_payment', { p_key: k('pay'), p_order: o5, p_method: 'transfer', p_amount: 10000000, p_reference: k('REF') });
  const tr = await val(`select id from payments where order_id = $1`, [o5]);
  const bl2 = await rpc(ACCOUNT, 'add_bank_line', { p_key: k('bl'), p_on: await val('select shop_today()::text'), p_amount: 10000000 });
  await rpc(ACCOUNT, 'confirm_payment', { p_payment: tr, p_bank_line: bl2 });
  await rpc(COUNTER, 'deliver_order', { p_key: k('go'), p_order: o5, p_lines: [{ product_id: panel, qty: 1, serials: ['SP-2'] }] });

  // A return, a refund, counts, owner money and running costs.
  await rpc(COUNTER, 'return_goods', { p_key: k('ret'), p_order: o3, p_lines: [{ product_id: battery, qty: 1 }], p_reason: 'Wrong size' });
  await rpc(ACCOUNT, 'refund_order', { p_key: k('rf'), p_order: o3, p_amount: 1000000, p_method: 'transfer', p_reason: 'Returned' });
  const counted = await val(`select coalesce(sum(qty), 0)::text from stock_balances where product_id = $1`, [battery]);
  const sc = await rpc(STORE, 'submit_stock_count', { p_key: k('cnt'), p_location: shop, p_lines: [{ product_id: battery, counted }] });
  await rpc(OWNER, 'approve_stock_count', { p_count: sc });
  const safeNow = N(await val(`select coalesce(sum(amount_kobo), 0) from ledger_entries where account_code = 'cash'`)) - N(await val('select i_tills_expected()'));
  const safe = await rpc(COUNTER, 'submit_safe_count', { p_key: k('safe'), p_counted: safeNow, p_counted_at: new Date().toISOString() });
  await rpc(OWNER, 'approve_safe_count', { p_count: safe });
  await rpc(ACCOUNT, 'owner_money_out', { p_key: k('out'), p_account: 'cash', p_amount: 1000000, p_what: 'Owner pocket' });
  await rpc(ACCOUNT, 'record_expense', { p_key: k('exp'), p_account: 'rent', p_amount: 200000, p_paid_from: 'bank', p_what: 'Shop rent' });
  await rpc(ACCOUNT, 'move_money', { p_key: k('mv'), p_from: 'cash', p_to: 'bank', p_amount: 500000 });
  await rpc(ACCOUNT, 'pay_supplier', { p_key: k('sup'), p_supplier: sup, p_amount: 300000 });
  await rpc(COUNTER, 'till_paid_out', { p_key: k('out'), p_account: 'fuel_delivery', p_amount: 10000, p_what: 'Generator fuel' });
  await rpc(COUNTER2, 'open_till', { p_float: 10000 });
  await rpc(COUNTER2, 'close_till', { p_counted: 9000 }); // a real shortage on the books
  const tillExpected = await val(`select float_kobo + coalesce((select sum(amount_kobo) from payments where till_session_id = s.id and method = 'cash' and status = 'confirmed'), 0) - coalesce((select sum(amount_kobo) from till_paid_outs where session_id = s.id), 0) from till_sessions s where staff_id = $1 and status = 'open'`, [COUNTER]);
  await rpc(COUNTER, 'close_till', { p_counted: tillExpected });

  const books = await val('select i_books_check()');
  if (!books.ok) throw new Error(`the seeded shop does not balance: ${books.problems.join('; ')}`);

  // ---- Dump, tamper, restore ----
  const out = fs.createWriteStream(file);
  const { manifest } = await dumpTo(src, out, keyHex);
  await new Promise((r) => out.close(r));
  const sealed = fs.readFileSync(file);
  if (sealed.includes(Buffer.from('ledger_entries'))) throw new Error('the dump file holds plaintext');
  const tampered = Buffer.from(sealed);
  tampered[sealed.length - 10] ^= 0xff;
  const bad = path.join(tmp, 'tampered.enc');
  fs.writeFileSync(bad, tampered);
  const dstReserved = await dst.reserve();
  for (const part of schemaSql()) await dst.unsafe(part);
  let refused = false;
  try { await restoreFrom(dstReserved, fs.createReadStream(bad), keyHex); } catch { refused = true; }
  if (!refused) throw new Error('a tampered backup restored without complaint');
  await restoreFrom(dstReserved, fs.createReadStream(file), keyHex);

  // ---- Compare every table and the books ----
  for (const [t, { count }] of Object.entries(manifest.tables)) {
    const n = (await dst.unsafe(`select count(*)::bigint as n from ${t.replace('.', '."')}"`))[0].n;
    if (String(n) !== String(count)) throw new Error(`${t}: source ${count}, restored ${n}`);
  }
  const sums = async (s) => Object.fromEntries((await s.unsafe(`select account_code a, coalesce(sum(amount_kobo), 0) s from ledger_entries group by 1`)).map((r) => [r.a, String(r.s)]));
  const a = await sums(src), b = await sums(dst);
  for (const acct of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[acct] !== b[acct]) throw new Error(`ledger ${acct}: source ${a[acct]}, restored ${b[acct]}`);
  }
  const dstBooks = await dst.unsafe('select i_books_check()');
  if (!dstBooks[0].i_books_check.ok) throw new Error('the restored books disagree');
  // The restored shop takes new writes: identity sequences were reset.
  await rpcDst(ACCOUNT, 'record_expense', { p_key: 'after-restore', p_account: 'other_costs', p_amount: 1, p_paid_from: 'bank', p_what: 'Post-restore write' });
  const dstBooks2 = await dst.unsafe('select i_books_check()');
  if (!dstBooks2[0].i_books_check.ok) throw new Error('the restored books disagree after a new write');
  dstReserved.release();

  console.log(`backup proof: OK (${Object.keys(manifest.tables).length} tables, ${Object.values(manifest.tables).reduce((n, t) => n + N(t.count), 0)} rows round-tripped, ${(sealed.length / 1024).toFixed(1)} KB sealed)`);
} finally {
  await src.end({ timeout: 2 }).catch(() => {});
  await dst.end({ timeout: 2 }).catch(() => {});
  await srcPg.stop().catch(() => {});
  await dstPg.stop().catch(() => {});
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch {}
  const clean = path.join(os.homedir(), '.claude', 'tools', 'dev-clean.mjs');
  if (fs.existsSync(clean)) spawnSync(process.execPath, [clean, '--yes'], { stdio: 'ignore', windowsHide: true });
}
