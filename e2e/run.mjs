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
  }
}
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
  for (const who of ['owner', 'counter', 'accountant']) {
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
    await o.getByRole('button', { name: 'It is in the bank' }).click();
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
