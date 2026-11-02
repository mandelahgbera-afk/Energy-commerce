// Shared by the tests: loads the schema, and talks to either PGlite or a real Postgres the same way.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'supabase', 'migrations');

export function schemaSql() {
  const files = fs.readdirSync(migrationsDir).filter((n) => n.endsWith('.sql')).sort();
  return [fs.readFileSync(path.join(here, 'stubs.sql'), 'utf8'), ...files.map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))];
}

export async function openPglite() {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite();
  return {
    where: 'PGlite',
    query: async (text, params = []) => (await pg.query(text, params)).rows,
    exec: async (text) => { await pg.exec(text); },
    close: async () => { await pg.close(); },
  };
}

// Plain strings for dates, so both drivers read them the same.
export const postgresOptions = (port, password, database, max) => ({
  host: '127.0.0.1', port, user: 'postgres', password, database, max, onnotice: () => {}, idle_timeout: 20,
  types: { date: { to: 1184, from: [1082, 1114, 1184], serialize: (x) => x, parse: (x) => x } },
});

export const arr = (type, values) => ({ __array: type, values });

// A named call, so the database's own function signature decides each parameter's type.
export function buildCall(fn, args) {
  const params = [];
  const parts = Object.keys(args).map((name) => {
    const v = args[name];
    if (v && v.__array) {
      params.push(`{${v.values.map((x) => `"${x}"`).join(',')}}`);
      return `${name} => $${params.length}::text::${v.__array}[]`;
    }
    if (v !== null && typeof v === 'object') {
      params.push(JSON.stringify(v));
      return `${name} => $${params.length}::text::jsonb`;
    }
    params.push(v);
    return `${name} => $${params.length}`;
  });
  return { text: `select * from public.${fn}(${parts.join(', ')})`, params };
}

export const unwrap = (rows) => {
  if (rows.length === 1 && Object.keys(rows[0]).length === 1) return Object.values(rows[0])[0];
  return rows;
};

export const N = (x) => (x === null || x === undefined ? x : Number(x));

export const USERS = {
  OWNER: '00000000-0000-4000-8000-000000000001',
  COUNTER: '00000000-0000-4000-8000-000000000002',
  COUNTER2: '00000000-0000-4000-8000-000000000003',
  STORE: '00000000-0000-4000-8000-000000000004',
  DISPATCH: '00000000-0000-4000-8000-000000000005',
  DRIVER: '00000000-0000-4000-8000-000000000006',
  ACCOUNT: '00000000-0000-4000-8000-000000000007',
  BUYER: '00000000-0000-4000-8000-000000000008',
  STRANGER: '00000000-0000-4000-8000-000000000009',
  EXSTAFF: '00000000-0000-4000-8000-00000000000a',
};

// Users exist in auth.users, the first owner goes in by hand (as on a real install), and the owner adds the rest.
export async function seedPeople(db) {
  for (const id of Object.values(USERS)) await db.query('insert into auth.users (id) values ($1)', [id]);
  await db.query(`insert into staff (id, name, role) values ($1, 'Owner', 'owner')`, [USERS.OWNER]);
}
