'use client';

// Shelf labels: the name, today's shelf price and the shop code as a barcode, on A4 sheets of 24
// labels (70 × 37 mm). A scan of the label finds the part at the counter and in the stock room,
// because search matches the shop code. Prices only, never cost, so the storekeeper can print too.
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { browserDb } from '@/lib/supabase';
import { formatNaira } from '@/lib/money';
import { StaffNav } from '@/components/staff-nav';
import { Barcode } from '@/components/barcode';

type Product = { id: string; sku: string; name: string; family: string; unit: string; price_kobo: number | string };
const allowed = ['owner', 'storekeeper'];
const PER_SHEET = 24;
const naira = (k: number | string) => formatNaira(k).replace(/\.00$/, '');
const field = { height: 44, boxSizing: 'border-box', padding: '0 12px', border: '1px solid rgba(16,24,34,.14)', borderRadius: 12, background: '#FFFFFF', font: '450 15px var(--sans)' } as const;
const chip = { minHeight: 40, padding: '0 12px', border: '1px solid rgba(16,24,34,.12)', borderRadius: 11, background: '#FFFFFF', font: '500 13.5px var(--sans)', cursor: 'pointer' } as const;

export default function Labels() {
  const db = useRef(browserDb()).current;
  const [me, setMe] = useState<undefined | null | { role: string | null }>(undefined);
  const [items, setItems] = useState<Product[] | null>(null);
  const [shopName, setShopName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [family, setFamily] = useState('');
  const [copies, setCopies] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      const { data } = await db.auth.getSession();
      if (!data.session) { setMe(null); return; }
      const r = await db.from('staff').select('role').eq('id', data.session.user.id).maybeSingle();
      setMe({ role: r.data?.role ?? null });
    })();
  }, [db]);

  useEffect(() => {
    if (!me?.role || !allowed.includes(me.role)) return;
    void db.from('products').select('id, sku, name, family, unit, price_kobo').eq('status', 'active').order('family').order('name').limit(2000)
      .then(({ data, error: e }) => { if (e) setError('The product list could not load. Check the connection and refresh.'); else setItems((data ?? []) as Product[]); });
    void db.rpc('shop_details').then(({ data }) => setShopName((data as { name?: string | null } | null)?.name ?? null));
  }, [db, me]);

  const families = useMemo(() => [...new Set((items ?? []).map((i) => i.family))].sort(), [items]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (items ?? []).filter((i) => (!family || i.family === family) && (!t || `${i.sku} ${i.name}`.toLowerCase().includes(t)));
  }, [items, q, family]);
  const labels = (items ?? []).flatMap((i) => Array.from({ length: copies[i.id] ?? 0 }, (_, n) => ({ ...i, n })));
  const sheets = Array.from({ length: Math.ceil(labels.length / PER_SHEET) }, (_, s) => labels.slice(s * PER_SHEET, (s + 1) * PER_SHEET));
  const set = (id: string, n: number) => setCopies((c) => ({ ...c, [id]: Math.max(0, Math.min(99, Math.round(n) || 0)) }));

  if (me === undefined) return <main style={{ minHeight: '100vh' }} aria-busy="true" />;
  if (me === null || !allowed.includes(me.role ?? '')) {
    return (
      <main className="mx-auto max-w-sm px-5 py-20 text-center">
        <p className="text-lg font-semibold">{me === null ? 'Sign in to print shelf labels.' : 'Shelf labels are for the owner and the storekeeper.'}</p>
        <Link href={me === null ? '/login' : '/'} className="press mt-4 inline-flex h-12 items-center rounded-field bg-action px-6 text-sm font-medium text-white">{me === null ? 'Sign in' : 'Back'}</Link>
      </main>
    );
  }

  return (
    <main className="labels-page" style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '12px clamp(10px, 2vw, 28px) 60px' }}>
      <StaffNav label="Staff" wide={1040} />
      <div style={{ maxWidth: 1040, margin: '22px auto 0', display: 'grid', gap: 14 }}>
        <header style={{ padding: '0 2px' }}>
          <h1 style={{ margin: 0, fontSize: 'clamp(26px, 3vw, 34px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-.03em' }}>Shelf labels</h1>
          <p style={{ margin: '6px 0 0', maxWidth: 680, fontSize: 15, lineHeight: 1.5, color: '#434E5A' }}>Pick the products and how many labels each. They print on A4 sheets of 24 labels (70 × 37 mm). The barcode is the shop code, so scanning a label finds the part.</p>
        </header>

        <section className="card rise" style={{ padding: 'clamp(16px, 3vw, 24px)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <input id="lb-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find by name or code" aria-label="Find by name or code" style={{ ...field, flex: '1 1 220px' }} />
            <select id="lb-family" value={family} onChange={(e) => setFamily(e.target.value)} aria-label="Kind of goods" style={{ ...field, flex: '0 1 200px', cursor: 'pointer' }}>
              <option value="">All kinds</option>
              {families.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <button type="button" className="press" style={chip} onClick={() => setCopies((c) => ({ ...c, ...Object.fromEntries(shown.map((i) => [i.id, Math.max(1, c[i.id] ?? 0)])) }))}>One of each shown</button>
            <button type="button" className="press" style={chip} onClick={() => setCopies({})} disabled={!labels.length}>Clear</button>
          </div>
          {error ? <p role="alert" style={{ margin: '12px 0 0', padding: '10px 12px', borderRadius: 12, background: '#FDF3E7', color: '#92400E', fontSize: 14 }}>{error}</p> : null}
          {items === null && !error ? <p style={{ margin: '14px 2px 0', color: '#55606C', fontSize: 14 }}>Loading the products…</p> : null}
          <ul aria-label="Products" style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'grid', gap: 2, maxHeight: 420, overflowY: 'auto' }}>
            {shown.slice(0, 300).map((i) => (
              <li key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 4px', borderTop: '1px solid rgba(16,24,34,.06)' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 550, fontSize: 14.5 }}>{i.name}</span>
                  <span style={{ display: 'block', fontSize: 12.5, color: '#55606C', fontFamily: 'var(--mono)' }}>{i.sku}</span>
                </span>
                <span className="tabular" style={{ fontSize: 14, whiteSpace: 'nowrap' }}>{naira(i.price_kobo)}</span>
                <input inputMode="numeric" value={copies[i.id] ?? 0} onChange={(e) => set(i.id, Number(e.target.value.replace(/\D/g, '')))} aria-label={`Labels for ${i.name}`} className="tabular"
                  style={{ ...field, width: 62, height: 40, textAlign: 'center' }} />
              </li>
            ))}
          </ul>
          {items && !shown.length ? <p style={{ margin: '10px 4px 0', fontSize: 14, color: '#55606C' }}>Nothing matches.</p> : null}
          {shown.length > 300 ? <p style={{ margin: '10px 4px 0', fontSize: 13, color: '#55606C' }}>Showing 300 of {shown.length}. Narrow the search to see the rest.</p> : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginTop: 14 }}>
            <span className="tabular" aria-live="polite" style={{ fontSize: 14, color: '#55606C' }}>{labels.length} {labels.length === 1 ? 'label' : 'labels'} · {sheets.length} {sheets.length === 1 ? 'sheet' : 'sheets'}</span>
            <button type="button" onClick={() => window.print()} disabled={!labels.length} className="press"
              style={{ minHeight: 46, padding: '0 18px', border: 0, borderRadius: 13, background: labels.length ? '#10161E' : '#E6EAEE', color: labels.length ? '#FFFFFF' : '#8E99A4', font: '600 15px var(--sans)', cursor: 'pointer' }}>Print labels</button>
          </div>
        </section>
      </div>

      {labels.length ? (
        <div className="label-print" aria-label="Labels to print" style={{ maxWidth: 1040, margin: '14px auto 0', overflowX: 'auto' }}>
          {sheets.map((sheet, s) => (
            <div key={s} className="label-sheet">
              {sheet.map((l) => (
                <div key={`${l.id}-${l.n}`} className="label">
                  {shopName ? <span className="label-shop">{shopName}</span> : null}
                  <span className="label-name">{l.name}</span>
                  <span className="label-price tabular">{naira(l.price_kobo)}{l.unit === 'metre' ? <span className="label-unit"> a metre</span> : null}</span>
                  <span className="label-code"><Barcode value={l.sku} /></span>
                  <span className="label-sku">{l.sku}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </main>
  );
}
