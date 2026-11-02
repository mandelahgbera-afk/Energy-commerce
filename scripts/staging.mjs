// Shared by the staging scripts: reads the database address from .env.local without printing it,
// and makes the dangerous scripts prove they mean this database.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function stagingUrl() {
  const file = path.join(root, '.env.local');
  const env = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const url = env.match(/^SUPABASE_DB_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
  if (!url) {
    console.log('SUPABASE_DB_URL is not in .env.local yet.');
    process.exit(1);
  }
  return url;
}

// The project id is in the address Supabase gives (db.<ref>.supabase.co, or postgres.<ref> on the pooler).
export const projectRef = (url) => url.match(/postgres\.([a-z0-9]+)[:@]/)?.[1] ?? url.match(/db\.([a-z0-9]+)\.supabase\.co/)?.[1] ?? null;

// A wipe or a password change must name the project it is aimed at, so it can never land on the
// wrong database, such as production once one exists. Returns the other arguments.
export function requireConfirm(url, argv, what) {
  const ref = projectRef(url);
  const at = argv.indexOf('--confirm');
  const said = at >= 0 ? argv[at + 1] : null;
  if (!ref || said !== ref) {
    console.log(`This ${what} the database of Supabase project ${ref ?? '(could not read the project id)'}.`);
    console.log(ref ? `If that is staging, run it again with --confirm ${ref}` : 'Refusing, because the project id could not be checked.');
    process.exit(1);
  }
  return argv.filter((_, i) => i !== at && i !== at + 1);
}
