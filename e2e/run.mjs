// End-to-end: a local Supabase, the real app, and Chrome, driven like a person at the counter.
// After each step the books are checked directly, so a screen that shows one thing and records
// another fails here. Run from the project folder:  npm run e2e
// Needs Docker running and Chrome installed. Leaves nothing behind but screenshots in e2e/shots/.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { chromium } from 'playwright-core';
import { start, stop, keys, dbUrl, ports } from './stack.mjs';
import { buildCall, unwrap } from '../sim/lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const shots = path.join(here, 'shots');
fs.mkdirSync(shots, { recursive: true });
const appPort = 3100;
const app = `http://localhost:${appPort}`;
const results = [];
const problems = [];
const previews = [];
const N = (x) => Number(x);

let gw;
let next;
let browser;
let sql;
const nextLog = [];

async function cleanup() {
  try { await browser?.close(); } catch {}
  if (next && !next.killed) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(next.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true });
    else next.kill('SIGTERM');
  }
  try { await sql?.end({ timeout: 2 }); } catch {}
  try { gw?.close(); } catch {}
  await stop();
}

async function step(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - t0, detail });
  } catch (e) {
    results.push({ name, ok: false, why: String(e.message).split('\n')[0] });
    for (const [i, pg] of openPages.entries()) await pg.screenshot({ path: path.join(shots, `fail-${results.length}-${i}.png`), fullPage: true }).catch(() => {});
  }
}
const openPages = [];
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`); };

try {
  gw = await start();
  const k = keys();
  sql = postgres({ ...dbUrl, max: 2, onnotice: () => {} });
  const as = (userId) => (fn, args = {}) => sql.begin(async (t) => {
    await t.unsafe(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
    await t.unsafe('set local role authenticated');
    const c = buildCall(fn, args);
    return unwrap([...(await t.unsafe(c.text, c.params))]);
  });
  const val = async (t, p = []) => { const r = (await sql.unsafe(t, p))[0]; return r ? Object.values(r)[0] : null; };

  // Test logins, made fresh for this run and never written down.
  const people = {};
  for (const who of ['owner', 'counter', 'accountant', 'storekeeper']) {
    const password = `e2e-${crypto.randomBytes(9).toString('base64url')}`;
    const email = `${who}@e2e.local`;
    const r = await fetch(`http://127.0.0.1:${ports.gateway}/auth/v1/admin/users`, {
      method: 'POST', headers: { apikey: k.service, authorization: `Bearer ${k.service}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    expect(r.ok, `could not create the ${who} login: ${r.status}`);
    people[who] = { email, password, id: (await r.json()).id };
  }
  await sql`insert into staff (id, name, role) values (${people.owner.id}, 'Owner', 'owner')`;
  const owner = as(people.owner.id);
  const counter = as(people.counter.id);
  await owner('save_staff', { p_user: people.counter.id, p_name: 'Ada', p_role: 'counter', p_discount_limit: 5 });
  await owner('save_staff', { p_user: people.accountant.id, p_name: 'Fatima', p_role: 'accountant' });
  await owner('save_staff', { p_user: people.storekeeper.id, p_name: 'Bola', p_role: 'storekeeper' });
  const shop = await owner('save_location', { p_name: 'Ikeja shop' });
  const sup = await owner('save_supplier', { p_name: 'Lagos Batteries' });
  let n = 0;
  const key = (p) => `${p}-${++n}`;
  const product = async ({ sku, name, price, trade, cost, qty, tracking = 'count', unit = 'each', part, size, serials }) => {
    const id = await owner('save_product', { p_sku: sku, p_name: name, p_price: price, p_trade: trade, p_tracking: tracking, p_unit: unit, p_low_stock_at: 3 });
    await owner('set_last_cost', { p_product: id, p_cost: cost });
    if (part) await owner('save_part_details', { p_product: id, p_part_number: part, ...(size ? { p_bore: size[0], p_outside: size[1], p_width: size[2] } : {}) });
    await owner('receive_goods', { p_key: key('rcv'), p_supplier: sup, p_location: shop, p_lines: [{ product_id: id, qty, ...(serials ? { serials } : {}) }] });
    return id;
  };
  const bearing = await product({ sku: 'B-6205-2RS', name: '6205-2RS bearing', price: 480000, trade: 420000, cost: 300000, qty: 48, part: '6205 2RS', size: [25, 52, 15] });
  const panel = await product({ sku: 'P-550', name: '550 W solar panel', price: 18500000, trade: 17000000, cost: 14000000, qty: 6 });
  const tradePhone = '08031234567';
  const musa = await counter('save_customer', { p_phone: tradePhone, p_name: 'Musa Installer', p_reminders_ok: true });
  await owner('set_customer_terms', { p_customer: musa, p_kind: 'installer', p_credit_limit: 50000000 });
  // A transfer waiting for the owner to confirm.
  const waitingOrder = await counter('create_order', { p_key: key('ord'), p_location: shop, p_lines: [{ product_id: panel, qty: 1 }] });
  const waitingPay = await counter('take_payment', { p_key: key('pay'), p_order: waitingOrder, p_method: 'transfer', p_amount: 18500000, p_reference: 'GTB-2211' });
  await counter('open_till', { p_float: 0 });
  // A phone order for a battery, paid by a card tap still waiting for the bank: ready to pack.
  // Two units on the shelf, one made months earlier, so packing must offer the older one first.
  const battery = await product({ sku: 'CB-24F', name: 'Car battery, size 24F', price: 7800000, trade: 7100000, cost: 5600000, qty: 1, tracking: 'serial', serials: ['CB-NEW-1'] });
  await owner('receive_goods', { p_key: key('rcv'), p_supplier: sup, p_location: shop, p_lines: [{ product_id: battery, qty: 1, serials: ['CB-OLD-1'], made_on: '2026-05-01' }] });
  const phoneOrder = await counter('create_order', { p_key: key('ord'), p_location: shop, p_lines: [{ product_id: battery, qty: 1 }], p_phone: '08039990001', p_channel: 'phone' });
  await counter('take_payment', { p_key: key('pay'), p_order: phoneOrder, p_method: 'pos', p_amount: 7800000 });
  // For the books: rent paid from the bank, a deposit transfer to match, and a "transfer" with no money behind it.
  const accountant = as(people.accountant.id);
  await accountant('record_expense', { p_key: key('exp'), p_account: 'rent', p_amount: 15000000, p_paid_from: 'bank', p_what: 'Shop rent' });
  const depositOrder = await counter('create_order', { p_key: key('ord'), p_location: shop, p_lines: [{ product_id: panel, qty: 1 }] });
  const depositPay = await counter('take_payment', { p_key: key('pay'), p_order: depositOrder, p_method: 'transfer', p_amount: 5000000, p_reference: 'ZEN-77' });
  const fakeOrder = await counter('create_order', { p_key: key('ord'), p_location: shop, p_lines: [{ product_id: panel, qty: 1 }] });
  const fakePay = await counter('take_payment', { p_key: key('pay'), p_order: fakeOrder, p_method: 'transfer', p_amount: 1234500, p_reference: 'FAKE-9' });
  await sql`update payments set created_at = now() - interval '5 hours' where id = ${fakePay}`;

  // The app, pointed at this stack. Settings passed here win over .env.local, which is left alone.
  next = spawn(process.execPath, [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '-p', String(appPort)], {
    cwd: root, windowsHide: true,
    env: { ...process.env, POWER_E2E_DIST: '.next-e2e', NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${ports.gateway}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: k.anon, NEXT_TELEMETRY_DISABLED: '1' },
  });
  next.stdout.on('data', (d) => nextLog.push(String(d)));
  next.stderr.on('data', (d) => nextLog.push(String(d)));
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${app}/login`)).ok) break; } catch {}
    if (i > 120) throw new Error(`the app did not start:\n${nextLog.slice(-8).join('')}`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const session = async (who, viewport = { width: 1280, height: 900 }) => {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    openPages.unshift(page);
    page.on('pageerror', (e) => problems.push(`${who}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) problems.push(`${who} console: ${m.text().slice(0, 200)}`); });
    page.on('response', async (r) => {
      if (!r.url().includes('/rpc/preview_sale')) return;
      try { previews.push({ who, sent: r.request().postData(), got: (await r.text()).slice(0, 300) }); } catch {}
    });
    // A missing file is named, not just counted.
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`${who}: ${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
    await page.goto(`${app}/login`);
    await page.fill('input[type=email]', people[who].email);
    await page.fill('input[type=password]', people[who].password);
    await page.click('button[type=submit]');
    await page.waitForURL(`${app}/`, { timeout: 30000 });
    return { context, page };
  };
  const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  const desk = await session('counter');
  const p = desk.page;

  await step('a trade customer is recognised and priced at trade, from any phone format', async () => {
    await p.goto(`${app}/counter`);
    await p.fill('#scan', '6205 2rs');
    // Like a barcode scanner: the code and Enter at once, before any results are back.
    await p.press('#scan', 'Enter');
    await p.getByText('6205-2RS bearing').first().waitFor({ timeout: 20000 });
    await p.fill('#ph', tradePhone);
    await p.getByText('Trade prices applied.').waitFor({ timeout: 20000 });
    await p.getByText('₦4,200.00 each, trade price').waitFor();
    return 'Musa Installer, ₦4,200.00 a bearing';
  });

  await step('a cash sale records exactly what the screen showed', async () => {
    await p.getByRole('button', { name: 'Cash', exact: true }).click();
    await p.getByRole('button', { name: 'Exact', exact: true }).click();
    await p.getByRole('button', { name: 'Complete sale' }).click();
    await p.getByText('Sale complete').waitFor({ timeout: 20000 });
    await p.screenshot({ path: path.join(shots, 'counter-done-desktop.png') });
    const o = (await sql`select o.total_kobo, o.goods_status, o.customer_id, o.money_status from orders o join order_lines l on l.order_id = o.id
      where l.product_id = ${bearing} order by o.created_at desc limit 1`)[0];
    eq(N(o.total_kobo), 420000, 'order total:');
    eq(o.customer_id, musa, 'customer on the order:');
    eq(o.money_status, 'paid', 'money:');
    eq(o.goods_status, 'delivered', 'goods:');
    eq(N(await val(`select qty from stock_balances where product_id = $1`, [bearing])), 47, 'bearings left:');
    expect(await p.getByText('₦4,200.00').first().isVisible(), 'the receipt should show ₦4,200.00');
    const books = await val('select i_books_check()');
    expect(books.ok, `books: ${books.problems?.join('; ')}`);
    return 'order ₦4,200.00 paid and delivered, 47 left, books agree';
  });

  await step('phone first, then two scans: still trade price, and the books agree', async () => {
    await p.getByRole('button', { name: 'New sale' }).click();
    await p.fill('#ph', tradePhone);
    await p.fill('#scan', '6205 2rs');
    await p.press('#scan', 'Enter');
    await p.getByText('6205-2RS bearing').first().waitFor({ timeout: 20000 });
    await p.fill('#scan', '62052RS');
    await p.press('#scan', 'Enter');
    await p.getByText('₦8,400.00').first().waitFor({ timeout: 20000 });
    await p.getByText('Trade prices applied.').waitFor();
    await p.getByRole('button', { name: 'Cash', exact: true }).click();
    await p.getByRole('button', { name: 'Exact', exact: true }).click();
    await p.getByRole('button', { name: 'Complete sale' }).click();
    await p.getByText('Sale complete').waitFor({ timeout: 20000 });
    const o = (await sql`select o.total_kobo, o.customer_id from orders o join order_lines l on l.order_id = o.id
      where l.product_id = ${bearing} order by o.created_at desc limit 1`)[0];
    eq(N(o.total_kobo), 840000, 'second order:');
    eq(o.customer_id, musa, 'customer:');
    eq(N(await val(`select qty from stock_balances where product_id = $1`, [bearing])), 45, 'bearings left:');
    return '2 bearings at ₦4,200.00, 45 left';
  });

  await step('the till count is recorded in kobo, from typed notes', async () => {
    await p.getByRole('button', { name: 'Close the till' }).click();
    await p.fill('input[aria-label="Number of ₦1000 notes"]', '12');
    await p.fill('input[aria-label="Number of ₦100 notes"]', '6');
    await p.getByText('₦12,600.00').first().waitFor();
    await p.getByRole('button', { name: 'This is my count' }).click();
    await p.getByText('The count is saved.').waitFor({ timeout: 20000 });
    const t = (await sql`select counted_kobo, difference_kobo from till_sessions where staff_id = ${people.counter.id} order by opened_at desc limit 1`)[0];
    eq(N(t.counted_kobo), 1260000, 'counted:');
    eq(N(t.difference_kobo), 0, 'difference:');
    expect(!(await p.getByText('expected', { exact: false }).count()), 'the expected figure must never show');
    return 'counted ₦12,600.00, no difference, nothing expected shown';
  });

  await step('the counter fits a phone with no sideways scroll', async () => {
    const phone = await session('counter', { width: 375, height: 812 });
    await phone.page.goto(`${app}/counter`);
    await phone.page.getByText('Scan or type a part').waitFor();
    await phone.page.screenshot({ path: path.join(shots, 'counter-phone.png'), fullPage: true });
    expect(await noSideScroll(phone.page), 'the counter scrolls sideways at 375px');
    await phone.context.close();
    return '375 px';
  });

  const store = await session('storekeeper');
  const s = store.page;

  await step('a delivery is received into the books, with no cost or shelf figure shown', async () => {
    const before = N(await val('select qty from stock_balances where product_id = $1', [bearing]));
    await s.goto(`${app}/stock`);
    await s.fill('#part', '6205 2rs');
    await s.press('#part', 'Enter');
    await s.getByRole('textbox', { name: 'Quantity received of 6205-2RS bearing' }).fill('10');
    await s.getByRole('button', { name: 'Finish, with 10 items' }).click();
    await s.getByText('Recorded.').waitFor({ timeout: 20000 });
    eq(N(await val('select qty from stock_balances where product_id = $1', [bearing])), before + 10, 'bearings on the shelf:');
    const books = await val('select i_books_check()');
    expect(books.ok, `books: ${books.problems?.join('; ')}`);
    return `${before} to ${before + 10} bearings, books agree`;
  });

  await step('packing offers the oldest battery first, then hands over a card-paid order', async () => {
    await s.getByRole('button', { name: 'Pack', exact: true }).click();
    await s.getByRole('button', { name: /Phone order/ }).click();
    await s.fill('#ps', 'CB-NEW-1');
    await s.press('#ps', 'Enter');
    await s.getByText('Take CB-OLD-1 first').waitFor({ timeout: 10000 });
    await s.fill('#ps', 'cb-old-1');
    await s.press('#ps', 'Enter');
    await s.getByText('Ready to hand over').waitFor({ timeout: 10000 });
    await s.getByRole('button', { name: 'Hand over' }).click();
    await s.getByText('packed and handed over').waitFor({ timeout: 20000 });
    eq((await sql`select goods_status from orders where id = ${phoneOrder}`)[0].goods_status, 'delivered', 'order:');
    eq((await sql`select status from serial_units where serial = 'CB-OLD-1'`)[0].status, 'sold', 'the older unit left:');
    eq((await sql`select status from serial_units where serial = 'CB-NEW-1'`)[0].status, 'in_stock', 'the newer unit stayed:');
    return 'CB-OLD-1 out, CB-NEW-1 still on the shelf';
  });

  await step('a shelf count is typed blind and waits for the owner', async () => {
    await s.getByRole('button', { name: 'Count', exact: true }).click();
    await s.getByText('Never counted').first().waitFor({ timeout: 20000 });
    for (const input of await s.getByRole('textbox', { name: /^Count of / }).all()) await input.fill('1');
    await s.getByRole('button', { name: 'Finish the count' }).click();
    await s.getByText('Sent to the owner.').waitFor({ timeout: 20000 });
    eq(N(await val(`select count(*) from stock_counts where status = 'submitted'`)), 1, 'counts waiting:');
    expect(!(await s.getByText(/expected/i).count()) || (await s.getByText('Nobody is shown what the books expect').count()) === 1, 'no expected figure on screen');
    await s.screenshot({ path: path.join(shots, 'stock-desktop.png'), fullPage: true });
    return 'submitted, stock unchanged until approved';
  });

  await step('the stock room fits a phone with no sideways scroll', async () => {
    const phone = await session('storekeeper', { width: 375, height: 812 });
    await phone.page.goto(`${app}/stock`);
    await phone.page.getByText('Receive a delivery').waitFor({ timeout: 20000 });
    await phone.page.screenshot({ path: path.join(shots, 'stock-phone.png'), fullPage: true });
    expect(await noSideScroll(phone.page), 'the stock room scrolls sideways at 375px');
    await phone.context.close();
    return '375 px';
  });

  const boss = await session('owner');
  const o = boss.page;

  await step("the owner's day shows the transfer waiting and the cash that came in", async () => {
    await o.goto(`${app}/owner`);
    await o.getByText(/thing(s)? need(s)? you/).waitFor({ timeout: 30000 });
    await o.getByText('₦185,000.00 from a walk-in customer').waitFor();
    const today = (await sql`select coalesce(sum(amount_kobo), 0)::bigint s from payments where method = 'cash' and status = 'confirmed'`)[0].s;
    eq(N(today), 1260000, 'cash in the books:');
    await o.getByText('₦12,600.00').first().waitFor();
    await o.screenshot({ path: path.join(shots, 'owner-desktop.png'), fullPage: true });
    return 'transfer waiting, ₦12,600.00 cash today';
  });

  await step('the owner confirms the transfer, and only then is it money', async () => {
    eq((await sql`select status from payments where id = ${waitingPay}`)[0].status, 'pending', 'before:');
    await o.locator('article', { hasText: '₦185,000.00' }).getByRole('button', { name: 'It is in the bank' }).click();
    await o.getByText(/Confirmed\./).waitFor({ timeout: 20000 });
    eq((await sql`select status from payments where id = ${waitingPay}`)[0].status, 'confirmed', 'after:');
    const books = await val('select i_books_check()');
    expect(books.ok, `books: ${books.problems?.join('; ')}`);
    return 'pending to confirmed, books agree';
  });

  await step("the owner's day fits a phone with no sideways scroll", async () => {
    const phone = await session('owner', { width: 375, height: 812 });
    await phone.page.goto(`${app}/owner`);
    await phone.page.getByText('Money in today').waitFor({ timeout: 30000 });
    await phone.page.screenshot({ path: path.join(shots, 'owner-phone.png'), fullPage: true });
    expect(await noSideScroll(phone.page), 'the owner screen scrolls sideways at 375px');
    await phone.context.close();
    return '375 px';
  });

  const acc = await session('accountant');
  const a = acc.page;
  const balanceLine = async () => {
    const t = await a.getByText(/Own -?₦[\d,.]+ = owe/).innerText();
    const m = t.match(/Own (-?₦[\d,.]+) = owe (-?₦[\d,.]+) \+ owner (-?₦[\d,.]+)/);
    const n = (x) => Math.round(Number(x.replace(/[₦,]/g, '')) * 100);
    return { text: t, ok: t.startsWith('The books balance.') && m && n(m[1]) === n(m[2]) + n(m[3]) };
  };

  await step('the books balance on screen: own equals owe plus owner', async () => {
    await a.goto(`${app}/books`);
    await a.getByText(/The books balance./).waitFor({ timeout: 30000 });
    const b = await balanceLine();
    expect(b.ok, b.text);
    await a.getByText(/(Profit|Loss) after all costs/).waitFor();
    await a.screenshot({ path: path.join(shots, 'books-month.png'), fullPage: true });
    return b.text.replace('The books balance. ', '');
  });

  await step('a mistake is reversed with a reason, never edited, and the books still balance', async () => {
    await a.getByRole('button', { name: 'Entries', exact: true }).click();
    expect(!(await a.getByText(/debit/i).count()), 'no accounting words until asked');
    await a.getByRole('switch', { name: 'Accountant view' }).click();
    await a.getByText('Debit').first().waitFor();
    await a.fill('#f', 'rent');
    await a.getByRole('button', { name: 'Reverse' }).first().waitFor({ timeout: 10000 });
    expect(!(await a.getByRole('button', { name: /delete|edit/i }).count()), 'there is no delete or edit');
    await a.getByRole('button', { name: 'Reverse' }).first().click();
    await a.getByText('Why are you reversing this?').waitFor();
    await a.getByRole('button', { name: 'Wrong amount' }).click();
    await a.getByText('Reversal of: Shop rent').waitFor({ timeout: 20000 });
    eq(N(await val(`select count(*) from ledger_txns where reversal_of is not null and reason = 'Wrong amount'`)), 1, 'reversals:');
    await a.getByText(/The books balance./).waitFor();
    expect((await balanceLine()).ok, 'books balance after the reversal');
    return 'reversed with "Wrong amount", books balance';
  });

  await step('a transfer is matched to its statement line, and a fake alert is caught', async () => {
    await a.getByRole('button', { name: 'Bank', exact: true }).click();
    await a.getByText('This may be a fake alert').waitFor({ timeout: 20000 });
    await a.getByRole('textbox', { name: 'Amount on the statement' }).fill('50,000');
    await a.getByRole('textbox', { name: 'Reference on the statement' }).fill('ZEN-77');
    await a.getByRole('button', { name: 'Add line' }).click();
    expect(!(await a.locator('article', { hasText: 'This may be a fake alert' }).getByRole('button', { name: /^Match to/ }).count()), 'a fake alert must never get a plain match');
    await a.locator('article', { hasText: 'ZEN-77' }).getByRole('button', { name: /Match to ₦50,000.00/ }).click();
    await a.getByText(/Matched. ₦50,000.00/).waitFor({ timeout: 20000 });
    const p = (await sql`select status, bank_line_id from payments where id = ${depositPay}`)[0];
    eq(p.status, 'confirmed', 'deposit:');
    expect(p.bank_line_id, 'matched to a statement line');
    await a.locator('article', { hasText: 'This may be a fake alert' }).getByRole('button', { name: 'Not in the bank' }).click();
    await a.getByText('Marked as not received.').first().waitFor({ timeout: 20000 });
    eq((await sql`select status from payments where id = ${fakePay}`)[0].status, 'rejected', 'fake alert:');
    const books = await val('select i_books_check()');
    expect(books.ok, `books: ${books.problems?.join('; ')}`);
    return 'deposit matched, fake alert refused, books agree';
  });

  await step('a month cannot be closed before it is over, and the checks say why', async () => {
    await o.goto(`${app}/books`);
    await o.getByRole('button', { name: 'Close', exact: true }).click();
    await o.getByText('The bank matches the statement').waitFor({ timeout: 20000 });
    expect(await o.getByRole('button', { name: 'This month is not over yet' }).isDisabled(), 'close must be refused');
    await o.screenshot({ path: path.join(shots, 'books-close.png'), fullPage: true });
    return 'refused, checks listed';
  });

  await step('the books fit a phone with no sideways scroll', async () => {
    const phone = await session('accountant', { width: 375, height: 812 });
    await phone.page.goto(`${app}/books`);
    await phone.page.getByText(/The books balance./).waitFor({ timeout: 30000 });
    await phone.page.screenshot({ path: path.join(shots, 'books-phone.png'), fullPage: true });
    expect(await noSideScroll(phone.page), 'the books scroll sideways at 375px');
    await phone.context.close();
    return '375 px';
  });

  await step('a counter cannot open the owner screen', async () => {
    await p.goto(`${app}/owner`);
    await p.getByText('This page is for the owner and the accountant.').waitFor({ timeout: 20000 });
    return 'refused';
  });
} catch (e) {
  results.push({ name: 'setting up', ok: false, why: String(e.message).split('\n')[0] });
} finally {
  await cleanup();
}

if (results.some((r) => !r.ok)) for (const x of previews) console.log('preview', x.who, x.sent, '=>', x.got);
for (const r of results) console.log(`${r.ok ? 'pass' : 'FAIL'}  ${r.name}${r.ok ? `  (${r.detail}, ${r.ms} ms)` : `\n      ${r.why}`}`);
const failed = results.filter((r) => !r.ok).length;
if (problems.length) console.log(`\nBrowser errors (${problems.length}):\n${[...new Set(problems)].slice(0, 10).map((x) => `  ${x}`).join('\n')}`);
console.log(`\n${results.length - failed} of ${results.length} passed. Screenshots in e2e/shots/.`);
spawnSync(process.execPath, [path.join(os.homedir(), '.claude', 'tools', 'dev-clean.mjs'), '--yes'], { stdio: 'ignore', windowsHide: true });
process.exit(failed ? 1 : 0);
