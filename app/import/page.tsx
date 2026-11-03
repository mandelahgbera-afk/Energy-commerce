'use client';

// Bring in the shop's price list: copy the rows from Excel and paste them, or choose a CSV file.
// The database previews every line in plain words first, and saves every line or none. Money
// cells are turned into kobo here with the exact parser; anything unreadable is passed on as it
// is, so the preview names the line instead of guessing.
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { browserDb } from '@/lib/supabase';
import { friendly } from '@/lib/errors';
import { formatNaira, nairaToKobo } from '@/lib/money';
import { Spinner, Tick } from '@/components/kit/feel';
import { StaffNav } from '@/components/staff-nav';

type Row = { line: number; sku: string | null; name: string | null; action: 'new' | 'update' | 'same' | 'error'; problem: string | null; price: number | string | null; price_before: number | string | null; trade: number | string | null; trade_before: number | string | null };
type Preview = { counts: { new: number; update: number; same: number; error: number }; rows: Row[] };

const columns: [string, string[]][] = [
  ['sku', ['sku', 'code', 'item code', 'product code']],
  ['name', ['name', 'description', 'item', 'product']],
  ['family', ['kind', 'family', 'category', 'type']],
  ['unit', ['unit', 'uom']],
  ['price', ['price', 'shelf price', 'selling price', 'retail price']],
  ['trade', ['trade', 'trade price', 'wholesale', 'wholesale price']],
  ['cost', ['cost', 'cost price', 'buying price']],
  ['part', ['part', 'part number', 'part no', 'part no.']],
  ['bore', ['bore', 'bore mm', 'id mm', 'inner mm']],
  ['outside', ['outside', 'outside mm', 'od mm', 'outer mm']],
  ['width', ['width', 'width mm', 'thickness mm']],
  ['warranty', ['warranty', 'warranty months']],
  ['tracking', ['serial', 'serials', 'serial numbers', 'tracking']],
  ['low', ['low', 'low stock', 'low stock at', 'reorder level']],
];
const template = [
  'SKU,Name,Kind,Unit,Price,Trade price,Cost,Part number,Bore mm,Outside mm,Width mm,Warranty months,Serial numbers,Low stock at',
  'B-6205-2RS,6205-2RS bearing,Bearings,each,4800,4200,3000,6205 2RS,25,52,15,0,no,3',
  'CB-24F,"Car battery, size 24F",Batteries,each,78000,71000,56000,,,,,12,yes,2',
].join('\r\n');
const badge = { new: ['New', '#1B5CF0', '#EEF3FF'], update: ['Changes', '#92400E', '#FDF3E7'], same: ['Same', '#55606C', '#F1F3F5'], error: ['Problem', '#B42318', '#FEF0EE'] } as const;
const errorOf = (message: string) => { const [n, ...rest] = message.split(':'); return friendly(n, rest.join(':').trim()); };

