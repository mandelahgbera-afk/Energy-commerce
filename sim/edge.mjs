// Every rule, one scene at a time, on one connection. After every scene the books must still agree with themselves.
//   node edge.mjs          fast, on PGlite
//   node edge.mjs --real   the same scenes on real Postgres
import { randomUUID } from 'node:crypto';
import { openPglite, schemaSql, buildCall, unwrap, N, arr, USERS, seedPeople, postgresOptions } from './lib.mjs';

const { OWNER, COUNTER, COUNTER2, STORE, DISPATCH, DRIVER, ACCOUNT, BUYER, STRANGER, EXSTAFF } = USERS;

const real = process.argv.includes('--real');
let db;
let stopPg = async () => {};
if (real) {
  const { startPostgres } = await import('./testpg.mjs');
  const { default: postgres } = await import('postgres');
  const pg = await startPostgres({ port: 54411, password: 'test', database: 'power_edge' });
  const sql = postgres(postgresOptions(54411, 'test', 'power_edge', 1));
  const conn = await sql.reserve();
  db = {
    where: `real Postgres (${pg.where})`,
    query: async (t, p = []) => [...(await conn.unsafe(t, p))],
    exec: async (t) => { await conn.unsafe(t); },
    close: async () => { conn.release(); await sql.end({ timeout: 2 }); },
  };
  stopPg = pg.stop;
} else {
  db = await openPglite();
}

for (const part of schemaSql()) await db.exec(part);

const q = (t, p = []) => db.query(t, p);
const val = async (t, p = []) => { const r = (await q(t, p))[0]; return r ? Object.values(r)[0] : null; };

