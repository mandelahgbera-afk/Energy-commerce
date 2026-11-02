// 90 days of a pretend shop on real Postgres, one action at a time through the same functions the screens will call.
// It answers two things: do the books still agree every single day, and how much database does one sale really use?
//   node simulate.mjs [sales per day, default 30] [days, default 90]
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { startPostgres } from './testpg.mjs';
import { schemaSql, buildCall, unwrap, N, USERS, seedPeople, postgresOptions, here } from './lib.mjs';

const { OWNER, COUNTER, COUNTER2, STORE, ACCOUNT } = USERS;
const perDay = Number(process.argv[2] ?? 30);
const days = Number(process.argv[3] ?? 90);
const PORT = 54413;
const pg = await startPostgres({ port: PORT, password: 'test', database: 'power_sim' });
const options = postgresOptions(PORT, 'test', 'power_sim', 1);
const adminSql = postgres(options);
for (const part of schemaSql()) await adminSql.unsafe(part);
const admin = async (t, p = []) => [...(await adminSql.unsafe(t, p))];
const val = async (t, p = []) => { const r = (await admin(t, p))[0]; return r ? Object.values(r)[0] : null; };
await seedPeople({ query: admin });

// The pretend calendar. This replaces shop_today() in this throwaway database only.
await admin('create table sim_clock (today date not null)');
await admin(`insert into sim_clock values ('2026-01-01')`);
await admin('grant select on sim_clock to anon, authenticated, service_role');
await admin(`create or replace function shop_today() returns date language sql stable set search_path = public, pg_temp as $$ select today from sim_clock $$`);

// One connection stays logged in as an API user, so nothing here gets rights a real screen wouldn't have.
const apiSql = postgres(options);
const api = await apiSql.reserve();
await api.unsafe('set role authenticated');
let times = [];
const rpc = async (who, fn, args = {}) => {
  await api.unsafe(`select set_config('request.jwt.claim.sub', $1, false)`, [who]);
  const c = buildCall(fn, args);
  const started = process.hrtime.bigint();
  const out = unwrap([...(await api.unsafe(c.text, c.params))]);
  if (fn === 'counter_sale') times.push(Number(process.hrtime.bigint() - started) / 1e6);
  return out;
};

// Same numbers every run, so a change in the result means the code changed.
let seed = 20261101;
const rand = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rand() * a.length)];
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
let seq = 0;
const k = (p) => `${p}-${++seq}`;
const iso = (d) => d.toISOString().slice(0, 10);

for (const [user, name, role, limit] of [[COUNTER, 'Ada', 'counter', 5], [COUNTER2, 'Bayo', 'counter', 3], [STORE, 'Chidi', 'storekeeper', 0], [ACCOUNT, 'Fatima', 'accountant', 0]]) {
  await rpc(OWNER, 'save_staff', { p_user: user, p_name: name, p_role: role, p_discount_limit: limit });
}
const shop = await rpc(OWNER, 'save_location', { p_name: 'Main shop' });
const suppliers = [];
for (const name of ['Lagos Batteries', 'Sun Import', 'Bearing House']) suppliers.push(await rpc(OWNER, 'save_supplier', { p_name: name }));

// A catalogue the size of a real dealer: mostly small parts, with fewer big-ticket panels and batteries.
const families = [
  { family: 'solar panel', n: 60, price: [8000000, 25000000], tracking: 'serial', vat: 0, warranty: 120, weight: 0.1 },
  { family: 'solar battery', n: 80, price: [25000000, 180000000], tracking: 'serial', vat: 0, warranty: 24, weight: 0.08 },
  { family: 'car battery', n: 140, price: [4500000, 18000000], tracking: 'serial', vat: 750, warranty: 12, weight: 0.27 },
  { family: 'bearing', n: 900, price: [150000, 2500000], tracking: 'count', vat: 750, warranty: 0, weight: 0.3 },
  { family: 'belt', n: 300, price: [200000, 1800000], tracking: 'count', vat: 750, warranty: 0, weight: 0.17 },
  { family: 'chain', n: 120, price: [300000, 1500000], tracking: 'count', unit: 'metre', vat: 750, warranty: 0, weight: 0.08 },
];
const products = [];
for (const f of families) {
  for (let i = 0; i < f.n; i++) {
    const price = between(f.price[0], f.price[1]);
    const p = { sku: `${f.family.slice(0, 3).toUpperCase()}-${i + 1}`, price, tracking: f.tracking, unit: f.unit ?? 'each', weight: f.weight, family: f.family, cost: Math.round(price * (0.6 + rand() * 0.2)) };
    p.id = await rpc(OWNER, 'save_product', {
      p_sku: p.sku, p_name: `${f.family} ${i + 1}`, p_price: price, p_trade: Math.round(price * 0.93), p_tracking: f.tracking, p_unit: p.unit,
      p_warranty_months: f.warranty, p_vat_bp: f.vat, p_family: f.family, p_low_stock_at: 3, p_attributes: { brand: pick(['SKF', 'NTN', 'Felicity', 'Luminous', 'Exide']), size: `${between(10, 400)}mm` },
    });
    await rpc(ACCOUNT, 'set_last_cost', { p_product: p.id, p_cost: p.cost });
    products.push(p);
  }
}
const weighted = (() => { const out = []; for (const p of products) for (let i = 0; i < Math.round(p.weight * 10); i++) out.push(p); return out; })();

