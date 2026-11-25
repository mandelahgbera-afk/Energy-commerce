// Adds deliveries and the small CRM to the staging demo, after db-demo-day: a demo rider who can
// sign in, an order at every stage of the /orders board, a failed drop, two counter sales, notes
// and follow-ups. Shop data is written only through the real functions, every step has its own
// key, and a second run changes nothing. The rider's sign-in is made the way db-pass sets one
// (Postgres's own bcrypt); its password goes to staging-demo-logins.txt beside the repo, never
// to the screen. Names are made up and the phones are in the 0803 999 01xx block.
//   node scripts/db-demo-deliveries.mjs --confirm <project-id>
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { buildCall, unwrap } from '../sim/lib.mjs';
import { root, stagingUrl, requireConfirm } from './staging.mjs';

const url = stagingUrl();
requireConfirm(url, process.argv, 'adds a demo rider sign-in and demo orders to');
const sql = postgres(url, { ssl: 'require', max: 1, onnotice: () => {} });
const RIDER_EMAIL = 'rider.demo@powerstore.test';
const logins = path.join(root, '..', 'staging-demo-logins.txt');

const step = async (what, fn) => { try { const r = await fn(); console.log(`ok  ${what}`); return r; } catch (e) { console.log(`--  ${what}: ${String(e.message).split('\n')[0]}`); return null; } };
try {
  const [owner] = await sql`select id from staff where role = 'owner' and active order by created_at limit 1`;
  const [shop] = await sql`select id from locations where kind = 'shop' order by name limit 1`;
  if (!owner || !shop) { console.log('Run npm run db:owner and the demo day first.'); process.exit(1); }
  const as = (id) => (fn, args = {}) => sql.begin(async (t) => {
    if (id) await t.unsafe(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id, role: 'authenticated' })]);
    await t.unsafe(`set local role ${id ? 'authenticated' : 'anon'}`);
    const c = buildCall(fn, args);
    return unwrap([...(await t.unsafe(c.text, c.params))]);
  });
  const rpc = as(owner.id);
  const visitor = as(null);
  const ids = Object.fromEntries((await sql`select sku, id from products`).map((r) => [r.sku, r.id]));
  const [{ today, tomorrow }] = await sql`select shop_today()::text today, (shop_today() + 1)::text tomorrow`;

  // The rider's sign-in: a confirmed email account shaped like the ones the dashboard makes.
  let [rider] = await sql`select id from auth.users where lower(email) = ${RIDER_EMAIL}`;
  if (!rider) {
    const password = `Demo-${crypto.randomBytes(9).toString('base64url')}`;
    rider = await sql.begin(async (t) => {
      const [u] = await t`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token,
          email_change_token_new, email_change, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
        select coalesce((select instance_id from auth.users limit 1), '00000000-0000-0000-0000-000000000000'), gen_random_uuid(),
          'authenticated', 'authenticated', ${RIDER_EMAIL}, crypt(${password}, gen_salt('bf', 10)), now(),
          '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', ''
        returning id`;
      await t`insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
        values (${u.id}::text, ${u.id}, ${sql.json({ sub: u.id, email: RIDER_EMAIL, email_verified: true, phone_verified: false })}, 'email', now(), now(), now())`;
      return u;
    });
    fs.appendFileSync(logins, `Staging demo rider (sign in at /login, then My drops): ${RIDER_EMAIL}  ${password}\n`);
    console.log(`ok  rider sign-in made; the password is in ${logins}`);
  } else console.log(`ok  rider sign-in already there (password in ${logins})`);
  await step('Emeka (demo) is a rider', () => rpc('save_staff', { p_user: rider.id, p_name: 'Emeka (demo)', p_role: 'driver' }));
  const emeka = as(rider.id);

  const customer = (phone, name) => step(`customer ${name}`, () => rpc('save_customer', { p_phone: phone, p_name: name, p_reminders_ok: true }));
  const order = async (n, phone, lines, method) => {
    const o = await step(`order ${n}`, () => rpc('create_order', { p_key: `demo-del-ord-${n}`, p_location: shop.id, p_lines: lines.map(([sku, qty]) => ({ product_id: ids[sku], qty })), p_phone: phone, p_channel: 'phone' }));
    if (o && method) {
      const [{ total_kobo }] = await sql`select total_kobo from orders where id = ${o}`;
      await step(`order ${n} paid by ${method}`, () => rpc('take_payment', { p_key: `demo-del-pay-${n}`, p_order: o, p_method: method, p_amount: Number(total_kobo) }));
    }
    return o;
  };
  const book = async (o, args) => {
    if (!o || (await sql`select 1 from shipments where order_id = ${o}`).length) return;
    await step(`delivery booked for ${args.p_on}`, () => rpc('book_delivery', { p_order: o, ...args }));
  };
  const out = (n, o) => o && step(`order ${n} given to Emeka`, () => rpc('dispatch_order', { p_key: `demo-del-out-${n}`, p_order: o, p_rider: rider.id }));
  const token = async (o) => (await sql`select receipt_token from orders where id = ${o}`)[0].receipt_token;

  // Waiting for money: a church roof, with a call note and a follow-up due today.
  const amaka = await customer('08039990102', 'Amaka Okafor');
  await order(1, '08039990102', [['SP-550M', 2]]);
  if (amaka) {
    await step('note on Amaka', () => rpc('add_customer_note', { p_key: 'demo-del-note-1', p_customer: amaka, p_kind: 'call', p_body: 'Wants two 550 W panels for a church roof. Will pay by transfer this week.' }));
    await step('follow-up due today', () => rpc('add_follow_up', { p_key: 'demo-del-fu-1', p_customer: amaka, p_what: 'Call to check the transfer went through', p_due_on: today }));
  }

  // Ready to go: a card tap still to check, booked for tomorrow, no pin yet (the customer can drop one from the link).
  await customer('08039990103', 'Kunle Adebayo');
  const o2 = await order(2, '08039990103', [['CB-55', 1]], 'pos');
  await book(o2, { p_address: '14 Oba Akran Avenue, Ikeja', p_on: tomorrow, p_time: 'morning', p_landmark: 'Beside the blue gate, opposite the filling station', p_contact_name: 'Kunle Adebayo' });

  // Delivered: given to Emeka and sold at the door with the customer's code.
  await customer('08039990104', 'Chinedu Obi');
  const o4 = await order(4, '08039990104', [['TB-220', 1]], 'pos');
  await book(o4, { p_address: '22 Allen Avenue, Ikeja', p_on: today, p_time: 'morning', p_landmark: 'Above the bank, second floor', p_lat: 6.6006, p_lng: 3.3536 });
  await out(4, o4);
  if (o4) {
    const seen = await visitor('track_order', { p_token: await token(o4) });
    if (seen.stage === 'on_the_way') await step('order 4 delivered with the code', () => emeka('confirm_drop', { p_key: 'demo-del-drop-4', p_order: o4, p_code: seen.delivery.code }));
  }

  // A failed drop: back on the shelf for the customer, with the reason and a new day.
  await customer('08039990105', 'Fatima Yusuf');
  const o5 = await order(5, '08039990105', [['CB-75', 1]], 'pos');
  await book(o5, { p_address: '5 Opebi Road, Ikeja', p_on: today, p_time: 'evening', p_landmark: 'White gate next to the church', p_lat: 6.5935, p_lng: 3.3601 });
  await out(5, o5);
  if (o5) await step('order 5: nobody at the gate', () => emeka('fail_drop', { p_key: 'demo-del-fail-5', p_order: o5, p_reason: 'Nobody at the gate and the phone was off', p_next_on: tomorrow }));

  // On the way: out with Emeka now, with his last point on the map.
  await customer('08039990101', 'Ngozi Eze');
  const o3 = await order(3, '08039990101', [['V-A50', 4]], 'pos');
  await book(o3, { p_address: '3 Adeniyi Jones Avenue, Ikeja', p_on: today, p_time: 'afternoon', p_landmark: 'Yellow building beside the pharmacy', p_lat: 6.6042, p_lng: 3.3489 });
  await out(3, o3);
  await step('Emeka shares where he is', () => emeka('share_position', { p_lat: 6.5958, p_lng: 3.3412 }));

  // Two counter sales: a walk-in by card, and an installer at trade price by transfer.
  await step('counter sale: 4 bearings by card', () => rpc('counter_sale', { p_key: 'demo-del-sale-1', p_location: shop.id, p_lines: [{ product_id: ids['B-6203-2RS'], qty: 4 }], p_method: 'pos' }));
  await step('counter sale: 2 belts at trade, by transfer', () => rpc('counter_sale', { p_key: 'demo-del-sale-2', p_location: shop.id, p_lines: [{ product_id: ids['V-A50'], qty: 2 }], p_method: 'transfer', p_phone: '07033330003', p_reference: 'GTB-61873' }));

  // The installers from the demo day get a visit note and a follow-up.
  const [bright] = await sql`select id from customers where phone like '%8031110001' limit 1`;
  const [okafor] = await sql`select id from customers where phone like '%8052220002' limit 1`;
  if (bright) await step('visit note on Bright Solar', () => rpc('add_customer_note', { p_key: 'demo-del-note-2', p_customer: bright.id, p_kind: 'visit', p_body: 'Visited their Lekki site. They want a monthly price for ten 550 W panels.' }));
  if (okafor) await step('follow-up for Okafor Power', () => rpc('add_follow_up', { p_key: 'demo-del-fu-2', p_customer: okafor.id, p_what: 'Send the new battery prices', p_due_on: tomorrow }));

  const board = await rpc('orders_board', {});
  const count = {};
  for (const r of board.orders ?? []) count[r.stage] = (count[r.stage] ?? 0) + 1;
  console.log('board:', JSON.stringify(count));
} finally {
  await sql.end({ timeout: 5 });
}