const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const sorted = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
const same = (a, b, msg = '') => { if (sorted(a) !== sorted(b)) throw new Error(`${msg} expected ${sorted(b)}, got ${sorted(a)}`); };
const eq = (a, b, msg = '') => { if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`); };
const fails = async (p, msg) => {
  try { await p; } catch (e) {
    if (!String(e.message).includes(msg)) throw new Error(`expected "${msg}", got "${e.message}"`);
    return;
  }
  throw new Error(`expected "${msg}", but it worked`);
};

// Runs as a logged-in person, with the same role and rights the app's API would have.
async function as(who, fn) {
  await q(`select set_config('request.jwt.claim.sub', $1, false)`, [who === 'anon' || who === 'service' ? '' : who]);
  await db.exec(`set role ${who === 'anon' ? 'anon' : who === 'service' ? 'service_role' : 'authenticated'}`);
  try { return await fn(); } finally {
    await db.exec('reset role');
    await q(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}
const rpc = (who, fn, args = {}) => as(who, async () => { const c = buildCall(fn, args); return unwrap(await q(c.text, c.params)); });

let seq = 0;
const k = (p = 'k') => `${p}-${++seq}`;

// Dates relative to today, so the scenes don't age out of the 400-day limit.
const now = new Date();
const ago = (months, day = 15) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, day)).toISOString().slice(0, 10);
const errorOf = async (p) => { try { await p; return null; } catch (e) { return e; } };

const accounts = async () => Object.fromEntries((await q('select account_code a, sum(amount_kobo) s from ledger_entries group by 1')).map((r) => [r.a, N(r.s)]));
const moved = async (fn) => {
  const a = await accounts();
  await fn();
  const b = await accounts();
  const d = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const v = (b[key] ?? 0) - (a[key] ?? 0);
    if (v !== 0) d[key] = v;
  }
  return d;
};

const results = [];
async function test(name, fn) {
  try {
    await fn();
    const chk = await val('select i_books_check()');
    if (!chk.ok) throw new Error(`books disagree afterwards: ${chk.problems.join('; ')}`);
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, why: e.message });
  }
}

// Setting up the shop, through the same functions the screens will use.
await seedPeople(db);
await rpc(OWNER, 'save_staff', { p_user: COUNTER, p_name: 'Ada', p_role: 'counter', p_discount_limit: 5 });
await rpc(OWNER, 'save_staff', { p_user: COUNTER2, p_name: 'Bayo', p_role: 'counter', p_discount_limit: 0 });
await rpc(OWNER, 'save_staff', { p_user: STORE, p_name: 'Chidi', p_role: 'storekeeper' });
await rpc(OWNER, 'save_staff', { p_user: DISPATCH, p_name: 'Dele', p_role: 'dispatcher' });
await rpc(OWNER, 'save_staff', { p_user: DRIVER, p_name: 'Emeka', p_role: 'driver' });
await rpc(OWNER, 'save_staff', { p_user: ACCOUNT, p_name: 'Fatima', p_role: 'accountant' });
await rpc(OWNER, 'save_staff', { p_user: EXSTAFF, p_name: 'Gone', p_role: 'owner', p_active: false });
const shop = await rpc(OWNER, 'save_location', { p_name: 'Main shop' });
const back = await rpc(OWNER, 'save_location', { p_name: 'Back store', p_kind: 'warehouse' });
const sup = await rpc(OWNER, 'save_supplier', { p_name: 'Lagos Batteries' });
await rpc(COUNTER, 'open_till', { p_float: 0 });

async function product({ price = 10000000, cost = 6000000, qty = 10, trade = null, tracking = 'count', unit = 'each', vat = 0, warranty = 0, low = 0, at = shop } = {}) {
  const sku = `T-${++seq}`;
  const id = await rpc(OWNER, 'save_product', { p_sku: sku, p_name: `Test ${sku}`, p_price: price, p_trade: trade, p_tracking: tracking, p_unit: unit, p_warranty_months: warranty, p_vat_bp: vat, p_low_stock_at: low });
  await rpc(OWNER, 'set_last_cost', { p_product: id, p_cost: cost });
  const serials = tracking === 'serial' ? Array.from({ length: qty }, (_, i) => `${sku}-${i + 1}`) : [];
  if (qty > 0) await rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: at, p_lines: [{ product_id: id, qty, serials }] });
  return { id, sku, serials };
}
const line = (p, qty = 1, extra = {}) => ({ product_id: p.id, qty, ...extra });
const order = (p, { qty = 1, price, phone = null, credit = false, backorder = false, who = COUNTER } = {}) =>
  rpc(who, 'create_order', { p_key: k('ord'), p_location: shop, p_lines: [line(p, qty, price === undefined ? {} : { unit_price: price })], p_phone: phone, p_on_credit: credit, p_backorder: backorder });
const sale = (p, { qty = 1, method = 'cash', phone = null, key = k('sale'), who = COUNTER, serials, price, reference = null } = {}) =>
  rpc(who, 'counter_sale', { p_key: key, p_location: shop, p_lines: [line(p, qty, { ...(serials ? { serials } : {}), ...(price === undefined ? {} : { unit_price: price }) })], p_method: method, p_phone: phone, p_reference: reference });
// Default cash: a scene's "money is in" means real money in the drawer. Card taps stay pending until
// matched against a bank line, which is what the POS scenes below exercise.
const pay = (o, amount, method = 'cash', { who = COUNTER, reference = null } = {}) =>
  rpc(who, 'take_payment', { p_key: k('pay'), p_order: o, p_method: method, p_amount: amount, p_reference: reference });
const deliver = (o, lines = null, who = COUNTER) => rpc(who, 'deliver_order', { p_key: k('go'), p_order: o, p_lines: lines });
const ret = (o, lines, { key = k('ret'), who = COUNTER, at = null, reason = 'Changed mind' } = {}) =>
  rpc(who, 'return_goods', { p_key: key, p_order: o, p_lines: lines, p_reason: reason, ...(at ? { p_location: at } : {}) });
const orderRow = async (o) => (await q('select * from orders where id = $1', [o]))[0];
const shelf = async (p, at = shop) => {
  const r = (await q('select qty, reserved from stock_balances where product_id = $1 and location_id = $2', [p.id, at]))[0];
  return { qty: N(r?.qty ?? 0), reserved: N(r?.reserved ?? 0) };
};
const bankLine = (amount, on = null) => rpc(ACCOUNT, 'add_bank_line', { p_key: k('bl'), p_on: on ?? new Date().toISOString().slice(0, 10), p_amount: amount, p_reference: k('STMT') });
const customerByPhone = (phone) => val(`select id from customers where phone = normalize_phone($1)`, [phone]);

// ---- The ledger ----

await test('a transaction that does not balance cannot be saved', async () => {
  const t = randomUUID();
  await fails(db.exec(`begin;
    insert into ledger_txns (id, occurred_on, kind, what) values ('${t}', current_date, 'x', 'x');
    insert into ledger_entries (txn_id, account_code, amount_kobo) values ('${t}', 'bank', 100);
    commit;`), 'ledger_unbalanced');
  await db.exec('rollback').catch(() => {});
  eq(N(await val('select count(*) from ledger_txns where id = $1', [t])), 0);
});

await test('nobody can edit or delete history, not even the database owner', async () => {
  await product({ qty: 1 });
  await rpc(ACCOUNT, 'record_expense', { p_key: k('exp'), p_account: 'rent', p_amount: 5000000, p_paid_from: 'bank', p_what: 'Rent' });
  await fails(q('update ledger_entries set amount_kobo = 1'), 'append_only');
  await fails(q('delete from ledger_entries'), 'append_only');
  await fails(q(`update ledger_txns set what = 'x'`), 'append_only');
  await fails(q('delete from ledger_txns'), 'append_only');
  await fails(q(`update stock_movements set qty = 1`), 'append_only');
  await fails(q(`delete from stock_movements`), 'append_only');
  await fails(q(`delete from audit_log`), 'append_only');
  for (const t of ['ledger_entries', 'stock_movements', 'audit_log']) await fails(q(`truncate ${t}`), 'append_only');
});

await test('a typo far in the future cannot slip past the books', async () => {
  await fails(rpc(ACCOUNT, 'record_expense', { p_key: k('exp'), p_account: 'rent', p_amount: 5, p_paid_from: 'bank', p_what: 'Typo', p_on: '2062-01-01' }), 'future_date');
});

await test('a finished transaction cannot have lines added, even balanced ones', async () => {
  const t = await rpc(ACCOUNT, 'record_expense', { p_key: k('exp'), p_account: 'rent', p_amount: 100, p_paid_from: 'bank', p_what: 'Rent' });
  await fails(db.exec(`begin;
    insert into ledger_entries (txn_id, account_code, amount_kobo) values ('${t}', 'bank', 50);
    insert into ledger_entries (txn_id, account_code, amount_kobo) values ('${t}', 'rent', -50);
    commit;`), 'ledger_txn_sealed');
  await db.exec('rollback').catch(() => {});
});

await test('retrying the same entry records it once', async () => {
  const key = k('exp');
  const args = { p_key: key, p_account: 'fuel_delivery', p_amount: 300000, p_paid_from: 'cash', p_what: 'Fuel' };
  const change = await moved(async () => {
    const a = await rpc(ACCOUNT, 'record_expense', args);
    const b = await rpc(ACCOUNT, 'record_expense', args);
    eq(a, b);
  });
  same(change, { fuel_delivery: 300000, cash: -300000 });
});

await test('money far beyond what Nazia could hold still adds up (₦50 billion)', async () => {
  const big = 5000000000000;
  const change = await moved(() => rpc(OWNER, 'post_opening_balance', { p_key: k('open'), p_account: 'bank', p_amount: big, p_on: ago(9, 1) }));
  same(change, { bank: big, owner_money: -big });
});

await test('opening stock, money and debts go through their own doors', async () => {
  const id = await rpc(OWNER, 'save_product', { p_sku: k('OPEN'), p_name: 'Old stock', p_price: 500000 });
  await rpc(OWNER, 'set_last_cost', { p_product: id, p_cost: 400000 });
  await fails(rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: null, p_location: shop, p_lines: [{ product_id: id, qty: 1 }] }), 'not_allowed');
  same(await moved(() => rpc(OWNER, 'receive_goods', { p_key: k('rcv'), p_supplier: null, p_location: shop, p_lines: [{ product_id: id, qty: 5 }] })), { stock: 2000000, owner_money: -2000000 });
  await fails(rpc(OWNER, 'post_opening_balance', { p_key: k('open'), p_account: 'stock', p_amount: 100, p_on: ago(9, 1) }), 'use_domain_function');
  await fails(rpc(OWNER, 'post_opening_balance', { p_key: k('open'), p_account: 'customers_owe', p_amount: 100, p_on: ago(9, 1) }), 'use_domain_function');
  await fails(rpc(OWNER, 'post_opening_balance', { p_key: k('open'), p_account: 'bank', p_amount: -100, p_on: ago(9, 1) }), 'bad_amount');
  same(await moved(() => rpc(OWNER, 'post_opening_balance', { p_key: k('open'), p_account: 'suppliers_owed', p_amount: 5000000, p_on: ago(9, 1), p_supplier: sup })), { suppliers_owed: -5000000, owner_money: 5000000 });
  const c = await rpc(COUNTER, 'save_customer', { p_phone: '08030000099', p_name: 'Old debtor' });
  let o;
  same(await moved(async () => { o = await rpc(OWNER, 'post_opening_debt', { p_key: k('debt'), p_customer: c, p_amount: 7500000, p_on: ago(9, 1) }); }), { customers_owe: 7500000, owner_money: -7500000 });
  same(await moved(() => pay(o, 2500000, 'cash')), { cash: 2500000, customers_owe: -2500000 });
  eq(N((await rpc(COUNTER, 'customer_balance', { p_customer: c })).owes), 5000000);
});

await test('an opening debt typed wrongly comes off cleanly, and only that way', async () => {
  const c = await rpc(COUNTER, 'save_customer', { p_phone: '08030000098', p_name: 'Typo debtor' });
  const o = await rpc(OWNER, 'post_opening_debt', { p_key: k('debt'), p_customer: c, p_amount: 7500000, p_on: ago(9, 1) });
  const t = await val(`select id from ledger_txns where ref_type = 'order' and ref_id = $1`, [o]);
  await fails(rpc(ACCOUNT, 'reverse_txn', { p_txn: t, p_reason: 'typo' }), 'use_domain_function');
  same(await moved(() => rpc(OWNER, 'void_opening_debt', { p_order: o, p_reason: 'Typed wrongly' })), { customers_owe: -7500000, owner_money: 7500000 });
  eq(N((await rpc(COUNTER, 'customer_balance', { p_customer: c })).owes), 0);
  await fails(rpc(OWNER, 'void_opening_debt', { p_order: o, p_reason: 'again' }), 'not_an_opening_debt');
  const paid = await rpc(OWNER, 'post_opening_debt', { p_key: k('debt'), p_customer: c, p_amount: 100000, p_on: ago(9, 1) });
  await pay(paid, 100, 'cash');
  await fails(rpc(OWNER, 'void_opening_debt', { p_order: paid, p_reason: 'x' }), 'payments_exist');
});

await test('a mistake is fixed by a reversal, once, with a reason', async () => {
  const t = await rpc(ACCOUNT, 'record_expense', { p_key: k('exp'), p_account: 'salaries', p_amount: 7000000, p_paid_from: 'bank', p_what: 'Wrong entry' });
  await fails(rpc(ACCOUNT, 'reverse_txn', { p_txn: t, p_reason: '  ' }), 'reason_required');
  let r;
  same(await moved(async () => { r = await rpc(ACCOUNT, 'reverse_txn', { p_txn: t, p_reason: 'Typed twice' }); }), { salaries: -7000000, bank: 7000000 });
  await fails(rpc(ACCOUNT, 'reverse_txn', { p_txn: t, p_reason: 'again' }), 'already_reversed');
  await fails(rpc(ACCOUNT, 'reverse_txn', { p_txn: r, p_reason: 'undo the undo' }), 'cannot_reverse_a_reversal');
});

await test('a sale cannot be reversed behind the back of its stock and customer records', async () => {
  const p = await product();
  const s = await sale(p);
  const t = await val(`select id from ledger_txns where ref_type = 'delivery' and ref_id = (select id from deliveries where order_id = $1)`, [s.order_id]);
  await fails(rpc(ACCOUNT, 'reverse_txn', { p_txn: t, p_reason: 'no' }), 'use_domain_function');
});

await test('a closed month refuses new entries, and corrections land in the open month', async () => {
  const args = { p_key: k('exp'), p_account: 'rent', p_amount: 1000000, p_paid_from: 'bank', p_what: 'Old rent', p_on: ago(11, 15) };
  const t = await rpc(ACCOUNT, 'record_expense', args);
  await rpc(OWNER, 'close_month', { p_month: ago(11, 1), p_statement_balance: -1000000 });
  same(await moved(async () => { eq(await rpc(ACCOUNT, 'record_expense', args), t, 'retry after the close:'); }), {});
  await fails(rpc(ACCOUNT, 'record_expense', { p_key: k('exp'), p_account: 'rent', p_amount: 5, p_paid_from: 'bank', p_what: 'Late', p_on: ago(11, 20) }), 'period_closed');
  await fails(rpc(ACCOUNT, 'record_expense', { p_key: k('exp'), p_account: 'rent', p_amount: 5, p_paid_from: 'bank', p_what: 'Older still', p_on: ago(12, 20) }), 'period_closed');
  await fails(rpc(ACCOUNT, 'reverse_txn', { p_txn: t, p_reason: 'x', p_on: ago(11, 28) }), 'period_closed');
  same(await moved(() => rpc(ACCOUNT, 'reverse_txn', { p_txn: t, p_reason: 'Wrong month' })), { rent: -1000000, bank: 1000000 });
});

await test('opening entries stop once the books are running', async () => {
  const c = await rpc(COUNTER, 'save_customer', { p_phone: '08030000097' });
  await fails(rpc(OWNER, 'post_opening_balance', { p_key: k('open'), p_account: 'bank', p_amount: 100, p_on: ago(1, 1) }), 'books_already_running');
  await fails(rpc(OWNER, 'post_opening_debt', { p_key: k('debt'), p_customer: c, p_amount: 100, p_on: ago(1, 1) }), 'books_already_running');
  const p = await product({ qty: 0 });
  await fails(rpc(OWNER, 'receive_goods', { p_key: k('rcv'), p_supplier: null, p_location: shop, p_lines: [line(p, 1)] }), 'books_already_running');
});

await test('dates are checked: staff work today, and nothing lands far outside the books', async () => {
  const p = await product({ qty: 0 });
  await fails(rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [line(p, 1)], p_on: ago(1, 5) }), 'date_not_allowed');
  await rpc(ACCOUNT, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [line(p, 1)], p_on: ago(1, 5) });
  await fails(rpc(ACCOUNT, 'record_expense', { p_key: k('exp'), p_account: 'rent', p_amount: 5, p_paid_from: 'bank', p_what: 'Typo', p_on: '1999-01-01' }), 'too_old');
});

await test('a month with a bank difference will not close', async () => {
  await rpc(ACCOUNT, 'record_expense', { p_key: k('exp'), p_account: 'rent', p_amount: 200000, p_paid_from: 'bank', p_what: 'Jan', p_on: ago(10, 10) });
  await fails(rpc(OWNER, 'close_month', { p_month: ago(10, 1), p_statement_balance: 0 }), 'bank differs from the statement by');
});

await test('supplier payments cannot come out of the wrong kind of account', async () => {
  await fails(rpc(ACCOUNT, 'pay_supplier', { p_key: k('sp'), p_supplier: sup, p_amount: 100, p_from: 'sales' }), 'not_a_money_account');
  await fails(rpc(ACCOUNT, 'record_expense', { p_key: k('exp'), p_account: 'bank', p_amount: 100, p_paid_from: 'cash', p_what: 'x' }), 'not_an_expense_account');
});

// ---- Stock ----

await test('goods arriving add to shelf, stock value and what we owe the supplier', async () => {
  const id = await rpc(OWNER, 'save_product', { p_sku: k('GR'), p_name: 'Bearing 6205', p_price: 500000 });
  await fails(rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [{ product_id: id, qty: 4 }] }), 'cost_not_set');
  await rpc(OWNER, 'set_last_cost', { p_product: id, p_cost: 300000 });
  const key = k('rcv');
  const args = { p_key: key, p_supplier: sup, p_location: shop, p_lines: [{ product_id: id, qty: 4 }] };
  same(await moved(() => rpc(STORE, 'receive_goods', args)), { stock: 1200000, suppliers_owed: -1200000 });
  same(await moved(() => rpc(STORE, 'receive_goods', args)), {}, 'retry:');
  same(await shelf({ id }), { qty: 4, reserved: 0 });
});

await test('paying the supplier clears what we owe them', async () => {
  const before = N(await val(`select coalesce(sum(amount_kobo), 0) from ledger_entries where account_code = 'suppliers_owed' and supplier_id = $1`, [sup]));
  same(await moved(() => rpc(ACCOUNT, 'pay_supplier', { p_key: k('sp'), p_supplier: sup, p_amount: 1000000 })), { suppliers_owed: 1000000, bank: -1000000 });
  eq(N(await val(`select coalesce(sum(amount_kobo), 0) from ledger_entries where account_code = 'suppliers_owed' and supplier_id = $1`, [sup])), before + 1000000);
});

await test('selling everything leaves exactly ₦0 of stock value, even when costs do not divide evenly', async () => {
  const p = await product({ cost: 10000, qty: 2 });
  await rpc(OWNER, 'set_last_cost', { p_product: p.id, p_cost: 10100 });
  await rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [line(p, 1)] });
  eq(N(await val('select value_kobo from product_costs where product_id = $1', [p.id])), 30100);
  let cogs = 0;
  for (let i = 0; i < 3; i++) cogs += (await moved(() => sale(p))).cogs;
  eq(cogs, 30100);
  eq(N(await val('select value_kobo from product_costs where product_id = $1', [p.id])), 0);
  eq(N(await val('select on_hand from product_costs where product_id = $1', [p.id])), 0);
});

await test('belts sold by the metre work, and bearings cannot be sold in fractions', async () => {
  const belt = await product({ unit: 'metre', qty: 10, price: 3333, cost: 2000 });
  const s = await sale(belt, { qty: 2.5 });
  eq(N(s.total), 8333);
  same(await shelf(belt), { qty: 7.5, reserved: 0 });
  const bearing = await product();
  await fails(sale(bearing, { qty: 1.5 }), 'bad_qty');
});

await test('serial numbers must match the count and can only exist once', async () => {
  const p = await product({ tracking: 'serial', qty: 2 });
  await fails(rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [line(p, 2, { serials: ['ONLY-ONE'] })] }), 'serial_count_mismatch');
  await fails(rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [line(p, 1, { serials: [p.serials[0]] })] }), 'serial_exists');
  same(await shelf(p), { qty: 2, reserved: 0 });
});

await test('a serial number is in exactly one place, and sells only once', async () => {
  const p = await product({ tracking: 'serial', qty: 2 });
  await rpc(STORE, 'transfer_stock', { p_product: p.id, p_from: shop, p_to: back, p_qty: 1, p_serials: arr('text', [p.serials[0]]) });
  same(await shelf(p), { qty: 1, reserved: 0 });
  same(await shelf(p, back), { qty: 1, reserved: 0 });
  eq(await val('select location_id from serial_units where serial = $1', [p.serials[0]]), back);
  await fails(sale(p, { serials: [p.serials[0]] }), 'serial_not_available');
  await sale(p, { serials: [p.serials[1]] });
  await rpc(STORE, 'transfer_stock', { p_product: p.id, p_from: back, p_to: shop, p_qty: 1, p_serials: arr('text', [p.serials[0]]) });
  await fails(sale(p, { serials: [p.serials[1]] }), 'serial_not_available');
  await sale(p, { serials: [p.serials[0].toLowerCase()] });
  eq(N(await val(`select count(*) from serial_units where product_id = $1 and status = 'sold' and location_id is null`, [p.id])), 2);
});

await test('stock on hold cannot be sold to someone else or moved away', async () => {
  const p = await product({ qty: 2 });
  await order(p, { qty: 2 });
  same(await shelf(p), { qty: 2, reserved: 2 });
  await fails(sale(p), 'insufficient_stock');
  await fails(rpc(STORE, 'transfer_stock', { p_product: p.id, p_from: shop, p_to: back, p_qty: 1 }), 'insufficient_stock');
});

await test('oldest stock is offered first, so batteries do not go flat on the shelf', async () => {
  const id = await rpc(OWNER, 'save_product', { p_sku: k('OLD'), p_name: 'Car battery', p_price: 8000000, p_tracking: 'serial' });
  await rpc(OWNER, 'set_last_cost', { p_product: id, p_cost: 5000000 });
  await rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [{ product_id: id, qty: 1, serials: ['NEW-1'], made_on: '2026-09-01' }] });
  await rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [{ product_id: id, qty: 1, serials: ['OLD-1'], made_on: '2026-01-01' }] });
  const picks = await as(COUNTER, () => q('select serial from oldest_serials($1, $2, 2)', [id, shop]));
  eq(picks.map((r) => r.serial).join(), 'OLD-1,NEW-1');
});

await test('a count is blind, needs the owner, and moves money with the stock', async () => {
  const p = await product({ qty: 10, cost: 6000000 });
  const c = await rpc(STORE, 'submit_stock_count', { p_key: k('cnt'), p_location: shop, p_lines: [{ product_id: p.id, counted: 8 }] });
  same(await shelf(p), { qty: 10, reserved: 0 }, 'before approval:');
  eq(await as(STORE, () => q('select * from stock_count_lines')).then((r) => r.length), 0, 'storekeeper reads expected:');
  await fails(rpc(STORE, 'approve_stock_count', { p_count: c }), 'not_allowed');
  same(await moved(() => rpc(OWNER, 'approve_stock_count', { p_count: c })), { stock: -12000000, stock_differences: 12000000 });
  same(await shelf(p), { qty: 8, reserved: 0 });
  await fails(rpc(OWNER, 'approve_stock_count', { p_count: c }), 'count_already_decided');
  const gain = await rpc(STORE, 'submit_stock_count', { p_key: k('cnt'), p_location: shop, p_lines: [{ product_id: p.id, counted: 9 }] });
  same(await moved(() => rpc(OWNER, 'approve_stock_count', { p_count: gain })), { stock: 6000000, stock_differences: -6000000 });
});

await test('a count difference is applied even if sales happened after the count', async () => {
  const p = await product({ qty: 10 });
  const c = await rpc(STORE, 'submit_stock_count', { p_key: k('cnt'), p_location: shop, p_lines: [{ product_id: p.id, counted: 9 }] });
  await sale(p, { qty: 2 });
  await rpc(OWNER, 'approve_stock_count', { p_count: c });
  same(await shelf(p), { qty: 7, reserved: 0 });
});

// ---- Selling ----

await test('a walk-in pays cash and leaves with the goods, in one step', async () => {
  const p = await product({ price: 15000000, cost: 10000000, qty: 3 });
  let s;
  same(await moved(async () => { s = await sale(p); }), { cash: 15000000, sales: -15000000, cogs: 10000000, stock: -10000000 });
  eq(s.state, 'done');
  const o = await orderRow(s.order_id);
  eq(o.money_status, 'paid');
  eq(o.goods_status, 'delivered');
  same(await shelf(p), { qty: 2, reserved: 0 });
});

await test('retrying a sale after a dropped connection changes nothing', async () => {
  const p = await product({ qty: 5 });
  const key = k('sale');
  const a = await sale(p, { key });
  const change = await moved(async () => {
    const b = await sale(p, { key });
    eq(b.order_id, a.order_id);
    eq(b.invoice_no, a.invoice_no);
  });
  same(change, {});
  same(await shelf(p), { qty: 4, reserved: 0 });
  eq(N(await val('select count(*) from payments where order_id = $1', [a.order_id])), 1);
  eq(N(await val('select count(*) from deliveries where order_id = $1', [a.order_id])), 1);
});

await test('a failed sale leaves nothing behind, and invoice numbers have no gaps', async () => {
  const p = await product({ qty: 1 });
  const n = (s) => Number(s.invoice_no.split('-').pop());
  const first = await sale(p);
  const key = k('sale');
  await fails(sale(p, { key }), 'insufficient_stock');
  eq(N(await val('select count(*) from orders where client_key = $1', [key])), 0);
  await rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [line(p, 1)] });
  const next = await sale(p);
  eq(n(next), n(first) + 1);
});

await test('a deposit is money we owe, and only becomes a sale when goods leave', async () => {
  const p = await product({ price: 100000000, cost: 70000000, qty: 2, tracking: 'serial', warranty: 24 });
  const o = await order(p, { phone: '08030000001' });
  same(await shelf(p), { qty: 2, reserved: 1 });
  let id;
  same(await moved(async () => { id = await pay(o, 40000000, 'transfer', { reference: k('REF') }); }), {}, 'alert alone:');
  const bl = await bankLine(40000000);
  same(await moved(() => rpc(ACCOUNT, 'confirm_payment', { p_payment: id, p_bank_line: bl })), { bank: 40000000, goods_owed: -40000000 });
  eq((await orderRow(o)).money_status, 'part_paid');
  await fails(deliver(o, [line(p, 1, { serials: [p.serials[0]] })]), 'payment_required');
  same(await shelf(p), { qty: 2, reserved: 1 }, 'after refused delivery:');
  same(await moved(() => pay(o, 60000000)), { cash: 60000000, goods_owed: -60000000 });
  same(await moved(() => deliver(o, [line(p, 1, { serials: [p.serials[0]] })])), { goods_owed: 100000000, sales: -100000000, cogs: 70000000, stock: -70000000 });
  const row = await orderRow(o);
  eq(row.goods_status, 'delivered');
  eq(row.hold_until, null);
  same(await shelf(p), { qty: 1, reserved: 0 });
  const unit = (await q(`select to_char(sold_on, 'YYYY-MM') s, to_char(warranty_ends_on, 'YYYY-MM') w, customer_id c from serial_units where serial = $1`, [p.serials[0]]))[0];
  eq(unit.c, await customerByPhone('08030000001'));
  eq(Number(unit.w.slice(0, 4)), Number(unit.s.slice(0, 4)) + 2, 'warranty years:');
});

await test('a fake transfer alert never turns into money or goods', async () => {
  const p = await product({ qty: 1 });
  const s = await sale(p, { method: 'transfer', reference: 'FAKE-1' });
  eq(s.state, 'awaiting_transfer');
  await fails(deliver(s.order_id), 'payment_required');
  const id = await val('select id from payments where order_id = $1', [s.order_id]);
  await fails(rpc(ACCOUNT, 'reject_payment', { p_payment: id, p_reason: '' }), 'reason_required');
  same(await moved(() => rpc(ACCOUNT, 'reject_payment', { p_payment: id, p_reason: 'Not on the statement' })), {});
  await fails(deliver(s.order_id), 'payment_required');
  await fails(rpc(ACCOUNT, 'confirm_payment', { p_payment: id, p_bank_line: await bankLine(10000000) }), 'payment_already_decided');
});

await test('one bank alert cannot be used twice', async () => {
  const p = await product({ qty: 5 });
  const a = await order(p);
  const b = await order(p);
  await pay(a, 10000000, 'transfer', { reference: 'same-ref' });
  await fails(pay(b, 10000000, 'transfer', { reference: ' SAME-REF ' }), 'reference_already_used');
  const c = await order(p);
  const d = await order(p);
  const pc = await pay(c, 5000000, 'transfer');
  const pd = await pay(d, 5000000, 'transfer');
  const bl = await bankLine(5000000);
  await rpc(ACCOUNT, 'confirm_payment', { p_payment: pc, p_bank_line: bl });
  await fails(rpc(ACCOUNT, 'confirm_payment', { p_payment: pd, p_bank_line: bl }), 'bank_line_used_up');
  await rpc(ACCOUNT, 'reject_payment', { p_payment: pd, p_reason: 'Only one came in' });
});

await test('one big transfer can pay for two orders', async () => {
  const p = await product({ qty: 5 });
  const a = await order(p);
  const b = await order(p);
  const bl = await bankLine(15000000);
  const pa = await pay(a, 10000000, 'transfer');
  const pb = await pay(b, 5000000, 'transfer');
  await rpc(ACCOUNT, 'confirm_payment', { p_payment: pa, p_bank_line: bl });
  await rpc(ACCOUNT, 'confirm_payment', { p_payment: pb, p_bank_line: bl });
  eq(N(await val('select matched_kobo from bank_lines where id = $1', [bl])), 15000000);
  await pay(b, 5000000);
});

await test('nobody confirms their own transfer, and only the owner can do it without a statement line', async () => {
  const p = await product({ qty: 3 });
  const o = await order(p);
  const mine = await pay(o, 1000000, 'transfer', { who: ACCOUNT });
  await fails(rpc(ACCOUNT, 'confirm_payment', { p_payment: mine, p_bank_line: await bankLine(1000000) }), 'cannot_confirm_own_payment');
  const theirs = await pay(o, 1000000, 'transfer');
  await fails(rpc(ACCOUNT, 'confirm_payment', { p_payment: theirs }), 'bank_line_required');
  await rpc(OWNER, 'confirm_payment', { p_payment: mine });
  await rpc(OWNER, 'confirm_payment', { p_payment: theirs });
  eq(N((await orderRow(o)).paid_kobo), 2000000);
});

await test('a transfer confirmed against the statement is dated when the money arrived', async () => {
  const p = await product({ qty: 1 });
  const o = await order(p);
  const id = await pay(o, 1000000, 'transfer');
  const bl = await bankLine(1000000, ago(8, 5));
  await rpc(ACCOUNT, 'confirm_payment', { p_payment: id, p_bank_line: bl });
  eq(await val(`select occurred_on::text from ledger_txns where ref_type = 'payment' and ref_id = $1`, [id]), ago(8, 5));
});

await test('part deliveries add up to the exact price, VAT included', async () => {
  const belt = await product({ unit: 'metre', qty: 10, price: 3333, cost: 2000, vat: 750 });
  const o = await order(belt, { qty: 2.5 });
  const row = await orderRow(o);
  eq(N(row.total_kobo), 8333);
  eq(N(row.vat_kobo), 581);
  await pay(o, 8333);
  const first = await moved(() => deliver(o, [line(belt, 1.25)]));
  eq((await orderRow(o)).goods_status, 'part_delivered');
  same(await shelf(belt), { qty: 8.75, reserved: 1.25 });
  const second = await moved(() => deliver(o, [line(belt, 1.25)]));
  eq(first.sales + second.sales, -(8333 - 581));
  eq(first.vat_payable + second.vat_payable, -581);
  eq(N((await orderRow(o)).billed_kobo), 8333);
  eq((await orderRow(o)).goods_status, 'delivered');
  await fails(deliver(o, [line(belt, 0.5)]), 'nothing_to_deliver');
});

await test('prices include VAT, and the sale splits it out', async () => {
  const p = await product({ price: 10750000, cost: 5000000, vat: 750 });
  same(await moved(() => sale(p)), { cash: 10750000, sales: -10000000, vat_payable: -750000, cogs: 5000000, stock: -5000000 });
});

await test('credit sale within the limit, debt on the call list, paid off later', async () => {
  const phone = '08030000002';
  const c = await rpc(COUNTER, 'save_customer', { p_phone: phone, p_name: 'Musa Installer' });
  await rpc(OWNER, 'set_customer_terms', { p_customer: c, p_kind: 'business', p_credit_limit: 50000000 });
  const p = await product({ price: 30000000, cost: 20000000 });
  const o = await order(p, { phone, credit: true });
  same(await moved(() => deliver(o)), { customers_owe: 30000000, sales: -30000000, cogs: 20000000, stock: -20000000 });
  const list = await as(COUNTER, () => q('select * from debtors()'));
  eq(N(list.find((d) => d.customer_id === c).owed_kobo), 30000000);
  same(await moved(() => pay(o, 10000000, 'cash')), { cash: 10000000, customers_owe: -10000000 });
  eq(N((await rpc(COUNTER, 'customer_balance', { p_customer: c })).owes), 20000000);
});

await test('over the credit limit needs the owner, and the limit is checked again when goods leave', async () => {
  const phone = '08030000003';
  const c = await rpc(COUNTER, 'save_customer', { p_phone: phone });
  await rpc(OWNER, 'set_customer_terms', { p_customer: c, p_kind: 'retail', p_credit_limit: 50000000 });
  const p = await product({ price: 30000000, cost: 20000000 });
  const a = await order(p, { phone, credit: true });
  const b = await order(p, { phone, credit: true });
  eq((await orderRow(b)).needs_approval, false, 'each fits alone:');
  await deliver(a);
  await fails(deliver(b), 'over_credit_limit');
  same(await moved(() => pay(a, 30000000, 'cash')), { cash: 30000000, customers_owe: -30000000 });
  await deliver(b);
  const big = await order(p, { phone, credit: true, qty: 2 });
  eq((await orderRow(big)).needs_approval, true);
  await fails(deliver(big), 'awaiting_approval');
  const ap = await val(`select id from approvals where order_id = $1 and kind = 'credit'`, [big]);
  await fails(rpc(COUNTER, 'decide_approval', { p_approval: ap, p_yes: true }), 'not_allowed');
  await rpc(OWNER, 'decide_approval', { p_approval: ap, p_yes: true, p_note: 'Known customer' });
  await deliver(big);
  eq(N((await rpc(COUNTER, 'customer_balance', { p_customer: c })).owes), 90000000);
});

await test('credit needs a named customer, and cash customers cannot walk off owing', async () => {
  const p = await product();
  await fails(order(p, { credit: true }), 'credit_needs_customer');
  const o = await order(p, { phone: '08030000004' });
  await fails(deliver(o), 'payment_required');
});

await test('a discount over the staff limit waits for the owner, and a refusal frees the stock', async () => {
  const p = await product({ price: 10000000, qty: 2 });
  const ok = await sale(p, { price: 9600000 });
  eq(ok.state, 'done');
  const s = await sale(p, { price: 9000000 });
  eq(s.state, 'awaiting_approval');
  same(await shelf(p), { qty: 1, reserved: 1 });
  await fails(pay(s.order_id, 9000000), 'awaiting_approval');
  await fails(deliver(s.order_id), 'awaiting_approval');
  const ap = await val('select id from approvals where order_id = $1', [s.order_id]);
  await rpc(OWNER, 'decide_approval', { p_approval: ap, p_yes: false, p_note: 'Too low' });
  eq((await orderRow(s.order_id)).goods_status, 'cancelled');
  same(await shelf(p), { qty: 1, reserved: 0 });
  await fails(rpc(OWNER, 'decide_approval', { p_approval: ap, p_yes: true }), 'approval_already_decided');
});

await test('an approved discount goes through, and the owner needs no approval', async () => {
  const p = await product({ price: 10000000, qty: 3 });
  const s = await sale(p, { price: 8000000, who: COUNTER2, method: 'pos' });
  eq(s.state, 'awaiting_approval');
  const ap = await val('select id from approvals where order_id = $1', [s.order_id]);
  await rpc(OWNER, 'decide_approval', { p_approval: ap, p_yes: true });
  await pay(s.order_id, 8000000);
  await deliver(s.order_id);
  await rpc(OWNER, 'save_staff', { p_user: OWNER, p_name: 'Owner', p_role: 'owner' });
  const o = await order(p, { who: OWNER, price: 1000000 });
  eq((await orderRow(o)).needs_approval, false);
});

await test('trade customers get trade price automatically, which counter staff cannot grant', async () => {
  const phone = '08030000005';
  const p = await product({ price: 10000000, trade: 8500000 });
  const c = await rpc(COUNTER, 'save_customer', { p_phone: phone });
  await fails(rpc(COUNTER, 'set_customer_terms', { p_customer: c, p_kind: 'installer', p_credit_limit: 0 }), 'not_allowed');
  eq(N((await orderRow(await order(p, { phone }))).total_kobo), 10000000);
  await rpc(OWNER, 'set_customer_terms', { p_customer: c, p_kind: 'installer', p_credit_limit: 0 });
  const trade = await orderRow(await order(p, { phone }));
  eq(N(trade.total_kobo), 8500000);
  eq(trade.needs_approval, false);
});

await test('unpaid holds run out and free the stock', async () => {
  const p = await product({ qty: 1 });
  const o = await order(p);
  await rpc('service', 'expire_holds');
  eq((await orderRow(o)).goods_status, 'waiting', 'not yet:');
  await q(`update orders set hold_until = now() - interval '1 hour' where id = $1`, [o]);
  await rpc('service', 'expire_holds');
  eq((await orderRow(o)).goods_status, 'cancelled');
  same(await shelf(p), { qty: 1, reserved: 0 });
});

await test('a hold with money stays open, its goods go back on sale, and staff are told', async () => {
  const p = await product({ qty: 1 });
  const o = await order(p, { phone: '08030000006' });
  await pay(o, 2000000);
  await q(`update orders set hold_until = now() - interval '1 hour' where id = $1`, [o]);
  await rpc('service', 'expire_holds');
  const row = await orderRow(o);
  eq(row.goods_status, 'waiting');
  eq(row.hold_lapsed, true);
  eq(N(row.paid_kobo), 2000000);
  same(await shelf(p), { qty: 1, reserved: 0 });
  const seen = await rpc(OWNER, 'owner_exceptions');
  expect(seen.holds_lapsed.some((h) => h.invoice_no === row.invoice_no), 'owner not told');
  await sale(p);
  eq(await rpc(COUNTER, 'reserve_order', { p_order: o }), false, 'none left:');
  await rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [line(p, 1)] });
  eq(await rpc(COUNTER, 'reserve_order', { p_order: o }), true);
  await pay(o, 8000000);
  await deliver(o);
});

await test('a hold waiting on a transfer does not run out', async () => {
  const p = await product({ qty: 1 });
  const o = await order(p);
  const id = await pay(o, 1000000, 'transfer');
  await q(`update orders set hold_until = now() - interval '1 hour' where id = $1`, [o]);
  await rpc('service', 'expire_holds');
  eq((await orderRow(o)).goods_status, 'waiting');
  same(await shelf(p), { qty: 1, reserved: 1 });
  await rpc(ACCOUNT, 'reject_payment', { p_payment: id, p_reason: 'No money' });
});

await test('a deposit can be taken on goods still on their way', async () => {
  const p = await product({ qty: 0, price: 5000000 });
  await fails(order(p), 'insufficient_stock');
  const o = await order(p, { backorder: true, phone: '08030000007' });
  same(await shelf(p), { qty: 0, reserved: 0 });
  await pay(o, 5000000);
  await fails(deliver(o), 'insufficient_stock');
  await rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [line(p, 1)] });
  eq(await rpc(DISPATCH, 'reserve_order', { p_order: o }), true);
  await deliver(o, null, DISPATCH);
  eq((await orderRow(o)).goods_status, 'delivered');
});

await test('money sent over the price is held for the customer and can be refunded, no more', async () => {
  const p = await product({ price: 10000000, cost: 5000000 });
  const o = await order(p);
  const id = await pay(o, 12000000, 'transfer');
  await rpc(ACCOUNT, 'confirm_payment', { p_payment: id, p_bank_line: await bankLine(12000000) });
  eq((await orderRow(o)).money_status, 'overpaid');
  await deliver(o);
  await fails(rpc(ACCOUNT, 'refund_order', { p_key: k('rf'), p_order: o, p_amount: 3000000, p_method: 'transfer', p_reason: 'Change' }), 'refund_more_than_held');
  same(await moved(() => rpc(ACCOUNT, 'refund_order', { p_key: k('rf'), p_order: o, p_amount: 2000000, p_method: 'transfer', p_reason: 'Change' })), { goods_owed: 2000000, bank: -2000000 });
  eq((await orderRow(o)).money_status, 'paid');
});

await test('cash and card cannot overpay, because the extra is change', async () => {
  const p = await product({ price: 1000000 });
  const o = await order(p);
  await fails(pay(o, 1000001, 'cash'), 'more_than_owed');
  await fails(pay(o, 1000001, 'pos'), 'more_than_owed');
  await fails(pay(o, 0, 'cash'), 'bad_amount');
  await fails(pay(o, -5, 'cash'), 'bad_amount');
});

await test('an order with money cannot be cancelled until it is refunded', async () => {
  const p = await product({ qty: 1 });
  const o = await order(p);
  await pay(o, 1000000);
  await fails(rpc(COUNTER, 'cancel_order', { p_order: o, p_reason: 'Changed mind' }), 'refund_first');
  await rpc(ACCOUNT, 'refund_order', { p_key: k('rf'), p_order: o, p_amount: 1000000, p_method: 'transfer', p_reason: 'Changed mind' });
  await rpc(COUNTER, 'cancel_order', { p_order: o, p_reason: 'Changed mind' });
  same(await shelf(p), { qty: 1, reserved: 0 });
  await fails(pay(o, 1000, 'pos'), 'order_cancelled');
  await fails(deliver(o), 'order_cancelled');
});

await test('delivered goods cannot be cancelled away', async () => {
  const p = await product();
  const s = await sale(p);
  await fails(rpc(COUNTER, 'cancel_order', { p_order: s.order_id, p_reason: 'x' }), 'goods_already_left');
});

await test('a bounced payment after delivery puts the debt on the customer', async () => {
  const phone = '08030000008';
  const p = await product({ price: 20000000, cost: 10000000 });
  const s = await sale(p, { method: 'pos', phone });
  const id = await val('select id from payments where order_id = $1', [s.order_id]);
  // The card was matched against the bank line first; only then can it bounce.
  await rpc(ACCOUNT, 'confirm_payment', { p_payment: id, p_bank_line: await bankLine(20000000) });
  await fails(rpc(ACCOUNT, 'reverse_payment', { p_payment: id, p_reason: 'Bounced' }), 'not_allowed');
  same(await moved(() => rpc(OWNER, 'reverse_payment', { p_payment: id, p_reason: 'POS chargeback' })), { bank: -20000000, customers_owe: 20000000 });
  await fails(rpc(OWNER, 'reverse_payment', { p_payment: id, p_reason: 'again' }), 'cannot_reverse_this_payment');
  eq(N((await rpc(COUNTER, 'customer_balance', { p_customer: await customerByPhone(phone) })).owes), 20000000);
});

await test('a till closes blind: expected is never shown, shortages go to the books', async () => {
  const p = await product({ price: 1000000, cost: 500000 });
  await fails(sale(p, { who: COUNTER2 }), 'till_not_open');
  const t = await rpc(COUNTER2, 'open_till', { p_float: 500000 });
  await fails(rpc(COUNTER2, 'open_till', { p_float: 1 }), 'till_already_open');
  await sale(p, { who: COUNTER2 });
  same(await moved(() => rpc(COUNTER2, 'till_paid_out', { p_key: k('out'), p_account: 'fuel_delivery', p_amount: 200000, p_what: 'Generator fuel' })), { fuel_delivery: 200000, cash: -200000 });
  await fails(rpc(COUNTER2, 'till_paid_out', { p_key: k('out'), p_account: 'sales', p_amount: 1, p_what: 'x' }), 'bad_account');
  const mine = await rpc(COUNTER2, 'my_till');
  expect(!('expected_kobo' in mine) && !('expected' in mine), 'my_till shows expected');
  eq(await as(COUNTER2, () => q('select * from till_sessions')).then((r) => r.length), 0, 'counter reads till rows:');
  let out;
  same(await moved(async () => { out = await rpc(COUNTER2, 'close_till', { p_counted: 1250000 }); }), { cash: -50000, till_differences: 50000 });
  expect(out === '' || out === null, `close_till told the counter something: ${JSON.stringify(out)}`);
  const row = (await q('select * from till_sessions where id = $1', [t]))[0];
  eq(N(row.expected_kobo), 1300000);
  eq(N(row.difference_kobo), -50000);
  await fails(sale(p, { who: COUNTER2 }), 'till_not_open');
});

await test('cash over is recorded too, and the owner can close a till someone forgot', async () => {
  await rpc(COUNTER2, 'open_till', { p_float: 100000 });
  const t = await val(`select id from till_sessions where staff_id = $1 and status = 'open'`, [COUNTER2]);
  await fails(rpc(COUNTER, 'close_till', { p_counted: 1, p_session: t }), 'not_allowed');
  same(await moved(() => rpc(OWNER, 'close_till', { p_counted: 120000, p_session: t })), { cash: 20000, till_differences: -20000 });
  const seen = await rpc(ACCOUNT, 'owner_exceptions');
  expect(seen.till_differences.length >= 2, 'differences not listed');
});

await test('a sale below cost goes through at the counter and shows on the owner screen', async () => {
  const p = await product({ price: 10000000, cost: 9900000 });
  const s = await sale(p, { price: 9500000 });
  eq(s.state, 'done');
  const seen = await rpc(OWNER, 'owner_exceptions');
  expect(seen.below_cost.some((b) => b.invoice_no === s.invoice_no), 'below-cost sale not flagged');
});

await test('the month report matches the entries', async () => {
  const month = await val(`select date_trunc('month', shop_today())::date::text`);
  const report = await rpc(ACCOUNT, 'month_report', { p_month: month });
  const raw = await q(`select e.account_code a, sum(e.amount_kobo) s from ledger_entries e join ledger_txns t on t.id = e.txn_id
    join ledger_accounts l on l.code = e.account_code
    where l.kind in ('income', 'expense') and date_trunc('month', t.occurred_on)::date = $1::date group by 1`, [month]);
  const net = raw.reduce((sum, r) => sum + N(r.s), 0);
  eq(N(report.profit), -net);
  expect(N(report.income) > 0, 'no income this month');
  const bank = N(await val(`select coalesce(sum(e.amount_kobo), 0) from ledger_entries e join ledger_txns t on t.id = e.txn_id where e.account_code = 'bank' and t.occurred_on < ($1::date + interval '1 month')`, [month]));
  eq(N(report.balances.bank), bank);
});

await test('the receipt link shows one order to anyone holding it, and never cost', async () => {
  const p = await product({ price: 8000000, cost: 7777777, tracking: 'serial', qty: 1, warranty: 12 });
  const s = await sale(p, { phone: '08030000009', serials: [p.serials[0]], method: 'pos' });
  // The card is matched against the bank line before the receipt can show the order as paid.
  await rpc(ACCOUNT, 'confirm_payment', { p_payment: await val('select id from payments where order_id = $1', [s.order_id]), p_bank_line: await bankLine(8000000) });
  const token = await val('select receipt_token from orders where id = $1', [s.order_id]);
  const r = await rpc('anon', 'receipt_by_token', { p_token: token });
  eq(r.invoice_no, s.invoice_no);
  eq(N(r.balance), 0);
  eq(r.lines[0].serials[0].serial, p.serials[0]);
  expect(r.lines[0].serials[0].warranty_ends_on, 'no warranty date');
  expect(!JSON.stringify(r).includes('7777777') && !/cost/i.test(JSON.stringify(r)), 'cost on receipt');
  eq(await rpc('anon', 'receipt_by_token', { p_token: randomUUID() }), null);
});

await test('anyone can check a serial number, and it reveals nothing about who bought it', async () => {
  const p = await product({ tracking: 'serial', qty: 1, warranty: 12 });
  await sale(p, { serials: [p.serials[0]], phone: '08030000010', method: 'pos' });
  const found = await rpc('anon', 'check_serial', { p_serial: p.serials[0].toLowerCase() });
  eq(found.found, true);
  eq(found.sold, true);
  expect(!JSON.stringify(found).includes('2340'), 'phone leaked');
  eq((await rpc('anon', 'check_serial', { p_serial: 'NOPE' })).found, false);
});

await test('the public store sees in, low or out, never counts', async () => {
  const a = await product({ qty: 5, low: 2 });
  const b = await product({ qty: 2, low: 2 });
  const c = await product({ qty: 0 });
  const rows = await as('anon', () => q(`select * from availability($1::text::uuid[])`, [`{${a.id},${b.id},${c.id}}`]));
  const state = Object.fromEntries(rows.map((r) => [r.product_id, r.state]));
  same(state, { [a.id]: 'in', [b.id]: 'low', [c.id]: 'out' });
});

await test('the check catches books changed behind its back', async () => {
  const p = await product({ qty: 1 });
  await q('update product_costs set value_kobo = value_kobo + 1 where product_id = $1', [p.id]);
  const a = await val('select i_books_check()');
  expect(!a.ok && a.problems.some((x) => x.startsWith('stock account')), 'value change missed');
  await q('update product_costs set value_kobo = value_kobo - 1 where product_id = $1', [p.id]);
  await q('update stock_balances set qty = qty + 1 where product_id = $1', [p.id]);
  const b = await val('select i_books_check()');
  expect(!b.ok && b.problems.some((x) => x.includes('disagree with their movements')), 'shelf change missed');
  await q('update stock_balances set qty = qty - 1 where product_id = $1', [p.id]);
  const o = await order(p);
  await q('update orders set paid_kobo = 5 where id = $1', [o]);
  const c = await val('select i_books_check()');
  expect(!c.ok && c.problems.some((x) => x.startsWith('goods owed')), 'order change missed');
  await q('update orders set paid_kobo = 0 where id = $1', [o]);
  await q(`update orders set note = 'Opening balance', billed_kobo = 5, paid_kobo = 5 where id = $1`, [o]);
  const d = await val('select i_books_check()');
  expect(!d.ok && d.problems.some((x) => x.includes('disagree with their lines')), 'a note must not switch the check off');
  await q('update orders set note = null, billed_kobo = 0, paid_kobo = 0 where id = $1', [o]);
});

// ---- Each of these was a real bug, found by a second reader trying to break the first version ----

await test('a give-away cannot hide behind an overpriced line', async () => {
  const panel = await product({ price: 10000000, cost: 6000000 });
  const cheap = await product({ price: 100000, cost: 50000 });
  const free = await rpc(COUNTER2, 'create_order', { p_key: k('ord'), p_location: shop, p_lines: [line(panel, 1, { unit_price: 0 }), line(cheap, 1, { unit_price: 10100000 })] });
  eq((await orderRow(free)).needs_approval, true, 'free line:');
  await fails(deliver(free, [line(panel, 1)], COUNTER2), 'awaiting_approval');
  const cut = await rpc(COUNTER2, 'create_order', { p_key: k('ord'), p_location: shop, p_lines: [line(panel, 1, { unit_price: 6100000 }), line(cheap, 1, { unit_price: 4000000 })] });
  eq((await orderRow(cut)).needs_approval, true, '39% off one line:');
});

await test('quantities are checked at every door: no fractions of a bearing, no nonsense', async () => {
  const p = await product({ qty: 5 });
  const o = await order(p, { qty: 3 });
  await pay(o, 30000000);
  for (const qty of [0.001, 0.5, 0.9996, 1.5]) await fails(deliver(o, [line(p, qty)]), 'bad_qty');
  await fails(rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [line(p, 1.5)] }), 'bad_qty');
  await fails(rpc(STORE, 'transfer_stock', { p_product: p.id, p_from: shop, p_to: back, p_qty: 0.5 }), 'bad_qty');
  await fails(rpc(STORE, 'submit_stock_count', { p_key: k('cnt'), p_location: shop, p_lines: [{ product_id: p.id, counted: 8.5 }] }), 'bad_qty');
  await fails(rpc(STORE, 'submit_stock_count', { p_key: k('cnt'), p_location: shop, p_lines: [{ product_id: p.id, counted: 'NaN' }] }), 'bad_qty');
  const belt = await product({ unit: 'metre', qty: 10, price: 1000, cost: 500 });
  await fails(sale(belt, { qty: 2.4130000000000003 }), 'bad_qty');
  await fails(sale(belt, { qty: 1.2345 }), 'bad_qty');
  await fails(sale(belt, { qty: 2000000 }), 'bad_qty');
  await sale(belt, { qty: 1.234 });
  same(await shelf(belt), { qty: 8.766, reserved: 0 });
});

await test('no refused call carries a cost or a hidden figure in its error', async () => {
  const cost = 6123457;
  const p = await product({ qty: 1, cost });
  const o = await order(p);
  const tries = [
    () => deliver(o, [line(p, 0.9996)]),
    () => deliver(o, [line(p, 0.0004)]),
    () => rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [line(p, '99999999999999999999', { made_on: 'not-a-date' })] }),
    () => rpc(STORE, 'submit_stock_count', { p_key: k('cnt'), p_location: shop, p_lines: [{ product_id: p.id, counted: -1 }] }),
    () => rpc(STORE, 'submit_stock_count', { p_key: k('cnt'), p_location: shop, p_lines: [{ product_id: p.id }] }),
  ];
  for (const attempt of tries) {
    const e = await errorOf(attempt());
    expect(e, 'it should have been refused');
    const text = [e.message, e.detail, e.hint].join(' ');
    expect(!text.includes(String(cost)), `cost in error: ${text}`);
    expect(text.includes('bad_qty'), `expected bad_qty, got: ${text}`);
  }
});

await test('a storekeeper cannot work out cost from what a huge delivery does', async () => {
  const cheap = await product({ qty: 0, cost: 1 });
  const dear = await product({ qty: 0, cost: 900000000000 });
  for (const qty of ['1000001', '99999999999']) {
    const a = await errorOf(rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [line(cheap, qty)] }));
    const b = await errorOf(rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [line(dear, qty)] }));
    eq(a.message, b.message, 'answers differ by cost:');
  }
});

await test('the person counting cannot look up the shelf figure', async () => {
  const p = await product({ qty: 25, tracking: 'serial' });
  for (const t of ['stock_balances', 'stock_movements', 'serial_units']) {
    eq((await as(STORE, () => q(`select * from ${t} limit 1`))).length, 0, `storekeeper reads ${t}:`);
  }
  expect((await as(COUNTER, () => q('select * from stock_balances limit 1'))).length === 1, 'counter still needs shelf numbers');
  const picks = await as(STORE, () => q(`select serial from oldest_serials($1, $2, 100)`, [p.id, shop]));
  eq(picks.length, 20, 'a pick list must not double as a count:');
});

await test('a transfer needs both ends, so stock cannot appear from nowhere', async () => {
  const p = await product({ qty: 2 });
  await fails(rpc(STORE, 'transfer_stock', { p_product: p.id, p_from: null, p_to: shop, p_qty: 1000 }), 'bad_location');
  await fails(rpc(STORE, 'transfer_stock', { p_product: p.id, p_from: shop, p_to: null, p_qty: 1 }), 'bad_location');
  same(await shelf(p), { qty: 2, reserved: 0 });
});

await test('a cash refund must come out of a till someone is counting', async () => {
  const p = await product({ price: 1000000 });
  const o = await order(p);
  await pay(o, 1000000, 'cash');
  await fails(rpc(ACCOUNT, 'refund_order', { p_key: k('rf'), p_order: o, p_amount: 300000, p_method: 'cash', p_reason: 'Part back' }), 'till_not_open');
  await rpc(ACCOUNT, 'open_till', { p_float: 300000 });
  same(await moved(() => rpc(ACCOUNT, 'refund_order', { p_key: k('rf'), p_order: o, p_amount: 300000, p_method: 'cash', p_reason: 'Part back' })), { cash: -300000, goods_owed: 300000 });
  same(await moved(() => rpc(ACCOUNT, 'close_till', { p_counted: 0 })), {}, 'drawer matches:');
});

await test('a key used for something else is refused, never answered with the old result', async () => {
  const p = await product({ qty: 30, price: 1000000 });
  const a = await order(p);
  const b = await order(p);
  const key = k('pay');
  await rpc(COUNTER, 'take_payment', { p_key: key, p_order: a, p_method: 'pos', p_amount: 1000000 });
  await fails(rpc(COUNTER, 'take_payment', { p_key: key, p_order: b, p_method: 'pos', p_amount: 1000000 }), 'key_reused');
  await fails(rpc(COUNTER, 'take_payment', { p_key: key, p_order: a, p_method: 'pos', p_amount: 500 }), 'key_reused');
  await fails(rpc(ACCOUNT, 'refund_order', { p_key: key, p_order: a, p_amount: 1000, p_method: 'transfer', p_reason: 'x' }), 'key_reused');
  const go = k('go');
  await rpc(COUNTER, 'deliver_order', { p_key: go, p_order: a });
  await pay(b, 1000000);
  await fails(rpc(COUNTER, 'deliver_order', { p_key: go, p_order: b }), 'key_reused');
  const ok = k('ord');
  await rpc(COUNTER, 'create_order', { p_key: ok, p_location: shop, p_lines: [line(p, 5)] });
  await fails(sale(p, { key: ok, qty: 1 }), 'key_reused');
  const rk = k('rcv');
  await rpc(STORE, 'receive_goods', { p_key: rk, p_supplier: sup, p_location: shop, p_lines: [line(p, 1)] });
  await fails(rpc(STORE, 'receive_goods', { p_key: rk, p_supplier: sup, p_location: shop, p_lines: [line(p, 99)] }), 'key_reused');
  const ek = k('exp');
  await rpc(ACCOUNT, 'record_expense', { p_key: ek, p_account: 'rent', p_amount: 100, p_paid_from: 'bank', p_what: 'x' });
  await fails(rpc(ACCOUNT, 'record_expense', { p_key: ek, p_account: 'rent', p_amount: 200, p_paid_from: 'bank', p_what: 'x' }), 'key_reused');
  same(await moved(() => rpc(ACCOUNT, 'move_money', { p_key: ek, p_from: 'cash', p_to: 'bank', p_amount: 5 })), { cash: -5, bank: 5 }, 'a different kind of action is not a collision:');
  const bk = k('bl');
  await rpc(ACCOUNT, 'add_bank_line', { p_key: bk, p_on: ago(0, 1), p_amount: 100 });
  await fails(rpc(ACCOUNT, 'add_bank_line', { p_key: bk, p_on: ago(0, 1), p_amount: 200 }), 'key_reused');
  await fails(rpc(COUNTER, 'till_paid_out', { p_key: k('out'), p_account: 'other_costs', p_amount: 0, p_what: 'x' }), 'bad_amount');
});

await test('a till shortage cannot be hidden by using up its internal ledger key', async () => {
  await rpc(COUNTER2, 'open_till', { p_float: 1000000 });
  const t = await val(`select id from till_sessions where staff_id = $1 and status = 'open'`, [COUNTER2]);
  await rpc(ACCOUNT, 'record_expense', { p_key: `till:${t}`, p_account: 'other_costs', p_amount: 1, p_paid_from: 'bank', p_what: 'x' });
  same(await moved(() => rpc(COUNTER2, 'close_till', { p_counted: 600000 })), { cash: -400000, till_differences: 400000 });
});

await test('a retried count counts once, a second count cannot double the loss, and a bad count can be refused', async () => {
  const p = await product({ qty: 10, cost: 6000000 });
  const key = k('cnt');
  const first = await rpc(STORE, 'submit_stock_count', { p_key: key, p_location: shop, p_lines: [{ product_id: p.id, counted: 8 }] });
  eq(await rpc(STORE, 'submit_stock_count', { p_key: key, p_location: shop, p_lines: [{ product_id: p.id, counted: 8 }] }), first, 'retry:');
  await fails(rpc(STORE, 'submit_stock_count', { p_key: key, p_location: shop, p_lines: [{ product_id: p.id, counted: 7 }] }), 'key_reused');
  const again = await rpc(STORE, 'submit_stock_count', { p_key: k('cnt'), p_location: shop, p_lines: [{ product_id: p.id, counted: 8 }] });
  await rpc(OWNER, 'approve_stock_count', { p_count: first });
  await fails(rpc(OWNER, 'approve_stock_count', { p_count: again }), 'count_out_of_date');
  same(await shelf(p), { qty: 8, reserved: 0 });
  await fails(rpc(OWNER, 'reject_stock_count', { p_count: again, p_reason: ' ' }), 'reason_required');
  await fails(rpc(STORE, 'reject_stock_count', { p_count: again, p_reason: 'x' }), 'not_allowed');
  await rpc(OWNER, 'reject_stock_count', { p_count: again, p_reason: 'Second count of the same shelf' });
  await fails(rpc(OWNER, 'reject_stock_count', { p_count: again, p_reason: 'x' }), 'count_already_decided');
  const typo = await rpc(STORE, 'submit_stock_count', { p_key: k('cnt'), p_location: shop, p_lines: [{ product_id: p.id, counted: 1000 }] });
  same(await moved(() => rpc(OWNER, 'reject_stock_count', { p_count: typo, p_reason: 'Typed 1000' })), {});
});

await test('a hold running out never cancels goods that have left, and tidies up after a refund', async () => {
  const gift = await product({ qty: 2, price: 500000, cost: 100000 });
  const main = await product({ qty: 2, price: 1000000 });
  const o = await rpc(OWNER, 'create_order', { p_key: k('ord'), p_location: shop, p_lines: [line(gift, 1, { unit_price: 0 }), line(main, 1)] });
  await deliver(o, [line(gift, 1)]);
  await q(`update orders set hold_until = now() - interval '1 hour' where id = $1`, [o]);
  await rpc('service', 'expire_holds');
  const row = await orderRow(o);
  eq(row.goods_status, 'part_delivered');
  eq(row.hold_lapsed, true);
  same(await shelf(main), { qty: 2, reserved: 0 });
  const p = await product({ qty: 1, price: 1000000 });
  const d = await order(p);
  await pay(d, 1000000);
  await q(`update orders set hold_until = now() - interval '1 hour' where id = $1`, [d]);
  await rpc('service', 'expire_holds');
  eq((await orderRow(d)).hold_lapsed, true);
  await rpc(ACCOUNT, 'refund_order', { p_key: k('rf'), p_order: d, p_amount: 1000000, p_method: 'transfer', p_reason: 'Changed mind' });
  await rpc('service', 'expire_holds');
  eq((await orderRow(d)).goods_status, 'cancelled', 'no money and no goods left:');
});

await test('an unpaid order only ever gets the short hold', async () => {
  const p = await product({ qty: 1 });
  const o = await order(p);
  await rpc(COUNTER, 'reserve_order', { p_order: o });
  eq(await val(`select hold_until < now() + interval '2 days' from orders where id = $1`, [o]), true);
});

await test('a yes given after the hold ran out sticks', async () => {
  const p = await product({ qty: 2, price: 10000000 });
  const s = await sale(p, { price: 5000000 });
  await q(`update orders set hold_until = now() - interval '1 hour' where id = $1`, [s.order_id]);
  await rpc(OWNER, 'decide_approval', { p_approval: await val('select id from approvals where order_id = $1', [s.order_id]), p_yes: true });
  await rpc('service', 'expire_holds');
  const row = await orderRow(s.order_id);
  eq(row.goods_status, 'waiting');
  eq(row.needs_approval, false);
});

await test('a nameless walk-in whose payment bounced still shows as owed', async () => {
  const p = await product({ price: 12345600 });
  const s = await sale(p, { method: 'pos' });
  const pid = await val('select id from payments where order_id = $1', [s.order_id]);
  await rpc(ACCOUNT, 'confirm_payment', { p_payment: pid, p_bank_line: await bankLine(12345600) });
  await rpc(OWNER, 'reverse_payment', { p_payment: pid, p_reason: 'Chargeback' });
  const list = await as(COUNTER, () => q('select * from debtors()'));
  const nameless = list.find((d) => d.customer_id === null);
  expect(nameless && N(nameless.owed_kobo) >= 12345600, 'debt is invisible');
});

await test('counter staff can only pay small running costs from the drawer', async () => {
  for (const account of ['cogs', 'stock_differences', 'till_differences', 'stock', 'sales']) {
    await fails(rpc(COUNTER, 'till_paid_out', { p_key: k('out'), p_account: account, p_amount: 100, p_what: 'x' }), 'bad_account');
  }
  await fails(rpc(COUNTER, 'till_paid_out', { p_key: k('out'), p_account: 'other_costs', p_amount: 5000001, p_what: 'Big' }), 'over_paid_out_limit');
  await fails(rpc(COUNTER, 'till_paid_out', { p_key: k('out'), p_account: 'other_costs', p_amount: 5000000000, p_what: 'Huge' }), 'over_paid_out_limit');
});

await test('a write with no key is refused, because it could never be retried safely', async () => {
  const p = await product();
  await fails(rpc(ACCOUNT, 'record_expense', { p_key: null, p_account: 'rent', p_amount: 5, p_paid_from: 'bank', p_what: 'x' }), 'key_required');
  await fails(rpc(ACCOUNT, 'move_money', { p_key: '  ', p_from: 'cash', p_to: 'bank', p_amount: 5 }), 'key_required');
  await fails(rpc(ACCOUNT, 'pay_supplier', { p_key: null, p_supplier: sup, p_amount: 5 }), 'key_required');
  await fails(rpc(COUNTER, 'create_order', { p_key: null, p_location: shop, p_lines: [line(p)] }), 'key_required');
  await fails(rpc(STORE, 'submit_stock_count', { p_key: null, p_location: shop, p_lines: [] }), 'key_required');
  await fails(rpc(OWNER, 'owner_money_in', { p_key: null, p_account: 'cash', p_amount: 5, p_what: 'x' }), 'key_required');
  await fails(rpc(OWNER, 'owner_money_out', { p_key: ' ', p_account: 'cash', p_amount: 5, p_what: 'x' }), 'key_required');
  await fails(rpc(COUNTER, 'submit_safe_count', { p_key: null, p_counted: 0, p_counted_at: '2026-01-01T00:00:00Z' }), 'key_required');
  await fails(rpc(COUNTER, 'create_quote', { p_key: null, p_location: shop, p_lines: [] }), 'key_required');
  await fails(rpc(COUNTER, 'revise_quote', { p_key: ' ', p_quote: randomUUID(), p_lines: [] }), 'key_required');
});

await test('a retry gets its first answer even after the till has closed', async () => {
  await rpc(COUNTER2, 'open_till', { p_float: 100000 });
  const args = { p_key: k('out'), p_account: 'other_costs', p_amount: 20000, p_what: 'Water' };
  const id = await rpc(COUNTER2, 'till_paid_out', args);
  await rpc(COUNTER2, 'close_till', { p_counted: 80000 });
  same(await moved(async () => { eq(await rpc(COUNTER2, 'till_paid_out', args), id); }), {});
});

await test('money cannot be reversed or refunded to a date before it existed', async () => {
  const p = await product({ price: 1000000 });
  const s = await sale(p, { method: 'pos' });
  const id = await val('select id from payments where order_id = $1', [s.order_id]);
  await rpc(ACCOUNT, 'confirm_payment', { p_payment: id, p_bank_line: await bankLine(1000000) });
  await fails(rpc(OWNER, 'reverse_payment', { p_payment: id, p_reason: 'x', p_on: ago(3, 5) }), 'bad_date');
  const o = await order(p);
  await pay(o, 1000000);
  await fails(rpc(ACCOUNT, 'refund_order', { p_key: k('rf'), p_order: o, p_amount: 1000, p_method: 'transfer', p_reason: 'x', p_on: ago(3, 5) }), 'bad_date');
});

await test('trade prices are for trade customers and staff, not the street', async () => {
  const p = await product({ price: 10000000, trade: 8500000 });
  const retail = randomUUID();
  const trade = randomUUID();
  for (const [user, phone] of [[retail, '08030000201'], [trade, '08030000202']]) {
    await q('insert into auth.users (id) values ($1)', [user]);
    await rpc(COUNTER, 'save_customer', { p_phone: phone });
    await q('update customers set user_id = $1 where phone = normalize_phone($2)', [user, phone]);
  }
  await rpc(OWNER, 'set_customer_terms', { p_customer: await customerByPhone('08030000202'), p_kind: 'installer', p_credit_limit: 0 });
  const read = (who) => as(who, () => q('select trade_price_kobo from product_trade_prices where product_id = $1', [p.id]));
  await fails(read('anon'), 'permission denied');
  eq((await read(retail)).length, 0, 'retail login:');
  eq((await read(trade)).length, 1, 'installer login:');
  eq((await read(COUNTER)).length, 1, 'staff:');
  const row = (await as('anon', () => q('select * from products where id = $1', [p.id])))[0];
  expect(!('trade_price_kobo' in row), 'trade price on the public product row');
});

await test('a temporary table named staff does not make a stranger staff', async () => {
  await as(STRANGER, async () => {
    await db.exec(`create temp table staff (id uuid, name text, role staff_role, discount_limit_pct numeric, active boolean)`);
    try {
      await q(`insert into staff values ($1, 'x', 'owner', 100, true)`, [STRANGER]);
      const c = buildCall('save_location', { p_name: 'Fake' });
      await fails(q(c.text, c.params), 'not_allowed');
    } finally {
      await db.exec('drop table pg_temp.staff');
    }
  });
});

// ---- Who can see and do what ----

const secretTables = ['ledger_accounts', 'ledger_txns', 'ledger_entries', 'closed_periods', 'product_costs', 'order_line_costs', 'goods_receipts', 'stock_counts', 'stock_count_lines', 'till_sessions', 'till_paid_outs', 'bank_lines'];

await test('counter, storekeeper, dispatcher, driver and strangers cannot read cost, ledger or tills', async () => {
  for (const who of [COUNTER, STORE, DISPATCH, DRIVER, STRANGER, BUYER, EXSTAFF]) {
    for (const t of secretTables) {
      const n = await as(who, () => q(`select count(*) c from ${t}`));
      eq(N(n[0].c), 0, `${who} reads ${t}:`);
    }
  }
  for (const who of [OWNER, ACCOUNT]) {
    expect(N((await as(who, () => q('select count(*) c from product_costs')))[0].c) > 0, `${who} should read costs`);
  }
});

await test('the anonymous public cannot read any of it at all', async () => {
  for (const t of [...secretTables, 'product_trade_prices', 'staff', 'customers', 'suppliers', 'audit_log', 'orders', 'order_lines', 'payments', 'deliveries', 'stock_balances', 'serial_units', 'stock_movements', 'lots', 'approvals', 'locations', 'shop_settings']) {
    await fails(as('anon', () => q(`select * from ${t} limit 1`)), 'permission denied');
  }
  expect(N((await as('anon', () => q('select count(*) c from products')))[0].c) > 0, 'public should see products');
});

await test('nothing a counter can read has a cost in it', async () => {
  const readable = ['products', 'orders', 'order_lines', 'deliveries', 'payments', 'stock_balances', 'serial_units', 'order_line_serials', 'customers', 'locations', 'shop_settings', 'approvals'];
  const cols = await q(`select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name = any($1::text::text[]) and (column_name ilike '%cost%' or column_name ilike '%margin%' or column_name ilike '%profit%' or column_name = 'value_kobo')`,
    [`{${readable.join(',')}}`]);
  eq(cols.length, 0, `columns: ${JSON.stringify(cols)}`);
  const entries = await as(COUNTER, () => q(`select detail from approvals limit 50`));
  expect(!/cost/.test(JSON.stringify(entries)), 'cost in approvals');
});

await test('storekeepers and drivers cannot read customer phone numbers', async () => {
  eq(N((await as(STORE, () => q('select count(*) c from customers')))[0].c), 0);
  eq(N((await as(DRIVER, () => q('select count(*) c from customers')))[0].c), 0);
  expect(N((await as(COUNTER, () => q('select count(*) c from customers')))[0].c) > 0, 'counter should read customers');
});

await test('no login can write to any table directly, whatever its role', async () => {
  const tables = (await q(`select tablename t from pg_tables where schemaname = 'public'`)).map((r) => r.t);
  const firstCol = async (t) => val(`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 and is_identity = 'NO' and is_generated = 'NEVER' order by ordinal_position limit 1`, [t]);
  for (const who of [OWNER, COUNTER, 'anon', 'service']) {
    for (const t of tables) {
      const c = await firstCol(t);
      await fails(as(who, () => q(`delete from ${t}`)), 'permission denied');
      await fails(as(who, () => q(`update ${t} set ${c} = ${c}`)), 'permission denied');
      await fails(as(who, () => q(`insert into ${t} default values`)), 'permission denied');
      await fails(as(who, () => q(`truncate ${t} cascade`)), 'permission denied');
    }
  }
});

await test('only the functions on this list can be run from outside', async () => {
  const runnable = async (role) => (await q(`select p.proname n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and has_function_privilege($1, p.oid, 'execute') order by 1`, [role])).map((r) => r.n);
  eq((await runnable('anon')).join(), 'availability,catalogue,check_serial,has_staff_role,is_staff,receipt_by_token,request_quote,shop_details,shop_today');
  eq((await runnable('service_role')).join(), 'expire_holds,i_books_check,shop_today');
  eq((await runnable('authenticated')).join(), [
    'accept_quote', 'add_bank_line', 'approve_safe_count', 'approve_stock_count', 'availability', 'bank_matches', 'books_check', 'books_month', 'cancel_order', 'cancel_quote', 'cash_position', 'catalogue', 'check_serial', 'close_month', 'close_quote_request', 'close_till', 'confirm_payment', 'count_list',
    'counter_sale', 'create_order', 'create_quote', 'customer_balance', 'debtors', 'decide_approval', 'deliver_order', 'has_staff_role', 'import_products', 'is_staff', 'month_close_checks', 'month_report', 'move_money',
    'my_till', 'oldest_serials', 'open_quote_requests', 'open_till', 'owner_exceptions', 'owner_money_in', 'owner_money_out', 'owner_today', 'pack_list', 'pay_supplier', 'post_opening_balance', 'post_opening_debt', 'preview_sale', 'quote_from_request', 'receipt_by_token', 'receive_goods',
    'record_expense', 'refund_order', 'reject_payment', 'reject_safe_count', 'reject_stock_count', 'request_quote', 'reserve_order', 'return_goods', 'reverse_payment', 'reverse_txn', 'revise_quote', 'save_customer', 'save_location', 'save_part_details', 'save_product',
    'save_settings', 'save_staff', 'save_supplier', 'search_parts', 'set_customer_terms', 'set_last_cost', 'shop_details', 'shop_today', 'submit_safe_count', 'submit_stock_count', 'take_payment', 'till_paid_out', 'transfer_stock', 'void_opening_debt',
  ].join());
});

await test('the internal back doors are shut', async () => {
  for (const who of [COUNTER, ACCOUNT, OWNER, 'anon']) {
    await fails(as(who, () => q(`select i_post_txn('x', 'x', current_date, '[]'::jsonb)`)), 'permission denied');
    await fails(as(who, () => q(`select i_audit(null, 'x', 'x', 'x')`)), 'permission denied');
    await fails(as(who, () => q(`select i_take_value('${randomUUID()}', 1)`)), 'permission denied');
    await fails(as(who, () => q(`select i_books_check()`)), 'permission denied');
  }
});

await test('each role is refused what is not its job', async () => {
  const dummy = randomUUID();
  const everyoneBut = (...allowed) => [OWNER, COUNTER, COUNTER2, STORE, DISPATCH, DRIVER, ACCOUNT, BUYER, STRANGER, EXSTAFF].filter((w) => !allowed.includes(w) && w !== OWNER);
  const rules = [
    ['counter_sale', { p_key: 'x', p_location: dummy, p_lines: [] }, everyoneBut(COUNTER, COUNTER2)],
    ['create_order', { p_key: 'x', p_location: dummy, p_lines: [] }, everyoneBut(COUNTER, COUNTER2)],
    ['take_payment', { p_key: 'x', p_order: dummy, p_method: 'cash', p_amount: 1 }, everyoneBut(COUNTER, COUNTER2, ACCOUNT)],
    ['deliver_order', { p_key: 'x', p_order: dummy }, everyoneBut(COUNTER, COUNTER2, STORE, DISPATCH)],
    ['confirm_payment', { p_payment: dummy }, everyoneBut(ACCOUNT)],
    ['reject_payment', { p_payment: dummy, p_reason: 'x' }, everyoneBut(ACCOUNT)],
    ['reverse_payment', { p_payment: dummy, p_reason: 'x' }, everyoneBut()],
    ['refund_order', { p_key: 'x', p_order: dummy, p_amount: 1, p_method: 'cash', p_reason: 'x' }, everyoneBut(ACCOUNT)],
    ['cancel_order', { p_order: dummy, p_reason: 'x' }, everyoneBut(COUNTER, COUNTER2, ACCOUNT)],
    ['reserve_order', { p_order: dummy }, everyoneBut(COUNTER, COUNTER2, STORE, DISPATCH)],
    ['return_goods', { p_key: 'x', p_order: dummy, p_lines: [], p_reason: 'x' }, everyoneBut(COUNTER, COUNTER2, ACCOUNT)],
    ['decide_approval', { p_approval: dummy, p_yes: true }, everyoneBut()],
    ['save_staff', { p_user: dummy, p_name: 'x', p_role: 'owner' }, everyoneBut()],
    ['save_product', { p_sku: 'x', p_name: 'x', p_price: 1 }, everyoneBut()],
    ['set_last_cost', { p_product: dummy, p_cost: 1 }, everyoneBut(ACCOUNT)],
    ['set_customer_terms', { p_customer: dummy, p_kind: 'retail', p_credit_limit: 1 }, everyoneBut()],
    ['receive_goods', { p_key: 'x', p_supplier: dummy, p_location: dummy, p_lines: [] }, everyoneBut(STORE, ACCOUNT)],
    ['transfer_stock', { p_product: dummy, p_from: dummy, p_to: dummy, p_qty: 1 }, everyoneBut(STORE, DISPATCH)],
    ['submit_stock_count', { p_key: 'x', p_location: dummy, p_lines: [] }, everyoneBut(STORE)],
    ['approve_stock_count', { p_count: dummy }, everyoneBut()],
    ['reject_stock_count', { p_count: dummy, p_reason: 'x' }, everyoneBut()],
    ['record_expense', { p_key: 'x', p_account: 'rent', p_amount: 1, p_paid_from: 'bank', p_what: 'x' }, everyoneBut(ACCOUNT)],
    ['move_money', { p_key: 'x', p_from: 'cash', p_to: 'bank', p_amount: 1 }, everyoneBut(ACCOUNT)],
    ['pay_supplier', { p_key: 'x', p_supplier: dummy, p_amount: 1 }, everyoneBut(ACCOUNT)],
    ['reverse_txn', { p_txn: dummy, p_reason: 'x' }, everyoneBut(ACCOUNT)],
    ['post_opening_balance', { p_key: 'x', p_account: 'bank', p_amount: 1, p_on: '2026-01-01' }, everyoneBut()],
    ['post_opening_debt', { p_key: 'x', p_customer: dummy, p_amount: 1, p_on: '2026-01-01' }, everyoneBut()],
    ['void_opening_debt', { p_order: dummy, p_reason: 'x' }, everyoneBut()],
    ['add_bank_line', { p_key: 'x', p_on: '2026-01-01', p_amount: 1 }, everyoneBut(ACCOUNT)],
    ['close_month', { p_month: '2026-01-01', p_statement_balance: 0 }, everyoneBut()],
    ['month_report', { p_month: '2026-01-01' }, everyoneBut(ACCOUNT)],
    ['books_check', {}, everyoneBut(ACCOUNT)],
    ['owner_exceptions', {}, everyoneBut(ACCOUNT)],
    ['owner_today', {}, everyoneBut(ACCOUNT)],
    ['books_month', { p_month: '2026-01-01' }, everyoneBut(ACCOUNT)],
    ['month_close_checks', { p_month: '2026-01-01' }, everyoneBut(ACCOUNT)],
    ['bank_matches', {}, everyoneBut(ACCOUNT)],
    ['open_quote_requests', {}, everyoneBut(COUNTER, COUNTER2, ACCOUNT)],
    ['quote_from_request', { p_request: dummy, p_location: dummy }, everyoneBut(COUNTER, COUNTER2, ACCOUNT)],
    ['close_quote_request', { p_request: dummy, p_reason: 'x' }, everyoneBut(COUNTER, COUNTER2, ACCOUNT)],
    ['import_products', { p_key: 'x', p_rows: [{ sku: 'x' }] }, everyoneBut()],
    ['save_settings', { p_hold_unpaid_hours: 24, p_hold_deposit_days: 14, p_till_paid_out_limit: 5000000, p_battery_life_months: 24 }, everyoneBut()],
    ['pack_list', {}, everyoneBut(STORE, DISPATCH, COUNTER, COUNTER2)],
    ['count_list', { p_location: dummy }, everyoneBut(STORE)],
    ['debtors', {}, everyoneBut(COUNTER, COUNTER2, ACCOUNT)],
    ['customer_balance', { p_customer: dummy }, everyoneBut(COUNTER, COUNTER2, ACCOUNT)],
    ['preview_sale', { p_lines: [] }, everyoneBut(COUNTER, COUNTER2)],
    ['open_till', { p_float: 0 }, everyoneBut(COUNTER, COUNTER2, ACCOUNT)],
    ['close_till', { p_counted: 0 }, everyoneBut(COUNTER, COUNTER2, ACCOUNT)],
    ['my_till', {}, everyoneBut(COUNTER, COUNTER2, ACCOUNT)],
    ['owner_money_in', { p_key: 'x', p_account: 'cash', p_amount: 1, p_what: 'x' }, everyoneBut()],
    ['owner_money_out', { p_key: 'x', p_account: 'cash', p_amount: 1, p_what: 'x' }, everyoneBut()],
    ['submit_safe_count', { p_key: 'x', p_counted: 0, p_counted_at: '2026-01-01T00:00:00Z' }, everyoneBut(COUNTER, COUNTER2)],
    ['approve_safe_count', { p_count: dummy }, everyoneBut()],
    ['reject_safe_count', { p_count: dummy, p_reason: 'x' }, everyoneBut()],
    ['cash_position', {}, everyoneBut(ACCOUNT)],
    ['create_quote', { p_key: 'x', p_location: dummy, p_lines: [] }, everyoneBut(COUNTER, COUNTER2, ACCOUNT)],
    ['revise_quote', { p_key: 'x', p_quote: dummy, p_lines: [] }, everyoneBut(COUNTER, COUNTER2, ACCOUNT)],
    ['accept_quote', { p_quote: dummy }, everyoneBut(COUNTER, COUNTER2, ACCOUNT)],
    ['cancel_quote', { p_quote: dummy, p_reason: 'x' }, everyoneBut(COUNTER, COUNTER2, ACCOUNT)],
    ['save_part_details', { p_product: dummy, p_part_number: 'x' }, everyoneBut()],
    ['search_parts', { p_query: 'x' }, everyoneBut(COUNTER, COUNTER2, STORE, DISPATCH, ACCOUNT)],
  ];
  for (const [fn, args, forbidden] of rules) {
    for (const who of forbidden) await fails(rpc(who, fn, args).catch((e) => { throw new Error(`${fn} as ${who}: ${e.message}`); }), 'not_allowed');
    await fails(rpc('anon', fn, args), 'permission denied');
  }
});

await test('someone who has left is refused, even an owner', async () => {
  await fails(rpc(EXSTAFF, 'save_product', { p_sku: 'x', p_name: 'x', p_price: 1 }), 'not_allowed');
  eq(N((await as(EXSTAFF, () => q('select count(*) c from ledger_entries')))[0].c), 0);
});

await test('the owner cannot lock themselves out', async () => {
  await fails(rpc(OWNER, 'save_staff', { p_user: OWNER, p_name: 'x', p_role: 'counter' }), 'cannot_remove_own_access');
  await fails(rpc(OWNER, 'save_staff', { p_user: OWNER, p_name: 'x', p_role: 'owner', p_active: false }), 'cannot_remove_own_access');
});

await test('a customer with an account sees their own orders and nobody else\'s', async () => {
  const phone = '08030000011';
  const p = await product();
  const s = await sale(p, { phone, method: 'pos' });
  await sale(p, { phone: '08030000012', method: 'pos' });
  await q('update customers set user_id = $1 where phone = normalize_phone($2)', [BUYER, phone]);
  const mine = await as(BUYER, () => q('select id from orders'));
  eq(mine.length, 1);
  eq(mine[0].id, s.order_id);
  eq((await as(BUYER, () => q('select id from order_lines'))).length, 1);
  eq((await as(BUYER, () => q('select id from payments'))).length, 1);
  eq((await as(BUYER, () => q('select id from customers'))).length, 1);
  await fails(rpc(BUYER, 'counter_sale', { p_key: 'x', p_location: shop, p_lines: [] }), 'not_allowed');
});

await test('every table has row-level security and every privileged function pins its search path', async () => {
  const open = await q(`select c.relname n from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
  eq(open.map((r) => r.n).join(), '');
  const loose = await q(`select p.proname n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) x where x like 'search_path=%pg_temp%'))`);
  eq(loose.map((r) => r.n).join(), '');
});