let serialNo = 0;
const today = () => val('select today::text from sim_clock');
async function receive(items) {
  const day = await today();
  const lines = items.map(({ p, qty }) => {
    const line = { product_id: p.id, qty, lot: `L-${day}`, made_on: day };
    if (p.tracking === 'serial') line.serials = Array.from({ length: qty }, () => `${p.sku}-${++serialNo}`);
    return line;
  });
  await rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: pick(suppliers), p_location: shop, p_lines: lines, p_on: day });
}

// Opening stock for what the shop keeps on the shelf, entered in batches as a supplier delivery.
for (let i = 0; i < products.length; i += 60) {
  await receive(products.slice(i, i + 60).map((p) => ({ p, qty: p.tracking === 'serial' ? 3 : 12 })));
}

const free = async (p) => N(await val('select coalesce(sum(qty - reserved), 0) from stock_balances where product_id = $1', [p.id]));
async function serialsFor(p, n) {
  await api.unsafe(`select set_config('request.jwt.claim.sub', $1, false)`, [COUNTER]);
  return [...(await api.unsafe('select serial from oldest_serials($1, $2, $3)', [p.id, shop, n]))].map((r) => r.serial);
}
async function deliveryLines(lines) {
  const out = [];
  for (const l of lines) {
    const entry = { product_id: l.p.id, qty: l.qty };
    if (l.p.tracking === 'serial') entry.serials = await serialsFor(l.p, l.qty);
    out.push(entry);
  }
  return out;
}

const phones = Array.from({ length: Math.max(200, perDay * 25) }, (_, i) => `0803${String(1000000 + i)}`);
const tradePhones = phones.slice(0, 40);
for (const phone of tradePhones) {
  const c = await rpc(COUNTER, 'save_customer', { p_phone: phone, p_name: `Trade ${phone}`, p_reminders_ok: true });
  await rpc(OWNER, 'set_customer_terms', { p_customer: c, p_kind: 'installer', p_credit_limit: 500000000 });
}

const startedSize = N(await val('select pg_database_size(current_database())'));
const tally = { sales: 0, cash: 0, pos: 0, transfer: 0, deposit: 0, credit: 0, approval: 0, abandoned: 0, refused: 0, booksChecks: 0, tillsClosed: 0, monthsClosed: 0, counts: 0, lines: 0 };
const openDeposits = [];
const openCredit = [];
const checkpoints = [];

async function chooseLines() {
  const n = pick([1, 1, 1, 2, 2, 3, 4]);
  const seen = new Set();
  const lines = [];
  for (let i = 0; i < n; i++) {
    const p = pick(weighted);
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const qty = p.tracking === 'serial' ? pick([1, 1, 1, 2]) : p.unit === 'metre' ? pick([0.5, 1, 1.5, 2.5, 3]) : pick([1, 1, 2, 4, 6]);
    if ((await free(p)) >= qty) lines.push({ p, qty });
  }
  return lines;
}

const orderTotal = async (o) => N(await val('select total_kobo from orders where id = $1', [o]));

