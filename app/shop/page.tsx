'use client';

// The public catalogue: anyone can search, see today's shelf price and whether it is in stock,
// and ask for a quote without an account. Nothing here moves money or stock: a request is a note
// the counter turns into a real quote. The page never shows trade prices, costs or exact counts.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browserDb } from '@/lib/supabase';
import { friendly } from '@/lib/errors';
import { formatNaira } from '@/lib/money';
import { toQty } from '@/lib/quantity';
import { lineTotalKobo } from '@/lib/sale-math';
import { Spinner, Tick } from '@/components/kit/feel';
import { Mark } from '@/components/staff-nav';

type Item = { product: string; sku: string; name: string; family: string; unit: string; part_number: string | null; price: number | string; warranty_months: number;
  sizes: { bore: number | null; outside: number | null; width: number | null } | null; state: 'in' | 'low' | 'out' };
type Pick = { product: string; name: string; unit: string; price: number | string; qty: string };

const store = 'power-store-quote-list';
const examples = ['6205 2RS', '25 x 52 x 15', 'Car battery'];
const facts = ['Prices set by the shop today', 'Real stock from the shelves', 'No account, nothing to pay to ask'];
const stateText = { in: 'In stock', low: 'Only a few left', out: 'Out of stock' } as const;
const stateColor = { in: '#0A6E4B', low: '#92400E', out: '#55606C' } as const;
const stateBg = { in: 'rgba(238,249,244,.92)', low: 'rgba(253,243,231,.94)', out: 'rgba(241,243,245,.94)' } as const;
const label = { display: 'block', marginBottom: 5, fontSize: 13, fontWeight: 550, color: '#434E5A' } as const;
const field = { width: '100%', height: 48, boxSizing: 'border-box', padding: '0 14px', border: '1px solid rgba(16,24,34,.14)', borderRadius: 13, background: '#FFFFFF', color: '#10161E', font: '450 15.5px var(--sans)', outline: 'none' } as const;
const errorOf = (message: string) => { const [n, ...rest] = message.split(':'); return friendly(n, rest.join(':').trim()); };
// For the visitor's eyes only: the quote itself is priced by the database.
const estimate = (list: Pick[]) => list.reduce((s, p) => { try { return s + lineTotalKobo(BigInt(p.price), p.qty); } catch { return s; } }, 0n);
const local = (phone: string) => (phone.startsWith('234') ? `0${phone.slice(3)}` : phone);
const warranty = (m: number) => (m >= 12 && m % 12 === 0 ? `${m / 12} ${m === 12 ? 'year' : 'years'} warranty` : `${m} months warranty`);

// Naira large, kobo small: easier to read at a glance.
function Price({ kobo, size = 19 }: { kobo: bigint | number | string; size?: number }) {
  const [whole, frac] = formatNaira(kobo).split('.');
  return <span className="tabular" style={{ fontSize: size, fontWeight: 650, letterSpacing: '-.02em', whiteSpace: 'nowrap' }}>{whole}<span style={{ fontSize: Math.round(size * 0.64), fontWeight: 550, color: '#8E99A4' }}>.{frac}</span></span>;
}