// ---- Returns: goods that left can come back ----

await test('goods come back: sale, stock and money reverse exactly, at the original cost', async () => {
  const p = await product({ price: 10000000, cost: 6000000, qty: 3 });
  const o = await order(p);
  await pay(o, 10000000);
  await deliver(o);
  const m = await moved(() => ret(o, [{ product_id: p.id, qty: 1 }]));
  same(m, { sales: 10000000, cogs: -6000000, stock: 6000000, goods_owed: -10000000 });
  eq((await shelf(p)).qty, 3, 'the unit is back on the shelf:');
  const r = await orderRow(o);
  eq(N(r.billed_kobo), 0, 'nothing is billed any more:');
  eq(r.goods_status, 'waiting');
  eq(N(await val('select billed_kobo from returns where order_id = $1', [o])), 10000000, 'the credit note says what is owed:');
  // The customer's money is now held for them again, so the accountant's refund pays it out.
  same(await moved(() => rpc(ACCOUNT, 'refund_order', { p_key: k('rf'), p_order: o, p_amount: 10000000, p_method: 'transfer', p_reason: 'Returned' })),
    { bank: -10000000, goods_owed: 10000000 });
});

await test('three part returns add up to the exact full return', async () => {
  const p = await product({ price: 1000000, cost: 900000, qty: 3 });
  const o = await order(p, { qty: 3 });
  await pay(o, 3000000);
  await deliver(o);
  let sales = 0, stock = 0;
  for (let i = 0; i < 3; i++) {
    const m = await moved(() => ret(o, [{ product_id: p.id, qty: 1 }]));
    same(m, { sales: 1000000, cogs: -900000, stock: 900000, goods_owed: -1000000 });
    sales += m.sales; stock += m.stock;
  }
  eq(sales, 3000000, 'the three returns billed back exactly:');
  eq(stock, 2700000, 'the original cost came back exactly:');
  const r = await orderRow(o);
  eq(N(r.billed_kobo), 0);
  eq(r.goods_status, 'waiting');
  eq((await shelf(p)).qty, 3);
  eq(N(await val('select value_kobo from product_costs where product_id = $1', [p.id])), 2700000);
});