async function oneSale(who) {
  const lines = await chooseLines();
  if (lines.length === 0) { tally.refused++; return; }
  tally.lines += lines.length;
  const roll = rand();
  const phone = rand() < 0.55 ? pick(phones) : null;
  const withSerials = await deliveryLines(lines);
  if (roll < 0.03) {
    // Asks for too big a discount and waits for the owner.
    const asked = lines.map((l) => ({ product_id: l.p.id, qty: l.qty, unit_price: Math.round(l.p.price * 0.8) }));
    const o = await rpc(who, 'create_order', { p_key: k('ord'), p_location: shop, p_lines: asked, p_phone: phone ?? pick(phones) });
    const ap = await val('select id from approvals where order_id = $1', [o]);
    tally.approval++;
    if (ap && rand() < 0.3) { await rpc(OWNER, 'decide_approval', { p_approval: ap, p_yes: false, p_note: 'Too low' }); return; }
    if (ap) await rpc(OWNER, 'decide_approval', { p_approval: ap, p_yes: true });
    await rpc(who, 'take_payment', { p_key: k('pay'), p_order: o, p_method: 'pos', p_amount: await orderTotal(o) });
    await rpc(who, 'deliver_order', { p_key: k('go'), p_order: o, p_lines: withSerials });
    tally.sales++;
  } else if (roll < 0.06) {
    // Asks for a hold and never comes back.
    await rpc(who, 'create_order', { p_key: k('ord'), p_location: shop, p_lines: lines.map((l) => ({ product_id: l.p.id, qty: l.qty })), p_phone: phone ?? pick(phones) });
    tally.abandoned++;
  } else if (roll < 0.16) {
    // Pays a deposit by transfer and collects another day.
    const o = await rpc(who, 'create_order', { p_key: k('ord'), p_location: shop, p_channel: pick(['phone', 'online']), p_lines: lines.map((l) => ({ product_id: l.p.id, qty: l.qty })), p_phone: phone ?? pick(phones) });
    const total = await orderTotal(o);
    const deposit = Math.round(total * 0.4);
    const id = await rpc(who, 'take_payment', { p_key: k('pay'), p_order: o, p_method: 'transfer', p_amount: deposit, p_reference: k('TRF') });
    const bl = await rpc(ACCOUNT, 'add_bank_line', { p_key: k('bl'), p_on: await today(), p_amount: deposit, p_reference: k('STMT') });
    await rpc(ACCOUNT, 'confirm_payment', { p_payment: id, p_bank_line: bl });
    openDeposits.push({ o, rest: total - deposit, lines, due: between(1, 6) });
    tally.deposit++;
  } else if (roll < 0.21) {
    // A trade customer takes goods on credit.
    const o = await rpc(who, 'create_order', { p_key: k('ord'), p_location: shop, p_lines: lines.map((l) => ({ product_id: l.p.id, qty: l.qty })), p_phone: pick(tradePhones), p_on_credit: true });
    const needs = await val('select needs_approval from orders where id = $1', [o]);
    if (needs) { await rpc(OWNER, 'decide_approval', { p_approval: await val('select id from approvals where order_id = $1', [o]), p_yes: true }); tally.approval++; }
    await rpc(who, 'deliver_order', { p_key: k('go'), p_order: o, p_lines: withSerials });
    openCredit.push({ o, due: between(7, 30), left: await orderTotal(o) });
    tally.credit++;
    tally.sales++;
  } else {
    // A walk-in, paid and gone in one tap, by cash, card or transfer.
    const method = roll < 0.6 ? 'cash' : roll < 0.85 ? 'pos' : 'transfer';
    const s = await rpc(who, 'counter_sale', { p_key: k('sale'), p_location: shop, p_lines: withSerials, p_method: method, p_phone: phone, p_name: phone ? `Customer ${phone}` : null, p_reference: method === 'transfer' ? k('TRF') : null });
    tally[method]++;
    tally.sales++;
    if (method === 'transfer') {
      const id = await val('select id from payments where order_id = $1', [s.order_id]);
      const bl = await rpc(ACCOUNT, 'add_bank_line', { p_key: k('bl'), p_on: await today(), p_amount: N(s.total), p_reference: k('STMT') });
      await rpc(ACCOUNT, 'confirm_payment', { p_payment: id, p_bank_line: bl });
      await rpc(who, 'deliver_order', { p_key: k('go'), p_order: s.order_id, p_lines: withSerials });
    }
  }
}

async function collectDeposits() {
  for (let i = openDeposits.length - 1; i >= 0; i--) {
    const d = openDeposits[i];
    if (--d.due > 0) continue;
    openDeposits.splice(i, 1);
    if (d.rest > 0) await rpc(COUNTER2, 'take_payment', { p_key: k('pay'), p_order: d.o, p_method: 'pos', p_amount: d.rest });
    await rpc(COUNTER, 'deliver_order', { p_key: k('go'), p_order: d.o, p_lines: await deliveryLines(d.lines) });
    tally.sales++;
  }
}