// Cells from Excel arrive tab-separated; a CSV uses commas (or semicolons), with quotes allowed.
function parseTable(text: string): string[][] {
  const t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const first = t.split('\n', 1)[0];
  const sep = first.includes('\t') ? '\t' : first.split(';').length > first.split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
const norm = (h: string) => h.toLowerCase().replace(/[():₦]/g, '').replace(/\s+/g, ' ').trim();
const money = (v: string) => { const t = v.replace(/\s|ngn/gi, ''); if (!t) return null; try { return Number(nairaToKobo(t)); } catch { return v; } };
const num = (v: string) => { const t = v.trim().replace(/,/g, ''); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : v; };

function toRows(text: string) {
  const table = parseTable(text);
  if (table.length < 2) return { rows: [], ignored: [] as string[], missing: ['a header row and at least one product'] };
  const heads = table[0].map(norm);
  const keys = heads.map((h) => columns.find(([, words]) => words.includes(h))?.[0] ?? null);
  const ignored = table[0].filter((_, i) => keys[i] === null && heads[i] !== '');
  const missing = ['sku', 'name', 'price'].filter((k) => !keys.includes(k));
  const rows = table.slice(1).map((cells) => {
    const out: Record<string, string | number | null> = {};
    keys.forEach((k, i) => {
      if (!k) return;
      const v = (cells[i] ?? '').trim();
      out[k] = ['price', 'trade', 'cost'].includes(k) ? money(v) : ['bore', 'outside', 'width', 'warranty', 'low'].includes(k) ? num(v) : v || null;
    });
    return out;
  });
  return { rows, ignored, missing };
}

export default function ImportPage() {
  const db = useRef(browserDb()).current;
  const [me, setMe] = useState<undefined | null | { role: string | null }>(undefined);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [show, setShow] = useState<'all' | 'error' | 'change'>('all');
  const [busy, setBusy] = useState<'look' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Preview['counts'] | null>(null);
  const key = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await db.auth.getSession();
      if (!data.session) { setMe(null); return; }
      const r = await db.from('staff').select('role').eq('id', data.session.user.id).maybeSingle();
      setMe({ role: r.data?.role ?? null });
    })();
  }, [db]);

  const parsed = useMemo(() => (text.trim() ? toRows(text) : null), [text]);
  const edit = (t: string) => { setText(t); setPreview(null); setSaved(null); setError(null); key.current = null; };

  const look = async () => {
    if (!parsed || parsed.missing.length || busy) return;
    if (parsed.rows.length > 2000) { setError('That is more than 2,000 lines. Split the sheet in two and bring in each half.'); return; }
    setBusy('look');
    setError(null);
    const { data, error: e } = await db.rpc('import_products', { p_key: null, p_rows: parsed.rows, p_apply: false });
    setBusy(null);
    if (e) { setError(errorOf(e.message)); return; }
    setPreview(data as Preview);
    setShow((data as Preview).counts.error ? 'error' : 'all');
  };
  const save = async () => {
    if (!parsed || !preview || busy) return;
    key.current ??= crypto.randomUUID();
    setBusy('save');
    setError(null);
    const { data, error: e } = await db.rpc('import_products', { p_key: key.current, p_rows: parsed.rows, p_apply: true });
    setBusy(null);
    if (e) { setError(errorOf(e.message)); return; }
    setSaved((data as { counts: Preview['counts'] }).counts);
    setPreview(null);
    setText('');
    key.current = null;
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([template], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'price-list-template.csv' });
    a.click();
    URL.revokeObjectURL(url);
  };

  if (me === undefined) return <main style={{ minHeight: '100vh' }} aria-busy="true" />;
  if (me === null || me.role !== 'owner') {
    return (
      <main className="mx-auto max-w-sm px-5 py-20 text-center">
        <p className="text-lg font-semibold">{me === null ? 'Sign in to bring in a price list.' : 'The price list is for the owner.'}</p>
        <Link href={me === null ? '/login' : '/'} className="press mt-4 inline-flex h-12 items-center rounded-field bg-action px-6 text-sm font-medium text-white">{me === null ? 'Sign in' : 'Back'}</Link>
      </main>
    );
  }

  const rows = preview?.rows.filter((r) => show === 'all' || (show === 'error' ? r.action === 'error' : r.action === 'new' || r.action === 'update')) ?? [];
  const canSave = !!preview && preview.counts.error === 0 && preview.counts.new + preview.counts.update > 0;
  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '12px clamp(10px, 2vw, 28px) 60px' }}>
      <StaffNav label="Staff" wide={1040} />
      <div style={{ maxWidth: 1040, margin: '22px auto 0', display: 'grid', gap: 14 }}>
        <header style={{ padding: '0 2px' }}>
          <h1 style={{ margin: 0, fontSize: 'clamp(26px, 3vw, 34px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-.03em' }}>Bring in the price list</h1>
          <p style={{ margin: '6px 0 0', maxWidth: 680, fontSize: 15, lineHeight: 1.5, color: '#434E5A' }}>In Excel, select the rows with the header row on top, copy, and paste them below. Or choose a CSV file. Nothing is saved until you press Save, and a product that already exists keeps anything you leave blank.</p>
        </header>

        {saved ? (
          <div className="card rise" role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: 18, background: '#F3FAF7', borderColor: 'rgba(13,148,101,.18)' }}>
            <span style={{ display: 'grid', placeItems: 'center', width: 30, height: 30, flex: 'none', borderRadius: 15, background: '#0D9465' }}><Tick size={17} /></span>
            <span style={{ flex: 1, minWidth: 220, fontSize: 15.5, fontWeight: 550 }}>Saved: {saved.new} new, {saved.update} changed. They are on the shop now.</span>
            <Link href="/shop" className="press" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 42, padding: '0 14px', borderRadius: 12, background: '#FFFFFF', border: '1px solid rgba(16,24,34,.12)', fontSize: 14, fontWeight: 500 }}>See the shop</Link>
          </div>
        ) : null}

        <section className="card rise" style={{ padding: 'clamp(16px, 3vw, 24px)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <label htmlFor="sheet" style={{ fontSize: 16, fontWeight: 600 }}>Paste the rows here</label>
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button type="button" onClick={download} className="press" style={{ minHeight: 40, padding: '0 12px', border: '1px solid rgba(16,24,34,.12)', borderRadius: 11, background: '#FFFFFF', font: '500 13.5px var(--sans)', cursor: 'pointer' }}>Get the template</button>
              <label className="press" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 40, padding: '0 12px', border: '1px solid rgba(16,24,34,.12)', borderRadius: 11, background: '#FFFFFF', fontSize: 13.5, fontWeight: 500, cursor: 'pointer' }}>
                Choose a CSV file
                <input type="file" accept=".csv,.txt,text/csv" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) edit(await f.text()); e.target.value = ''; }} />
              </label>
            </span>
          </div>
          <textarea id="sheet" value={text} onChange={(e) => edit(e.target.value)} spellCheck={false} placeholder={'SKU\tName\tKind\tPrice\tTrade price\n6205-2RS\t6205-2RS bearing\tBearings\t4800\t4200'} rows={8}
            style={{ width: '100%', boxSizing: 'border-box', marginTop: 12, padding: 14, border: '1px solid rgba(16,24,34,.14)', borderRadius: 14, background: '#FBFCFD', color: '#10161E', font: '13.5px/1.55 var(--mono)', resize: 'vertical', whiteSpace: 'pre', overflowX: 'auto' }} />
          {parsed ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', marginTop: 10, fontSize: 13.5, color: '#55606C' }}>
              <span className="tabular" style={{ fontWeight: 600, color: '#2A3441' }}>{parsed.rows.length} {parsed.rows.length === 1 ? 'line' : 'lines'}</span>
              {parsed.missing.length ? <span style={{ color: '#B42318', fontWeight: 550 }}>Needs a column for: {parsed.missing.join(', ')}.</span> : null}
              {parsed.ignored.length ? <span>Not used: {parsed.ignored.join(', ')}</span> : null}
            </div>
          ) : null}
          {error ? <p role="alert" style={{ margin: '12px 0 0', padding: '10px 12px', borderRadius: 12, background: '#FDF3E7', color: '#92400E', fontSize: 14 }}>{error}</p> : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button type="button" onClick={() => void look()} disabled={!parsed || parsed.missing.length > 0 || busy !== null} className="press" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 46, padding: '0 18px', border: 0, borderRadius: 13, background: !parsed || parsed.missing.length ? '#E6EAEE' : '#10161E', color: !parsed || parsed.missing.length ? '#8E99A4' : '#FFFFFF', font: '600 15px var(--sans)', cursor: 'pointer' }}>
              {busy === 'look' ? <><Spinner size={16} />Checking…</> : 'Check the list'}
            </button>
          </div>
        </section>

        {preview ? (
          <section aria-label="What the list will do" className="card rise" style={{ padding: 'clamp(16px, 3vw, 24px)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {(['new', 'update', 'same', 'error'] as const).map((a) => (
                <span key={a} className="tabular" style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, padding: '8px 12px', borderRadius: 12, background: badge[a][2], color: badge[a][1], fontSize: 14, fontWeight: 600 }}>
                  <span style={{ fontSize: 20, fontWeight: 650 }}>{preview.counts[a]}</span>{a === 'new' ? 'new' : a === 'update' ? 'with changes' : a === 'same' ? 'unchanged' : preview.counts.error === 1 ? 'problem' : 'problems'}
                </span>
              ))}
            </div>
            <div role="group" aria-label="Show" style={{ display: 'flex', gap: 4, marginTop: 14 }}>
              {([['all', 'All'], ['error', 'Problems'], ['change', 'New and changed']] as const).map(([v, l]) => (
                <button key={v} type="button" aria-pressed={show === v} onClick={() => setShow(v)} style={{ minHeight: 36, padding: '0 12px', border: 0, borderRadius: 10, background: show === v ? '#10161E' : '#F1F3F5', color: show === v ? '#FFFFFF' : '#2A3441', font: '500 13.5px var(--sans)', cursor: 'pointer' }}>{l}</button>
              ))}
            </div>
            <div style={{ marginTop: 10, overflowX: 'auto' }}>
              <table className="tabular" style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse', fontSize: 14 }}>
                <thead><tr style={{ textAlign: 'left', color: '#55606C', fontSize: 12.5 }}><th style={{ padding: '8px 6px', fontWeight: 550 }} title="The row number in your sheet">Row</th><th style={{ padding: '8px 6px', fontWeight: 550 }}>What happens</th><th style={{ padding: '8px 6px', fontWeight: 550 }}>Product</th><th style={{ padding: '8px 6px', fontWeight: 550, textAlign: 'right' }}>Price</th></tr></thead>
                <tbody>
                  {rows.slice(0, 300).map((r) => (
                    <tr key={r.line} style={{ borderTop: '1px solid rgba(16,24,34,.06)', verticalAlign: 'top' }}>
                      <td style={{ padding: '9px 6px', color: '#8E99A4' }}>{r.line + 1}</td>
                      <td style={{ padding: '9px 6px' }}><span style={{ padding: '2px 8px', borderRadius: 9, background: badge[r.action][2], color: badge[r.action][1], fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{badge[r.action][0]}</span></td>
                      <td style={{ padding: '9px 6px' }}>
                        <div style={{ fontWeight: 550 }}>{r.name ?? '—'}</div>
                        <div style={{ fontSize: 12.5, color: '#55606C', fontFamily: 'var(--mono)' }}>{r.sku ?? 'no SKU'}</div>
                        {r.problem ? <div style={{ marginTop: 3, fontSize: 13.5, color: '#B42318' }}>{r.problem}</div> : null}
                      </td>
                      <td style={{ padding: '9px 6px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {r.action === 'update' && r.price_before !== null && Number(r.price_before) !== Number(r.price) ? <span style={{ color: '#8E99A4', textDecoration: 'line-through', marginRight: 6 }}>{formatNaira(r.price_before)}</span> : null}
                        {typeof r.price === 'number' || (typeof r.price === 'string' && /^\d+$/.test(r.price)) ? formatNaira(r.price) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 300 ? <p style={{ margin: '10px 6px 0', fontSize: 13, color: '#55606C' }}>And {rows.length - 300} more lines like these.</p> : null}
              {rows.length === 0 ? <p style={{ margin: '10px 6px 0', fontSize: 14, color: '#55606C' }}>Nothing to show here.</p> : null}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(16,24,34,.07)' }}>
              <span style={{ fontSize: 14, color: preview.counts.error ? '#B42318' : '#434E5A' }}>
                {preview.counts.error ? 'Fix the problem lines in Excel, then paste again. Nothing is saved while any line has a problem.' : canSave ? 'Every line is fine. Saving puts them on the counter and the shop at once.' : 'Nothing new or changed to save.'}
              </span>
              <button type="button" onClick={() => void save()} disabled={!canSave || busy !== null} className="press" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 48, padding: '0 20px', border: 0, borderRadius: 14, background: canSave ? '#1B5CF0' : '#E6EAEE', color: canSave ? '#FFFFFF' : '#8E99A4', font: '600 15.5px var(--sans)', cursor: canSave ? 'pointer' : 'default', boxShadow: canSave ? '0 10px 24px rgba(27,92,240,.24)' : 'none' }}>
                {busy === 'save' ? <><Spinner size={16} />Saving…</> : `Save ${preview.counts.new + preview.counts.update} ${preview.counts.new + preview.counts.update === 1 ? 'product' : 'products'}`}
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