await test('a credit part-return cuts the debt, and the rest comes back as money owed', async () => {
  const phone = '08030000005';
  await rpc(COUNTER, 'save_customer', { p_phone: phone, p_name: 'Ngozi Returns' });
  await rpc(OWNER, 'set_customer_terms', { p_customer: await customerByPhone(phone), p_kind: 'retail', p_credit_limit: 50000000 });
  const p = await product({ price: 1000000, cost: 900000, qty: 3 });
  const o = await order(p, { qty: 3, phone, credit: true });
  await pay(o, 1500000, 'cash');
  await deliver(o);
  same(await moved(() => ret(o, [{ product_id: p.id, qty: 1 }])), { sales: 1000000, cogs: -900000, stock: 900000, customers_owe: -1000000 });
  eq(N((await rpc(COUNTER, 'customer_balance', { p_customer: await customerByPhone(phone) })).owes), 500000, 'the debt shrank:');
  same(await moved(() => ret(o, [{ product_id: p.id, qty: 2 }])),
    { sales: 2000000, cogs: -1800000, stock: 1800000, customers_owe: -500000, goods_owed: -1500000 });
  eq(N((await rpc(COUNTER, 'customer_balance', { p_customer: await customerByPhone(phone) })).owes), 0);
  eq(N((await rpc(COUNTER, 'customer_balance', { p_customer: await customerByPhone(phone) })).holds), 1500000, 'the rest is held for the customer:');
  same(await moved(() => rpc(ACCOUNT, 'refund_order', { p_key: k('rf'), p_order: o, p_amount: 1500000, p_method: 'transfer', p_reason: 'Returned' })),
    { bank: -1500000, goods_owed: 1500000 });
});