async function collectDebts() {
  for (let i = openCredit.length - 1; i >= 0; i--) {
    const c = openCredit[i];
    if (--c.due > 0) continue;
    const part = rand() < 0.3 ? Math.round(c.left / 2) : c.left;
    if (part > 0) {
      const id = await rpc(ACCOUNT, 'take_payment', { p_key: k('pay'), p_order: c.o, p_method: 'transfer', p_amount: part, p_reference: k('TRF') });
      const bl = await rpc(ACCOUNT, 'add_bank_line', { p_key: k('bl'), p_on: await today(), p_amount: part, p_reference: k('STMT') });
      await rpc(OWNER, 'confirm_payment', { p_payment: id, p_bank_line: bl });
    }
    c.left -= part;
    if (c.left <= 0) openCredit.splice(i, 1); else c.due = between(3, 14);
  }
}

async function restock() {
  const low = await admin(`select product_id, sum(qty - reserved) f from stock_balances group by 1 having sum(qty - reserved) < 3 limit 40`);
  const items = low.map((r) => products.find((p) => p.id === r.product_id)).filter(Boolean).map((p) => ({ p, qty: p.tracking === 'serial' ? 4 : 15 }));
  if (items.length === 0) return;
  // Costs drift with the exchange rate, so now and then the owner updates one.
  for (const { p } of items) {
    if (rand() < 0.3) { p.cost = Math.round(p.cost * (1 + rand() * 0.08)); await rpc(OWNER, 'set_last_cost', { p_product: p.id, p_cost: p.cost }); }
  }
  await receive(items);
  await rpc(ACCOUNT, 'pay_supplier', { p_key: k('sp'), p_supplier: pick(suppliers), p_amount: between(5000000, 40000000), p_on: await today() });
}

const start = new Date('2026-01-01T00:00:00Z');
const clockStarted = Date.now();
for (let d = 0; d < days; d++) {
  const date = new Date(start.getTime() + d * 86400000);
  await admin('update sim_clock set today = $1', [iso(date)]);

  // Month end: the owner closes last month before the new day's business starts.
  if (date.getUTCDate() === 1 && d > 0) {
    const month = iso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1)));
    const end = iso(date);
    const bank = N(await val(`select coalesce(sum(e.amount_kobo), 0) from ledger_entries e join ledger_txns t on t.id = e.txn_id where e.account_code = 'bank' and t.occurred_on < $1::date`, [end]));
    await rpc(OWNER, 'close_month', { p_month: month, p_statement_balance: bank });
    tally.monthsClosed++;
  }

  await rpc(COUNTER, 'open_till', { p_float: 5000000 });
  await rpc(COUNTER2, 'open_till', { p_float: 5000000 });
  await restock();
  await collectDeposits();
  for (let i = 0; i < perDay; i++) await oneSale(i % 3 === 0 ? COUNTER2 : COUNTER);
  await collectDebts();
  await admin(`update orders set hold_until = now() - interval '1 minute' where created_on < $1::date - 1 and paid_kobo = 0 and goods_status = 'waiting' and hold_until is not null`, [iso(date)]);
  await api.unsafe('reset role');
  await api.unsafe('set role service_role');
  await api.unsafe('select expire_holds()');
  await api.unsafe('reset role');
  await api.unsafe('set role authenticated');

  // Paying running costs, some from the drawer.
  await rpc(COUNTER, 'till_paid_out', { p_key: k('out'), p_account: 'fuel_delivery', p_amount: between(200000, 900000), p_what: 'Generator fuel' });
  await rpc(ACCOUNT, 'record_expense', { p_key: k('exp'), p_account: pick(['fuel_delivery', 'other_costs', 'bank_charges']), p_amount: between(100000, 1500000), p_paid_from: 'bank', p_what: 'Running cost', p_on: iso(date) });
  if (date.getUTCDate() === 28) {
    await rpc(ACCOUNT, 'record_expense', { p_key: k('exp'), p_account: 'salaries', p_amount: 60000000, p_paid_from: 'bank', p_what: 'Salaries', p_on: iso(date) });
    await rpc(ACCOUNT, 'record_expense', { p_key: k('exp'), p_account: 'rent', p_amount: 25000000, p_paid_from: 'bank', p_what: 'Rent', p_on: iso(date) });
  }

  // Weekly count of a few shelves, with the odd missing part.
  if (d % 7 === 3) {
    const sampled = (await admin(`select b.product_id, b.qty from stock_balances b join products p on p.id = b.product_id where p.tracking = 'count' and b.reserved = 0 and b.qty > 2 order by b.product_id limit 15`));
    const c = await rpc(STORE, 'submit_stock_count', { p_key: k('cnt'), p_location: shop, p_lines: sampled.map((s, i) => ({ product_id: s.product_id, counted: N(s.qty) - (i === 0 ? 1 : 0) })) });
    await rpc(OWNER, 'approve_stock_count', { p_count: c });
    tally.counts++;
  }

  // Evening: count the drawers blind, usually right, sometimes a little short.
  for (const who of [COUNTER, COUNTER2]) {
    const session = await val(`select id from till_sessions where staff_id = $1 and status = 'open'`, [who]);
    const float = N(await val('select float_kobo from till_sessions where id = $1', [session]));
    const cash = N(await val(`select coalesce(sum(amount_kobo), 0) from payments where till_session_id = $1 and status = 'confirmed' and method = 'cash'`, [session]));
    const out = N(await val('select coalesce(sum(amount_kobo), 0) from till_paid_outs where session_id = $1', [session]));
    const counted = float + cash - out - (rand() < 0.1 ? between(5000, 50000) : 0);
    await rpc(who, 'close_till', { p_counted: Math.max(counted, 0) });
    tally.tillsClosed++;
  }
  const cashHeld = N(await val(`select coalesce(sum(amount_kobo), 0) from ledger_entries where account_code = 'cash'`));
  if (cashHeld > 20000000) await rpc(ACCOUNT, 'move_money', { p_key: k('bank'), p_from: 'cash', p_to: 'bank', p_amount: cashHeld - 10000000, p_on: iso(date) });

  const chk = await val('select i_books_check()');
  tally.booksChecks++;
  if (!chk.ok) throw new Error(`Day ${d + 1} (${iso(date)}): the books disagree: ${chk.problems.join('; ')}`);

  if ((d + 1) % 30 === 0 || d === days - 1) {
    const size = N(await val('select pg_database_size(current_database())'));
    checkpoints.push({ day: d + 1, bytes: size, sales: tally.sales });
    console.log(`day ${d + 1}: ${tally.sales} sales, database ${(size / 1048576).toFixed(1)} MB, ${Math.round((Date.now() - clockStarted) / 1000)} s so far`);
  }
}

