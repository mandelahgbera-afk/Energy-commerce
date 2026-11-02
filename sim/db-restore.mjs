// The other half of sim/db-dump.mjs: open the sealed file, prove nothing was changed, empty the
// target (which must already have the migrations applied) and load every table back through COPY.
// Triggers and foreign keys rest during the load, as pg_restore does, then identity sequences are
// reset from the restored data so the shop keeps writing.
//
// restoreFrom(sql, inStream, keyHex) -> manifest. Pass a reserved connection: the load changes
// session settings for its duration.
import { createDecipheriv, createHash } from 'node:crypto';

const MAGIC = Buffer.from('PWBK1');
const quote = (s) => `"${s.replace(/"/g, '""')}"`;

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function restoreFrom(sql, inStream, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('the key is not 32 bytes of hex');
  const sealed = await readAll(inStream);
  if (!sealed.subarray(0, 5).equals(MAGIC)) throw new Error('not a Power Store backup');
  const iv = sealed.subarray(5, 17);
  const tag = sealed.subarray(17, 33);
  const ct = sealed.subarray(33);
  let plain;
  try {
    const dec = createDecipheriv('aes-256-gcm', key, iv);
    dec.setAuthTag(tag);
    plain = Buffer.concat([dec.update(ct), dec.final()]);
  } catch {
    throw new Error('the backup cannot be opened: wrong key or damaged file');
  }
  // The manifest line opens the payload; after it, length-prefixed frames.
  const firstNewline = plain.indexOf('\n');
  if (firstNewline < 0 || plain.subarray(0, 1).toString() !== 'M') throw new Error('the backup has no manifest');
  const manifest = JSON.parse(plain.subarray(2, firstNewline).toString('utf8'));
  const body = plain.subarray(firstNewline + 1);
  if (createHash('sha256').update(body).digest('hex') !== manifest.sha256) throw new Error('the backup does not match its own checksum');
  const frames = [];
  let pos = 0;
  while (pos < body.length) {
    const lineEnd = body.indexOf('\n', pos);
    if (lineEnd < 0) throw new Error('a frame header is cut off');
    const [tag, schemaname, tablename, lenText, colsJson] = body.subarray(pos, lineEnd).toString('utf8').split(' ');
    if (tag !== 'T') throw new Error(`bad frame header: ${body.subarray(pos, lineEnd).toString().slice(0, 40)}`);
    const len = Number(lenText);
    const data = body.subarray(lineEnd + 1, lineEnd + 1 + len);
    if (data.length !== len) throw new Error(`frame for ${schemaname}.${tablename} is cut off`);
    frames.push({ schemaname, tablename, cols: JSON.parse(colsJson), data });
    pos = lineEnd + 1 + len;
  }
  // Empty everything with checks off (the append-only tables refuse truncate otherwise),
  // load, then bring checks back.
  await sql.unsafe('set session_replication_role = replica');
  try {
    const all = frames.map((f) => `${quote(f.schemaname)}.${quote(f.tablename)}`).join(', ');
    await sql.unsafe(`truncate ${all} cascade`);
    for (const f of frames) {
      const w = await sql`copy ${sql.unsafe(`${quote(f.schemaname)}.${quote(f.tablename)}`)} (${sql.unsafe(f.cols.map(quote).join(', '))}) from stdin`.writable();
      w.write(f.data);
      w.write('\\.\n');
      await new Promise((res, rej) => { w.end(res); w.on('error', rej); });
    }
  } finally {
    await sql.unsafe('set session_replication_role = origin');
  }
  // Identity columns do not advance during COPY; without this the next insert collides.
  const idents = await sql.unsafe(`select table_schema s, table_name t, column_name c from information_schema.columns
    where is_identity = 'YES' and table_schema not in ('pg_catalog', 'information_schema')`);
  for (const { s, t, c } of idents) {
    await sql.unsafe(`select setval(pg_get_serial_sequence('${quote(s)}.${quote(t)}', '${c}'), coalesce((select max(${quote(c)}) + 1 from ${quote(s)}.${quote(t)}), 1), false)`);
  }
  return manifest;
}