await test('a returned serial goes back on the shelf and can be sold again', async () => {
  const p = await product({ tracking: 'serial', qty: 2 });
  const s = await sale(p, { serials: [p.serials[0]] });
  eq((await val('select status from serial_units where serial = $1', [p.serials[0]])), 'sold');
  await ret(s.order_id, [{ product_id: p.id, qty: 1, serials: [p.serials[0]] }]);
  const u = (await q('select status, location_id from serial_units where serial = $1', [p.serials[0]]))[0];
  eq(u.status, 'in_stock');
  eq(u.location_id, shop);
  eq((await shelf(p)).qty, 2, 'both units are on the shelf:');
  // The same order can take the unit back and hand it out again.
  await deliver(s.order_id, [{ product_id: p.id, qty: 1, serials: [p.serials[0]] }]);
  eq(N((await orderRow(s.order_id)).billed_kobo), 10000000, 'the re-delivery re-billed the line:');
  await ret(s.order_id, [{ product_id: p.id, qty: 1, serials: [p.serials[0]] }]);
  const s2 = await sale(p, { serials: [p.serials[0]] });
  eq(s2.state, 'done', 'the same unit sells again on a new order:');
});

await test('a serial re-sold on another order cannot be returned against the old one', async () => {
  const p = await product({ tracking: 'serial', qty: 2 });
  const oa = await order(p, { qty: 2 });
  await pay(oa, 20000000);
  await deliver(oa, [{ product_id: p.id, qty: 2, serials: [p.serials[0], p.serials[1]] }]);
  await ret(oa, [{ product_id: p.id, qty: 1, serials: [p.serials[0]] }]);
  const sb = await sale(p, { serials: [p.serials[0]] });
  eq(sb.state, 'done', 'the unit sold again, to someone else:');
  // The old order's line can no longer claim it: that would take the new sale's stock.
  await fails(ret(oa, [{ product_id: p.id, qty: 1, serials: [p.serials[0]] }]), 'serial_not_on_line');
  // The genuine return, against the order that actually sold it, still works.
  await ret(sb.order_id, [{ product_id: p.id, qty: 1, serials: [p.serials[0]] }]);
  eq((await val('select status from serial_units where serial = $1', [p.serials[0]])), 'in_stock');
});

await test('a returned serial can go to repair instead of the shelf', async () => {
  const repair = await rpc(OWNER, 'save_location', { p_name: 'Repair bench', p_kind: 'repair' });
  const p = await product({ tracking: 'serial', qty: 1 });
  const s = await sale(p, { serials: [p.serials[0]] });
  await ret(s.order_id, [{ product_id: p.id, qty: 1, serials: [p.serials[0]] }], { at: repair });
  const u = (await q('select status, location_id from serial_units where serial = $1', [p.serials[0]]))[0];
  eq(u.status, 'in_stock');
  eq(u.location_id, repair);
  eq((await shelf(p, repair)).qty, 1);
  eq((await q(`select reason from stock_movements where serial_id = (select id from serial_units where serial = $1) order by id desc limit 1`, [p.serials[0]]))[0].reason, 'returned');
});

await test('retrying a return changes nothing, and a reused key is refused', async () => {
  const p = await product({ price: 1000000, cost: 900000, qty: 2 });
  const o = await order(p, { qty: 2 });
  await pay(o, 2000000);
  await deliver(o);
  const key = k('ret');
  const first = await ret(o, [{ product_id: p.id, qty: 1 }], { key });
  const again = await ret(o, [{ product_id: p.id, qty: 1 }], { key });
  eq(first, again, 'the retry returns the first return:');
  eq(N(await val('select count(*) from returns where client_key = $1', [key])), 1);
  eq(N(await val(`select count(*) from ledger_txns where idempotency_key = 'return:' || $1`, [first])), 1);
  eq((await shelf(p)).qty, 1, 'the unit came back once:');
  const o2 = await order(p);
  await fails(ret(o2, [{ product_id: p.id, qty: 1 }], { key }), 'key_reused');
});

await test('you cannot return more than left, or return what never left', async () => {
  const p = await product({ price: 1000000, cost: 900000, qty: 2 });
  const o = await order(p, { qty: 2 });
  await pay(o, 2000000);
  await deliver(o, [{ product_id: p.id, qty: 1 }]);
  await fails(ret(o, [{ product_id: p.id, qty: 2 }]), 'more_than_delivered');
  await fails(ret(o, [{ product_id: p.id, qty: 1, serials: ['XX'] }]), 'serials_not_tracked');
  // The remaining unit of p is still reserved for o, so a fresh product proves the never-left case.
  const p2 = await product({ price: 1000000, cost: 900000, qty: 1 });
  const o2 = await order(p2);
  await fails(ret(o2, [{ product_id: p2.id, qty: 1 }]), 'nothing_to_return');
  const ps = await product({ tracking: 'serial', qty: 2 });
  const sa = await sale(ps, { serials: [ps.serials[0]] });
  const sb = await sale(ps, { serials: [ps.serials[1]] });
  await fails(ret(sa.order_id, [{ product_id: ps.id, qty: 1, serials: [ps.serials[1]] }]), 'serial_not_on_line');
});

// ---- The owner's money and the safe ----

await test('the owner\'s money in and out moves equity, never profit', async () => {
  const month = await val(`select date_trunc('month', shop_today())::date::text`);
  const report = () => rpc(ACCOUNT, 'month_report', { p_month: month });
  const before = await report();
  same(await moved(() => rpc(OWNER, 'owner_money_in', { p_key: k('in'), p_account: 'cash', p_amount: 5000000, p_what: 'Owner top-up' })), { cash: 5000000, owner_money: -5000000 });
  same(await moved(() => rpc(OWNER, 'owner_money_out', { p_key: k('out'), p_account: 'cash', p_amount: 2000000, p_what: 'Owner pocket' })), { cash: -2000000, owner_money: 2000000 });
  const after = await report();
  eq(N(after.income), N(before.income), 'a top-up became income:');
  eq(N(after.costs), N(before.costs), 'a drawing became a cost:');
  eq(N(after.profit), N(before.profit), 'profit moved:');
  await fails(rpc(OWNER, 'owner_money_in', { p_key: k('in'), p_account: 'sales', p_amount: 1, p_what: 'x' }), 'bad_account');
  await fails(rpc(OWNER, 'owner_money_out', { p_key: k('out'), p_account: 'rent', p_amount: 1, p_what: 'x' }), 'bad_account');
  await fails(rpc(OWNER, 'owner_money_in', { p_key: k('in'), p_account: 'cash', p_amount: 0, p_what: 'x' }), 'bad_amount');
  await fails(rpc(OWNER, 'owner_money_out', { p_key: k('out'), p_account: 'cash', p_amount: -5, p_what: 'x' }), 'bad_amount');
  await fails(rpc(OWNER, 'owner_money_out', { p_key: k('out'), p_account: 'cash', p_amount: 5, p_what: '  ' }), 'reason_required');
  const key = k('in');
  const t1 = await rpc(OWNER, 'owner_money_in', { p_key: key, p_account: 'bank', p_amount: 1000, p_what: 'Twice' });
  eq(await rpc(OWNER, 'owner_money_in', { p_key: key, p_account: 'bank', p_amount: 1000, p_what: 'Twice' }), t1, 'the retry returns the first posting:');
  await fails(rpc(OWNER, 'owner_money_in', { p_key: key, p_account: 'bank', p_amount: 2000, p_what: 'Twice' }), 'key_reused');
  // A wrong drawing is fixed by a reversal, like any journal entry.
  const bad = await rpc(OWNER, 'owner_money_out', { p_key: k('out'), p_account: 'cash', p_amount: 70000, p_what: 'Typo' });
  same(await moved(() => rpc(ACCOUNT, 'reverse_txn', { p_txn: bad, p_reason: 'Wrong figure' })), { cash: 70000, owner_money: -70000 });
});

await test('the safe is counted blind, and only the owner decides', async () => {
  const impliedSafe = async () => N(await val(`select coalesce(sum(amount_kobo), 0) from ledger_entries where account_code = 'cash'`)) - N(await val('select i_tills_expected()'));
  const w = await impliedSafe();
  const key = k('safe');
  const at = new Date().toISOString();
  const c = await rpc(COUNTER, 'submit_safe_count', { p_key: key, p_counted: w, p_counted_at: at });
  expect(!JSON.stringify(c).includes(String(w)) && !JSON.stringify(c).includes('expected'), 'the count told the counter a figure');
  eq(N((await rpc(ACCOUNT, 'owner_exceptions')).safe_counts_waiting), 1, 'a waiting safe count is not on the owner screen:');
  eq(await rpc(COUNTER, 'submit_safe_count', { p_key: key, p_counted: w, p_counted_at: at }), c, 'the retry returns the first count:');
  await fails(rpc(COUNTER, 'submit_safe_count', { p_key: key, p_counted: w + 1, p_counted_at: at }), 'key_reused');
  eq(N((await as(COUNTER, () => q('select count(*) c from safe_counts')))[0].c), 0, 'a counter can read safe counts:');
  await fails(rpc(ACCOUNT, 'approve_safe_count', { p_count: c }), 'not_allowed');
  await fails(rpc(ACCOUNT, 'reject_safe_count', { p_count: c, p_reason: 'x' }), 'not_allowed');
  await rpc(OWNER, 'reject_safe_count', { p_count: c, p_reason: 'Recheck the bag' });
  await fails(rpc(OWNER, 'reject_safe_count', { p_count: c, p_reason: 'Again' }), 'count_already_decided');
  await fails(rpc(COUNTER, 'submit_safe_count', { p_key: k('safe'), p_counted: -1, p_counted_at: new Date().toISOString() }), 'bad_amount');
  const again = await rpc(COUNTER2, 'submit_safe_count', { p_key: k('safe'), p_counted: w, p_counted_at: new Date().toISOString() });
  eq(N(await rpc(OWNER, 'approve_safe_count', { p_count: again })), 0, 'a right count posts nothing:');
  await fails(rpc(OWNER, 'approve_safe_count', { p_count: again }), 'count_already_decided');
  const row = (await q('select * from safe_counts where id = $1', [again]))[0];
  eq(N(row.expected_kobo), w);
  eq(N(row.difference_kobo), 0);
  await fails(rpc(OWNER, 'approve_safe_count', { p_count: randomUUID() }), 'no_such_count');
});

await test('a short safe posts the loss, and an over posts the gain', async () => {
  const impliedSafe = async () => N(await val(`select coalesce(sum(amount_kobo), 0) from ledger_entries where account_code = 'cash'`)) - N(await val('select i_tills_expected()'));
  const w0 = await impliedSafe();
  const c = await rpc(COUNTER, 'submit_safe_count', { p_key: k('safe'), p_counted: w0 - 50000, p_counted_at: new Date().toISOString() });
  same(await moved(() => rpc(OWNER, 'approve_safe_count', { p_count: c })), { cash: -50000, safe_differences: 50000 });
  const w1 = await impliedSafe();
  eq(w1, w0 - 50000, 'the books moved to the counted figure:');
  const d = await rpc(COUNTER, 'submit_safe_count', { p_key: k('safe'), p_counted: w1 + 20000, p_counted_at: new Date().toISOString() });
  same(await moved(() => rpc(OWNER, 'approve_safe_count', { p_count: d })), { cash: 20000, safe_differences: -20000 });
  eq(await impliedSafe(), w1 + 20000);
});

await test('a safe count goes stale when money moves or a till opens, and a fresh one is exact', async () => {
  const impliedSafe = async () => N(await val(`select coalesce(sum(amount_kobo), 0) from ledger_entries where account_code = 'cash'`)) - N(await val('select i_tills_expected()'));
  const w = await impliedSafe();
  const p = await product({ price: 1000000, cost: 500000, qty: 2 });
  const c = await rpc(COUNTER, 'submit_safe_count', { p_key: k('safe'), p_counted: w, p_counted_at: new Date().toISOString() });
  await sale(p, { method: 'cash' }); // the sale's cash lands in the till, so the safe itself is unchanged
  await fails(rpc(OWNER, 'approve_safe_count', { p_count: c }), 'count_out_of_date');
  const d = await rpc(COUNTER, 'submit_safe_count', { p_key: k('safe'), p_counted: w, p_counted_at: new Date().toISOString() });
  await rpc(COUNTER2, 'open_till', { p_float: 200000 }); // the float leaves the safe
  await fails(rpc(OWNER, 'approve_safe_count', { p_count: d }), 'count_out_of_date');
  const e = await rpc(COUNTER, 'submit_safe_count', { p_key: k('safe'), p_counted: w - 200000, p_counted_at: new Date().toISOString() });
  same(await moved(() => rpc(OWNER, 'approve_safe_count', { p_count: e })), {}, 'nothing is wrong, nothing posts:');
  await rpc(COUNTER2, 'close_till', { p_counted: 200000 }); // tidy: the float goes back to the safe
  // The old counts still wait for a decision; the owner refuses them rather than let them block the month.
  for (const old of [c, d]) await rpc(OWNER, 'reject_safe_count', { p_count: old, p_reason: 'Recounted' });
});