await admin('vacuum analyze');
const finishedSize = N(await val('select pg_database_size(current_database())'));
const tables = await admin(`select c.relname t, pg_total_relation_size(c.oid) b, c.reltuples r from pg_class c join pg_namespace s on s.oid = c.relnamespace
  where s.nspname = 'public' and c.relkind = 'r' order by 2 desc`);
const orders = N(await val('select count(*) from orders'));
const grown = finishedSize - startedSize;
const kbPerSale = grown / 1024 / tally.sales;
const sortedTimes = [...times].sort((a, b) => a - b);
const pct = (p) => sortedTimes[Math.floor(sortedTimes.length * p)];
const report = {
  perDay, days, tally, orders,
  startedBytes: startedSize, finishedBytes: finishedSize, grownBytes: grown,
  kbPerSale: Number(kbPerSale.toFixed(2)),
  counterSaleMs: { p50: Number(pct(0.5).toFixed(1)), p95: Number(pct(0.95).toFixed(1)), p99: Number(pct(0.99).toFixed(1)), n: sortedTimes.length },
  checkpoints,
  tables: tables.slice(0, 14).map((t) => ({ table: t.t, kb: Math.round(N(t.b) / 1024), rows: N(t.r) })),
  ledgerRows: N(await val('select count(*) from ledger_entries')),
};
fs.mkdirSync(path.join(here, 'reports'), { recursive: true });
fs.writeFileSync(path.join(here, 'reports', `simulate-${perDay}-per-day.json`), `${JSON.stringify(report, null, 2)}\n`);

console.log(`\n${tally.sales} sales over ${days} days at ${perDay} a day; books checked ${tally.booksChecks} times, all agreed.`);
console.log(`Tally: ${JSON.stringify(tally)}`);
console.log(`Database: ${(startedSize / 1048576).toFixed(1)} MB with the catalogue, ${(finishedSize / 1048576).toFixed(1)} MB after. ${kbPerSale.toFixed(1)} KB per sale.`);
console.log(`counter_sale: median ${report.counterSaleMs.p50} ms, 95% under ${report.counterSaleMs.p95} ms (the database alone, on this laptop).`);
console.log('Biggest tables:');
for (const t of report.tables) console.log(`  ${t.table.padEnd(24)} ${String(t.kb).padStart(8)} KB  ${t.rows} rows`);

await api.unsafe('reset role');
api.release();
await apiSql.end({ timeout: 2 });
await adminSql.end({ timeout: 2 });
await pg.stop();
process.exit(0);
