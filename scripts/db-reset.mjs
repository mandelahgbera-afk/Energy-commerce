// Wipes staging back to a clean slate and reseeds the demo catalogue, so a simulation can be
// replayed. Everything goes through the real doors; only the wipe touches tables directly.
//   node scripts/db-reset.mjs <real-owner-email> [demo-owner-email] --confirm <project-id>
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { root, stagingUrl, requireConfirm } from './staging.mjs';

const url = stagingUrl();
const args = requireConfirm(url, process.argv, 'wipes every shop record in');
const sql = postgres(url, { ssl: 'require', max: 1, onnotice: () => {} });
const quote = (s) => `"${s.replace(/"/g, '""')}"`;
try {
  // The config tables survive the wipe: their rows are part of the schema, not shop data.
  const tables = await sql`select tablename from pg_tables
    where schemaname = 'public' and tablename not in ('ledger_accounts', 'shop_settings')`;
  const all = tables.map((t) => `public.${quote(t.tablename)}`).join(', ');
  await sql.unsafe('set session_replication_role = replica');
  try {
    await sql.unsafe(`truncate ${all} cascade`);
  } finally {
    await sql.unsafe('set session_replication_role = origin');
  }
  console.log(`wiped ${tables.length} public tables; sign-ins (auth) untouched.`);
  // The config rows come back from the migrations themselves, so they can never drift.
  const migrationsDir = path.join(root, 'supabase', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((n) => n.endsWith('.sql'))) {
    const text = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    for (const m of text.matchAll(/insert into ledger_accounts[\s\S]*?;\n/g)) {
      const stmt = m[0].includes('on conflict') ? m[0] : m[0].replace(/;\s*$/, ' on conflict (code) do nothing;');
      await sql.unsafe(stmt);
    }
  }
  await sql.unsafe('insert into shop_settings default values on conflict do nothing');
  // The owner rows come back first: the real owner, then the demo owner.
  const ownerEmails = [args[2], args[3]].filter(Boolean);
  if (ownerEmails.length === 0) {
    console.log('Usage: node scripts/db-reset.mjs <real-owner-email> [demo-owner-email] --confirm <project-id>');
    process.exit(1);
  }
  for (const email of ownerEmails) {
    const users = await sql`select id from auth.users where lower(email) = ${email.toLowerCase()}`;
    if (users.length === 0) {
      console.log(`No sign-up for ${email} — create it first, then rerun.`);
      process.exit(1);
    }
    await sql`insert into staff (id, name, role) values (${users[0].id}, ${email}, 'owner') on conflict (id) do nothing`;
  }
  const owner = await sql`select id from staff where role = 'owner' order by created_at limit 1`;
  const { buildCall, unwrap } = await import('../sim/lib.mjs');
  const rpc = (fn, args = {}) => sql.begin(async (t) => {
    await t.unsafe(`select set_config('request.jwt.claim.sub', $1, true)`, [owner[0].id]);
    await t.unsafe('set local role authenticated');
    const c = buildCall(fn, args);
    return unwrap([...(await t.unsafe(c.text, c.params))]);
  });
  const shop = await rpc('save_location', { p_name: 'Ikeja shop' });
  const back = await rpc('save_location', { p_name: 'Warehouse', p_kind: 'warehouse' });
  const sup = await rpc('save_supplier', { p_name: 'Lagos Batteries' });
  const catalogue = [
    { sku: 'B-6205-2RS', name: '6205-2RS bearing', price: 480000, cost: 300000, trade: 420000, qty: 48, part: '6205 2RS', size: [25, 52, 15] },
    { sku: 'B-6204-2RS', name: '6204-2RS bearing', price: 390000, cost: 240000, trade: 340000, qty: 3, part: '6204 2RS', size: [20, 47, 14] },
    { sku: 'V-A42', name: 'A42 V-belt', price: 320000, cost: 180000, trade: 280000, qty: 15, unit: 'metre', part: 'A42' },
    { sku: 'CH-10B', name: '10B roller chain, per metre', price: 950000, cost: 550000, trade: 860000, qty: 2, unit: 'metre', part: '10B-1' },
    { sku: 'CB-24F', name: 'Car battery, size 24F', price: 7800000, cost: 5600000, trade: 7100000, qty: 2, tracking: 'serial', serials: ['CB-24F-3310', 'CB-24F-3342'] },
    { sku: 'TB-200', name: '200Ah tubular battery', price: 42000000, cost: 31500000, trade: 39200000, qty: 1, tracking: 'serial', serials: ['TB-200-88121'] },
  ];
  let seq = 0;
  const key = (p) => `${p}-${++seq}`;
  for (const p of catalogue) {
    const id = await rpc('save_product', { p_sku: p.sku, p_name: p.name, p_price: p.price, p_trade: p.trade, p_tracking: p.tracking ?? 'count', p_unit: p.unit ?? 'each' });
    await rpc('set_last_cost', { p_product: id, p_cost: p.cost });
    if (p.part) await rpc('save_part_details', { p_product: id, p_part_number: p.part, ...(p.size ? { p_bore: p.size[0], p_outside: p.size[1], p_width: p.size[2] } : {}) });
    await rpc('receive_goods', { p_key: key('rcv'), p_supplier: sup, p_location: shop, p_lines: [{ product_id: id, qty: p.qty, ...(p.serials ? { serials: p.serials } : {}) }] });
  }
  console.log('clean slate ready: 6 products, low stock on the 6204, the chain and the tubular battery for the simulations.');
} finally {
  await sql.end({ timeout: 5 });
}
