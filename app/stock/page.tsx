'use client';

// The stock room, ported from StockRoom.dc.html: receive, pack, count. Storekeepers see the work,
// never shelf figures or costs, so counts stay blind. Every write goes to the same functions the
// rest of the shop uses, with one key per tap so a retry on a bad network records once.
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserDb } from '@/lib/supabase';
import { friendly } from '@/lib/errors';
import { toQty } from '@/lib/quantity';
import { Tick } from '@/components/kit/feel';

type Tab = 'receive' | 'pack' | 'count';
type Hit = { product: string; sku: string; name: string; part_number: string | null };
type RecvLine = { productId: string; name: string; sku: string; serial: boolean; unit: string; qty: string; serials: string[]; madeOn: string };
type PackLine = { product_id: string; sku: string; name: string; unit: string; tracking: string; remaining: number | string; oldest: string[] | null };
type PackOrder = { order_id: string; invoice_no: string | null; customer: string | null; channel: string; created_on: string; on_credit: boolean; lines: PackLine[] };
type CountLine = { product_id: string; sku: string; name: string; unit: string; last_counted_on: string | null };

const allowed: Record<Tab, string[]> = {
  receive: ['owner', 'storekeeper', 'accountant'],
  pack: ['owner', 'storekeeper', 'dispatcher', 'counter'],
  count: ['owner', 'storekeeper'],
};
const tabLabel: Record<Tab, string> = { receive: 'Receive', pack: 'Pack', count: 'Count' };
const field = { width: '100%', height: 52, boxSizing: 'border-box', padding: '0 16px', border: '1.5px solid #10161E', borderRadius: 14, background: '#FFFFFF', color: '#10161E', font: "500 17px 'Geist Mono', monospace" } as const;
const ghost = { minHeight: 44, padding: '0 14px', border: '1px solid rgba(16,24,34,.16)', borderRadius: 12, background: '#FFFFFF', color: '#10161E', font: '500 14px Geist, system-ui, sans-serif', cursor: 'pointer' } as const;
const solid = (on: boolean) => ({ width: '100%', minHeight: 56, marginTop: 14, border: 0, borderRadius: 15, background: on ? '#1B5CF0' : '#8E99A4', color: '#FFFFFF', font: '600 17px Geist, system-ui, sans-serif', cursor: on ? 'pointer' : 'default' }) as const;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function StockRoom() {
  const db = useRef(browserDb()).current;
  const [me, setMe] = useState<undefined | null | { role: string | null; name: string }>(undefined);
  const [tab, setTab] = useState<Tab>('receive');
  const [locations, setLocations] = useState<{ id: string; name: string; kind: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const showError = useCallback((msg: string) => {
    const [name, ...rest] = msg.split(':');
    setError(friendly(name, rest.join(':').trim()));
  }, []);

  useEffect(() => {
    (async () => {
      const { data: s } = await db.auth.getSession();
      if (!s.session) { setMe(null); return; }
      const staff = await db.from('staff').select('role, name').eq('id', s.session.user.id).maybeSingle();
      const role = staff.data?.role ?? null;
      setMe({ role, name: staff.data?.name ?? '' });
      const first = (['receive', 'pack', 'count'] as Tab[]).find((t) => role && allowed[t].includes(role));
      if (first) setTab(first);
      const locs = await db.from('locations').select('id, name, kind').order('name');
      setLocations((locs.data ?? []).sort((a, b) => (a.kind === 'shop' ? -1 : 0) - (b.kind === 'shop' ? -1 : 0)));
    })();
  }, [db]);

  if (me === undefined) return <main style={{ minHeight: '100vh' }} aria-busy="true" />;
  const tabs = (['receive', 'pack', 'count'] as Tab[]).filter((t) => me?.role && allowed[t].includes(me.role));
  if (me === null || tabs.length === 0) {
    return (
      <main className="mx-auto max-w-sm px-5 py-20 text-center">
        <p className="text-lg font-semibold">{me === null ? 'Sign in to work the stock room.' : 'The stock room is for stock and counter staff.'}</p>
        <Link href={me === null ? '/login' : '/'} className="press mt-4 inline-flex h-12 items-center rounded-field bg-action px-6 text-sm font-medium text-white">{me === null ? 'Sign in' : 'Back'}</Link>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '12px clamp(10px, 2vw, 28px) 40px' }}>
      <nav aria-label="Staff" className="glass" style={{ position: 'sticky', top: 12, zIndex: 30, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '4px 14px', padding: '6px 12px 6px 18px', borderRadius: 18, maxWidth: 980, margin: '0 auto' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, fontWeight: 650, fontSize: 17, letterSpacing: '-.02em' }}>Stock room</span>
        <div role="group" aria-label="Stock room" style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${tabs.length}, 104px)`, padding: 3, background: 'rgba(16,24,34,.07)', borderRadius: 12 }}>
          <span aria-hidden="true" style={{ position: 'absolute', top: 3, bottom: 3, left: 3, width: 104, background: '#FFFFFF', borderRadius: 9, boxShadow: '0 1px 2px rgba(16,24,34,.12), 0 4px 10px rgba(16,24,34,.08)', transform: `translateX(${tabs.indexOf(tab) * 104}px)`, transition: 'transform .28s cubic-bezier(.3,1.2,.5,1)' }} />
          {tabs.map((t) => (
            <button key={t} type="button" aria-pressed={tab === t} onClick={() => { setError(null); setTab(t); }} style={{ position: 'relative', height: 40, border: 0, background: 'transparent', color: '#10161E', font: '500 14px Geist, system-ui, sans-serif', cursor: 'pointer' }}>{tabLabel[t]}</button>
          ))}
        </div>
        <span style={{ fontSize: 13.5, color: '#434E5A' }}>{me.name}{locations[0] ? ` · ${locations[0].name}` : ''}</span>
      </nav>
      <div style={{ maxWidth: 980, margin: '18px auto 0' }}>
        {error ? <p role="alert" style={{ margin: '0 2px 12px', padding: '10px 14px', borderRadius: 12, background: '#FDF3E7', color: '#92400E', fontSize: 14.5 }}>{error}</p> : null}
        {tab === 'receive' ? <Receive db={db} locations={locations} onError={showError} clearError={() => setError(null)} /> : null}
        {tab === 'pack' ? <Pack db={db} onError={showError} clearError={() => setError(null)} /> : null}
        {tab === 'count' ? <Count db={db} locations={locations} onError={showError} clearError={() => setError(null)} /> : null}
      </div>
    </main>
  );
}

type Db = ReturnType<typeof browserDb>;
type Props = { db: Db; onError: (m: string) => void; clearError: () => void };

// A search box that works with a barcode scanner: an Enter before the answer waits for it, and
// only the answer for what is in the box counts.
function PartSearch({ db, onPick, label }: { db: Db; onPick: (h: Hit) => void; label: string }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [hitsFor, setHitsFor] = useState('');
  const pending = useRef(false);
  const pick = useCallback((h: Hit) => { onPick(h); setQ(''); setHits([]); setHitsFor(''); }, [onPick]);
  useEffect(() => {
    const term = q.trim();
    if (!term) { setHits([]); setHitsFor(''); return; }
    let live = true;
    const t = setTimeout(async () => {
      const { data, error } = await db.rpc('search_parts', { p_query: term, p_limit: 4 });
      if (!live || error) return;
      const rows = (data ?? []) as Hit[];
      setHits(rows);
      setHitsFor(term);
      if (pending.current && rows.length) { pending.current = false; pick(rows[0]); }
    }, 120);
    return () => { live = false; clearTimeout(t); };
  }, [q, db, pick]);
  return (
    <div>
      <label htmlFor="part" style={{ display: 'block', marginBottom: 7, fontSize: 14.5, fontWeight: 600 }}>{label}</label>
      <input id="part" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" placeholder="Scan the barcode, or type 6205 2rs" style={field}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (hitsFor === q.trim() && hits.length) pick(hits[0]);
          else if (q.trim()) pending.current = true;
        }} />
      {hits.length ? (
        <div role="listbox" aria-label="Matching parts" style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
          {hits.map((h) => (
            <button key={h.product} type="button" role="option" aria-selected={false} onClick={() => pick(h)} className="press" style={{ minHeight: 48, padding: '6px 12px', border: 0, borderRadius: 11, background: '#F4F6F8', color: '#10161E', textAlign: 'left', font: '500 15px Geist, system-ui, sans-serif', cursor: 'pointer' }}>
              {h.name} <span style={{ color: '#55606C', fontWeight: 400, fontSize: 13 }}>{h.part_number ?? h.sku}</span>
            </button>
          ))}
        </div>
      ) : null}
      {q.trim() && hitsFor === q.trim() && hits.length === 0 ? <p style={{ margin: '8px 0 0', fontSize: 14, color: '#92400E' }}>Nothing matches. Check the number, or search by size.</p> : null}
    </div>
  );
}

function Receive({ db, locations, onError, clearError }: Props & { locations: { id: string; name: string }[] }) {
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [supplier, setSupplier] = useState('');
  const [location, setLocation] = useState('');
  const [lines, setLines] = useState<RecvLine[]>([]);
  const [scan, setScan] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const key = useRef<string | null>(null);

  useEffect(() => {
    void db.from('suppliers').select('id, name').order('name').then(({ data }) => { setSuppliers(data ?? []); if (data?.[0]) setSupplier((s) => s || data[0].id); });
  }, [db]);
  useEffect(() => { if (!location && locations[0]) setLocation(locations[0].id); }, [locations, location]);

  const add = useCallback(async (h: Hit) => {
    setDone(null);
    const { data } = await db.from('products').select('tracking, unit').eq('id', h.product).maybeSingle();
    setLines((cur) => (cur.some((l) => l.productId === h.product) ? cur
      : [...cur, { productId: h.product, name: h.name, sku: h.sku, serial: data?.tracking === 'serial', unit: data?.unit ?? 'each', qty: data?.tracking === 'serial' ? '0' : '1', serials: [], madeOn: '' }]));
  }, [db]);
  const update = (id: string, patch: Partial<RecvLine>) => setLines((cur) => cur.map((l) => (l.productId === id ? { ...l, ...patch } : l)));

  const scanSerial = (l: RecvLine) => {
    const code = (scan[l.productId] ?? '').trim().toUpperCase();
    if (!code) return;
    if (lines.some((x) => x.serials.includes(code))) { setNote(`${code} was already scanned.`); return; }
    update(l.productId, { serials: [...l.serials, code], qty: String(l.serials.length + 1) });
    setScan((s) => ({ ...s, [l.productId]: '' }));
    setNote(`${code} received.`);
  };

  const units = lines.reduce((s, l) => s + (l.serial ? l.serials.length : Number(l.qty) || 0), 0);
  const ready = !busy && supplier !== '' && location !== '' && lines.length > 0 && lines.every((l) => (l.serial ? l.serials.length > 0 : Number(l.qty) > 0));

  const finish = async () => {
    if (!ready) return;
    setBusy(true);
    clearError();
    key.current ??= crypto.randomUUID();
    let payload;
    try {
      payload = lines.map((l) => ({ product_id: l.productId, qty: l.serial ? l.serials.length : Number(toQty(l.qty)), ...(l.serial ? { serials: l.serials } : {}), ...(l.madeOn ? { made_on: l.madeOn } : {}) }));
    } catch {
      setBusy(false);
      onError('bad_qty');
      return;
    }
    const { error } = await db.rpc('receive_goods', { p_key: key.current, p_supplier: supplier, p_location: location, p_lines: payload });
    setBusy(false);
    if (error) { onError(error.message); return; }
    key.current = null;
    setDone(`${plural(units, 'item')} on ${plural(lines.length, 'line')} into ${locations.find((x) => x.id === location)?.name ?? 'the shelf'}.`);
    setLines([]);
    setNote(null);
  };

  return (
    <section aria-labelledby="r1" className="rise">
      <h1 id="r1" style={{ margin: '0 2px', fontSize: 'clamp(24px, 3vw, 32px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-.028em' }}>Receive a delivery</h1>
      <p style={{ margin: '6px 2px 14px', fontSize: 15, lineHeight: 1.45, color: '#434E5A' }}>Scan each unit as it comes off the truck. Damaged goods stay on the truck and go back on the supplier&apos;s note.</p>
      <div className="card" style={{ padding: 18, display: 'grid', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6, fontSize: 14, fontWeight: 550 }}>From
            <select value={supplier} onChange={(e) => setSupplier(e.target.value)} style={{ ...field, font: '500 15px Geist, system-ui, sans-serif', border: '1px solid rgba(16,24,34,.16)' }}>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 6, fontSize: 14, fontWeight: 550 }}>Into
            <select value={location} onChange={(e) => setLocation(e.target.value)} style={{ ...field, font: '500 15px Geist, system-ui, sans-serif', border: '1px solid rgba(16,24,34,.16)' }}>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        </div>
        <PartSearch db={db} onPick={(h) => void add(h)} label="Add a part" />
      </div>

      {lines.length ? (
        <div className="card" style={{ marginTop: 12, padding: '6px 18px' }}>
          {lines.map((l) => (
            <div key={l.productId} className="rise" style={{ padding: '12px 0', borderBottom: '1px solid #F1F3F5' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 550 }}>{l.name}</div>
                  <div style={{ fontSize: 13, color: '#55606C' }}>{l.serial ? `${plural(l.serials.length, 'unit')} scanned` : l.unit === 'metre' ? 'Metres received' : 'Quantity received'}</div>
                </div>
                {l.serial ? null : (
                  <input inputMode="decimal" aria-label={`Quantity received of ${l.name}`} value={l.qty} onChange={(e) => update(l.productId, { qty: e.target.value.replace(/[^\d.]/g, '').slice(0, 10) })} className="tabular" style={{ width: 110, height: 46, boxSizing: 'border-box', padding: '0 12px', border: '1px solid rgba(16,24,34,.16)', borderRadius: 12, textAlign: 'right', font: '600 16px Geist, system-ui, sans-serif' }} />
                )}
                <button type="button" onClick={() => setLines((cur) => cur.filter((x) => x.productId !== l.productId))} style={ghost}>Remove</button>
              </div>
              {l.serial ? (
                <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input aria-label={`Scan a serial for ${l.name}`} value={scan[l.productId] ?? ''} onChange={(e) => setScan((s) => ({ ...s, [l.productId]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); scanSerial(l); } }} autoComplete="off" placeholder="Scan the serial, then Enter" style={{ ...field, flex: '1 1 220px', height: 46, fontSize: 15 }} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, color: '#434E5A' }}>Made on
                      <input type="date" value={l.madeOn} onChange={(e) => update(l.productId, { madeOn: e.target.value })} style={{ height: 46, padding: '0 10px', border: '1px solid rgba(16,24,34,.16)', borderRadius: 12, font: '500 14px Geist, system-ui, sans-serif' }} />
                    </label>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {l.serials.map((s) => (
                      <button key={s} type="button" aria-label={`Remove ${s}`} onClick={() => update(l.productId, { serials: l.serials.filter((x) => x !== s) })} className="press rise" style={{ minHeight: 36, padding: '0 10px', border: 0, borderRadius: 9, background: '#10161E', color: '#FFFFFF', font: "500 13px 'Geist Mono', monospace", cursor: 'pointer' }}>{s} ×</button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
          <p aria-live="polite" style={{ minHeight: 18, margin: '8px 0 0', fontSize: 13.5, color: '#434E5A' }}>{note}</p>
        </div>
      ) : null}

      {done ? (
        <div className="card rise" aria-live="polite" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, padding: 18, background: '#EEF9F4', fontSize: 15.5 }}>
          <Tick size={22} stroke="#0D9465" /><span><b style={{ fontWeight: 600 }}>Recorded.</b> {done}</span>
        </div>
      ) : null}
      <button type="button" onClick={() => void finish()} disabled={!ready} className="press" style={solid(ready)}>
        {busy ? 'Recording…' : lines.length ? `Finish, with ${plural(units, 'item')}` : 'Add the first part'}
      </button>
    </section>
  );
}

function Pack({ db, onError, clearError }: Props) {
  const [list, setList] = useState<{ ready: PackOrder[]; waiting_for_money: number } | null>(null);
  const [open, setOpen] = useState<PackOrder | null>(null);
  const [picked, setPicked] = useState<Record<string, string[] | true>>({});
  const [scan, setScan] = useState('');
  const [warn, setWarn] = useState<{ code: string; productId: string; first: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const key = useRef<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await db.rpc('pack_list');
    if (error) onError(error.message);
    else setList(data as { ready: PackOrder[]; waiting_for_money: number });
  }, [db, onError]);
  useEffect(() => { void load(); }, [load]);

  const need = (l: PackLine) => Math.ceil(Number(l.remaining));
  const isDone = (l: PackLine) => (l.tracking === 'serial' ? ((picked[l.product_id] as string[] | undefined)?.length ?? 0) >= need(l) : picked[l.product_id] === true);
  const doneCount = open ? open.lines.filter(isDone).length : 0;
  const allDone = open !== null && doneCount === open.lines.length;

  const take = (productId: string, code: string) => {
    setPicked((p) => ({ ...p, [productId]: [...((p[productId] as string[] | undefined) ?? []), code] }));
    setWarn(null);
    setMsg(`${code} picked.`);
    setScan('');
  };
  const onScan = () => {
    if (!open) return;
    const code = scan.trim().toUpperCase();
    if (!code) return;
    const taken = Object.values(picked).flatMap((v) => (Array.isArray(v) ? v : []));
    if (taken.includes(code)) { setMsg(`${code} is already picked.`); setScan(''); return; }
    const line = open.lines.find((l) => l.tracking === 'serial' && !isDone(l) && (l.oldest ?? []).includes(code))
      ?? open.lines.find((l) => l.tracking === 'serial' && !isDone(l));
    if (!line) { setMsg(`${code} is not on this order, or that line is already picked.`); setScan(''); return; }
    // Oldest first, so batteries never sit until they go flat. A newer unit can still go, on purpose.
    const first = (line.oldest ?? []).find((s) => !taken.includes(s));
    if (first && first !== code) { setWarn({ code, productId: line.product_id, first }); setScan(''); return; }
    take(line.product_id, code);
  };

  const handOver = async () => {
    if (!open || !allDone || busy) return;
    setBusy(true);
    clearError();
    key.current ??= crypto.randomUUID();
    const lines = open.lines.map((l) => ({ product_id: l.product_id, qty: Number(l.remaining), ...(l.tracking === 'serial' ? { serials: picked[l.product_id] as string[] } : {}) }));
    const { error } = await db.rpc('deliver_order', { p_key: key.current, p_order: open.order_id, p_lines: lines });
    setBusy(false);
    if (error) { onError(error.message); return; }
    key.current = null;
    setDone(`${open.invoice_no ?? 'The order'} is packed and handed over${open.customer ? ` for ${open.customer}` : ''}.`);
    setOpen(null);
    setPicked({});
    void load();
  };

  if (!open) {
    return (
      <section aria-labelledby="p0" className="rise">
        <h1 id="p0" style={{ margin: '0 2px', fontSize: 'clamp(24px, 3vw, 32px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-.028em' }}>{list ? (list.ready.length ? `${plural(list.ready.length, 'order')} to pack` : 'Nothing to pack') : 'Getting the orders…'}</h1>
        <p style={{ margin: '6px 2px 14px', fontSize: 15, color: '#434E5A' }}>{list && list.waiting_for_money > 0 ? `${plural(list.waiting_for_money, 'order')} still waiting for their money. They appear here once it is in.` : 'Only orders whose money is in.'}</p>
        {done ? <div className="card rise" aria-live="polite" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, padding: 18, background: '#EEF9F4', fontSize: 15.5 }}><Tick size={22} stroke="#0D9465" />{done}</div> : null}
        <div style={{ display: 'grid', gap: 10 }}>
          {list?.ready.map((o) => (
            <button key={o.order_id} type="button" onClick={() => { setDone(null); setMsg(null); setPicked({}); setOpen(o); }} className="card press" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 18, textAlign: 'left', cursor: 'pointer', color: '#10161E', font: 'inherit' }}>
              <span>
                <span style={{ display: 'block', fontSize: 16.5, fontWeight: 600 }}>{o.invoice_no ?? 'Order'}{o.customer ? ` for ${o.customer}` : ''}</span>
                <span style={{ display: 'block', marginTop: 2, fontSize: 13.5, color: '#55606C' }}>{plural(o.lines.length, 'line')} · {o.channel === 'counter' ? 'At the counter' : o.channel === 'phone' ? 'Phone order' : 'Online order'}{o.on_credit ? ' · On account' : ''}</span>
              </span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#1B5CF0' }}>Pack</span>
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="p1" className="rise">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <h1 id="p1" style={{ margin: '0 2px', fontSize: 'clamp(24px, 3vw, 32px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-.028em' }}>Packing {open.invoice_no}</h1>
          <p aria-live="polite" style={{ margin: '6px 2px 0', fontSize: 15, color: '#434E5A' }}>{doneCount} of {open.lines.length} picked{open.customer ? `, for ${open.customer}` : ''}.</p>
        </div>
        <button type="button" onClick={() => { setOpen(null); setPicked({}); }} style={ghost}>Back to the list</button>
      </div>
      <div className="card" style={{ marginTop: 14, padding: 18 }}>
        <label htmlFor="ps" style={{ display: 'block', marginBottom: 7, fontSize: 14.5, fontWeight: 600 }}>Scan what you pick up</label>
        <input id="ps" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onScan(); } }} autoComplete="off" placeholder="Scan the unit, then Enter" style={field} />
        {warn ? (
          <div role="alert" className="rise" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 10, padding: '10px 12px', borderRadius: 12, background: '#FDF3E7' }}>
            <span style={{ fontSize: 14, color: '#92400E' }}>Take {warn.first} first. It is older, so it should leave before {warn.code}.</span>
            <button type="button" onClick={() => take(warn.productId, warn.code)} style={ghost}>Use it anyway</button>
          </div>
        ) : null}
        <p aria-live="polite" style={{ minHeight: 18, margin: '8px 0 0', fontSize: 13.5, color: '#434E5A' }}>{msg}</p>
        <ol style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
          {open.lines.map((l) => {
            const ok = isDone(l);
            const got = (picked[l.product_id] as string[] | undefined) ?? [];
            return (
              <li key={l.product_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid #F1F3F5' }}>
                <span aria-hidden="true" style={{ flex: 'none', display: 'grid', placeItems: 'center', width: 26, height: 26, borderRadius: 13, background: ok ? '#0D9465' : '#F1F3F5', transition: 'background .2s' }}>{ok ? <Tick size={15} /> : null}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 550 }}>{l.name}</div>
                  <div style={{ fontSize: 13, color: '#55606C' }}>
                    {l.tracking === 'serial'
                      ? `${got.length} of ${need(l)} scanned${(l.oldest ?? []).length ? `. Oldest first: ${(l.oldest ?? []).filter((s) => !got.includes(s)).slice(0, 3).join(', ')}` : ''}`
                      : `Take ${String(Number(l.remaining))}${l.unit === 'metre' ? ' m' : ''}`}
                  </div>
                </div>
                {l.tracking !== 'serial' && !ok ? <button type="button" onClick={() => setPicked((p) => ({ ...p, [l.product_id]: true }))} style={ghost}>Picked</button> : null}
              </li>
            );
          })}
        </ol>
      </div>
      {allDone ? <p className="rise" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 2px 0', fontSize: 15, fontWeight: 550, color: '#0A6E4B' }}><Tick size={18} stroke="#0D9465" />Ready to hand over</p> : null}
      <button type="button" onClick={() => void handOver()} disabled={!allDone || busy} className="press" style={solid(allDone && !busy)}>{busy ? 'Recording…' : allDone ? 'Hand over' : 'Pick every line first'}</button>
    </section>
  );
}

function Count({ db, locations, onError, clearError }: Props & { locations: { id: string; name: string }[] }) {
  const [location, setLocation] = useState('');
  const [lines, setLines] = useState<CountLine[] | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const key = useRef<string | null>(null);

  useEffect(() => { if (!location && locations[0]) setLocation(locations[0].id); }, [locations, location]);
  useEffect(() => {
    if (!location) return;
    setLines(null);
    setVals({});
    setSent(false);
    void db.rpc('count_list', { p_location: location, p_limit: 8 }).then(({ data, error }) => { if (error) onError(error.message); else setLines(data as CountLine[]); });
  }, [db, location, onError]);

  const filled = lines !== null && lines.length > 0 && lines.every((l) => (vals[l.product_id] ?? '').trim() !== '');
  const finish = async () => {
    if (!lines || !filled || busy) return;
    setBusy(true);
    clearError();
    key.current ??= crypto.randomUUID();
    const { error } = await db.rpc('submit_stock_count', { p_key: key.current, p_location: location, p_lines: lines.map((l) => ({ product_id: l.product_id, counted: Number(vals[l.product_id]) })) });
    setBusy(false);
    if (error) { onError(error.message); return; }
    key.current = null;
    setSent(true);
  };

  return (
    <section aria-labelledby="c1" className="rise">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <h1 id="c1" style={{ margin: '0 2px', fontSize: 'clamp(24px, 3vw, 32px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-.028em' }}>Count the shelf</h1>
          <p style={{ margin: '6px 2px 0', fontSize: 15, lineHeight: 1.45, color: '#434E5A' }}>Count what you see, and type it. Nobody is shown what the books expect, so nobody counts to match.</p>
        </div>
        <select aria-label="Which shelf" value={location} onChange={(e) => setLocation(e.target.value)} style={{ height: 46, padding: '0 12px', border: '1px solid rgba(16,24,34,.16)', borderRadius: 12, background: '#FFFFFF', font: '500 15px Geist, system-ui, sans-serif' }}>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>
      <div className="card" style={{ marginTop: 14, padding: '6px 18px' }}>
        {lines === null ? <p className="sub" style={{ padding: '12px 0' }}>Getting the list…</p> : null}
        {lines && lines.length === 0 ? <p className="sub" style={{ padding: '12px 0' }}>Nothing on this shelf to count.</p> : null}
        {lines?.map((l) => (
          <div key={l.product_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: '1px solid #F1F3F5' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15.5, fontWeight: 550 }}>{l.name}</div>
              <div style={{ fontSize: 13, color: '#55606C' }}>{l.last_counted_on ? `Last counted ${l.last_counted_on}` : 'Never counted'}{l.unit === 'metre' ? ' · in metres' : ''}</div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#434E5A' }}>Counted
              <input inputMode={l.unit === 'metre' ? 'decimal' : 'numeric'} aria-label={`Count of ${l.name}`} disabled={sent} value={vals[l.product_id] ?? ''} onChange={(e) => setVals((v) => ({ ...v, [l.product_id]: e.target.value.replace(l.unit === 'metre' ? /[^\d.]/g : /\D/g, '').slice(0, 9) }))} className="tabular" style={{ width: 96, height: 46, boxSizing: 'border-box', padding: '0 12px', border: '1px solid rgba(16,24,34,.16)', borderRadius: 12, textAlign: 'right', font: '600 16px Geist, system-ui, sans-serif' }} />
            </label>
          </div>
        ))}
      </div>
      {sent ? (
        <div className="card rise" aria-live="polite" style={{ marginTop: 12, padding: 18, background: '#EEF9F4' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 17, fontWeight: 600 }}><Tick size={22} stroke="#0D9465" />Sent to the owner.</div>
          <p style={{ margin: '6px 0 0', fontSize: 14, lineHeight: 1.45, color: '#434E5A' }}>Stock does not change until they approve the count.</p>
        </div>
      ) : (
        <button type="button" onClick={() => void finish()} disabled={!filled || busy} className="press" style={solid(filled && !busy)}>{busy ? 'Sending…' : filled ? 'Finish the count' : 'Count every line first'}</button>
      )}
    </section>
  );
}