await test('two old safe counts cannot take the same loss twice', async () => {
  const impliedSafe = async () => N(await val(`select coalesce(sum(amount_kobo), 0) from ledger_entries where account_code = 'cash'`)) - N(await val('select i_tills_expected()'));
  const w = await impliedSafe();
  const lost = async () => N(await val(`select coalesce(sum(amount_kobo), 0) from ledger_entries where account_code = 'safe_differences'`));
  const before = await lost();
  const a = await rpc(COUNTER, 'submit_safe_count', { p_key: k('safe'), p_counted: w - 30000, p_counted_at: new Date().toISOString() });
  const b = await rpc(COUNTER2, 'submit_safe_count', { p_key: k('safe'), p_counted: w - 30000, p_counted_at: new Date().toISOString() });
  same(await moved(() => rpc(OWNER, 'approve_safe_count', { p_count: a })), { cash: -30000, safe_differences: 30000 });
  await fails(rpc(OWNER, 'approve_safe_count', { p_count: b }), 'count_out_of_date');
  eq(await lost(), before + 30000, 'the loss posted twice:');
  const c = await rpc(COUNTER, 'submit_safe_count', { p_key: k('safe'), p_counted: w - 30000, p_counted_at: new Date().toISOString() });
  eq(N(await rpc(OWNER, 'approve_safe_count', { p_count: c })), 0, 'the second loss came back:');
  await rpc(OWNER, 'reject_safe_count', { p_count: b, p_reason: 'Recounted' });
});

await test('a month waits for a safe count that was never decided', async () => {
  const month = await val(`select date_trunc('month', shop_today())::date::text`);
  const bankBefore = async (end) => N(await val(`select coalesce(sum(e.amount_kobo), 0) from ledger_entries e join ledger_txns t on t.id = e.txn_id where e.account_code = 'bank' and t.occurred_on < $1::date`, [end]));
  const after = async (m) => val(`select ($1::date + interval '1 month')::date::text`, [m]);
  const earlier = (await q(`select distinct date_trunc('month', occurred_on)::date::text m from ledger_txns
    where occurred_on < $1::date and date_trunc('month', occurred_on)::date not in (select month from closed_periods) order by 1`, [month])).map((r) => r.m);
  expect(earlier.length >= 2, 'expected open earlier months');
  const counted = N(await val(`select coalesce(sum(amount_kobo), 0) from ledger_entries where account_code = 'cash'`)) - N(await val('select i_tills_expected()'));
  const c = await rpc(COUNTER, 'submit_safe_count', { p_key: k('safe'), p_counted: counted, p_counted_at: new Date().toISOString() });
  await q('update safe_counts set counted_on = $1 where id = $2', [earlier[0], c]);
  await fails(rpc(OWNER, 'close_month', { p_month: earlier[0], p_statement_balance: await bankBefore(await after(earlier[0])) }), 'a safe count is waiting');
  // Deciding it clears the way; the count was right, so nothing posts anywhere.
  eq(N(await rpc(OWNER, 'approve_safe_count', { p_count: c })), 0);
  eq(N(await val(`select count(*) from ledger_txns where ref_type = 'safe_count' and ref_id = $1`, [c])), 0);
});

await test('cash_position lines the ledger up with tills plus safe', async () => {
  const pos = await rpc(ACCOUNT, 'cash_position');
  const cash = N(await val(`select coalesce(sum(amount_kobo), 0) from ledger_entries where account_code = 'cash'`));
  const tills = N(await val('select i_tills_expected()'));
  eq(N(pos.ledger_cash), cash);
  eq(N(pos.in_open_tills), tills);
  eq(N(pos.implied_safe), cash - tills);
  expect(pos.last_safe_count && pos.last_safe_count.difference !== undefined, 'no last count reported');
  await fails(rpc(COUNTER, 'cash_position'), 'not_allowed');
});

await test('a safe count is judged from when it was taken, not when it was tapped in', async () => {
  const impliedSafe = async () => N(await val(`select coalesce(sum(amount_kobo), 0) from ledger_entries where account_code = 'cash'`)) - N(await val('select i_tills_expected()'));
  const w = await impliedSafe();
  const countedAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString(); // the cash was counted two hours ago
  const c = await rpc(COUNTER, 'submit_safe_count', { p_key: k('safe'), p_counted: w, p_counted_at: countedAt });
  await rpc(OWNER, 'owner_money_out', { p_key: k('out'), p_account: 'cash', p_amount: 10000, p_what: 'Pocket' });
  await fails(rpc(OWNER, 'approve_safe_count', { p_count: c }), 'count_out_of_date');
  await rpc(OWNER, 'reject_safe_count', { p_count: c, p_reason: 'Recount' });
  await fails(rpc(COUNTER, 'submit_safe_count', { p_key: k('safe'), p_counted: w, p_counted_at: new Date(Date.now() + 3600 * 1000).toISOString() }), 'bad_time');
});

await test('a wrongly typed safe count is put right by recounting, like a stock count', async () => {
  const impliedSafe = async () => N(await val(`select coalesce(sum(amount_kobo), 0) from ledger_entries where account_code = 'cash'`)) - N(await val('select i_tills_expected()'));
  await rpc(OWNER, 'owner_money_in', { p_key: k('in'), p_account: 'cash', p_amount: 100000, p_what: 'Scene cash' });
  const w = await impliedSafe();
  const typo = await rpc(COUNTER, 'submit_safe_count', { p_key: k('safe'), p_counted: w + 900000, p_counted_at: new Date().toISOString() });
  same(await moved(() => rpc(OWNER, 'approve_safe_count', { p_count: typo })), { cash: 900000, safe_differences: -900000 });
  const fix = await rpc(COUNTER, 'submit_safe_count', { p_key: k('safe'), p_counted: w, p_counted_at: new Date().toISOString() });
  same(await moved(() => rpc(OWNER, 'approve_safe_count', { p_count: fix })), { cash: -900000, safe_differences: 900000 });
  eq(await impliedSafe(), w, 'the books are back where they belong:');
});

// ---- POS: a card tap is a promise, not money ----

await test('a card tap hands over the goods, and the money waits for the bank line', async () => {
  const p = await product({ price: 10000000, cost: 6000000, qty: 2 });
  let s;
  same(await moved(async () => { s = await sale(p, { method: 'pos' }); }), { sales: -10000000, cogs: 6000000, stock: -6000000, customers_owe: 10000000 });
  eq(s.state, 'done', 'the counter is not slowed:');
  const pay1 = (await q(`select id, status, method from payments where order_id = $1`, [s.order_id]))[0];
  eq(pay1.status, 'pending');
  eq(pay1.method, 'pos');
  eq((await orderRow(s.order_id)).money_status, 'unpaid', 'the tap is not money yet:');
  const bl = await bankLine(10000000);
  same(await moved(() => rpc(ACCOUNT, 'confirm_payment', { p_payment: pay1.id, p_bank_line: bl })),
    { bank: 10000000, customers_owe: -10000000 });
  eq((await orderRow(s.order_id)).money_status, 'paid');
});

await test('a fake card tap never becomes money, and the goods are a debt', async () => {
  const p = await product({ qty: 2 });
  const s = await sale(p, { method: 'pos' });
  const pid = await val('select id from payments where order_id = $1', [s.order_id]);
  await fails(rpc(COUNTER, 'confirm_payment', { p_payment: pid, p_bank_line: await bankLine(10000000) }), 'not_allowed');
  await fails(rpc(ACCOUNT, 'confirm_payment', { p_payment: pid }), 'bank_line_required');
  same(await moved(() => rpc(ACCOUNT, 'reject_payment', { p_payment: pid, p_reason: 'No card money came in' })), {});
  eq((await orderRow(s.order_id)).money_status, 'unpaid', 'a rejected tap must not become money:');
  eq((await shelf(p)).qty, 1, 'the goods really left:');
  // The accountant who tapped it in cannot match it themselves, like a transfer.
  const o = await order(p);
  const mine = await rpc(ACCOUNT, 'take_payment', { p_key: k('pay'), p_order: o, p_method: 'pos', p_amount: 10000000 });
  await fails(rpc(ACCOUNT, 'confirm_payment', { p_payment: mine, p_bank_line: await bankLine(10000000) }), 'cannot_confirm_own_payment');
  await rpc(ACCOUNT, 'reject_payment', { p_payment: mine, p_reason: 'Clean up' });
  await rpc(COUNTER, 'cancel_order', { p_order: o, p_reason: 'Scene end' });
});

await test('an unmatched card shows on the owner list and blocks the month close', async () => {
  const p = await product({ qty: 2 });
  const s = await sale(p, { method: 'pos' });
  const pid = await val('select id from payments where order_id = $1', [s.order_id]);
  await q(`update payments set created_at = now() - interval '5 hours' where id = $1`, [pid]);
  const seen = await rpc(ACCOUNT, 'owner_exceptions');
  expect(seen.old_transfers.some((t) => t.payment === pid && t.method === 'pos'), 'the unmatched card is not on the owner list');
  const month = await val(`select date_trunc('month', shop_today())::date::text`);
  const bankBefore = async (end) => N(await val(`select coalesce(sum(e.amount_kobo), 0) from ledger_entries e join ledger_txns t on t.id = e.txn_id where e.account_code = 'bank' and t.occurred_on < $1::date`, [end]));
  const after = async (m) => val(`select ($1::date + interval '1 month')::date::text`, [m]);
  const earlier = (await q(`select distinct date_trunc('month', occurred_on)::date::text m from ledger_txns
    where occurred_on < $1::date and date_trunc('month', occurred_on)::date not in (select month from closed_periods) order by 1`, [month])).map((r) => r.m);
  expect(earlier.length >= 2, 'expected open earlier months');
  await q('update payments set recorded_on = $1 where id = $2', [earlier[0], pid]);
  await fails(rpc(OWNER, 'close_month', { p_month: earlier[0], p_statement_balance: await bankBefore(await after(earlier[0])) }), 'a payment is waiting');
  await rpc(ACCOUNT, 'reject_payment', { p_payment: pid, p_reason: 'No card money came in' });
});

await test('a double card tap is refused, and a retry returns the one pending payment', async () => {
  const p = await product({ price: 1000000, cost: 600000, qty: 2 });
  const o = await order(p);
  const key = k('pay');
  const id = await rpc(COUNTER, 'take_payment', { p_key: key, p_order: o, p_method: 'pos', p_amount: 600000 });
  eq(await rpc(COUNTER, 'take_payment', { p_key: key, p_order: o, p_method: 'pos', p_amount: 600000 }), id, 'the retry returns the one pending tap:');
  await fails(rpc(COUNTER, 'take_payment', { p_key: k('pay'), p_order: o, p_method: 'pos', p_amount: 600000 }), 'more_than_owed');
  await fails(rpc(COUNTER, 'take_payment', { p_key: key, p_order: o, p_method: 'pos', p_amount: 700000 }), 'key_reused');
  await fails(deliver(o), 'payment_required'); // 600k of card does not cover 1M of goods
  const rest = await rpc(COUNTER, 'take_payment', { p_key: k('pay'), p_order: o, p_method: 'pos', p_amount: 400000 });
  same(await moved(() => deliver(o)), { sales: -1000000, cogs: 600000, stock: -600000, customers_owe: 1000000 }, 'goods leave once the taps cover them:');
  const bl = await bankLine(1000000);
  same(await moved(async () => {
    await rpc(ACCOUNT, 'confirm_payment', { p_payment: id, p_bank_line: bl });
    await rpc(ACCOUNT, 'confirm_payment', { p_payment: rest, p_bank_line: bl });
  }), { bank: 1000000, customers_owe: -1000000 });
  eq((await orderRow(o)).money_status, 'paid');
  // Cash on top of a waiting card tap is refused, so a customer is never charged twice;
  // the part the card did not cover can still be paid in cash.
  const o2 = await order(p);
  await rpc(COUNTER, 'take_payment', { p_key: k('pay'), p_order: o2, p_method: 'pos', p_amount: 600000 });
  await fails(rpc(COUNTER, 'take_payment', { p_key: k('pay'), p_order: o2, p_method: 'cash', p_amount: 600000 }), 'more_than_owed');
  same(await moved(() => rpc(COUNTER, 'take_payment', { p_key: k('pay'), p_order: o2, p_method: 'cash', p_amount: 400000 })), { cash: 400000, goods_owed: -400000 });
});

// ---- Quotes: a promise on paper ----

await test('a quote keeps its price when the price moves, and acceptance obeys the discount rules', async () => {
  const p = await product({ price: 10000000, cost: 6000000, qty: 2 });
  const qid = await rpc(COUNTER, 'create_quote', { p_key: k('q'), p_location: shop, p_lines: [line(p)] });
  const qrow = (await q('select * from quotes where id = $1', [qid]))[0];
  eq(N(qrow.total_kobo), 10000000);
  eq(await val('select valid_until::text from quotes where id = $1', [qid]), await val('select (shop_today() + 7)::text'), 'the quote is good for a week:');
  await rpc(OWNER, 'save_product', { p_sku: p.sku, p_name: `Test ${p.sku}`, p_price: 15000000 }); // the price rises
  const o = await rpc(COUNTER, 'accept_quote', { p_quote: qid });
  const ord = await orderRow(o);
  eq(N(ord.total_kobo), 10000000, 'the quoted price held:');
  eq(ord.needs_approval, true, 'the drop against the new list price waits for the owner:');
  // The other direction: the price falls, the quoted price still holds, and there is nothing to approve.
  const p2 = await product({ price: 10000000, cost: 6000000, qty: 2 });
  const q2 = await rpc(COUNTER, 'create_quote', { p_key: k('q'), p_location: shop, p_lines: [line(p2)] });
  await rpc(OWNER, 'save_product', { p_sku: p2.sku, p_name: `Test ${p2.sku}`, p_price: 8000000 });
  const o2 = await rpc(COUNTER, 'accept_quote', { p_quote: q2 });
  const ord2 = await orderRow(o2);
  eq(N(ord2.total_kobo), 10000000);
  eq(ord2.needs_approval, false);
});

await test('a quote expires, versions supersede, and a cancelled quote stays dead', async () => {
  const p = await product({ qty: 3 });
  const v1 = await rpc(COUNTER, 'create_quote', { p_key: k('q'), p_location: shop, p_lines: [line(p)] });
  const v2 = await rpc(COUNTER, 'revise_quote', { p_key: k('q'), p_quote: v1, p_lines: [line(p, 2)] });
  const r2 = (await q('select * from quotes where id = $1', [v2]))[0];
  eq(N(r2.version), 2);
  eq(r2.root_id, v1);
  await fails(rpc(COUNTER, 'accept_quote', { p_quote: v1 }), 'quote_superseded');
  const o = await rpc(COUNTER, 'accept_quote', { p_quote: v2 });
  eq(await rpc(COUNTER, 'accept_quote', { p_quote: v2 }), o, 'a retry returns the first order:');
  eq(N((await orderRow(o)).total_kobo), 20000000);
  await fails(rpc(COUNTER, 'revise_quote', { p_key: k('q'), p_quote: v2, p_lines: [line(p)] }), 'quote_not_active');
  // An expired quote cannot be accepted or revised; the customer asks afresh.
  const e = await rpc(COUNTER, 'create_quote', { p_key: k('q'), p_location: shop, p_lines: [line(p)], p_valid_days: 3 });
  await q('update quotes set valid_until = shop_today() - 1 where id = $1', [e]);
  await fails(rpc(COUNTER, 'accept_quote', { p_quote: e }), 'quote_expired');
  await fails(rpc(COUNTER, 'revise_quote', { p_key: k('q'), p_quote: e, p_lines: [line(p)] }), 'quote_expired');
  // A cancelled quote is dead for good, and needs a reason.
  const cq = await rpc(COUNTER, 'create_quote', { p_key: k('q'), p_location: shop, p_lines: [line(p)] });
  await fails(rpc(COUNTER, 'cancel_quote', { p_quote: cq, p_reason: '  ' }), 'reason_required');
  await rpc(COUNTER, 'cancel_quote', { p_quote: cq, p_reason: 'Customer walked' });
  await fails(rpc(COUNTER, 'accept_quote', { p_quote: cq }), 'quote_not_active');
  await fails(rpc(COUNTER, 'cancel_quote', { p_quote: cq, p_reason: 'Again' }), 'quote_not_active');
});

await test('a quote holds nothing, and accepting it needs the stock to be there', async () => {
  const p = await product({ qty: 2 });
  const qid = await rpc(COUNTER, 'create_quote', { p_key: k('q'), p_location: shop, p_lines: [line(p, 2)] });
  same(await shelf(p), { qty: 2, reserved: 0 }, 'a quote holds nothing:');
  same(await moved(() => rpc(COUNTER, 'accept_quote', { p_quote: qid })), {}, 'acceptance moves no money:');
  same(await shelf(p), { qty: 2, reserved: 2 }, 'acceptance reserves like any order:');
  const p2 = await product({ qty: 1 });
  const q3 = await rpc(COUNTER, 'create_quote', { p_key: k('q'), p_location: shop, p_lines: [line(p2)] });
  await sale(p2); // the only unit leaves before the customer comes back
  await fails(rpc(COUNTER, 'accept_quote', { p_quote: q3 }), 'insufficient_stock');
  // Retries and key rules, like every other write.
  const key = k('q');
  const a = await rpc(COUNTER, 'create_quote', { p_key: key, p_location: shop, p_lines: [line(p2)] });
  eq(await rpc(COUNTER, 'create_quote', { p_key: key, p_location: shop, p_lines: [line(p2)] }), a, 'the retry returns the first quote:');
  await fails(rpc(COUNTER, 'create_quote', { p_key: key, p_location: shop, p_lines: [line(p2, 2)] }), 'key_reused');
  await fails(rpc(COUNTER, 'create_quote', { p_key: k('q'), p_location: shop, p_lines: [] }), 'empty_quote');
  await fails(rpc(COUNTER, 'create_quote', { p_key: k('q'), p_location: shop, p_lines: [line(p2)], p_valid_days: 0 }), 'bad_valid_days');
  await fails(rpc(COUNTER, 'create_quote', { p_key: k('q'), p_location: shop, p_lines: [line(p2)], p_valid_days: 91 }), 'bad_valid_days');
});

await test('quote totals match the order, VAT and trade price included', async () => {
  const belt = await product({ unit: 'metre', qty: 10, price: 3333, cost: 2000, vat: 750 });
  const vq = await rpc(COUNTER, 'create_quote', { p_key: k('q'), p_location: shop, p_lines: [line(belt, 2.5)] });
  const qr = (await q('select * from quotes where id = $1', [vq]))[0];
  eq(N(qr.total_kobo), 8333);
  eq(N(qr.vat_kobo), 581);
  const vo = await rpc(COUNTER, 'accept_quote', { p_quote: vq });
  const vr = await orderRow(vo);
  eq(N(vr.total_kobo), N(qr.total_kobo), 'the order totals equal the quote:');
  eq(N(vr.vat_kobo), N(qr.vat_kobo));
  eq(N(vr.list_total_kobo), N(qr.list_total_kobo));
  // An installer's quote shows the trade price, and so does the order it becomes.
  const phone = '08030000013';
  await rpc(COUNTER, 'save_customer', { p_phone: phone });
  await rpc(OWNER, 'set_customer_terms', { p_customer: await customerByPhone(phone), p_kind: 'installer', p_credit_limit: 0 });
  const tp = await product({ price: 10000000, trade: 8500000, qty: 1 });
  const tq = await rpc(COUNTER, 'create_quote', { p_key: k('q'), p_location: shop, p_lines: [line(tp)], p_customer: await customerByPhone(phone) });
  eq(N((await q('select total_kobo from quotes where id = $1', [tq]))[0].total_kobo), 8500000);
  const to = await rpc(COUNTER, 'accept_quote', { p_quote: tq });
  eq(N((await orderRow(to)).total_kobo), 8500000);
});

// ---- Catalogue search: the part, however it is asked ----

await test('a part number finds the part however it is written, with substitutes told apart', async () => {
  const bear = async (part, bore, od, width) => {
    const sku = `B-${++seq}`;
    const id = await rpc(OWNER, 'save_product', { p_sku: sku, p_name: `Bearing ${part}`, p_price: 1500000 });
    await rpc(OWNER, 'set_last_cost', { p_product: id, p_cost: 1000000 });
    await rpc(OWNER, 'save_part_details', { p_product: id, p_part_number: part, p_bore: bore, p_outside: od, p_width: width });
    await rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [{ product_id: id, qty: 4 }] });
    return id;
  };
  const sealed = await bear('6205 2RS', 25, 52, 15);
  const shielded = await bear('6205-ZZ', 25, 52, 15);
  const bigger = await bear('6304 2RS', 20, 52, 15);
  const r = await rpc(COUNTER, 'search_parts', { p_query: '6205 2rs' });
  eq(r[0].product, sealed, 'the exact part comes first:');
  eq(r[0].match, 'part');
  eq(N(r[0].sizes.bore), 25);
  eq(N(r[0].sizes.outside), 52);
  expect(r.some((x) => x.product === shielded && x.match === 'size'), 'the substitute is not told apart:');
  expect(!r.some((x) => x.product === bigger), 'an unrelated bearing crept in:');
  eq((await rpc(COUNTER, 'search_parts', { p_query: '6205-2rs' }))[0].product, sealed, 'dash writing:');
  eq((await rpc(COUNTER, 'search_parts', { p_query: '62052RS' }))[0].product, sealed, 'no separator:');
});

