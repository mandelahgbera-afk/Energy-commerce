// Wipes staging back to a clean slate and reseeds the demo catalogue, so a simulation can be
// replayed. Everything goes through the real doors; only the wipe touches tables directly.
//   node scripts/db-reset.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
const url = env.match(/^SUPABASE_DB_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!url) {
  console.log('SUPABASE_DB_URL is not in .env.local yet.');
  process.exit(1);
}
const sql = postgres(url, { ssl: 'require', max: 1, onnotice: () => {} });
const quote = (s) => `"${s.replace(/"/g, '""')}"`;
try {
  const tables = await sql`select schemaname, tablename from pg_tables
    where schemaname not in ('pg_catalog', 'information_schema') and schemaname <> 'auth'`;
  const all = tables.map((t) => `${quote(t.schemaname)}.${quote(t.tablename)}`).join(', ');
  await sql.unsafe('set session_replication_role = replica');
  try {
    await sql.unsafe(`truncate ${all} cascade`);
  } finally {
    await sql.unsafe('set session_replication_role = origin');
  }
  console.log(`wiped ${tables.length} tables (staff rows survive only if you rerun db-staff/db-owner).`);
  // Reseed the catalogue through the real doors.
  const owner = await sql`select id from staff where role = 'owner' order by created_at limit 1`;
  if (owner.length === 0) {
    console.log('No owner staff row left after the wipe — run db-owner again.');
    process.exit(1);
  }
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
    await rpc('receive_goods', { p_key: key('rcv'), p_supplier: sup, p_location: p.unit === 'metre' ? back : shop, p_lines: [{ product_id: id, qty: p.qty, ...(p.serials ? { serials: p.serials } : {}) }] });
  }
  console.log('clean slate ready: 6 products, low stock on the 6204, the chain and the tubular battery for the simulations.');
} finally {
  await sql.end({ timeout: 5 });
}
