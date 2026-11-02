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
const pay = (o, amount, method = 'pos', { who = COUNTER, reference = null } = {}) =>
  rpc(who, 'take_payment', { p_key: k('pay'), p_order: o, p_method: method, p_amount: amount, p_reference: reference });
const deliver = (o, lines = null, who = COUNTER) => rpc(who, 'deliver_order', { p_key: k('go'), p_order: o, p_lines: lines });
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
  same(await moved(() => pay(o, 60000000)), { bank: 60000000, goods_owed: -60000000 });
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
  await rpc(OWNER, 'reverse_payment', { p_payment: await val('select id from payments where order_id = $1', [s.order_id]), p_reason: 'Chargeback' });
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
  eq((await runnable('anon')).join(), 'availability,check_serial,has_staff_role,is_staff,receipt_by_token,shop_today');
  eq((await runnable('service_role')).join(), 'expire_holds,i_books_check,shop_today');
  eq((await runnable('authenticated')).join(), [
    'add_bank_line', 'approve_stock_count', 'availability', 'books_check', 'cancel_order', 'check_serial', 'close_month', 'close_till', 'confirm_payment',
    'counter_sale', 'create_order', 'customer_balance', 'debtors', 'decide_approval', 'deliver_order', 'has_staff_role', 'is_staff', 'month_report', 'move_money',
    'my_till', 'oldest_serials', 'open_till', 'owner_exceptions', 'pay_supplier', 'post_opening_balance', 'post_opening_debt', 'receipt_by_token', 'receive_goods',
    'record_expense', 'refund_order', 'reject_payment', 'reject_stock_count', 'reserve_order', 'reverse_payment', 'reverse_txn', 'save_customer', 'save_location', 'save_product',
    'save_staff', 'save_supplier', 'set_customer_terms', 'set_last_cost', 'shop_today', 'submit_stock_count', 'take_payment', 'till_paid_out', 'transfer_stock', 'void_opening_debt',
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
    ['debtors', {}, everyoneBut(COUNTER, COUNTER2, ACCOUNT)],
    ['customer_balance', { p_customer: dummy }, everyoneBut(COUNTER, COUNTER2, ACCOUNT)],
    ['open_till', { p_float: 0 }, everyoneBut(COUNTER, COUNTER2, ACCOUNT)],
    ['close_till', { p_counted: 0 }, everyoneBut(COUNTER, COUNTER2, ACCOUNT)],
    ['my_till', {}, everyoneBut(COUNTER, COUNTER2, ACCOUNT)],
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
    for (const why of ['a till is still open', 'a stock count is waiting', 'a transfer is waiting', 'bank differs']) expect(e.message.includes(why), `missing "${why}" in ${e.message}`);
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

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'pass' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      ${r.why}`}`);
console.log(`\n${results.length - failed.length} of ${results.length} passed on ${db.where}`);
await db.close();
await stopPg();
process.exit(failed.length ? 1 : 0);
