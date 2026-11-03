// Fills staging with a believable shop for demos: a full catalogue across every kind of goods
// (through the price-list import), stock on the shelves, installers on trade terms, transfers
// waiting for the owner, and quote requests from the public shop. Only the real functions are
// used, every step has its own key, and a second run changes nothing.
//   node scripts/db-demo-day.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { buildCall, unwrap } from '../sim/lib.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = fs.readFileSync(path.join(root, '.env.local'), 'utf8').match(/^SUPABASE_DB_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!url) { console.log('SUPABASE_DB_URL is not in .env.local yet.'); process.exit(1); }
const sql = postgres(url, { ssl: 'require', max: 1, onnotice: () => {} });

// [sku, name, kind, price, trade, cost, qty, warranty months, unit, part, size]; money in naira.
const list = [
  ['SP-450M', '450 W mono solar panel', 'solar panels', 115000, 106000, 92000, 24, 120],
  ['SP-550M', '550 W mono solar panel', 'solar panels', 145000, 134000, 118000, 30, 120],
  ['SP-600B', '600 W bifacial solar panel', 'solar panels', 175000, 162000, 141000, 16, 120],
  ['SP-200P', '200 W poly solar panel', 'solar panels', 62000, 57000, 48000, 20, 120],
  ['INV-3K', '3 kVA 24 V hybrid inverter', 'inverters', 420000, 395000, 340000, 8, 24],
  ['INV-5K', '5 kVA 48 V hybrid inverter', 'inverters', 780000, 735000, 640000, 6, 24],
  ['INV-10K', '10 kVA 48 V hybrid inverter', 'inverters', 1650000, 1560000, 1380000, 3, 24],
  ['CC-60', '60 A MPPT charge controller', 'inverters', 95000, 88000, 71000, 10, 12],
  ['LI-5K', '5 kWh 48 V lithium battery', 'batteries', 1450000, 1370000, 1190000, 5, 60],
  ['LI-10K', '10 kWh 48 V lithium battery', 'batteries', 2750000, 2600000, 2280000, 2, 60],
  ['TB-220', '220 Ah tubular battery', 'batteries', 395000, 372000, 318000, 10, 24],
  ['CB-55', 'Car battery, 55 Ah', 'batteries', 68000, 62000, 51000, 12, 12],
  ['CB-75', 'Car battery, 75 Ah', 'batteries', 92000, 85000, 70000, 9, 12],
  ['B-6203-2RS', '6203-2RS bearing', 'bearings', 3200, 2800, 2000, 60, 0, 'each', '6203 2RS', [17, 40, 12]],
  ['B-6206-2RS', '6206-2RS bearing', 'bearings', 5200, 4700, 3400, 40, 0, 'each', '6206 2RS', [30, 62, 16]],
  ['B-6305-2RS', '6305-2RS bearing', 'bearings', 6800, 6100, 4500, 30, 0, 'each', '6305 2RS', [25, 62, 17]],
  ['B-6308-2RS', '6308-2RS bearing', 'bearings', 14500, 13200, 9800, 12, 0, 'each', '6308 2RS', [40, 90, 23]],
  ['V-A50', 'A50 V-belt', 'belts', 3800, 3400, 2500, 25, 0, 'each', 'A50'],
  ['V-B60', 'B60 V-belt', 'belts', 5600, 5000, 3700, 18, 0, 'each', 'B60'],
  ['V-SPA1250', 'SPA1250 wedge belt', 'belts', 7900, 7100, 5200, 10, 0, 'each', 'SPA1250'],
  ['CH-08B', '08B-1 roller chain, per metre', 'chains', 8500, 7600, 5600, 30, 0, 'metre', '08B-1'],
  ['CH-12B', '12B-1 roller chain, per metre', 'chains', 16500, 15000, 11000, 20, 0, 'metre', '12B-1'],
  ['SPR-08B-17', '08B sprocket, 17 teeth', 'chains', 9800, 8900, 6500, 8, 0, 'each', '08B-17'],
];
// The first demo catalogue, given its kind of goods so the shop's filters read well.
const older = [['B-6205-2RS', '6205-2RS bearing', 'bearings', 4800], ['B-6204-2RS', '6204-2RS bearing', 'bearings', 3900], ['V-A42', 'A42 V-belt', 'belts', 3200],
  ['V-A44', 'A44 V-belt', 'belts', 3400], ['CH-10B', '10B roller chain, per metre', 'chains', 9500], ['CB-24F', 'Car battery, size 24F', 'batteries', 78000], ['TB-200', '200Ah tubular battery', 'batteries', 420000]];

