// A portable, encrypted copy of the whole database, without pg_dump binaries: every user table
// streams out through Postgres's own reversible COPY text format, framed by byte length (the driver
// strips COPY's `\.` marker, so framing never trusts it), checksummed, then sealed with AES-256-GCM.
// Restore is sim/db-restore.mjs; the round-trip proof is sim/backup-proof.mjs. The future 6-hourly
// job for R2 follows Gleey's pg_dump pattern instead; this one exists so a backup can be proven on
// any laptop, Docker or not.
//
// dumpTo(sql, outStream, keyHex?) -> manifest. The key is 32 bytes as hex (POWER_BACKUP_KEY in real
// use, from the password manager); omitted, a random one is made and the caller must keep it.
// The connection string is never printed, and the file holds the shop's real data: keep it safe.
import { createCipheriv, randomBytes, createHash } from 'node:crypto';

const MAGIC = Buffer.from('PWBK1');
const quote = (s) => `"${s.replace(/"/g, '""')}"`;

export async function dumpTo(sql, outStream, keyHex = null) {
  const key = keyHex ? Buffer.from(keyHex, 'hex') : randomBytes(32);
  if (key.length !== 32) throw new Error('the key is not 32 bytes of hex');
  const tables = await sql`select schemaname, tablename from pg_tables
    where schemaname not in ('pg_catalog', 'information_schema') order by 1, 2`;
  const frames = [];
  const manifest = { tables: {} };
  for (const { schemaname, tablename } of tables) {
    const cols = (await sql`select column_name from information_schema.columns
      where table_schema = ${schemaname} and table_name = ${tablename} and is_generated = 'NEVER'
      order by ordinal_position`).map((r) => r.column_name);
    const count = (await sql`select count(*)::bigint as n from ${sql(schemaname)}.${sql(tablename)}`)[0].n;
    manifest.tables[`${schemaname}.${tablename}`] = { count, cols };
    // COPY does not take postgres.js identifier parameters, so identifiers are quoted by hand
    // (names come from the catalogue) and spliced in as raw fragments.
    const readable = await sql`copy ${sql.unsafe(`${quote(schemaname)}.${quote(tablename)}`)} (${sql.unsafe(cols.map(quote).join(', '))}) to stdout`.readable();
    const chunks = [];
    for await (const chunk of readable) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const data = Buffer.concat(chunks);
    frames.push(Buffer.from(`T ${schemaname} ${tablename} ${data.length} ${JSON.stringify(cols)}\n`));
    frames.push(data);
  }
  const body = Buffer.concat(frames);
  manifest.sha256 = createHash('sha256').update(body).digest('hex');
  const plain = Buffer.concat([Buffer.from(`M ${JSON.stringify(manifest)}\n`), body]);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const sealed = Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ct]);
  await new Promise((res, rej) => {
    outStream.write(sealed, (e) => (e ? rej(e) : res()));
  });
  return { manifest, key };
}