// Drawn stand-ins until real photographs arrive: one quiet line drawing per kind of goods.
function Glyph({ family, name }: { family: string; name: string }) {
  const t = `${family} ${name}`.toLowerCase();
  const kind = /batter/.test(t) ? 'battery' : /solar|panel/.test(t) ? 'panel' : /bearing/.test(t) ? 'bearing' : /belt/.test(t) ? 'belt' : /chain/.test(t) ? 'chain' : 'box';
  const s = { fill: 'none', stroke: '#1B5CF0', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <svg aria-hidden="true" viewBox="0 0 96 64" width="100%" height="100%">
      {kind === 'battery' ? <g {...s}><rect x="22" y="18" width="52" height="34" rx="5" /><path d="M32 18v-5h8v5M56 18v-5h8v5M33 35h8M37 31v8M55 35h8" /></g> : null}
      {kind === 'panel' ? <g {...s}><path d="M18 46 28 16h44l8 30Z" /><path d="M38 16 34 46M52 16l-2 30M64 16l4 30M23 31h52" /><path d="M48 46v8M40 54h16" /></g> : null}
      {kind === 'bearing' ? <g {...s}><circle cx="48" cy="32" r="22" /><circle cx="48" cy="32" r="9" />{[0, 60, 120, 180, 240, 300].map((a) => <circle key={a} cx={48 + 15.5 * Math.cos((a * Math.PI) / 180)} cy={32 + 15.5 * Math.sin((a * Math.PI) / 180)} r="3.2" />)}</g> : null}
      {kind === 'belt' ? <g {...s}><rect x="14" y="18" width="68" height="28" rx="14" /><circle cx="28" cy="32" r="8" /><circle cx="68" cy="32" r="8" /></g> : null}
      {kind === 'chain' ? <g {...s}>{[14, 34, 54].map((x) => <rect key={x} x={x} y="24" width="28" height="16" rx="8" />)}</g> : null}
      {kind === 'box' ? <g {...s}><path d="M20 24 48 12l28 12v20L48 56 20 44Z" /><path d="M20 24l28 12 28-12M48 36v20" /></g> : null}
    </svg>
  );
}

