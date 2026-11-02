// Real connections fighting over the same things at the same moment, on real Postgres.
// Passing here means the locks hold, retries are safe, numbers have no gaps and nothing deadlocks.
import postgres from 'postgres';
import { startPostgres } from './testpg.mjs';
import { schemaSql, buildCall, unwrap, N, USERS, seedPeople, postgresOptions } from './lib.mjs';

const { OWNER, COUNTER, COUNTER2, STORE, ACCOUNT } = USERS;
const PORT = 54412;
const pg = await startPostgres({ port: PORT, password: 'test', database: 'power_race' });
const sql = postgres(postgresOptions(PORT, 'test', 'power_race', 30));
for (const part of schemaSql()) await sql.unsafe(part);
const admin = { query: async (t, p = []) => [...(await sql.unsafe(t, p))] };
await seedPeople(admin);

const rpc = (who, fn, args = {}) => sql.begin(async (t) => {
  await t.unsafe(`select set_config('request.jwt.claim.sub', $1, true)`, [who]);
  await t.unsafe('set local role authenticated');
  const c = buildCall(fn, args);
  return unwrap([...(await t.unsafe(c.text, c.params))]);
});
const val = async (t, p = []) => { const r = (await admin.query(t, p))[0]; return r ? Object.values(r)[0] : null; };

await rpc(OWNER, 'save_staff', { p_user: COUNTER, p_name: 'Ada', p_role: 'counter', p_discount_limit: 5 });
await rpc(OWNER, 'save_staff', { p_user: COUNTER2, p_name: 'Bayo', p_role: 'counter', p_discount_limit: 5 });
await rpc(OWNER, 'save_staff', { p_user: STORE, p_name: 'Chidi', p_role: 'storekeeper' });
await rpc(OWNER, 'save_staff', { p_user: ACCOUNT, p_name: 'Fatima', p_role: 'accountant' });
const shop = await rpc(OWNER, 'save_location', { p_name: 'Main shop' });
const back = await rpc(OWNER, 'save_location', { p_name: 'Back store', p_kind: 'warehouse' });
const sup = await rpc(OWNER, 'save_supplier', { p_name: 'Lagos Batteries' });

