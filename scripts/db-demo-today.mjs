// A believable day in the shop, dated today, so the owner's screens are never empty in a demo:
// counter sales by card and by transfer, an installer at trade price, a phone order on a deposit,
// a delivery out with the demo rider, a quote request from the public shop, a follow-up due
// today, and a battery sold by its serial with readings, for Readings and the health record. Run it on the morning of a demo. Shop data goes in only through the real functions, every
// step's key carries the date, so a second run the same day changes nothing and the next day adds
// that day. Shelves running low get restocked first. Run the demo day and deliveries demo before.
//   node scripts/db-demo-today.mjs --confirm <project-id>
import postgres from 'postgres';
import { buildCall, unwrap } from '../sim/lib.mjs';
import { stagingUrl, requireConfirm } from './staging.mjs';

const url = stagingUrl();
requireConfirm(url, process.argv, "adds today's demo sales and orders to");
const sql = postgres(url, { ssl: 'require', max: 1, onnotice: () => {} });

const step = async (what, fn) => { try { const r = await fn(); console.log(`ok  ${what}`); return r; } catch (e) { console.log(`--  ${what}: ${String(e.message).split('\n')[0]}`); return null; } };
try {
  const [owner] = await sql`select id from staff where role = 'owner' and active order by created_at limit 1`;
  const [shop] = await sql`select id from locations where kind = 'shop' order by name limit 1`;
  const [sup] = await sql`select id from suppliers order by name limit 1`;
  const [rider] = await sql`select id from staff where role = 'driver' and active order by created_at limit 1`;
  if (!owner || !shop || !sup) { console.log('Run npm run db:owner and the demo day first.'); process.exit(1); }
  const as = (id) => (fn, args = {}) => sql.begin(async (t) => {
    if (id) await t.unsafe(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id, role: 'authenticated' })]);
    await t.unsafe(`set local role ${id ? 'authenticated' : 'anon'}`);
    const c = buildCall(fn, args);
    return unwrap([...(await t.unsafe(c.text, c.params))]);
  });
  const rpc = as(owner.id);
  const visitor = as(null);
  const ids = Object.fromEntries((await sql`select sku, id from products`).map((r) => [r.sku, r.id]));
  const [{ today, n }] = await sql`select shop_today()::text today, extract(doy from shop_today())::int n`;
  const key = (what) => `demo-today-${today}-${what}`;
  const k = (naira) => Math.round(naira * 100);
  // Made-up people, a different pair each day; phones in the 0803 999 02xx block.
  const people = ['Bola Adeyemi', 'Ifeanyi Nwankwo', 'Halima Sani', 'Tobi Ojo', 'Uche Eze', 'Zainab Bello', 'Segun Alabi', 'Ngozi Okeke'];
  const who = (i) => ({ name: people[(n + i) % people.length], phone: `0803999${String(200 + ((n * 3 + i) % 100)).padStart(4, '0')}` });

  const used = ['B-6206-2RS', 'SP-550M', 'CB-75', 'INV-5K', 'LI-5K', 'V-B60', 'INV-3K', 'TB-220', 'CB-55'];
  if (used.some((s) => !ids[s])) { console.log('The demo catalogue is missing: run node scripts/db-demo-day.mjs first.'); process.exit(1); }
  for (const sku of used) {
    const [{ free }] = await sql`select coalesce(sum(qty - reserved), 0)::int free from stock_balances where product_id = ${ids[sku]}`;
    if (free < 6) await step(`restock 20 × ${sku}`, () => rpc('receive_goods', { p_key: key(`rcv-${sku}`), p_supplier: sup.id, p_location: shop.id, p_lines: [{ product_id: ids[sku], qty: 20 }] }));
  }
  const sell = (i, what, lines, method, extra = {}) => step(`sale: ${what}`, () => rpc('counter_sale', { p_key: key(`sale-${i}`), p_location: shop.id, p_lines: lines.map(([sku, qty]) => ({ product_id: ids[sku], qty })), p_method: method, ...extra }));

  await sell(1, '2 bearings by card', [['B-6206-2RS', 2]], 'pos');
  await sell(2, '4 × 550 W panels at trade, by transfer', [['SP-550M', 4]], 'transfer', { p_phone: '08031110001', p_reference: `GTB-${70000 + n}` });
  const a = who(0);
  await sell(3, `car battery for ${a.name}`, [['CB-75', 1]], 'pos', { p_phone: a.phone });
  await sell(4, '5 kVA inverter and 5 kWh lithium by card', [['INV-5K', 1], ['LI-5K', 1]], 'pos');
  await sell(5, '3 belts by card', [['V-B60', 3]], 'pos');

  // A phone order on a deposit: the transfer waits for a second person, and a follow-up is due.
  const b = who(1);
  const c = await step(`customer ${b.name}`, () => rpc('save_customer', { p_phone: b.phone, p_name: b.name, p_reminders_ok: true }));
  const o = await step('phone order: 3 kVA inverter and 2 tubular batteries', () => rpc('create_order', { p_key: key('ord-1'), p_location: shop.id, p_lines: [{ product_id: ids['INV-3K'], qty: 1 }, { product_id: ids['TB-220'], qty: 2 }], p_phone: b.phone, p_channel: 'phone' }));
  if (o) await step('deposit by transfer: ₦200,000', () => rpc('take_payment', { p_key: key('pay-1'), p_order: o, p_method: 'transfer', p_amount: k(200000), p_reference: `ZEN-${90000 + n}` }));
  if (c) await step('follow-up due today', () => rpc('add_follow_up', { p_key: key('fu-1'), p_customer: c, p_what: 'Confirm the deposit landed and agree the delivery day', p_due_on: today }));

  // A delivery out now with the demo rider.
  const d = who(2);
  await step(`customer ${d.name}`, () => rpc('save_customer', { p_phone: d.phone, p_name: d.name, p_reminders_ok: true }));
  const o2 = await step('order: car battery, paid by card', () => rpc('create_order', { p_key: key('ord-2'), p_location: shop.id, p_lines: [{ product_id: ids['CB-55'], qty: 1 }], p_phone: d.phone, p_channel: 'phone' }));
  if (o2) {
    const [{ total_kobo }] = await sql`select total_kobo from orders where id = ${o2}`;
    await step('card tap taken', () => rpc('take_payment', { p_key: key('pay-2'), p_order: o2, p_method: 'pos', p_amount: Number(total_kobo) }));
    if (!(await sql`select 1 from shipments where order_id = ${o2}`).length) {
      await step('delivery booked for today', () => rpc('book_delivery', { p_order: o2, p_address: '9 Toyin Street, Ikeja', p_on: today, p_time: 'afternoon', p_landmark: 'Opposite the big mosque', p_lat: 6.5985, p_lng: 3.3528 }));
    }
    if (rider) await step('given to the demo rider', () => rpc('dispatch_order', { p_key: key('out-2'), p_order: o2, p_rider: rider.id }));
  }

  // A battery sold by its serial, so Readings and the customer's health record have something to show:
  // each day one unit with that day's serial goes to a new customer with a set-up check, and every
  // unit from an earlier demo day gets one check a day, its backup easing off as it ages.
  if (ids['TB-200']) {
    const e = who(4);
    const sn = `TB200-${today.replaceAll('-', '')}`;
    await step(`customer ${e.name}`, () => rpc('save_customer', { p_phone: e.phone, p_name: e.name, p_reminders_ok: true }));
    await step(`battery ${sn} received`, () => rpc('receive_goods', { p_key: key('rcv-tb200'), p_supplier: sup.id, p_location: shop.id, p_lines: [{ product_id: ids['TB-200'], qty: 1, serials: [sn] }] }));
    await step(`sale: battery ${sn} for ${e.name}`, () => rpc('counter_sale', { p_key: key('sale-tb200'), p_location: shop.id, p_lines: [{ product_id: ids['TB-200'], qty: 1, serials: [sn] }], p_method: 'pos', p_phone: e.phone }));
    const units = await sql`select e.id, (shop_today() - e.sold_on)::int days, u.serial from equipment_units e
      join serial_units u on u.id = e.serial_id where e.product_id = ${ids['TB-200']} and e.closed_on is null order by e.sold_on`;
    for (const u of units) {
      const first = u.days === 0;
      const hours = Math.max(4, Math.round((7.5 - u.days * 0.03) * 10) / 10);
      await step(`reading on ${u.serial}: ${hours} h`, () => rpc('add_reading', { p_key: key(`rd-${u.id}`), p_unit: u.id, p_backup_hours: hours,
        p_voltage_mv: first ? 13400 : 12800, p_charge_pct: first ? 100 : 95, p_felt: u.days > 90 ? 'weaker' : 'strong',
        p_note: first ? 'Set-up check at handover' : 'Check-in call' }));
    }
  }

  await step('quote request from the public shop', () => visitor('request_quote', { p_key: key('rq-1'), p_name: who(3).name, p_phone: who(3).phone, p_lines: [{ product_id: ids['SP-550M'], qty: 6 }, { product_id: ids['INV-5K'], qty: 1 }], p_note: 'For a small office. What would the whole set cost?' }));

  const day = await rpc('owner_today', {});
  console.log('owner today:', JSON.stringify(day).slice(0, 300));
} finally {
  await sql.end({ timeout: 5 });
}