export default function Shop() {
  const db = useRef(browserDb()).current;
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState<string | null>(null);
  const [data, setData] = useState<{ families: { family: string; count: number }[]; items: Item[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [findError, setFindError] = useState<string | null>(null);
  const [list, setList] = useState<Pick[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ no: string; phone: string } | null>(null);
  const [bump, setBump] = useState(0);
  const key = useRef<string | null>(null);
  const [shop, setShop] = useState<{ name: string | null; phone: string | null; address: string | null; hours: string | null } | null>(null);
  useEffect(() => { void db.rpc('shop_details').then(({ data }) => { if (data) setShop(data as NonNullable<typeof shop>); }); }, [db]);

  // The list is kept on this device only, so a visitor can come back to it.
  useEffect(() => { try { const saved = localStorage.getItem(store); if (saved) setList(JSON.parse(saved)); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem(store, JSON.stringify(list)); } catch {} }, [list]);

  // "/" jumps to the search, Escape closes the list on a phone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key !== '/' || (e.target as HTMLElement | null)?.closest('input, textarea')) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const t = setTimeout(async () => {
      const { data: d, error: e } = await db.rpc('catalogue', { p_query: query.trim() || null, p_family: family, p_limit: 48 });
      if (!live) return;
      setLoading(false);
      if (e) setFindError(errorOf(e.message));
      else { setFindError(null); setData(d as typeof data); }
    }, query ? 180 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [db, query, family]);

  const families = useMemo(() => data?.families ?? [], [data]);
  const total = useMemo(() => estimate(list), [list]);
  const inList = (id: string) => list.find((p) => p.product === id);
  const add = (it: Item) => {
    setSent(null);
    setList((cur) => (cur.some((p) => p.product === it.product) ? cur : [...cur, { product: it.product, name: it.name, unit: it.unit, price: it.price, qty: '1' }]));
    setBump((b) => b + 1);
  };
  const setQty = (id: string, qty: string) => setList((cur) => cur.flatMap((p) => (p.product !== id ? [p] : Number(qty) <= 0 ? [] : [{ ...p, qty }])));
  const step = (p: Pick, by: number) => setQty(p.product, String(Math.max(0, Math.round((Number(p.qty) + by) * 1000) / 1000)));
  const ready = form.name.trim() !== '' && form.phone.trim() !== '';

  const send = useCallback(async () => {
    if (busy || list.length === 0) return;
    setBusy(true);
    setError(null);
    key.current ??= crypto.randomUUID();
    let lines;
    try { lines = list.map((p) => ({ product_id: p.product, qty: Number(toQty(p.qty)) })); } catch { setBusy(false); setError(friendly('bad_qty', '')); return; }
    const { data: r, error: e } = await db.rpc('request_quote', { p_key: key.current, p_name: form.name, p_phone: form.phone, p_lines: lines, p_note: form.note || null, p_email: form.email || null });
    setBusy(false);
    if (e) { setError(errorOf(e.message)); return; }
    key.current = null;
    setSent({ no: (r as { request_no: string }).request_no, phone: form.phone });
    setList([]);
  }, [busy, list, db, form]);

  const count = list.length;
  const items = `${count} ${count === 1 ? 'item' : 'items'}`;
  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '12px clamp(10px, 2vw, 28px) 0', overflowX: 'clip' }}>
      <nav aria-label="Store" className="glass" style={{ position: 'sticky', top: 12, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '6px 8px 6px 12px', borderRadius: 18, maxWidth: 1240, margin: '0 auto' }}>
        <a href="#top" style={{ display: 'inline-flex', alignItems: 'center', gap: 9, minHeight: 44, fontWeight: 650, fontSize: 17, letterSpacing: '-.02em' }}><Mark />{shop?.name ?? 'Power Store'}</a>
        <button type="button" onClick={() => setOpen(true)} aria-label={`Quote list, ${items}`} className="press" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '0 10px 0 16px', border: 0, borderRadius: 13, background: '#10161E', color: '#FFFFFF', font: '500 14.5px var(--sans)', cursor: 'pointer' }}>
          Quote list
          <span key={bump} className={bump ? 'bump' : ''} style={{ display: 'grid', placeItems: 'center', minWidth: 24, height: 24, padding: '0 7px', boxSizing: 'border-box', borderRadius: 12, background: count ? '#1B5CF0' : 'rgba(255,255,255,.16)', fontSize: 12.5, fontWeight: 650 }}>{count}</span>
        </button>
      </nav>

      <div id="top" style={{ maxWidth: 1240, margin: '0 auto', display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: '999 1 560px', minWidth: 0 }}>
          <header style={{ position: 'relative', padding: 'clamp(30px, 5.5vw, 64px) 2px 20px' }}>
            <div aria-hidden="true" className="hero-glow" />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 12px 5px 10px', borderRadius: 20, background: 'rgba(255,255,255,.75)', border: '1px solid rgba(16,24,34,.07)', fontSize: 13, fontWeight: 550, color: '#2A3441' }}>
              <span className="livedot" style={{ width: 7, height: 7, borderRadius: 4, background: '#0D9465' }} />Stock shown live from the shop
            </span>
            <h1 style={{ margin: '16px 0 0', maxWidth: 740, fontSize: 'clamp(32px, 4.8vw, 56px)', lineHeight: 1.03, fontWeight: 600, letterSpacing: '-.038em' }}>Solar, batteries and power parts, <span style={{ color: '#1B5CF0' }}>at today&apos;s price.</span></h1>
            <p style={{ margin: '14px 0 0', maxWidth: 580, fontSize: 'clamp(15.5px, 1.6vw, 18px)', lineHeight: 1.5, color: '#434E5A' }}>Find the part however you know it: the number on the old one, its size, or its name. Add it to a list and the shop calls you with a quote.</p>
            <label htmlFor="q" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Search the shop</label>
            <div className="glass searchbar" style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: 740, marginTop: 24, padding: '6px 8px 6px 18px', borderRadius: 18 }}>
              <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" style={{ flex: 'none', fill: 'none', stroke: '#55606C', strokeWidth: 2, strokeLinecap: 'round' }}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
              <input ref={search} id="q" type="search" value={query} onChange={(e) => setQuery(e.target.value.slice(0, 80))} placeholder="Part number, size like 25 x 52 x 15, or a name" autoComplete="off" enterKeyHint="search" style={{ flex: 1, minWidth: 0, height: 50, border: 0, outline: 'none', background: 'transparent', color: '#10161E', font: '450 17px var(--sans)' }} />
              {query ? <button type="button" onClick={() => { setQuery(''); search.current?.focus(); }} aria-label="Clear the search" className="press" style={{ flex: 'none', width: 36, height: 36, border: 0, borderRadius: 10, background: '#F1F3F5', color: '#434E5A', fontSize: 17, cursor: 'pointer' }}>×</button>
                : <kbd className="kbd" aria-hidden="true" style={{ flex: 'none', padding: '3px 9px', borderRadius: 7, border: '1px solid rgba(16,24,34,.14)', background: '#FFFFFF', color: '#55606C', font: '500 12.5px var(--mono)' }}>/</kbd>}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 13.5, color: '#55606C' }}>
              <span>Try</span>
              {examples.map((e) => <button key={e} type="button" onClick={() => setQuery(e)} className="press" style={{ minHeight: 36, padding: '0 12px', border: '1px solid rgba(16,24,34,.1)', borderRadius: 18, background: 'rgba(255,255,255,.72)', color: '#10161E', font: '500 13.5px var(--mono)', cursor: 'pointer' }}>{e}</button>)}
            </div>
            <ul aria-label="Why ask here" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', listStyle: 'none', margin: '18px 0 0', padding: 0, fontSize: 13.5, color: '#434E5A' }}>
              {facts.map((f) => <li key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Tick size={15} stroke="#0D9465" />{f}</li>)}
            </ul>
          </header>

          <div role="group" aria-label="Kinds of goods" className="chips" style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '2px 2px 14px', scrollbarWidth: 'none' }}>
            {[{ family: null as string | null, label: 'Everything', n: families.reduce((s, f) => s + Number(f.count), 0) }, ...families.map((f) => ({ family: f.family as string | null, label: f.family, n: Number(f.count) }))].map((f) => {
              const on = family === f.family;
              return (
                <button key={f.label} type="button" aria-pressed={on} onClick={() => setFamily(f.family)} className="press" style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 7, minHeight: 40, padding: '0 8px 0 14px', border: `1px solid ${on ? '#10161E' : 'rgba(16,24,34,.1)'}`, borderRadius: 20, background: on ? '#10161E' : '#FFFFFF', color: on ? '#FFFFFF' : '#10161E', font: '500 14px var(--sans)', textTransform: 'capitalize', cursor: 'pointer' }}>
                  {f.label}<span className="tabular" style={{ minWidth: 22, padding: '1px 6px', boxSizing: 'border-box', borderRadius: 10, background: on ? 'rgba(255,255,255,.16)' : '#F1F3F5', fontSize: 12, fontWeight: 600, textAlign: 'center' }}>{f.n || '·'}</span>
                </button>
              );
            })}
          </div>

          <p aria-live="polite" style={{ minHeight: 20, margin: '0 2px 10px', fontSize: 14, color: findError ? '#92400E' : '#55606C' }}>
            {findError ?? (data === null ? 'Getting the shelves…' : loading ? 'Looking…' : data.items.length ? `${data.items.length} ${data.items.length === 1 ? 'item' : 'items'}${query.trim() ? ` for "${query.trim()}"` : ''}` : '')}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(224px, 1fr))', gap: 14, opacity: loading && data ? 0.55 : 1, transition: 'opacity .2s' }}>
            {data === null ? Array.from({ length: 6 }, (_, i) => (
              <div key={i} aria-hidden="true" className="card skel" style={{ padding: 14 }}>
                <div style={{ height: 124, borderRadius: 14, background: '#F1F3F5' }} />
                <div style={{ width: '70%', height: 14, marginTop: 16, borderRadius: 7, background: '#F1F3F5' }} />
                <div style={{ width: '45%', height: 12, marginTop: 9, borderRadius: 6, background: '#F1F3F5' }} />
                <div style={{ height: 46, marginTop: 26, borderRadius: 13, background: '#F1F3F5' }} />
              </div>
            )) : null}
            {data && data.items.length === 0 && !loading ? (
              <div className="card rise" style={{ gridColumn: '1 / -1', padding: '36px 20px', textAlign: 'center' }}>
                <div style={{ width: 96, height: 64, margin: '0 auto', opacity: 0.7 }}><Glyph family="" name="" /></div>
                <p style={{ margin: '12px 0 0', fontSize: 17, fontWeight: 600 }}>Nothing matches &ldquo;{query.trim()}&rdquo;.</p>
                <p style={{ margin: '6px auto 0', maxWidth: 420, fontSize: 14.5, lineHeight: 1.5, color: '#55606C' }}>Try the number printed on the old part, or its size in millimetres, like 25 x 52 x 15. The counter can often get what isn&apos;t listed.</p>
                <button type="button" onClick={() => { setQuery(''); setFamily(null); }} className="press" style={{ minHeight: 44, marginTop: 14, padding: '0 18px', border: '1px solid rgba(16,24,34,.14)', borderRadius: 13, background: '#FFFFFF', font: '500 14.5px var(--sans)', cursor: 'pointer' }}>Show everything</button>
              </div>
            ) : null}
            {data?.items.map((it, i) => {
              const picked = inList(it.product);
              const size = it.sizes && it.sizes.bore != null ? `${Number(it.sizes.bore)} × ${Number(it.sizes.outside)} × ${Number(it.sizes.width)} mm` : null;
              return (
                <article key={it.product} className="card rise item" style={{ display: 'flex', flexDirection: 'column', padding: 14, animationDelay: `${Math.min(i, 8) * 35}ms`, outline: picked ? '2px solid #1B5CF0' : 'none', outlineOffset: -1 }}>
                  <div className="item-art" style={{ position: 'relative', height: 124, borderRadius: 14, background: 'radial-gradient(90% 90% at 30% 20%, #F6F8FF 0%, #EDF0F4 100%)', padding: '22px 30px 16px', boxSizing: 'border-box', overflow: 'hidden' }}>
                    <Glyph family={it.family} name={it.name} />
                    <span style={{ position: 'absolute', left: 10, top: 10, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 10, background: stateBg[it.state], color: stateColor[it.state], fontSize: 12, fontWeight: 600 }}>
                      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 3, background: stateColor[it.state] }} />{stateText[it.state]}
                    </span>
                  </div>
                  <h2 style={{ margin: '13px 0 0', fontSize: 16, fontWeight: 600, letterSpacing: '-.012em', lineHeight: 1.3 }}>{it.name}</h2>
                  <div style={{ marginTop: 4, fontSize: 12.5, color: '#55606C', fontFamily: 'var(--mono)' }}>{[it.part_number, size].filter(Boolean).join(' · ') || it.sku}</div>
                  {it.warranty_months ? (
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 7, fontSize: 12.5, color: '#434E5A' }}>
                      <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" style={{ fill: 'none', stroke: '#434E5A', strokeWidth: 2, strokeLinejoin: 'round' }}><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6Z" /></svg>{warranty(it.warranty_months)}
                    </div>
                  ) : null}
                  <div style={{ flex: 1 }} />
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginTop: 14 }}>
                    <Price kobo={it.price} />
                    <span style={{ fontSize: 12.5, color: '#55606C' }}>{it.unit === 'metre' ? 'a metre, today' : 'today'}</span>
                  </div>
                  {picked ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10, minHeight: 46 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 550, color: '#0A6E4B' }}><Tick size={16} stroke="#0D9465" />On your list</span>
                      <Stepper pick={picked} onStep={step} />
                    </div>
                  ) : (
                    <button type="button" onClick={() => add(it)} className="press" style={{ minHeight: 46, marginTop: 10, border: 0, borderRadius: 13, background: it.state === 'out' ? '#10161E' : '#1B5CF0', color: '#FFFFFF', font: '600 15px var(--sans)', cursor: 'pointer' }}>{it.state === 'out' ? 'Ask for it' : 'Add to quote'}</button>
                  )}
                </article>
              );
            })}
          </div>
        </div>

        {open ? <button type="button" aria-hidden="true" tabIndex={-1} className="quote-scrim" onClick={() => setOpen(false)} /> : null}
        <aside aria-label="Your quote list" className={`glass quote-panel${open ? ' open' : ''}`} style={{ flex: '1 1 330px', minWidth: 0, boxSizing: 'border-box', padding: 20, borderRadius: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, fontSize: 19, fontWeight: 600, letterSpacing: '-.015em' }}>
              Your quote list{count ? <span className="tabular" style={{ padding: '2px 8px', borderRadius: 10, background: '#EAF0FE', color: '#1B5CF0', fontSize: 12.5, fontWeight: 650 }}>{count}</span> : null}
            </h2>
            <button type="button" onClick={() => setOpen(false)} className="quote-close" aria-label="Close the quote list" style={{ minWidth: 44, minHeight: 44, border: 0, borderRadius: 12, background: 'transparent', fontSize: 20, cursor: 'pointer' }}>×</button>
          </div>
          {sent ? (
            <div className="rise" aria-live="polite" style={{ marginTop: 14, padding: 18, borderRadius: 18, background: 'linear-gradient(160deg, #EEF9F4 0%, #F7FCFA 100%)', border: '1px solid rgba(13,148,101,.16)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 16.5, fontWeight: 600 }}>
                <span style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, flex: 'none', borderRadius: 14, background: '#0D9465' }}><Tick size={16} /></span>Request {sent.no} received
              </div>
              <ol style={{ margin: '14px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
                {['The counter checks stock and your price.', `We call you on ${sent.phone}.`, 'You pay nothing until you agree the quote.'].map((t, i) => (
                  <li key={t} style={{ display: 'flex', gap: 10, fontSize: 14.5, lineHeight: 1.45, color: '#2A3441' }}>
                    <span className="tabular" style={{ display: 'grid', placeItems: 'center', width: 22, height: 22, flex: 'none', borderRadius: 11, background: '#FFFFFF', border: '1px solid rgba(13,148,101,.25)', color: '#0A6E4B', fontSize: 12, fontWeight: 650 }}>{i + 1}</span>{t}
                  </li>
                ))}
              </ol>
              {shop?.phone ? <p style={{ margin: '12px 0 0', fontSize: 13.5, color: '#434E5A' }}>Questions before then? Call the shop on <a href={`tel:+${shop.phone}`} style={{ fontWeight: 600, color: '#0A6E4B' }}>{local(shop.phone)}</a>.</p> : null}
            </div>
          ) : null}
          {list.length === 0 && !sent ? (
            <div style={{ marginTop: 14, padding: '22px 16px', borderRadius: 16, border: '1.5px dashed rgba(16,24,34,.14)', textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Nothing on it yet</p>
              <p style={{ margin: '6px 0 0', fontSize: 14, lineHeight: 1.5, color: '#55606C' }}>Add what you need and the shop prices it for you. Trade customers get their trade prices in the quote.</p>
            </div>
          ) : null}
          {list.length ? (
            <>
              <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
                {list.map((p) => (
                  <li key={p.product} className="rise" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '11px 0', borderTop: '1px solid rgba(16,24,34,.07)' }}>
                    <div style={{ minWidth: 0 }}><div style={{ fontSize: 14.5, fontWeight: 550 }}>{p.name}</div><div className="tabular" style={{ marginTop: 2, fontSize: 13, color: '#55606C' }}>{formatNaira(p.price)}{p.unit === 'metre' ? ' a metre' : ' each'}</div></div>
                    <Stepper pick={p} onStep={step} />
                  </li>
                ))}
              </ul>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, padding: '12px 0 0', borderTop: '1px solid rgba(16,24,34,.07)' }}>
                <span style={{ fontSize: 14, color: '#434E5A' }}>At today&apos;s shelf prices</span>
                <Price kobo={total} size={20} />
              </div>
              <p style={{ margin: '3px 0 0', fontSize: 12.5, color: '#55606C' }}>Trade customers pay their trade price in the quote.</p>
              <form onSubmit={(e) => { e.preventDefault(); void send(); }} style={{ display: 'grid', gap: 10, marginTop: 16 }}>
                <div><label htmlFor="rq-name" style={label}>Your name</label><input id="rq-name" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.slice(0, 80) })} className="fld" style={field} /></div>
                <div><label htmlFor="rq-phone" style={label}>Phone number</label><input id="rq-phone" autoComplete="tel" inputMode="tel" placeholder="0803 123 4567" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.slice(0, 20) })} className="fld" style={field} /></div>
                <div><label htmlFor="rq-email" style={label}>Email <span style={{ fontWeight: 450, color: '#8E99A4' }}>if you like</span></label><input id="rq-email" autoComplete="email" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value.slice(0, 120) })} className="fld" style={field} /></div>
                <div><label htmlFor="rq-note" style={label}>Anything we should know <span style={{ fontWeight: 450, color: '#8E99A4' }}>if you like</span></label><textarea id="rq-note" placeholder="Where it is going, or when you need it" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value.slice(0, 500) })} rows={3} className="fld" style={{ ...field, height: 'auto', padding: '12px 14px', resize: 'vertical' }} /></div>
                {error ? <p role="alert" style={{ margin: 0, padding: '10px 12px', borderRadius: 12, background: '#FDF3E7', fontSize: 14, color: '#92400E' }}>{error}</p> : null}
                <button type="submit" disabled={busy || !ready} className="press" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, width: '100%', minHeight: 54, marginTop: 2, border: 0, borderRadius: 15, background: busy || !ready ? '#A3ADB8' : '#1B5CF0', boxShadow: busy || !ready ? 'none' : '0 10px 24px rgba(27,92,240,.26)', color: '#FFFFFF', font: '600 16.5px var(--sans)', cursor: busy || !ready ? 'default' : 'pointer' }}>
                  {busy ? <><Spinner size={18} />Sending…</> : 'Send request'}
                </button>
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45, color: '#55606C', textAlign: 'center' }}>No account needed. We only use your number to call you about this quote.</p>
              </form>
            </>
          ) : null}
        </aside>
      </div>

      <footer style={{ maxWidth: 1240, margin: '56px auto 0', padding: '20px 2px 110px', borderTop: '1px solid rgba(16,24,34,.08)', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, fontSize: 13.5, color: '#55606C' }}>
        <div style={{ display: 'grid', gap: 8 }}>
          {shop && (shop.phone || shop.address || shop.hours) ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 18px', color: '#2A3441' }}>
              {shop.phone ? <a href={`tel:+${shop.phone}`} style={{ fontWeight: 600 }}>Call {local(shop.phone)}</a> : null}
              {shop.phone ? <a href={`https://wa.me/${shop.phone}`} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, color: '#0A6E4B' }}>WhatsApp</a> : null}
              {shop.address ? <span>{shop.address}</span> : null}
              {shop.hours ? <span>{shop.hours}</span> : null}
            </div>
          ) : null}
          <span>Prices are today&apos;s shelf prices and can change. A quote holds its price for 7 days.</span>
        </div>
        <Link href="/login" style={{ color: '#434E5A', fontWeight: 500 }}>Staff sign in</Link>
      </footer>

      {count && !open ? (
        <div className="glass quote-bar rise">
          <span style={{ fontSize: 14.5, fontWeight: 550 }}>{items} · <Price kobo={total} size={15} /></span>
          <button type="button" onClick={() => setOpen(true)} className="press" style={{ minHeight: 44, padding: '0 18px', border: 0, borderRadius: 13, background: '#1B5CF0', color: '#FFFFFF', font: '600 15px var(--sans)', cursor: 'pointer' }}>Review and send</button>
        </div>
      ) : null}

      <style>{`
        @keyframes bumpy { 0% { transform: scale(1) } 40% { transform: scale(1.28) } 100% { transform: scale(1) } }
        .bump { animation: bumpy .32s cubic-bezier(.3,1.4,.5,1) }
        .hero-glow { position: absolute; z-index: -1; left: 0; right: 0; top: -30px; height: 360px; pointer-events: none;
          background: radial-gradient(42% 55% at 18% 38%, rgba(27,92,240,.10), transparent 70%), radial-gradient(30% 40% at 62% 20%, rgba(255,210,94,.12), transparent 70%); }
        .searchbar { transition: box-shadow .2s, border-color .2s; }
        .searchbar:focus-within { border-color: rgba(27,92,240,.35); box-shadow: 0 0 0 4px rgba(27,92,240,.12), 0 14px 32px rgba(16,24,34,.14); }
        .searchbar input:focus-visible { outline: none; }
        .chips::-webkit-scrollbar { display: none; }
        .fld { transition: border-color .18s, box-shadow .18s; }
        .fld:focus { border-color: #1B5CF0 !important; box-shadow: 0 0 0 4px rgba(27,92,240,.12); outline: none; }
        .item { transition: transform .24s cubic-bezier(.2,.7,.2,1), box-shadow .24s; }
        .item:hover { transform: translateY(-3px); box-shadow: 0 16px 36px rgba(16,24,34,.10); }
        .item-art svg { transition: transform .45s cubic-bezier(.2,.7,.2,1); }
        .item:hover .item-art svg { transform: scale(1.06); }
        .skel { position: relative; overflow: hidden; }
        .skel::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,.75), transparent); animation: sweep 1.15s ease-in-out infinite; }
        .quote-panel { position: sticky; top: 84px; max-height: calc(100vh - 100px); overflow: auto; }
        .quote-close, .quote-scrim, .quote-bar { display: none; }
        @media (max-width: 900px) {
          .quote-panel { position: fixed; left: 8px; right: 8px; bottom: 8px; top: auto; z-index: 40; max-height: 84vh; transform: translateY(calc(100% + 16px)); transition: transform .34s cubic-bezier(.3,1,.4,1); }
          .quote-panel.open { transform: none; }
          .glass.quote-panel { background: rgba(255,255,255,.97); }
          .quote-close { display: inline-block; }
          .quote-scrim { display: block; position: fixed; inset: 0; z-index: 35; border: 0; background: rgba(16,22,30,.32); }
          .quote-bar { display: flex; position: fixed; left: 10px; right: 10px; bottom: 10px; z-index: 30; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 7px 7px 16px; border-radius: 18px; }
          .kbd { display: none; }
        }
        @media (hover: none) { .item:hover { transform: none; box-shadow: none; } .item:hover .item-art svg { transform: none; } }
        @media (prefers-reduced-motion: reduce) { .bump, .skel::after { animation: none } .quote-panel, .item, .item-art svg { transition: none } .item:hover { transform: none } }
      `}</style>
    </main>
  );
}

function Stepper({ pick, onStep }: { pick: Pick; onStep: (p: Pick, by: number) => void }) {
  const by = pick.unit === 'metre' ? 0.5 : 1;
  return (
    <div role="group" aria-label={`Quantity of ${pick.name}`} style={{ flex: 'none', display: 'flex', alignItems: 'center', background: '#F1F3F5', borderRadius: 12 }}>
      <button type="button" aria-label={`One fewer: ${pick.name}`} onClick={() => onStep(pick, -by)} className="press" style={{ width: 40, height: 40, border: 0, borderRadius: 12, background: 'transparent', fontSize: 18, cursor: 'pointer' }}>−</button>
      <span aria-live="polite" className="tabular" style={{ minWidth: 26, textAlign: 'center', fontSize: 15, fontWeight: 600 }}>{pick.qty}</span>
      <button type="button" aria-label={`One more: ${pick.name}`} onClick={() => onStep(pick, by)} className="press" style={{ width: 40, height: 40, border: 0, borderRadius: 12, background: 'transparent', fontSize: 18, cursor: 'pointer' }}>+</button>
    </div>
  );
}