await test('a size finds every part that fits, and a prefix or typo still finds the part', async () => {
  const ids = (rows) => rows.map((x) => x.product).sort().join();
  const sealed = await val(`select id from products where part_number_norm = '62052RS'`);
  const shielded = await val(`select id from products where part_number_norm = '6205ZZ'`);
  const bigger = await val(`select id from products where part_number_norm = '63042RS'`);
  const bySize = await rpc(COUNTER, 'search_parts', { p_query: '25x52x15' });
  expect(bySize.some((x) => x.product === sealed && x.match === 'size'), 'the sealed one is missing:');
  expect(bySize.some((x) => x.product === shielded && x.match === 'size'), 'the shielded one is missing:');
  expect(!bySize.some((x) => x.product === bigger), 'a different size crept in:');
  eq(ids(await rpc(COUNTER, 'search_parts', { p_query: '25 52 15' })), ids(bySize), 'words and x both find the same:');
  const pre = await rpc(COUNTER, 'search_parts', { p_query: '620' });
  expect(pre.some((x) => x.product === sealed && x.match === 'part'), 'the prefix missed:');
  const typo = await rpc(COUNTER, 'search_parts', { p_query: '6205 2rx' });
  eq(typo[0].product, sealed, 'a one-letter typo still finds it:');
  eq(typo[0].match, 'similar');
});

await test('search shows no count and no cost, and only staff who serve can use it', async () => {
  const res = await rpc(STORE, 'search_parts', { p_query: '6205' });
  expect(res.length > 0, 'a storekeeper found nothing:');
  const text = JSON.stringify(res);
  expect(!text.includes('qty') && !/cost|margin|profit/i.test(text), 'a count or cost leaked:');
  for (const row of res) expect(['in', 'low', 'out'].includes(row.state), `bad state: ${row.state}`);
  await fails(rpc(DRIVER, 'search_parts', { p_query: '6205' }), 'not_allowed');
  await fails(rpc('anon', 'search_parts', { p_query: '6205' }), 'permission denied');
  await fails(rpc(COUNTER, 'search_parts', { p_query: '   ' }), 'query_required');
  await fails(rpc(COUNTER, 'search_parts', { p_query: 'x', p_limit: 0 }), 'bad_limit');
  await fails(rpc(COUNTER, 'save_part_details', { p_product: randomUUID(), p_part_number: 'x' }), 'not_allowed');
  await fails(rpc(ACCOUNT, 'save_part_details', { p_product: randomUUID(), p_part_number: 'x' }), 'not_allowed');
  await fails(rpc(OWNER, 'save_part_details', { p_product: randomUUID(), p_part_number: 'x' }), 'no_such_product');
  // Even when substitutes overflow the limit, the exact part comes first, not last by id.
  const crown = await rpc(OWNER, 'save_product', { p_sku: `B-${++seq}`, p_name: 'Crowded 6205 2RS', p_price: 1500000 });
  await rpc(OWNER, 'set_last_cost', { p_product: crown, p_cost: 1000000 });
  await rpc(OWNER, 'save_part_details', { p_product: crown, p_part_number: '6205 2RS', p_bore: 25, p_outside: 52, p_width: 15 });
  await rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [{ product_id: crown, qty: 4 }] });
  for (let i = 0; i < 25; i++) {
    const sid = await rpc(OWNER, 'save_product', { p_sku: `B-${++seq}`, p_name: `Sub ${i}`, p_price: 1500000 });
    await rpc(OWNER, 'set_last_cost', { p_product: sid, p_cost: 1000000 });
    await rpc(OWNER, 'save_part_details', { p_product: sid, p_part_number: `6205-SUB-${i}`, p_bore: 25, p_outside: 52, p_width: 15 });
    await rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [{ product_id: sid, qty: 4 }] });
  }
  const crowded = await rpc(COUNTER, 'search_parts', { p_query: '6205 2rs' });
  eq(crowded.length, 20, 'the limit held:');
  eq(crowded[0].match, 'part', 'the exact part must never be crowded out:');
  eq(N(crowded[0].sizes.bore), 25);
  // Correcting one dimension keeps the others.
  await rpc(OWNER, 'save_part_details', { p_product: crown, p_width: 16 });
  const row3 = (await q('select * from product_sizes where product_id = $1', [crown]))[0];
  eq(N(row3.bore_mm), 25);
  eq(N(row3.outside_mm), 52);
  eq(N(row3.width_mm), 16);
  // An archived product vanishes from search, and a bare "205" pulls nothing.
  await q(`update products set status = 'archived' where id = $1`, [crown]);
  expect(!(await rpc(COUNTER, 'search_parts', { p_query: '6205 2rs' })).some((x) => x.product === crown), 'an archived part still shows:');
  eq((await rpc(COUNTER, 'search_parts', { p_query: '205' })).length, 0, 'a loose number pulled something in:');
});

// ---- The counter's price preview (Claude, 2 Nov 2026) ----

await test('the counter preview prices a sale exactly as the sale records it', async () => {
  const items = [
    await product({ price: 1250000, trade: 1100000, vat: 750, qty: 40 }),
    await product({ price: 333333, qty: 40 }),
    await product({ unit: 'metre', qty: 50, price: 3333, cost: 2000, vat: 750 }),
    await product({ price: 99999, trade: 90001, qty: 40 }),
  ];
  const tradePhone = '08030000301';
  const retailPhone = '08030000302';
  const tc = await rpc(COUNTER, 'save_customer', { p_phone: tradePhone, p_name: 'Trade buyer' });
  await rpc(OWNER, 'set_customer_terms', { p_customer: tc, p_kind: 'installer', p_credit_limit: 0 });
  await rpc(COUNTER, 'save_customer', { p_phone: retailPhone, p_name: 'Retail buyer' });
  let seed = 7;
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 24; i++) {
    const pick = items.filter(() => rand() < 0.6);
    if (pick.length === 0) pick.push(items[i % items.length]);
    const lines = pick.map((p) => line(p, p === items[2] ? [0.5, 1.25, 2.333][i % 3] : 1 + (i % 3)));
    const phone = [null, tradePhone, retailPhone, '0803'][i % 4];
    const pct = [0, 3, 5, 12][Math.floor(i / 4) % 4];
    const who = i % 2 ? COUNTER : COUNTER2;
    const pv = await rpc(who, 'preview_sale', { p_lines: lines, p_location: shop, p_phone: phone, p_discount_pct: pct });
    const sent = pv.lines.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_price: l.unit_price }));
    const o = await rpc(who, 'create_order', { p_key: k('ord'), p_location: shop, p_lines: sent, p_phone: phone && phone.length === 11 ? phone : null, p_backorder: true });
    const row = await orderRow(o);
    const why = `case ${i} (${phone ?? 'walk-in'}, ${pct}%):`;
    eq(N(row.total_kobo), N(pv.total), `total, ${why}`);
    eq(N(row.vat_kobo), N(pv.vat), `VAT, ${why}`);
    eq(row.needs_approval, pv.needs_approval, `approval, ${why}`);
    const stored = await q('select product_id, unit_price_kobo, line_total_kobo, line_vat_kobo from order_lines where order_id = $1', [o]);
    for (const pl of pv.lines) {
      const d = stored.find((s) => s.product_id === pl.product_id);
      eq(N(d.unit_price_kobo), N(pl.unit_price), `unit price, ${why}`);
      eq(N(d.line_total_kobo), N(pl.line_total), `line total, ${why}`);
      eq(N(d.line_vat_kobo), N(pl.line_vat), `line VAT, ${why}`);
    }
    await rpc(COUNTER, 'cancel_order', { p_order: o, p_reason: 'Preview test' });
  }
  const trade = await rpc(COUNTER, 'preview_sale', { p_lines: [line(items[0])], p_location: shop, p_phone: '+234 803 000 0301' });
  eq(trade.customer.trade, true, 'any phone format finds the customer:');
  eq(N(trade.lines[0].unit_price), 1100000);
  const retail = await rpc(COUNTER, 'preview_sale', { p_lines: [line(items[0])], p_location: shop, p_phone: retailPhone });
  eq(retail.customer.trade, false);
  eq(N(retail.lines[0].unit_price), 1250000, 'a retail customer pays the shelf price:');
  eq((await rpc(COUNTER, 'preview_sale', { p_lines: [line(items[0])], p_location: shop, p_phone: '080' })).customer, null, 'a half-typed number:');
  expect(!/cost/i.test(JSON.stringify(trade)) && !JSON.stringify(trade).includes('6000000'), 'cost in the preview');
  await fails(rpc(COUNTER, 'preview_sale', { p_lines: [line(items[0])], p_discount_pct: 101 }), 'bad_discount');
  await fails(rpc(COUNTER, 'preview_sale', { p_lines: [line(items[0], 1.5)] }), 'bad_qty');
});

// ---- Fixes from the outside review of the 2 Nov work (Claude, 2 Nov 2026) ----

await test('a serial battery cannot be returned without naming the unit that came back', async () => {
  const p = await product({ price: 100000000, cost: 70000000, qty: 2, tracking: 'serial' });
  const s = await sale(p, { serials: [p.serials[0]] });
  await fails(rpc(COUNTER, 'return_goods', { p_key: k('ret'), p_order: s.order_id, p_lines: [line(p, 1)], p_reason: 'Faulty' }), 'serial_required');
  await fails(rpc(COUNTER, 'return_goods', { p_key: k('ret'), p_order: s.order_id, p_lines: [line(p, 1, { serials: 'x' })], p_reason: 'Faulty' }), 'serial_required');
  same(await shelf(p), { qty: 1, reserved: 0 }, 'nothing came back:');
  await rpc(COUNTER, 'return_goods', { p_key: k('ret'), p_order: s.order_id, p_lines: [line(p, 1, { serials: [p.serials[0]] })], p_reason: 'Faulty' });
  same(await shelf(p), { qty: 2, reserved: 0 });
  const li = await val('select id from order_lines where order_id = $1', [s.order_id]);
  await q('update order_lines set delivered_qty = delivered_qty + 1 where id = $1', [li]);
  const chk = await val('select i_books_check()');
  expect(!chk.ok && chk.problems.some((x) => x.includes('serial numbers disagree with what was delivered')), 'the books check missed a unit with no serial');
  await q('update order_lines set delivered_qty = delivered_qty - 1 where id = $1', [li]);
});

await test('owner money and safe counts stay out of the accountant\'s hands', async () => {
  await fails(rpc(ACCOUNT, 'owner_money_out', { p_key: k('out'), p_account: 'cash', p_amount: 100, p_what: 'Drawing' }), 'not_allowed');
  await fails(rpc(ACCOUNT, 'owner_money_in', { p_key: k('in'), p_account: 'cash', p_amount: 100, p_what: 'Top-up' }), 'not_allowed');
  await fails(rpc(ACCOUNT, 'submit_safe_count', { p_key: k('safe'), p_counted: 0, p_counted_at: new Date().toISOString() }), 'not_allowed');
});

await test('keys the system makes for itself cannot be taken first by a screen', async () => {
  const p = await product({ qty: 5 });
  const quote = await rpc(COUNTER, 'create_quote', { p_key: k('q'), p_location: shop, p_lines: [line(p)] });
  await fails(rpc(COUNTER2, 'create_order', { p_key: `quote_accept:${quote}`, p_location: shop, p_lines: [line(p, 2)] }), 'key_reserved');
  await fails(sale(p, { key: 'opening_debt:x' }), 'key_reserved');
  expect(await rpc(COUNTER, 'accept_quote', { p_quote: quote }), 'the quote can still be accepted');
});

// ---- The owner's today screen (Claude, 2 Nov 2026) ----

await test('the owner\'s today screen adds up from the records', async () => {
  const today = (days = 30) => rpc(OWNER, 'owner_today', { p_days: days });
  const bearing = await product({ price: 500000, cost: 300000, qty: 4, low: 3 });
  const panel = await product({ price: 10000000, cost: 7000000, qty: 3 });
  const battery = await product({ price: 8000000, cost: 5000000, qty: 1, tracking: 'serial' });
  await q(`update products set name = 'Car battery 24F' where id = $1`, [battery.id]);

  // A cash sale moves money in today, the tiles and the graph by exactly its amount.
  const before = await today();
  await sale(bearing, { qty: 2 });
  const after = await today();
  eq(N(after.money_in_today.cash ?? 0) - N(before.money_in_today.cash ?? 0), 1000000, 'cash in today:');
  eq(N(after.tiles.sales) - N(before.tiles.sales), 1000000, 'sales tile:');
  eq(N(after.tiles.profit) - N(before.tiles.profit), 1000000 - 600000, 'profit tile:');
  eq(N(after.tiles.money_in) - N(before.tiles.money_in), 1000000, 'money in tile:');
  eq(after.series.length, 30, 'days on the graph:');
  eq(after.series[29].date, await val('select shop_today()::text'), 'the graph ends today:');
  eq(N(after.series[29].in) - N(before.series[29].in), 1000000, 'today on the graph:');
  // Most urgent first, at most 12, and only parts that really are running out.
  const urgency = (r) => (r.days_left === null ? (N(r.free) <= 0 ? 0 : 999) : Number(r.days_left));
  expect(after.running_out.length <= 12, 'the list is capped');
  after.running_out.forEach((r, i) => {
    if (i > 0) expect(urgency(after.running_out[i - 1]) <= urgency(r), `out of order at ${r.sku}`);
    expect((N(r.low_stock_at) > 0 && N(r.free) <= N(r.low_stock_at)) || (r.days_left !== null && Number(r.days_left) <= N(r.lead_days) + 7), `${r.sku} is not running out`);
  });

  // What waits on the owner, with the profit a yes would leave.
  const cut = await order(panel, { price: 7500000 });
  const waiting = await order(panel);
  const transfer = await pay(waiting, 4000000, 'transfer');
  const t = await today();
  const ap = t.queue.find((x) => x.type === 'approval' && x.order_id === cut);
  expect(ap, 'the discount should be waiting');
  eq(N(ap.profit), 7500000 - 7000000, 'profit a yes would leave:');
  expect(t.queue.some((x) => x.type === 'payment' && x.id === transfer), 'the transfer should be waiting');

  // Who owes us, by age, adds up to every unpaid delivery.
  const phone = '08030000401';
  const c = await rpc(COUNTER, 'save_customer', { p_phone: phone, p_name: 'Musa Owes', p_reminders_ok: true });
  await rpc(OWNER, 'set_customer_terms', { p_customer: c, p_kind: 'retail', p_credit_limit: 50000000 });
  const credit = await order(panel, { phone, credit: true });
  await deliver(credit);
  await q('update deliveries set delivered_on = shop_today() - 45 where order_id = $1', [credit]);
  const d = await today();
  eq(d.debts.length, 4, 'debt bands:');
  const owed = N(await val('select coalesce(sum(billed_kobo - paid_kobo), 0) from orders where billed_kobo > paid_kobo'));
  eq(d.debts.reduce((s, b) => s + N(b.total), 0), owed, 'debts add up:');
  expect(d.debts[1].customers.some((x) => x.name === 'Musa Owes' && N(x.owes) === 10000000), 'Musa should be in the 31 to 60 days band');

  // A battery sold 23 months ago is due next month, at the usual 24 months.
  await sale(battery, { serials: [battery.serials[0]], phone, method: 'pos' });
  await q(`update serial_units set sold_on = (shop_today() - interval '23 months')::date where serial = $1`, [battery.serials[0]]);
  const b = await today();
  eq(b.batteries_due.length, 6, 'months ahead:');
  expect(b.batteries_due[1].customers.some((x) => x.name === 'Musa Owes'), 'the battery customer should be due next month');

  eq((await rpc(ACCOUNT, 'owner_today', { p_days: 7 })).series.length, 7, 'a week:');
  eq((await today(90)).series.length, 90, 'a quarter:');
  await fails(today(14), 'bad_period');
  for (const who of [COUNTER, STORE, DISPATCH, DRIVER]) await fails(rpc(who, 'owner_today', {}), 'not_allowed');
});

// ---- The stock room (Claude, 2 Nov 2026) ----

await test('the stock room packs only what is paid for, oldest unit first, and counts blind', async () => {
  const battery = await product({ qty: 0, tracking: 'serial', price: 8000000, cost: 5000000 });
  await rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [line(battery, 1, { serials: ['PK-NEW-1'], made_on: ago(1, 1) })] });
  await rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [line(battery, 1, { serials: ['PK-OLD-1'], made_on: ago(6, 1) })] });
  const belt = await product({ unit: 'metre', qty: 20, price: 3000, cost: 1500 });
  const tapped = await rpc(COUNTER, 'create_order', { p_key: k('ord'), p_location: shop, p_lines: [line(battery, 1), line(belt, 2.5)], p_phone: '08030000501', p_channel: 'phone' });
  await pay(tapped, N((await orderRow(tapped)).total_kobo), 'pos');
  const deposit = await order(belt, { qty: 1 });
  await pay(deposit, 1000, 'transfer');

  const list = await rpc(STORE, 'pack_list');
  const mine = list.ready.find((o) => o.order_id === tapped);
  expect(mine, 'an order paid by a card tap waiting for the bank should be ready, as it is at delivery');
  expect(!list.ready.some((o) => o.order_id === deposit), 'an order waiting on a transfer must not be packed');
  expect(N(list.waiting_for_money) >= 1, 'orders waiting for money are counted');
  eq(mine.lines.find((l) => l.product_id === battery.id).oldest[0], 'PK-OLD-1', 'oldest unit first:');
  eq(Number(mine.lines.find((l) => l.product_id === belt.id).remaining), 2.5, 'metres to cut:');
  expect(!/"[a-z_]*cost[a-z_]*"|2348030000501|08030000501/i.test(JSON.stringify(list)), "the pack list must carry no cost and no phone number");
  await rpc(STORE, 'deliver_order', { p_key: k('go'), p_order: tapped, p_lines: [line(battery, 1, { serials: ['PK-OLD-1'] }), line(belt, 2.5)] });
  expect(!(await rpc(STORE, 'pack_list')).ready.some((o) => o.order_id === tapped), 'a packed order leaves the list');
  for (const who of [DISPATCH, COUNTER]) await rpc(who, 'pack_list');
  for (const who of [DRIVER, STRANGER]) await fails(rpc(who, 'pack_list'), 'not_allowed');

  const shelf2 = await rpc(OWNER, 'save_location', { p_name: k('Count shelf') });
  const counted = await product({ qty: 5, at: shelf2 });
  const never = await product({ qty: 7, at: shelf2 });
  await product({ qty: 2, tracking: 'serial', at: shelf2 });
  const c1 = await rpc(STORE, 'submit_stock_count', { p_key: k('cnt'), p_location: shelf2, p_lines: [{ product_id: counted.id, counted: 5 }] });
  await rpc(OWNER, 'approve_stock_count', { p_count: c1 });
  const cl = await rpc(STORE, 'count_list', { p_location: shelf2 });
  eq(cl.map((x) => x.product_id).join(), [never.id, counted.id].join(), 'never-counted first, and no serial units:');
  expect(!/"(qty|expected|on_hand|free|reserved)"/.test(JSON.stringify(cl)), 'a count list must carry no quantities');
  await fails(rpc(STORE, 'count_list', { p_location: shelf2, p_limit: 0 }), 'bad_limit');
  await fails(rpc(COUNTER, 'count_list', { p_location: shelf2 }), 'not_allowed');
});

// ---- Books (Claude, 2 Nov 2026) ----