const today = await val('select shop_today()::text');
let seq = 0;
const k = (p = 'k') => `${p}-${++seq}`;
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg = '') => { if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`); };

async function product({ price = 10000000, cost = 6000000, qty = 10, tracking = 'count' } = {}) {
  const sku = `R-${++seq}`;
  const id = await rpc(OWNER, 'save_product', { p_sku: sku, p_name: `Race ${sku}`, p_price: price, p_tracking: tracking });
  await rpc(OWNER, 'set_last_cost', { p_product: id, p_cost: cost });
  const serials = tracking === 'serial' ? Array.from({ length: qty }, (_, i) => `${sku}-${i + 1}`) : [];
  if (qty > 0) await rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [{ product_id: id, qty, serials }] });
  return { id, sku, serials };
}

// Waits for all of them, and counts how each one ended.
async function settle(promises) {
  const out = await Promise.allSettled(promises);
  const errors = {};
  for (const r of out) {
    if (r.status === 'rejected') {
      const name = String(r.reason.message).split(':')[0];
      errors[name] = (errors[name] ?? 0) + 1;
    }
  }
  return { wins: out.filter((r) => r.status === 'fulfilled').map((r) => r.value), errors };
}
const onlyErrors = (errors, allowed) => {
  const bad = Object.keys(errors).filter((e) => !allowed.includes(e));
  expect(bad.length === 0, `unexpected errors: ${bad.join(', ')}`);
};
const sale = (p, { key = k('sale'), who = COUNTER, serials, method = 'pos', qty = 1 } = {}) =>
  rpc(who, 'counter_sale', { p_key: key, p_location: shop, p_lines: [{ product_id: p.id, qty, ...(serials ? { serials } : {}) }], p_method: method });

const results = [];
async function scene(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    const chk = await val('select i_books_check()');
    if (!chk.ok) throw new Error(`books disagree afterwards: ${chk.problems.join('; ')}`);
    results.push({ name, ok: true, ms: Date.now() - started, detail });
  } catch (e) {
    results.push({ name, ok: false, why: e.message });
  }
}

await scene('20 sellers, 1 unit left: exactly one sells it', async () => {
  const p = await product({ qty: 1 });
  const { wins, errors } = await settle(Array.from({ length: 20 }, () => sale(p)));
  eq(wins.length, 1);
  onlyErrors(errors, ['insufficient_stock']);
  eq(N(await val('select qty from stock_balances where product_id = $1', [p.id])), 0);
  eq(N(await val('select value_kobo from product_costs where product_id = $1', [p.id])), 0);
  return `1 won, ${errors.insufficient_stock} refused`;
});

await scene('20 sellers, 5 units left: exactly five sell', async () => {
  const p = await product({ qty: 5 });
  const { wins, errors } = await settle(Array.from({ length: 20 }, () => sale(p)));
  eq(wins.length, 5);
  onlyErrors(errors, ['insufficient_stock']);
  eq(N(await val('select qty from stock_balances where product_id = $1', [p.id])), 0);
  return '5 won, 15 refused';
});

await scene('10 sellers want the same battery by serial number: one gets it', async () => {
  const p = await product({ qty: 3, tracking: 'serial' });
  const { wins, errors } = await settle(Array.from({ length: 10 }, () => sale(p, { serials: [p.serials[0]] })));
  eq(wins.length, 1);
  onlyErrors(errors, ['serial_not_available', 'insufficient_stock']);
  eq(N(await val(`select count(*) from serial_units where product_id = $1 and status = 'sold'`, [p.id])), 1);
  eq(N(await val('select qty from stock_balances where product_id = $1', [p.id])), 2);
  return `1 won, ${10 - wins.length} refused`;
});

await scene('the same sale sent 10 times at once records one sale', async () => {
  const p = await product({ qty: 5 });
  const key = k('sale');
  const { wins, errors } = await settle(Array.from({ length: 10 }, () => sale(p, { key })));
  onlyErrors(errors, []);
  eq(new Set(wins.map((w) => w.order_id)).size, 1);
  const o = wins[0].order_id;
  eq(N(await val('select count(*) from payments where order_id = $1', [o])), 1);
  eq(N(await val('select count(*) from deliveries where order_id = $1', [o])), 1);
  eq(N(await val('select qty from stock_balances where product_id = $1', [p.id])), 4);
  return '10 calls, 1 sale';
});

await scene('goods received twice at once by a double tap count once', async () => {
  const p = await product({ qty: 0 });
  const args = { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [{ product_id: p.id, qty: 7 }] };
  const { wins, errors } = await settle(Array.from({ length: 8 }, () => rpc(STORE, 'receive_goods', args)));
  onlyErrors(errors, []);
  eq(new Set(wins).size, 1);
  eq(N(await val('select qty from stock_balances where product_id = $1', [p.id])), 7);
  return '8 calls, 1 receipt';
});

await scene('two people confirm one transfer at the same moment: money goes in once', async () => {
  const p = await product({ qty: 1 });
  const o = await rpc(COUNTER, 'create_order', { p_key: k('ord'), p_location: shop, p_lines: [{ product_id: p.id, qty: 1 }] });
  const id = await rpc(COUNTER, 'take_payment', { p_key: k('pay'), p_order: o, p_method: 'transfer', p_amount: 10000000 });
  const bl = await rpc(ACCOUNT, 'add_bank_line', { p_key: k('bl'), p_on: today, p_amount: 100000000 });
  const attempts = Array.from({ length: 10 }, (_, i) => rpc(i % 2 ? OWNER : ACCOUNT, 'confirm_payment', { p_payment: id, p_bank_line: bl }));
  const { wins, errors } = await settle(attempts);
  eq(wins.length, 1);
  onlyErrors(errors, ['payment_already_decided']);
  eq(N(await val('select paid_kobo from orders where id = $1', [o])), 10000000);
  eq(N(await val('select matched_kobo from bank_lines where id = $1', [bl])), 10000000);
  eq(N(await val(`select count(*) from ledger_txns where ref_type = 'payment' and ref_id = $1`, [id])), 1);
  return '10 tries, 1 confirmed';
});

await scene('one bank line, two different payments at once: only one matches it', async () => {
  const p = await product({ qty: 2 });
  const make = async () => {
    const o = await rpc(COUNTER, 'create_order', { p_key: k('ord'), p_location: shop, p_lines: [{ product_id: p.id, qty: 1 }] });
    return rpc(COUNTER, 'take_payment', { p_key: k('pay'), p_order: o, p_method: 'transfer', p_amount: 5000000 });
  };
  const a = await make();
  const b = await make();
  const bl = await rpc(ACCOUNT, 'add_bank_line', { p_key: k('bl'), p_on: today, p_amount: 5000000 });
  const { wins, errors } = await settle([a, b].map((id) => rpc(OWNER, 'confirm_payment', { p_payment: id, p_bank_line: bl })));
  eq(wins.length, 1);
  onlyErrors(errors, ['bank_line_used_up']);
  return '1 matched, 1 refused';
});

await scene('10 credit deliveries at once cannot go past the limit', async () => {
  const phone = '08030009999';
  const c = await rpc(COUNTER, 'save_customer', { p_phone: phone, p_name: 'Racer' });
  await rpc(OWNER, 'set_customer_terms', { p_customer: c, p_kind: 'retail', p_credit_limit: 50000000 });
  const p = await product({ qty: 12 });
  const orders = [];
  for (let i = 0; i < 10; i++) {
    orders.push(await rpc(COUNTER, 'create_order', { p_key: k('ord'), p_location: shop, p_lines: [{ product_id: p.id, qty: 1 }], p_phone: phone, p_on_credit: true }));
  }
  const { wins, errors } = await settle(orders.map((o) => rpc(COUNTER, 'deliver_order', { p_key: k('go'), p_order: o })));
  eq(wins.length, 5);
  onlyErrors(errors, ['over_credit_limit']);
  eq(N(await val(`select sum(amount_kobo) from ledger_entries where account_code = 'customers_owe' and customer_id = $1`, [c])), 50000000);
  return '5 delivered, 5 refused, limit held';
});

await scene('cash sales racing a till close: every naira is counted exactly once', async () => {
  const p = await product({ qty: 40, price: 1000000 });
  await rpc(COUNTER2, 'open_till', { p_float: 100000 });
  const session = await val(`select id from till_sessions where staff_id = $1 and status = 'open'`, [COUNTER2]);
  const sales = Array.from({ length: 15 }, () => sale(p, { who: COUNTER2, method: 'cash' }));
  const closing = new Promise((r) => setTimeout(r, 120)).then(() => rpc(COUNTER2, 'close_till', { p_counted: 100000 }));
  const { wins, errors } = await settle([...sales, closing]);
  onlyErrors(errors, ['till_not_open']);
  const row = (await admin.query('select expected_kobo from till_sessions where id = $1', [session]))[0];
  const counted = N(await val(`select coalesce(sum(amount_kobo), 0) from payments where till_session_id = $1 and status = 'confirmed'`, [session]));
  eq(N(row.expected_kobo), 100000 + counted);
  return `${wins.length - 1} sales before the close, ${errors.till_not_open ?? 0} after`;
});

await scene('ten people return one delivered order at once: the stock comes back once', async () => {
  const p = await product({ qty: 2 });
  const o = await rpc(COUNTER, 'create_order', { p_key: k('ord'), p_location: shop, p_lines: [{ product_id: p.id, qty: 1 }] });
  await rpc(COUNTER, 'take_payment', { p_key: k('pay'), p_order: o, p_method: 'pos', p_amount: 10000000 });
  await rpc(COUNTER, 'deliver_order', { p_key: k('go'), p_order: o });
  const { wins, errors } = await settle(Array.from({ length: 10 }, () => rpc(COUNTER, 'return_goods', { p_key: k('ret'), p_order: o, p_lines: [{ product_id: p.id, qty: 1 }], p_reason: 'Bad unit' })));
  eq(wins.length, 1);
  onlyErrors(errors, ['nothing_to_return']);
  eq(N(await val('select qty from stock_balances where product_id = $1 and location_id = $2', [p.id, shop])), 2);
  return '1 return, 9 refused';
});

await scene('a return racing a sale of the same serial never deadlocks and never doubles the unit', async () => {
  const round = async () => {
    const p = await product({ qty: 2, tracking: 'serial' });
    const o = await rpc(COUNTER, 'create_order', { p_key: k('ord'), p_location: shop, p_lines: [{ product_id: p.id, qty: 1 }] });
    await rpc(COUNTER, 'take_payment', { p_key: k('pay'), p_order: o, p_method: 'pos', p_amount: 10000000 });
    await rpc(COUNTER, 'deliver_order', { p_key: k('go'), p_order: o, p_lines: [{ product_id: p.id, qty: 1, serials: [p.serials[0]] }] });
    const { errors } = await settle([
      rpc(COUNTER, 'return_goods', { p_key: k('ret'), p_order: o, p_lines: [{ product_id: p.id, qty: 1, serials: [p.serials[0]] }], p_reason: 'Bad unit' }),
      sale(p, { serials: [p.serials[0]] }),
    ]);
    onlyErrors(errors, ['serial_not_available']);
    const sold = N(await val(`select count(*) from serial_units where product_id = $1 and status = 'sold'`, [p.id]));
    const onShelf = N(await val('select qty from stock_balances where product_id = $1 and location_id = $2', [p.id, shop]));
    eq(sold + onShelf, 2, 'the unit is never both sold and on the shelf:');
    return Object.keys(errors).length;
  };
  const refused = await Promise.all(Array.from({ length: 8 }, round));
  eq(N(await val('select deadlocks from pg_stat_database where datname = current_database()')), 0, 'deadlocks:');
  return `8 rounds, ${refused.filter(Boolean).length} with a refused sale, 0 deadlocks`;
});

await scene('two opens of the same till at once leave one open', async () => {
  const { errors } = await settle([rpc(COUNTER, 'open_till', { p_float: 0 }), rpc(COUNTER, 'open_till', { p_float: 0 }), rpc(COUNTER, 'open_till', { p_float: 0 })]);
  eq(N(await val(`select count(*) from till_sessions where staff_id = $1 and status = 'open'`, [COUNTER])), 1);
  onlyErrors(errors, ['till_already_open', 'duplicate key value violates unique constraint "one_open_till"']);
  await rpc(COUNTER, 'close_till', { p_counted: 0 });
  return 'one open';
});

await scene('a busy shop: 300 mixed actions on a few products, no deadlocks, books still agree', async () => {
  const ps = [await product({ qty: 40 }), await product({ qty: 40 }), await product({ qty: 15, tracking: 'serial' }), await product({ qty: 40 })];
  const serialsLeft = [...ps[2].serials];
  const act = async (i) => {
    const p = ps[i % ps.length];
    const other = ps[(i + 1) % ps.length];
    const mod = i % 6;
    if (mod === 0) {
      if (p.serials.length === 0) return rpc(COUNTER, 'counter_sale', { p_key: k('sale'), p_location: shop, p_method: 'pos', p_lines: [{ product_id: p.id, qty: 1 }, ...(other.serials.length === 0 ? [{ product_id: other.id, qty: 1 }] : [])] });
      const s = serialsLeft.shift();
      if (!s) return null;
      return sale(p, { serials: [s] });
    }
    if (mod === 1 && p.serials.length === 0) return rpc(STORE, 'receive_goods', { p_key: k('rcv'), p_supplier: sup, p_location: shop, p_lines: [{ product_id: p.id, qty: 2 }, ...(other.serials.length === 0 ? [{ product_id: other.id, qty: 1 }] : [])] });
    // Half the transfers go the opposite way, the classic way for two people to freeze each other.
    if (mod === 2 && p.serials.length === 0) return rpc(STORE, 'transfer_stock', { p_product: p.id, p_from: i % 4 === 0 ? back : shop, p_to: i % 4 === 0 ? shop : back, p_qty: 1 });
    if (mod === 3 && p.serials.length === 0) {
      const o = await rpc(COUNTER, 'create_order', { p_key: k('ord'), p_location: shop, p_lines: [{ product_id: p.id, qty: 1 }, ...(other.serials.length === 0 ? [{ product_id: other.id, qty: 1 }] : [])] });
      const total = N(await val('select total_kobo from orders where id = $1', [o]));
      await rpc(COUNTER, 'take_payment', { p_key: k('pay'), p_order: o, p_method: 'pos', p_amount: Math.floor(total / 2) });
      await rpc(COUNTER2, 'take_payment', { p_key: k('pay'), p_order: o, p_method: 'pos', p_amount: total - Math.floor(total / 2) });
      return rpc(STORE, 'deliver_order', { p_key: k('go'), p_order: o });
    }
    if (mod === 4 && p.serials.length === 0) {
      const o = await rpc(COUNTER2, 'create_order', { p_key: k('ord'), p_location: shop, p_lines: [{ product_id: p.id, qty: 1 }] });
      return rpc(COUNTER2, 'cancel_order', { p_order: o, p_reason: 'Changed mind' });
    }
    if (p.serials.length === 0) {
      const c = await rpc(STORE, 'submit_stock_count', { p_key: k('cnt'), p_location: shop, p_lines: [{ product_id: p.id, counted: 30 }] });
      return rpc(OWNER, 'approve_stock_count', { p_count: c });
    }
    return null;
  };
  const queue = Array.from({ length: 300 }, (_, i) => i);
  const errors = {};
  let done = 0;
  await Promise.all(Array.from({ length: 20 }, async () => {
    while (queue.length) {
      const i = queue.shift();
      try { await act(i); done++; } catch (e) {
        const name = String(e.message).split(':')[0];
        errors[name] = (errors[name] ?? 0) + 1;
      }
    }
  }));
  onlyErrors(errors, ['insufficient_stock', 'count_out_of_date']);
  eq(N(await val(`select deadlocks from pg_stat_database where datname = current_database()`)), 0, 'deadlocks:');
  return `${done} finished, ${errors.insufficient_stock ?? 0} refused for lack of stock, 0 deadlocks`;
});

await scene('cash sales racing a safe count approval: the naira lands exactly once', async () => {
  const p = await product({ qty: 50, price: 1000000 });
  await rpc(OWNER, 'owner_money_in', { p_key: k('oin'), p_account: 'cash', p_amount: 100000000, p_what: 'Race float' });
  await rpc(COUNTER, 'open_till', { p_float: 0 });
  const safeNow = async () => N(await val(`select coalesce(sum(amount_kobo), 0) from ledger_entries where account_code = 'cash'`)) - N(await val('select i_tills_expected()'));
  const w = await safeNow();
  const c = await rpc(COUNTER, 'submit_safe_count', { p_key: k('safe'), p_counted: w, p_counted_at: new Date().toISOString() });
  const { wins, errors } = await settle([
    ...Array.from({ length: 10 }, () => sale(p, { method: 'cash' })),
    rpc(OWNER, 'approve_safe_count', { p_count: c }),
  ]);
  onlyErrors(errors, ['count_out_of_date']); // the approval either won the race or was told to recount
  expect(wins.length === 10 || wins.length === 11, `expected 10 or 11 finished, got ${wins.length}`);
  // A fresh count sees the sales' cash in the till, not in the safe: the safe is still exactly w.
  const c2 = await rpc(COUNTER, 'submit_safe_count', { p_key: k('safe'), p_counted: w, p_counted_at: new Date().toISOString() });
  eq(N(await rpc(OWNER, 'approve_safe_count', { p_count: c2 })), 0, 'the fresh count finds the safe exact:');
  eq(N(await val(`select coalesce(sum(amount_kobo), 0) from ledger_entries where account_code = 'cash'`)), 110000000, 'ledger cash:');
  eq(N(await val('select i_tills_expected()')), 10000000, 'the till holds its sales:');
  eq(await safeNow(), w, 'and the safe is exactly as counted:');
  await rpc(COUNTER, 'close_till', { p_counted: 10000000 });
  return `${wins.length} finished, sales raced the approval`;
});

await scene('two people approve one safe count at once: the loss posts once', async () => {
  await rpc(OWNER, 'owner_money_out', { p_key: k('oout'), p_account: 'cash', p_amount: 300000, p_what: 'Race take' });
  const w = N(await val(`select coalesce(sum(amount_kobo), 0) from ledger_entries where account_code = 'cash'`)) - N(await val('select i_tills_expected()'));
  const c = await rpc(COUNTER, 'submit_safe_count', { p_key: k('safe'), p_counted: w - 100000, p_counted_at: new Date().toISOString() });
  const { wins, errors } = await settle([
    rpc(OWNER, 'approve_safe_count', { p_count: c }),
    rpc(OWNER, 'approve_safe_count', { p_count: c }),
  ]);
  eq(wins.length, 1);
  onlyErrors(errors, ['count_already_decided']);
  eq(N(await val(`select coalesce(sum(amount_kobo), 0) from ledger_entries where account_code = 'safe_differences'`)), 100000, 'the loss posted twice:');
  eq(N(await val(`select coalesce(sum(amount_kobo), 0) from ledger_entries where account_code = 'cash'`)) - N(await val('select i_tills_expected()')), w - 100000, 'the books landed anywhere but the counted figure:');
  return '1 approved, 1 refused';
});

await scene('ten card payments race one bank line: only what the line covers is confirmed', async () => {
  const p = await product({ qty: 20, price: 1000000 });
  const ids = [];
  for (let i = 0; i < 10; i++) {
    const s = await sale(p, { method: 'pos' });
    ids.push(await val(`select id from payments where order_id = $1`, [s.order_id]));
  }
  const bl = await rpc(ACCOUNT, 'add_bank_line', { p_key: k('bl'), p_on: today, p_amount: 4000000 });
  const { wins, errors } = await settle(ids.map((id) => rpc(ACCOUNT, 'confirm_payment', { p_payment: id, p_bank_line: bl })));
  eq(wins.length, 4);
  onlyErrors(errors, ['bank_line_used_up']);
  eq(N(await val('select matched_kobo from bank_lines where id = $1', [bl])), 4000000);
  eq(N(await val(`select count(*) from payments where id = any($1::text::uuid[]) and status = 'confirmed'`, [`{${ids.join(',')}}`])), 4);
  eq(N(await val(`select count(*) from payments where id = any($1::text::uuid[]) and status = 'pending'`, [`{${ids.join(',')}}`])), 6);
  // Receipt numbers now only come from money that is really in, so the shop's own cash day
  // keeps the receipt book flowing: a till, ninety cash sales, a blind close at the exact count.
  await rpc(COUNTER2, 'open_till', { p_float: 0 });
  const cash = await product({ qty: 90, price: 1000000 });
  for (let i = 0; i < 90; i++) await sale(cash, { who: COUNTER2, method: 'cash' });
  await rpc(COUNTER2, 'close_till', { p_counted: 90000000 });
  return '4 confirmed, 6 refused, 90 cash sales receipted';
});

await scene('two counters accept one quote at once: one order', async () => {
  const p = await product({ qty: 5 });
  const qid = await rpc(COUNTER, 'create_quote', { p_key: k('q'), p_location: shop, p_lines: [{ product_id: p.id, qty: 1 }] });
  const { wins, errors } = await settle([
    rpc(COUNTER, 'accept_quote', { p_quote: qid }),
    rpc(COUNTER2, 'accept_quote', { p_quote: qid }),
  ]);
  onlyErrors(errors, []);
  eq(new Set(wins).size, 1);
  eq(N(await val(`select count(*) from orders where client_key = 'quote_accept:' || $1`, [qid])), 1);
  eq(N(await val('select reserved from stock_balances where product_id = $1', [p.id])), 1);
  return '1 order from 2 accept taps';
});

await scene('postings racing a month close: nothing lands in the month after it closes', async () => {
  const month = await val(`select (date_trunc('month', shop_today()) - interval '1 month')::date::text`);
  const inMonth = await val(`select ($1::date + 14)::text`, [month]);
  const statement = N(await val(`select coalesce(sum(amount_kobo), 0) from ledger_entries e join ledger_txns t on t.id = e.txn_id where e.account_code = 'bank' and t.occurred_on < ($1::date + interval '1 month')`, [month]));
  const post = (i) => rpc(ACCOUNT, 'record_expense', { p_key: k('exp'), p_account: 'other_costs', p_amount: 100 + i, p_paid_from: 'cash', p_what: 'Racing', p_on: inMonth });
  const results = [];
  let stop = false;
  const posters = Array.from({ length: 6 }, async (_, n) => {
    for (let i = 0; !stop && i < 60; i++) {
      try { results.push(await post(n * 100 + i)); } catch (e) {
        if (!String(e.message).startsWith('period_closed')) throw e;
        return;
      }
    }
  });
  await new Promise((r) => setTimeout(r, 80));
  let tries = 0;
  for (;;) {
    tries++;
    try {
      await rpc(OWNER, 'close_month', { p_month: month, p_statement_balance: statement });
      break;
    } catch (e) {
      if (!String(e.message).startsWith('shop_busy_try_again') || tries > 500) throw e;
    }
  }
  stop = true;
  await Promise.all(posters);
  const audited = (await admin.query(`select detail from audit_log where action = 'close_month' and entity_id = $1`, [month]))[0].detail;
  const actual = N(await val(`select count(*) from ledger_txns where occurred_on >= $1::date and occurred_on < ($1::date + interval '1 month')`, [month]));
  eq(actual, N(audited.txns_in_month), 'postings after the close:');
  return `${results.length} posted first, closed on try ${tries}, ${actual} in the month and none after`;
});

await scene('after all of that, invoice and receipt numbers have no gaps', async () => {
  for (const kind of ['INV', 'RCT']) {
    const rows = await admin.query(kind === 'INV' ? 'select invoice_no n from orders where invoice_no is not null' : 'select receipt_no n from payments where receipt_no is not null');
    const nums = rows.map((r) => Number(r.n.split('-').pop())).sort((a, b) => a - b);
    expect(nums.length > 100, `only ${nums.length} ${kind} numbers`);
    nums.forEach((n, i) => { if (n !== i + 1) throw new Error(`${kind} gap: position ${i + 1} holds ${n}`); });
  }
  return `${N(await val('select count(*) from orders'))} invoices, ${N(await val('select count(*) from payments where receipt_no is not null'))} receipts`;
});

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'pass' : 'FAIL'}  ${r.name}${r.ok ? `  (${r.detail}, ${r.ms} ms)` : `\n      ${r.why}`}`);
console.log(`\n${results.length - failed.length} of ${results.length} passed on real Postgres (${pg.where})`);
await sql.end({ timeout: 2 });
await pg.stop();
process.exit(failed.length ? 1 : 0);