const step = async (what, fn) => { try { const r = await fn(); console.log(`ok  ${what}`); return r; } catch (e) { console.log(`--  ${what}: ${String(e.message).split('\n')[0]}`); return null; } };
try {
  const [owner] = await sql`select id from staff where role = 'owner' and active order by created_at limit 1`;
  if (!owner) { console.log('No owner yet: run npm run db:owner first.'); process.exit(1); }
  const call = (role, fn, args) => sql.begin(async (t) => {
    if (role === 'owner') await t.unsafe(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: owner.id, role: 'authenticated' })]);
    await t.unsafe(`set local role ${role === 'owner' ? 'authenticated' : 'anon'}`);
    const c = buildCall(fn, args);
    return unwrap([...(await t.unsafe(c.text, c.params))]);
  });
  const rpc = (fn, args = {}) => call('owner', fn, args);
  const [shop] = await sql`select id from locations where kind = 'shop' order by name limit 1`;
  const [sup] = await sql`select id from suppliers order by name limit 1`;
  const supplier = sup?.id ?? (await rpc('save_supplier', { p_name: 'Sunrise Power Supply' }));
  if (!shop) { console.log('No shop location yet: run npm run db:demo first.'); process.exit(1); }

  const k = (n) => Math.round(n * 100);
  const rows = [
    ...list.map(([sku, name, family, price, trade, cost, , warranty, unit, part, size]) => ({ sku, name, family, price: k(price), trade: k(trade), cost: k(cost), warranty, unit: unit ?? 'each', part: part ?? null, ...(size ? { bore: size[0], outside: size[1], width: size[2] } : {}) })),
    ...older.map(([sku, name, family, price]) => ({ sku, name, family, price: k(price) })),
  ];
  const look = await step('price list checked', () => rpc('import_products', { p_key: null, p_rows: rows }));
  if (look?.counts.error) { console.log(look.rows.filter((r) => r.problem).map((r) => `   ${r.sku}: ${r.problem}`).join('\n')); process.exit(1); }
  await step(`price list saved (${look?.counts.new ?? 0} new, ${look?.counts.update ?? 0} changed)`, () => rpc('import_products', { p_key: 'demo-day-catalogue-1', p_rows: rows, p_apply: true }));

  const ids = Object.fromEntries((await sql`select sku, id from products`).map((r) => [r.sku, r.id]));
  for (const [sku, , , , , , qty] of list) {
    await step(`${qty} × ${sku} on the shelf`, () => rpc('receive_goods', { p_key: `demo-day-rcv-${sku}`, p_supplier: supplier, p_location: shop.id, p_lines: [{ product_id: ids[sku], qty }] }));
  }

  for (const [phone, name, limit] of [['08031110001', 'Bright Solar Installers', 150000000], ['08052220002', 'Okafor Power Solutions', 80000000], ['07033330003', 'Musa Engineering Works', 50000000]]) {
    const id = await step(`customer ${name}`, () => rpc('save_customer', { p_phone: phone, p_name: name, p_reminders_ok: true }));
    if (id) await step(`${name} on installer terms`, () => rpc('set_customer_terms', { p_customer: id, p_kind: 'installer', p_credit_limit: limit }));
  }

  // Transfers waiting for the owner: one full, one a deposit.
  const o1 = await step('order: 5 kVA inverter by transfer', () => rpc('create_order', { p_key: 'demo-day-ord-1', p_location: shop.id, p_lines: [{ product_id: ids['INV-5K'], qty: 1 }], p_phone: '08031110001', p_channel: 'phone' }));
  if (o1) await step('transfer waiting: ₦735,000', () => rpc('take_payment', { p_key: 'demo-day-pay-1', p_order: o1, p_method: 'transfer', p_amount: k(735000), p_reference: 'GTB-55102' }));
  const o2 = await step('order: 2 × 550 W panels', () => rpc('create_order', { p_key: 'demo-day-ord-2', p_location: shop.id, p_lines: [{ product_id: ids['SP-550M'], qty: 2 }, { product_id: ids['CC-60'], qty: 1 }], p_phone: '08052220002', p_channel: 'phone' }));
  if (o2) await step('deposit waiting: ₦150,000', () => rpc('take_payment', { p_key: 'demo-day-pay-2', p_order: o2, p_method: 'transfer', p_amount: k(150000), p_reference: 'ZEN-88231' }));

  // Two quote requests from the public shop.
  await step('quote request from a visitor', () => call('anon', 'request_quote', { p_key: 'demo-day-rq-1', p_name: 'Adaeze Nwosu', p_phone: '08094440004', p_lines: [{ product_id: ids['LI-5K'], qty: 1 }, { product_id: ids['INV-5K'], qty: 1 }], p_note: 'For a duplex in Lekki. Can you deliver?' }));
  await step('quote request from a workshop', () => call('anon', 'request_quote', { p_key: 'demo-day-rq-2', p_name: 'Tunde Bakare', p_phone: '08125550005', p_lines: [{ product_id: ids['B-6206-2RS'], qty: 10 }, { product_id: ids['V-B60'], qty: 4 }], p_note: 'Mill in Ota.' }));
  console.log('demo day ready.');
} finally {
  await sql.end({ timeout: 5 });
}