await test('the books screen balances, matches the bank, and previews the close by its own rules', async () => {
  const month = await val(`select date_trunc('month', shop_today())::date::text`);
  const b = await rpc(ACCOUNT, 'books_month', { p_month: month });
  eq(b.balanced, true, 'own = owe + owner:');
  eq(N(b.own), N(b.owe) + N(b.owner), 'the sides:');
  const net = N(await val(`select coalesce(sum(e.amount_kobo), 0) from ledger_entries e join ledger_txns t on t.id = e.txn_id
    join ledger_accounts a on a.code = e.account_code where a.kind in ('income', 'expense') and date_trunc('month', t.occurred_on)::date = $1::date`, [month]));
  eq(N(b.profit), -net, 'profit from the entries:');
  expect(b.months.includes(month), 'this month is listed');

  const p = await product({ qty: 3, price: 5000000 });
  const o = await order(p);
  const waiting = await pay(o, 5000000, 'transfer', { reference: 'BK-1' });
  const fake = await pay(await order(p), 4321000, 'transfer', { reference: 'BK-2' });
  const exact = await bankLine(5000000);
  await bankLine(9000000);
  const m = await rpc(ACCOUNT, 'bank_matches');
  const w = m.waiting.find((x) => x.payment_id === waiting);
  eq(w.candidates[0].bank_line_id, exact, 'the exact line comes first:');
  eq(w.candidates[0].exact, true, 'marked exact:');
  const fk = m.waiting.find((x) => x.payment_id === fake);
  expect(fk.candidates.length > 0 && fk.candidates.length <= 3 && fk.candidates.every((x) => N(x.left) >= 4321000), 'only lines big enough can match, three at most');
  expect(m.unmatched.some((x) => x.bank_line_id === exact), 'an unmatched line is listed');
  await rpc(ACCOUNT, 'confirm_payment', { p_payment: waiting, p_bank_line: exact });
  expect(!(await rpc(ACCOUNT, 'bank_matches')).unmatched.some((x) => x.bank_line_id === exact), 'a used line leaves the list');
  await q(`update payments set created_at = now() - interval '5 hours' where id = $1`, [fake]);
  await q(`update bank_lines set matched_kobo = amount_kobo where matched_kobo < amount_kobo`);
  eq((await rpc(ACCOUNT, 'bank_matches')).waiting.find((x) => x.payment_id === fake).no_money_seen, true, 'no money in the bank for it:');
  await rpc(ACCOUNT, 'reject_payment', { p_payment: fake, p_reason: 'Not on the statement' });

  const c = await rpc(ACCOUNT, 'month_close_checks', { p_month: month });
  eq(c.finished, false, 'this month is not over yet:');
  const bank = c.checks.find((x) => x.name === 'The bank matches the statement');
  eq(bank.ok, false, 'no statement typed yet:');
  const typed = await rpc(ACCOUNT, 'month_close_checks', { p_month: month, p_statement_balance: N(bank.books_bank) - 500 });
  eq(N(typed.checks.find((x) => x.name === 'The bank matches the statement').difference), 500, 'difference:');
  for (const who of [COUNTER, STORE, DRIVER]) {
    for (const fn of ['books_month', 'month_close_checks', 'bank_matches']) await fails(rpc(who, fn, fn === 'bank_matches' ? {} : { p_month: month }), 'not_allowed');
  }
});

// ---- The public catalogue and quote requests (Claude, 2 Nov 2026) ----

await test('the public catalogue shows shelf prices and stock bands, and anyone can ask for a quote', async () => {
  const fam = k('Bearings');
  const id = await rpc(OWNER, 'save_product', { p_sku: k('CAT'), p_name: 'Deep groove bearing 6305', p_price: 650000, p_trade: 600000, p_family: fam, p_low_stock_at: 2 });
  await rpc(OWNER, 'set_last_cost', { p_product: id, p_cost: 400000 });
  await rpc(OWNER, 'save_part_details', { p_product: id, p_part_number: '6305 2RS', p_bore: 25, p_outside: 62, p_width: 17 });
  await rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [{ product_id: id, qty: 9 }] });
  const draft = await rpc(OWNER, 'save_product', { p_sku: k('DRAFT'), p_name: 'Deep groove bearing secret', p_price: 1, p_family: fam });
  await q(`update products set status = 'draft' where id = $1`, [draft]);
  const look = (args) => rpc('anon', 'catalogue', args);
  for (const query of ['6305-2rs', '63052RS', 'deep groove', '25 x 62 x 17']) {
    const r = await look({ p_query: query, p_family: fam });
    eq(r.items.length, 1, `"${query}" finds it once:`);
    eq(r.items[0].product, id);
    eq(r.items[0].state, 'in');
    eq(N(r.items[0].price), 650000);
  }
  const all = JSON.stringify(await look({ p_family: fam }));
  expect(!all.includes(draft) && !all.includes('600000') && !all.includes('400000') && !/"(cost|trade|qty|free|on_hand)/.test(all), 'no drafts, trade prices, costs or counts');
  expect((await look({})).families.some((f) => f.family === fam), 'families are listed');
  await fails(look({ p_limit: 0 }), 'bad_limit');
  await fails(look({ p_query: 'x'.repeat(81) }), 'bad_query');

  const ask = (key, phone = '08030000601', lines = [{ product_id: id, qty: 4 }]) => rpc('anon', 'request_quote', { p_key: key, p_name: 'Kemi Adewale', p_phone: phone, p_lines: lines, p_note: 'For a water pump' });
  const key = k('rq');
  const r1 = await ask(key);
  expect(/^RQ-/.test(r1.request_no), 'a request number');
  eq((await ask(key)).request_no, r1.request_no, 'a retry gets the same request:');
  await fails(rpc('anon', 'request_quote', { p_key: key, p_name: 'Kemi Adewale', p_phone: '08030000601', p_lines: [{ product_id: id, qty: 5 }] }), 'key_reused');
  await fails(ask(k('rq'), '123'), 'bad_phone');
  await fails(ask(k('rq'), '08030000601', [{ product_id: draft, qty: 1 }]), 'no_such_product');
  await fails(ask(k('rq'), '08030000601', [{ product_id: id, qty: 1.5 }]), 'bad_qty');
  await fails(ask(k('rq'), '08030000601', []), 'bad_lines');
  for (let i = 0; i < 5; i++) await ask(k('rq'), '08030000602');
  await fails(ask(k('rq'), '08030000602'), 'too_many_requests');
  await fails(as('anon', () => q('select * from quote_requests')), 'permission denied');
  eq((await as(STORE, () => q('select * from quote_requests'))).length, 0, 'storekeeper reads requests:');

  const open = await rpc(COUNTER, 'open_quote_requests');
  const mine = open.find((x) => x.request_no === r1.request_no);
  eq(N(mine.lines[0].price), 650000, "today's price beside the request:");
  const quote = await rpc(COUNTER, 'quote_from_request', { p_request: mine.id, p_location: shop });
  eq(await rpc(COUNTER, 'quote_from_request', { p_request: mine.id, p_location: shop }), quote, 'a retry returns the same quote:');
  eq(N(await val('select total_kobo from quotes where id = $1', [quote])), 2600000, 'quoted at the shelf price:');
  expect(!(await rpc(COUNTER, 'open_quote_requests')).some((x) => x.id === mine.id), 'a quoted request leaves the list');
  const other = (await rpc(COUNTER, 'open_quote_requests'))[0];
  await rpc(COUNTER, 'close_quote_request', { p_request: other.id, p_reason: 'Duplicate' });
  await fails(rpc(COUNTER, 'close_quote_request', { p_request: other.id, p_reason: 'again' }), 'request_not_open');
});

await test('the owner sets hold times, the drawer limit and battery life, and the public sees only how to reach the shop', async () => {
  const defaults = { p_hold_unpaid_hours: 24, p_hold_deposit_days: 14, p_till_paid_out_limit: 5000000, p_battery_life_months: 24 };
  const was = (await q(`select * from shop_settings`))[0];
  try {
    await rpc(OWNER, 'save_settings', { p_hold_unpaid_hours: 2, p_hold_deposit_days: 30, p_till_paid_out_limit: 7500000, p_battery_life_months: 36,
      p_shop_name: '  Ikeja Power  ', p_shop_phone: '0803 555 0101', p_shop_address: '12 Allen Avenue, Ikeja', p_shop_hours: 'Monday to Saturday, 8am to 6pm' });
    const s = (await q(`select * from shop_settings`))[0];
    eq(s.hold_unpaid_hours, 2);
    eq(s.hold_deposit_days, 30);
    eq(N(s.till_paid_out_limit_kobo), 7500000);
    eq(s.battery_life_months, 36);
    eq(s.shop_name, 'Ikeja Power', 'the name is trimmed:');
    eq(s.shop_phone, '2348035550101', 'the phone is kept in one format:');

    // The new hold time is what the next unpaid order gets.
    const id = await rpc(OWNER, 'save_product', { p_sku: k('SET'), p_name: 'Settings test fuse', p_price: 10000 });
    await rpc(OWNER, 'set_last_cost', { p_product: id, p_cost: 6000 });
    await rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [{ product_id: id, qty: 3 }] });
    const o = await rpc(COUNTER, 'create_order', { p_key: k('ord'), p_location: shop, p_lines: [{ product_id: id, qty: 1 }] });
    const hours = Number((await q(`select extract(epoch from hold_until - now()) / 3600 h from orders where id = $1`, [o]))[0].h);
    expect(hours > 1.9 && hours <= 2, `a new unpaid order is held for 2 hours, not ${hours}`);

    // Every change keeps the values before and after.
    const a = (await q(`select actor, detail from audit_log where action = 'save_settings' order by id desc limit 1`))[0];
    eq(a.actor, OWNER, 'the change is signed by the owner:');
    eq(a.detail.before.hold_unpaid_hours, was.hold_unpaid_hours, 'the audit keeps the old value:');
    eq(a.detail.after.hold_unpaid_hours, 2);

    // The public sees how to reach the shop, and nothing about its limits or holds.
    const pub = await rpc('anon', 'shop_details', {});
    eq(Object.keys(pub).sort().join(), 'address,hours,name,phone', 'the public shop details:');
    eq(pub.phone, '2348035550101');
    eq(pub.hours, 'Monday to Saturday, 8am to 6pm');

    await fails(rpc(OWNER, 'save_settings', { ...defaults, p_hold_unpaid_hours: 0 }), 'bad_setting');
    await fails(rpc(OWNER, 'save_settings', { ...defaults, p_hold_deposit_days: 400 }), 'bad_setting');
    await fails(rpc(OWNER, 'save_settings', { ...defaults, p_till_paid_out_limit: -1 }), 'bad_setting');
    await fails(rpc(OWNER, 'save_settings', { ...defaults, p_battery_life_months: 500 }), 'bad_setting');
    await fails(rpc(OWNER, 'save_settings', { ...defaults, p_shop_hours: 'x'.repeat(121) }), 'bad_setting');
    await fails(rpc(OWNER, 'save_settings', { ...defaults, p_shop_phone: '12' }), 'bad_phone');
    await fails(rpc(ACCOUNT, 'save_settings', defaults), 'not_allowed');
    eq((await q(`select hold_unpaid_hours from shop_settings`))[0].hold_unpaid_hours, 2, 'a refused change leaves the settings alone:');

    // Blank details are cleared, so the public shop simply hides them.
    await rpc(OWNER, 'save_settings', { ...defaults, p_shop_name: ' ', p_shop_phone: '' });
    for (const v of Object.values(await rpc('anon', 'shop_details', {}))) eq(v, null, 'cleared details:');
  } finally {
    await q(`update shop_settings set hold_unpaid_hours = $1, hold_deposit_days = $2, till_paid_out_limit_kobo = $3, battery_life_months = $4,
      shop_name = null, shop_phone = null, shop_address = null, shop_hours = null where id`, [was.hold_unpaid_hours, was.hold_deposit_days, was.till_paid_out_limit_kobo, was.battery_life_months]);
  }
});

await test('the price list goes in from a sheet: a preview first, then every row or none, and a retry adds nothing', async () => {
  const base = k('IMP');
  const old = await rpc(OWNER, 'save_product', { p_sku: `${base}-3`, p_name: 'V-belt A42', p_price: 100000, p_trade: 90000, p_warranty_months: 3, p_family: 'belts' });
  await rpc(OWNER, 'save_product', { p_sku: `${base}-4`, p_name: 'Roller chain 08B', p_price: 300000, p_family: 'chains' });
  const rows = [
    { sku: `${base}-1`, name: 'Bearing 6206 2RS', family: 'Bearings', price: 520000, trade: 470000, cost: 330000, part: '6206 2RS', bore: 30, outside: 62, width: 16, warranty: 6 },
    { sku: `${base}-2`, name: 'Inverter battery 200Ah', family: 'Batteries', unit: 'pcs', tracking: 'yes', price: 25000000, warranty: 12 },
    { sku: `${base}-3`, name: 'V-belt A42', price: 120000 },
    { sku: `${base}-4`, name: 'Roller chain 08B', price: 300000 },
  ];
  const look = await rpc(OWNER, 'import_products', { p_key: null, p_rows: rows });
  eq(JSON.stringify(look.counts), JSON.stringify({ new: 2, same: 1, error: 0, update: 1 }), 'the preview counts:');
  eq(look.rows[2].action, 'update');
  eq(N(look.rows[2].price_before), 100000, 'the preview shows the old price:');
  eq(N(look.rows[2].trade), 90000, 'a blank trade price keeps the old one:');
  eq((await q(`select count(*)::int n from products where sku like $1`, [`${base}-%`]))[0].n, 2, 'a preview changes nothing:');

  const bad = [
    { name: 'No code', price: 1000 },
    { sku: `${base}-1`, name: 'Bearing 6206 2RS', price: 520000 },
    { sku: `${base}-1`, name: 'Twice', price: 520000 },
    { sku: `${base}-5`, name: 'Dear trade', price: 1000, trade: 2000 },
    { sku: `${base}-6`, name: 'Odd unit', price: 1000, unit: 'box' },
    { sku: `${base}-7`, name: 'Words for a price', price: 'abc' },
    { sku: `${base}-3`, name: 'V-belt A42', price: 120000, unit: 'metre' },
  ];
  const checked = await rpc(OWNER, 'import_products', { p_key: null, p_rows: bad });
  eq(checked.counts.error, 6, 'six bad lines:');
  eq(checked.rows.map((x) => x.problem ?? '').join('|'), ['The SKU is missing.', '', 'This SKU is already on an earlier line.', 'The trade price is above the shelf price.',
    'The unit must be each or metre.', 'The price is not a usable amount.', 'The unit or serial numbers cannot change on a product that already exists.'].join('|'));
  await fails(rpc(OWNER, 'import_products', { p_key: k('imp'), p_rows: bad, p_apply: true }), 'import_has_errors');
  eq((await q(`select count(*)::int n from products where sku like $1`, [`${base}-%`]))[0].n, 2, 'one bad line stops every line:');

  const key = k('imp');
  const done = await rpc(OWNER, 'import_products', { p_key: key, p_rows: rows, p_apply: true });
  eq(done.applied, true);
  const [a] = await q(`select p.id, p.price_kobo, p.family, p.warranty_months, p.part_number, t.trade_price_kobo, c.last_cost_kobo, s.bore_mm, s.outside_mm, s.width_mm
    from products p left join product_trade_prices t on t.product_id = p.id left join product_costs c on c.product_id = p.id left join product_sizes s on s.product_id = p.id
    where p.sku = $1`, [`${base}-1`]);
  eq(N(a.price_kobo), 520000); eq(N(a.trade_price_kobo), 470000); eq(N(a.last_cost_kobo), 330000);
  eq(a.family, 'bearings'); eq(a.warranty_months, 6); eq(a.part_number, '6206 2RS');
  eq([N(a.bore_mm), N(a.outside_mm), N(a.width_mm)].join(), '30,62,16', 'the sizes:');
  const [b] = await q(`select tracking::text, unit::text from products where sku = $1`, [`${base}-2`]);
  eq(`${b.tracking} ${b.unit}`, 'serial each', 'yes means serial numbers, pcs means each:');
  const [c] = await q(`select p.price_kobo, p.warranty_months, p.family, t.trade_price_kobo from products p join product_trade_prices t on t.product_id = p.id where p.id = $1`, [old]);
  eq(N(c.price_kobo), 120000, 'the new price:');
  eq(`${N(c.trade_price_kobo)} ${c.warranty_months} ${c.family}`, '90000 3 belts', 'blank cells keep trade price, warranty and kind:');
  const found = await rpc('anon', 'catalogue', { p_query: '30 x 62 x 16' });
  expect(found.items.some((x) => x.sku === `${base}-1`), 'the imported bearing is found by its size');

  // A retry after a dropped connection returns the same answer and adds nothing.
  eq(JSON.stringify(await rpc(OWNER, 'import_products', { p_key: key, p_rows: rows, p_apply: true })), JSON.stringify(done), 'a retry gives the same answer:');
  eq((await q(`select count(*)::int n from products where sku like $1`, [`${base}-%`]))[0].n, 4, 'and adds nothing:');
  await fails(rpc(OWNER, 'import_products', { p_key: key, p_rows: rows.slice(0, 1), p_apply: true }), 'key_reused');
  await fails(rpc(OWNER, 'import_products', { p_key: k('imp'), p_rows: [], p_apply: true }), 'bad_import');
  await fails(rpc(ACCOUNT, 'import_products', { p_key: null, p_rows: rows }), 'not_allowed');
});

// ---- Last, because it closes the month that every other scene posts into ----

await test('a month closes only when tills, counts, transfers and the bank all agree, and then it stays shut', async () => {
  const month = await val(`select date_trunc('month', shop_today())::date::text`);
  const bankBefore = async (end) => N(await val(`select coalesce(sum(e.amount_kobo), 0) from ledger_entries e join ledger_txns t on t.id = e.txn_id where e.account_code = 'bank' and t.occurred_on < $1::date`, [end]));
  const after = async (m) => val(`select ($1::date + interval '1 month')::date::text`, [m]);
  const p = await product({ qty: 3 });
  const o = await order(p);
  await pay(o, 1000000, 'transfer');
  const count = await rpc(STORE, 'submit_stock_count', { p_key: k('cnt'), p_location: shop, p_lines: [{ product_id: p.id, counted: 3 }] });
  await fails(rpc(OWNER, 'close_month', { p_month: month, p_statement_balance: 0 }), 'month_not_finished');

  // Earlier months must close first, in order.
  const earlier = (await q(`select distinct date_trunc('month', occurred_on)::date::text m from ledger_txns
    where occurred_on < $1::date and date_trunc('month', occurred_on)::date not in (select month from closed_periods) order by 1`, [month])).map((r) => r.m);
  expect(earlier.length >= 2, 'expected some earlier months');
  await fails(rpc(OWNER, 'close_month', { p_month: earlier[1], p_statement_balance: await bankBefore(await after(earlier[1])) }), 'an earlier month is still open');
  for (const m of earlier) await rpc(OWNER, 'close_month', { p_month: m, p_statement_balance: await bankBefore(await after(m)) });

  // A month later, the shop tries to close this month.
  await db.exec(`create or replace function shop_today() returns date language sql stable set search_path = public, pg_temp as $$ select ((now() at time zone 'Africa/Lagos') + interval '1 month')::date $$`);
  const nextMonth = await after(month);
  await fails(rpc(OWNER, 'close_month', { p_month: month, p_statement_balance: null }), 'statement_required');
  try {
    await rpc(OWNER, 'close_month', { p_month: month, p_statement_balance: 1 });
    throw new Error('it closed');
  } catch (e) {
    for (const why of ['a till is still open', 'a stock count is waiting', 'a payment is waiting', 'bank differs']) expect(e.message.includes(why), `missing "${why}" in ${e.message}`);
  }
  await rpc(COUNTER, 'close_till', { p_counted: 1 });
  await rpc(OWNER, 'approve_stock_count', { p_count: count });
  for (const r of await q(`select id from payments where status = 'pending'`)) await rpc(ACCOUNT, 'reject_payment', { p_payment: r.id, p_reason: 'No money' });
  await rpc(OWNER, 'close_month', { p_month: month, p_statement_balance: await bankBefore(nextMonth) });
  await rpc(OWNER, 'close_month', { p_month: month, p_statement_balance: 0 });

  const insideClosed = await val(`select ($1::date + 5)::text`, [month]);
  await fails(rpc(ACCOUNT, 'record_expense', { p_key: k('exp'), p_account: 'rent', p_amount: 1, p_paid_from: 'bank', p_what: 'Late', p_on: insideClosed }), 'period_closed');
  const late = await order(p);
  const id = await pay(late, 1000000, 'transfer');
  await fails(rpc(ACCOUNT, 'confirm_payment', { p_payment: id, p_bank_line: await bankLine(1000000, insideClosed) }), 'period_closed');
  await rpc(ACCOUNT, 'reject_payment', { p_payment: id, p_reason: 'Dated in a closed month' });
  const s = await sale(p, { method: 'pos' });
  eq(s.state, 'done', 'the new month works:');
  eq(await val(`select to_char(occurred_on, 'YYYY-MM-01') from ledger_txns where ref_type = 'delivery' and ref_id = (select id from deliveries where order_id = $1)`, [s.order_id]), nextMonth);
});

await test('a return after a month closed lands in the open month', async () => {
  const p = await product({ price: 1000000, cost: 900000, qty: 2 });
  const s = await sale(p, { method: 'pos' });
  const r = await ret(s.order_id, [{ product_id: p.id, qty: 1 }]);
  expect(N(await val('select count(*) from closed_periods')) > 0, 'expected a closed month');
  eq(await val(`select to_char(occurred_on, 'YYYY-MM-01') from ledger_txns where ref_type = 'return' and ref_id = $1`, [r]),
    await val(`select to_char(shop_today(), 'YYYY-MM-01')`));
  eq((await shelf(p)).qty, 2, 'the unit is back:');
});

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'pass' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.why}`}`);
console.log(`\n${results.length - failed.length} of ${results.length} passed on ${db.where}`);
await db.close();
await stopPg();
process.exit(failed.length ? 1 : 0);
