'use client';

// The public catalogue: anyone can search, see today's shelf price and whether it is in stock,
// and ask for a quote without an account. Nothing here moves money or stock: a request is a note
// the counter turns into a real quote. The page never shows trade prices, costs or exact counts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browserDb } from '@/lib/supabase';
import { friendly } from '@/lib/errors';
import { formatNaira } from '@/lib/money';
import { toQty } from '@/lib/quantity';
import { Tick } from '@/components/kit/feel';

type Item = { product: string; sku: string; name: string; family: string; unit: string; part_number: string | null; price: number | string; warranty_months: number;
  sizes: { bore: number | null; outside: number | null; width: number | null } | null; state: 'in' | 'low' | 'out' };
type Pick = { product: string; name: string; unit: string; price: number | string; qty: string };

const store = 'power-store-quote-list';
const examples = ['6205 2RS', '25 x 52 x 15', 'Car battery'];
const stateText = { in: 'In stock', low: 'Only a few left', out: 'Out of stock, ask us' } as const;
const stateColor = { in: '#0A6E4B', low: '#92400E', out: '#55606C' } as const;
const stateBg = { in: '#EEF9F4', low: '#FDF3E7', out: '#F1F3F5' } as const;
const field = { width: '100%', height: 48, boxSizing: 'border-box', padding: '0 14px', border: '1px solid rgba(16,24,34,.16)', borderRadius: 13, background: '#FFFFFF', color: '#10161E', font: '450 15.5px Geist, system-ui, sans-serif' } as const;

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
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState<string | null>(null);
  const [data, setData] = useState<{ families: { family: string; count: number }[]; items: Item[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<Pick[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ no: string; phone: string } | null>(null);
  const [bump, setBump] = useState(0);
  const key = useRef<string | null>(null);

  // The list is kept on this device only, so a visitor can come back to it.
  useEffect(() => { try { const saved = localStorage.getItem(store); if (saved) setList(JSON.parse(saved)); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem(store, JSON.stringify(list)); } catch {} }, [list]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const t = setTimeout(async () => {
      const { data: d, error: e } = await db.rpc('catalogue', { p_query: query.trim() || null, p_family: family, p_limit: 48 });
      if (!live) return;
      setLoading(false);
      if (e) setError(friendly(...(e.message.split(':') as [string, string])));
      else setData(d as typeof data);
    }, query ? 180 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [db, query, family]);

  const families = useMemo(() => data?.families ?? [], [data]);
  const inList = (id: string) => list.find((p) => p.product === id);
  const add = (it: Item) => {
    setSent(null);
    setList((cur) => (cur.some((p) => p.product === it.product) ? cur : [...cur, { product: it.product, name: it.name, unit: it.unit, price: it.price, qty: '1' }]));
    setBump((b) => b + 1);
  };
  const setQty = (id: string, qty: string) => setList((cur) => cur.flatMap((p) => (p.product !== id ? [p] : Number(qty) <= 0 ? [] : [{ ...p, qty }])));
  const step = (p: Pick, by: number) => setQty(p.product, String(Math.max(0, Math.round((Number(p.qty) + by) * 1000) / 1000)));

  const send = useCallback(async () => {
    if (busy || list.length === 0) return;
    setBusy(true);
    setError(null);
    key.current ??= crypto.randomUUID();
    let lines;
    try { lines = list.map((p) => ({ product_id: p.product, qty: Number(toQty(p.qty)) })); } catch { setBusy(false); setError(friendly('bad_qty', '')); return; }
    const { data: r, error: e } = await db.rpc('request_quote', { p_key: key.current, p_name: form.name, p_phone: form.phone, p_lines: lines, p_note: form.note || null, p_email: form.email || null });
    setBusy(false);
    if (e) { const [n, ...rest] = e.message.split(':'); setError(friendly(n, rest.join(':').trim())); return; }
    key.current = null;
    setSent({ no: (r as { request_no: string }).request_no, phone: form.phone });
    setList([]);
  }, [busy, list, db, form]);

  const count = list.length;
  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '12px clamp(10px, 2vw, 28px) 96px' }}>
      <nav aria-label="Store" className="glass" style={{ position: 'sticky', top: 12, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '6px 8px 6px 18px', borderRadius: 18, maxWidth: 1240, margin: '0 auto' }}>
        <a href="#top" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, fontWeight: 650, fontSize: 17, letterSpacing: '-.02em' }}>
          <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, borderRadius: 8, background: '#10161E', color: '#FFFFFF', fontSize: 15 }}>⚡</span>Power Store
        </a>
        <button type="button" onClick={() => setOpen(true)} aria-label={`Quote list, ${count} ${count === 1 ? 'item' : 'items'}`} className="press" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '0 16px', border: 0, borderRadius: 13, background: '#10161E', color: '#FFFFFF', font: '500 14.5px Geist, system-ui, sans-serif', cursor: 'pointer' }}>
          Quote list
          <span key={bump} className={bump ? 'bump' : ''} style={{ display: 'grid', placeItems: 'center', minWidth: 22, height: 22, padding: '0 6px', borderRadius: 11, background: count ? '#1B5CF0' : 'rgba(255,255,255,.18)', fontSize: 12.5, fontWeight: 650 }}>{count}</span>
        </button>
      </nav>

      <div id="top" style={{ maxWidth: 1240, margin: '0 auto', display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
        <div style={{ flex: '999 1 560px', minWidth: 0 }}>
          <header style={{ padding: 'clamp(26px, 5vw, 56px) 2px 18px' }}>
            <h1 style={{ margin: 0, maxWidth: 720, fontSize: 'clamp(30px, 4.6vw, 52px)', lineHeight: 1.04, fontWeight: 600, letterSpacing: '-.035em' }}>Solar, batteries and power parts, at today&apos;s price.</h1>
            <p style={{ margin: '12px 0 0', maxWidth: 560, fontSize: 'clamp(15.5px, 1.6vw, 18px)', lineHeight: 1.5, color: '#434E5A' }}>Real stock from our shelves. Find the part however you know it, add it to a list, and the shop calls you with a quote.</p>
            <label htmlFor="q" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Search the shop</label>
            <div className="glass" style={{ display: 'flex', alignItems: 'center', gap: 10, maxWidth: 720, marginTop: 22, padding: '6px 6px 6px 18px', borderRadius: 18 }}>
              <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" style={{ flex: 'none', fill: 'none', stroke: '#55606C', strokeWidth: 2, strokeLinecap: 'round' }}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
              <input id="q" type="search" value={query} onChange={(e) => setQuery(e.target.value.slice(0, 80))} placeholder="Part number, size like 25 x 52 x 15, or a name" autoComplete="off" style={{ flex: 1, minWidth: 0, height: 50, border: 0, outline: 'none', background: 'transparent', color: '#10161E', font: '450 17px Geist, system-ui, sans-serif' }} />
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, fontSize: 13.5, color: '#55606C' }}>
              <span style={{ alignSelf: 'center' }}>Try</span>
              {examples.map((e) => <button key={e} type="button" onClick={() => setQuery(e)} className="press" style={{ minHeight: 36, padding: '0 12px', border: '1px solid rgba(16,24,34,.12)', borderRadius: 18, background: 'rgba(255,255,255,.7)', color: '#10161E', font: "500 13.5px 'Geist Mono', monospace", cursor: 'pointer' }}>{e}</button>)}
            </div>
          </header>

          <div role="group" aria-label="Kinds of goods" style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '2px 2px 12px', scrollbarWidth: 'none' }}>
            {[{ family: null as string | null, label: 'Everything' }, ...families.map((f) => ({ family: f.family as string | null, label: f.family }))].map((f) => (
              <button key={f.label} type="button" aria-pressed={family === f.family} onClick={() => setFamily(f.family)} className="press" style={{ flex: 'none', minHeight: 40, padding: '0 14px', border: `1px solid ${family === f.family ? '#10161E' : 'rgba(16,24,34,.12)'}`, borderRadius: 20, background: family === f.family ? '#10161E' : '#FFFFFF', color: family === f.family ? '#FFFFFF' : '#10161E', font: '500 14px Geist, system-ui, sans-serif', textTransform: 'capitalize', cursor: 'pointer' }}>{f.label}</button>
            ))}
          </div>

          <p aria-live="polite" style={{ margin: '0 2px 10px', fontSize: 14, color: '#55606C' }}>
            {loading ? 'Looking…' : data ? (data.items.length ? `${data.items.length} ${data.items.length === 1 ? 'item' : 'items'}${query.trim() ? ` for "${query.trim()}"` : ''}` : `Nothing matches "${query.trim()}". Ask us anyway: the counter often has it, or can get it.`) : ''}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {data?.items.map((it) => {
              const picked = inList(it.product);
              const size = it.sizes && it.sizes.bore != null ? `${Number(it.sizes.bore)} × ${Number(it.sizes.outside)} × ${Number(it.sizes.width)} mm` : null;
              return (
                <article key={it.product} className="card rise" style={{ display: 'flex', flexDirection: 'column', padding: 14, boxShadow: picked ? '0 0 0 2px #1B5CF0' : 'none', transition: 'box-shadow .2s' }}>
                  <div style={{ height: 112, borderRadius: 14, background: 'linear-gradient(160deg, #F4F7FF 0%, #EEF1F4 100%)', padding: '14px 26px' }}><Glyph family={it.family} name={it.name} /></div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 10, background: stateBg[it.state], color: stateColor[it.state], fontSize: 12.5, fontWeight: 600 }}>
                      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 4, background: stateColor[it.state] }} />{stateText[it.state]}
                    </span>
                  </div>
                  <h2 style={{ margin: '8px 0 0', fontSize: 16, fontWeight: 600, letterSpacing: '-.01em', lineHeight: 1.3 }}>{it.name}</h2>
                  <div style={{ marginTop: 3, fontSize: 13, color: '#55606C', fontFamily: "'Geist Mono', monospace" }}>{[it.part_number, size].filter(Boolean).join(' · ') || it.sku}</div>
                  {it.warranty_months ? <div style={{ marginTop: 3, fontSize: 13, color: '#55606C' }}>{it.warranty_months} months warranty</div> : null}
                  <div style={{ flex: 1 }} />
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginTop: 12 }}>
                    <span className="tabular" style={{ fontSize: 19, fontWeight: 650, letterSpacing: '-.02em' }}>{formatNaira(it.price)}</span>
                    <span style={{ fontSize: 12.5, color: '#55606C' }}>{it.unit === 'metre' ? 'per metre, today' : "today's price"}</span>
                  </div>
                  {picked ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 550, color: '#0A6E4B' }}><Tick size={16} stroke="#0D9465" />On your list</span>
                      <Stepper pick={picked} onStep={step} />
                    </div>
                  ) : (
                    <button type="button" onClick={() => add(it)} className="press" style={{ minHeight: 46, marginTop: 10, border: 0, borderRadius: 13, background: '#1B5CF0', color: '#FFFFFF', font: '600 15px Geist, system-ui, sans-serif', cursor: 'pointer' }}>Add to quote</button>
                  )}
                </article>
              );
            })}
          </div>
        </div>

        {open ? <button type="button" aria-hidden="true" tabIndex={-1} className="quote-scrim" onClick={() => setOpen(false)} /> : null}
        <aside aria-label="Your quote list" className={`glass quote-panel${open ? ' open' : ''}`} style={{ flex: '1 1 320px', minWidth: 0, boxSizing: 'border-box', padding: 20, borderRadius: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 600, letterSpacing: '-.015em' }}>Your quote list</h2>
            <button type="button" onClick={() => setOpen(false)} className="quote-close" aria-label="Close the quote list" style={{ minWidth: 44, minHeight: 44, border: 0, borderRadius: 12, background: 'transparent', fontSize: 20, cursor: 'pointer' }}>×</button>
          </div>
          {sent ? (
            <div className="rise" aria-live="polite" style={{ marginTop: 14, padding: 16, borderRadius: 16, background: '#EEF9F4' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 17, fontWeight: 600 }}><Tick size={22} stroke="#0D9465" />Request {sent.no} received</div>
              <p style={{ margin: '8px 0 0', fontSize: 14.5, lineHeight: 1.5, color: '#434E5A' }}>The shop will call you on {sent.phone} to confirm prices, stock and delivery. Nothing is charged until you agree a quote.</p>
            </div>
          ) : null}
          {list.length === 0 && !sent ? <p style={{ margin: '12px 0 0', fontSize: 14.5, lineHeight: 1.5, color: '#55606C' }}>Add what you need, and we will price it for you. Trade customers get their trade prices in the quote.</p> : null}
          {list.length ? (
            <>
              <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
                {list.map((p) => (
                  <li key={p.product} className="rise" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderTop: '1px solid rgba(16,24,34,.08)' }}>
                    <div style={{ minWidth: 0 }}><div style={{ fontSize: 14.5, fontWeight: 550 }}>{p.name}</div><div className="tabular" style={{ fontSize: 13, color: '#55606C' }}>{formatNaira(p.price)}{p.unit === 'metre' ? ' a metre' : ' each'}, today</div></div>
                    <Stepper pick={p} onStep={step} />
                  </li>
                ))}
              </ul>
              <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                <input aria-label="Your name" autoComplete="name" placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.slice(0, 80) })} style={field} />
                <input aria-label="Phone number" autoComplete="tel" inputMode="tel" placeholder="Phone, such as 0803 123 4567" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value.slice(0, 20) })} style={field} />
                <input aria-label="Email, if you like" autoComplete="email" inputMode="email" placeholder="Email, if you like" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value.slice(0, 120) })} style={field} />
                <textarea aria-label="Anything we should know" placeholder="Anything we should know, such as where it is going" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value.slice(0, 500) })} rows={3} style={{ ...field, height: 'auto', padding: '12px 14px', resize: 'vertical' }} />
              </div>
              {error ? <p role="alert" style={{ margin: '10px 0 0', fontSize: 14, color: '#92400E' }}>{error}</p> : null}
              <button type="button" onClick={() => void send()} disabled={busy || !form.name.trim() || !form.phone.trim()} className="press" style={{ width: '100%', minHeight: 54, marginTop: 12, border: 0, borderRadius: 15, background: busy || !form.name.trim() || !form.phone.trim() ? '#8E99A4' : '#1B5CF0', color: '#FFFFFF', font: '600 16.5px Geist, system-ui, sans-serif', cursor: 'pointer' }}>{busy ? 'Sending…' : 'Send request'}</button>
              <p style={{ margin: '8px 0 0', fontSize: 12.5, lineHeight: 1.45, color: '#55606C' }}>No account needed. We only use your number to call you about this quote.</p>
            </>
          ) : null}
        </aside>
      </div>
      <style>{`
        @keyframes bumpy { 0% { transform: scale(1) } 40% { transform: scale(1.28) } 100% { transform: scale(1) } }
        .bump { animation: bumpy .32s cubic-bezier(.3,1.4,.5,1) }
        .quote-panel { position: sticky; top: 84px; }
        .quote-close, .quote-scrim { display: none; }
        @media (max-width: 900px) {
          .quote-panel { position: fixed; left: 8px; right: 8px; bottom: 8px; top: auto; z-index: 40; max-height: 82vh; overflow: auto; transform: translateY(calc(100% + 16px)); transition: transform .32s cubic-bezier(.3,1,.4,1); }
          .quote-panel.open { transform: none; }
          .glass.quote-panel { background: rgba(255,255,255,.97); }
          .quote-close { display: inline-block; }
          .quote-scrim { display: block; position: fixed; inset: 0; z-index: 35; border: 0; background: rgba(16,22,30,.32); }
        }
        @media (prefers-reduced-motion: reduce) { .bump { animation: none } .quote-panel { transition: none } }
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
