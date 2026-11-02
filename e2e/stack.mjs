// A throwaway Supabase on this laptop for end-to-end tests: the real Postgres image, the real sign-in
// service (GoTrue) and the real API (PostgREST), from images Supabase's own tools use, plus a small
// gateway that joins them at one address the way Supabase's does. Everything is removed afterwards.
// Nothing here talks to staging or the internet.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const images = {
  db: 'public.ecr.aws/supabase/postgres:17.11.0.006',
  auth: 'public.ecr.aws/supabase/gotrue:v2.197.0',
  rest: 'public.ecr.aws/supabase/postgrest:v16.5',
};
export const ports = { gateway: 54530, auth: 54531, db: 54532, rest: 54533 };
const net = 'power-e2e';
const names = { db: 'power-e2e-db', auth: 'power-e2e-auth', rest: 'power-e2e-rest' };
// A secret for this run only. The keys it signs are useless anywhere else.
const secret = crypto.randomBytes(32).toString('hex');

const docker = (args, timeout = 120000) => {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout, windowsHide: true });
  if (r.status !== 0) throw new Error(`docker ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || r.stdout).trim().split('\n').pop()}`);
  return r.stdout.trim();
};
const quiet = (args) => spawnSync('docker', args, { encoding: 'utf8', windowsHide: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export function sign(payload) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ iss: 'supabase', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 6 * 3600, ...payload });
  return `${head}.${body}.${crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}
export const keys = () => ({ anon: sign({ role: 'anon' }), service: sign({ role: 'service_role' }) });

export async function stop() {
  for (const n of Object.values(names)) quiet(['rm', '-f', n]);
  quiet(['network', 'rm', net]);
}

async function until(what, fn, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { if (await fn()) return; } catch {}
    await wait(1000);
  }
  throw new Error(`${what} did not come up`);
}

export async function start() {
  await stop();
  docker(['network', 'create', net]);
  docker(['run', '-d', '--name', names.db, '--network', net, '-p', `127.0.0.1:${ports.db}:5432`, '-e', 'POSTGRES_PASSWORD=postgres', '-e', `JWT_SECRET=${secret}`, images.db]);
  await until('the database', () => quiet(['exec', names.db, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']).status === 0);
  // The image's first start runs its own setup, then restarts once. Wait for that to finish.
  await wait(4000);
  await until('the database', () => quiet(['exec', names.db, 'psql', '-U', 'supabase_admin', '-h', '127.0.0.1', '-d', 'postgres', '-tAc', 'select 1']).status === 0);
  // Supabase's own setup gives these service roles their passwords; here we do it.
  docker(['exec', names.db, 'psql', '-U', 'supabase_admin', '-h', '127.0.0.1', '-d', 'postgres', '-qc',
    "alter role authenticator with password 'postgres'; alter role supabase_auth_admin with password 'postgres';"]);

  docker(['run', '-d', '--name', names.auth, '--network', net, '-p', `127.0.0.1:${ports.auth}:9999`,
    '-e', 'GOTRUE_API_HOST=0.0.0.0', '-e', 'PORT=9999', '-e', `API_EXTERNAL_URL=http://127.0.0.1:${ports.gateway}/auth/v1`,
    '-e', 'GOTRUE_DB_DRIVER=postgres', '-e', `GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:postgres@${names.db}:5432/postgres`,
    '-e', 'GOTRUE_SITE_URL=http://localhost:3100', '-e', 'GOTRUE_URI_ALLOW_LIST=*', '-e', 'GOTRUE_DISABLE_SIGNUP=true',
    '-e', 'GOTRUE_JWT_ADMIN_ROLES=service_role', '-e', 'GOTRUE_JWT_AUD=authenticated', '-e', 'GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated',
    '-e', 'GOTRUE_JWT_EXP=3600', '-e', `GOTRUE_JWT_SECRET=${secret}`, '-e', 'GOTRUE_EXTERNAL_EMAIL_ENABLED=true',
    '-e', 'GOTRUE_MAILER_AUTOCONFIRM=true', '-e', 'GOTRUE_EXTERNAL_PHONE_ENABLED=false', images.auth]);
  await until('sign-in', async () => (await fetch(`http://127.0.0.1:${ports.auth}/health`)).ok);

  // Our migrations run as postgres, as they do on Supabase, once the sign-in service has made auth.users.
  const sql = postgres({ host: '127.0.0.1', port: ports.db, user: 'postgres', password: 'postgres', database: 'postgres', max: 1, onnotice: () => {} });
  try {
    const dir = path.join(root, 'supabase', 'migrations');
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) await sql.unsafe(fs.readFileSync(path.join(dir, f), 'utf8'));
  } finally {
    await sql.end({ timeout: 2 });
  }

  docker(['run', '-d', '--name', names.rest, '--network', net, '-p', `127.0.0.1:${ports.rest}:3000`,
    '-e', `PGRST_DB_URI=postgres://authenticator:postgres@${names.db}:5432/postgres`, '-e', 'PGRST_DB_SCHEMAS=public',
    '-e', 'PGRST_DB_ANON_ROLE=anon', '-e', `PGRST_JWT_SECRET=${secret}`, images.rest]);
  await until('the API', async () => (await fetch(`http://127.0.0.1:${ports.rest}/`)).ok);
  return gateway();
}

// One address for the app, like Supabase's: /auth/v1 to sign-in, /rest/v1 to the API.
function gateway() {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'content-range, x-supabase-api-version');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const to = req.url.startsWith('/auth/v1') ? { port: ports.auth, strip: '/auth/v1' } : req.url.startsWith('/rest/v1') ? { port: ports.rest, strip: '/rest/v1' } : null;
    if (!to) { res.writeHead(404); res.end(); return; }
    const headers = { ...req.headers, host: `127.0.0.1:${to.port}` };
    const up = http.request({ host: '127.0.0.1', port: to.port, method: req.method, path: req.url.slice(to.strip.length) || '/', headers }, (r) => {
      const h = { ...r.headers };
      delete h['access-control-allow-origin'];
      res.writeHead(r.statusCode ?? 502, h);
      r.pipe(res);
    });
    up.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  return new Promise((resolve) => server.listen(ports.gateway, '127.0.0.1', () => resolve(server)));
}

export const dbUrl = { host: '127.0.0.1', port: ports.db, user: 'postgres', password: 'postgres', database: 'postgres' };
