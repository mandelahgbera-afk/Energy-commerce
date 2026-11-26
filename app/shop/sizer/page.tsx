'use client';

// The solar sizer for the public: a visitor adds what they will run, sees the inverter, battery and
// panels it needs, and one tap puts a matching set from this shop's own list into their quote list,
// with the sizes as the note. Panels are counted in the shop's own biggest panel, so the sizes, the
// note and the set agree. The counter prices and checks it, as with any request. Nothing here
// shows trade prices or stock counts, and nothing is saved until the visitor sends the request.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserDb } from '@/lib/supabase';
import { matchSet, panelSize, type Offer, type Plan } from '@/lib/solar';
import { Mark } from '@/components/staff-nav';
import { Sizer } from '@/components/tools';

const LIST = 'power-store-quote-list'; // the keys app/shop/page.tsx reads
const NOTE = 'power-store-quote-note';
type Pick = { product: string; name: string; unit: string; price: number | string; qty: string };

export default function SolarSizer() {
  const db = useRef(browserDb()).current;
  const router = useRouter();
  // Today's inverters, batteries and panels: null while loading, false if it could not load.
  const [shelf, setShelf] = useState<Offer[] | null | false>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [shop, setShop] = useState<{ name: string | null; phone: string | null } | null>(null);
  useEffect(() => { void db.rpc('shop_details').then(({ data }) => { if (data) setShop(data as NonNullable<typeof shop>); }); }, [db]);
  const load = useCallback(async () => {
    const found = await Promise.all(['kva', 'lithium', 'tubular', 'panel'].map((q) => db.rpc('catalogue', { p_query: q, p_family: null, p_limit: 100 })));
    setShelf(found.some((r) => r.error) ? false : found.flatMap((r) => (r.data as { items: Offer[] }).items));
  }, [db]);
  useEffect(() => { void load(); }, [load]);

  const ask = (plan: Plan, summary: string, items: Offer[]) => {
    setProblem(null);
    const lines = matchSet(plan, items);
    if (!lines.length) {
      setProblem(plan.kva ? 'The shop has nothing on its list that fits yet. Call the shop and they will put a set together.' : 'That is bigger than one inverter. Call the shop and they will design it with you.');
      return;
    }
    try {
      const list: Pick[] = JSON.parse(localStorage.getItem(LIST) ?? '[]');
      for (const l of lines) {
        const at = list.findIndex((p) => p.product === l.product);
        const pick = { product: l.product, name: l.name, unit: l.unit, price: l.price, qty: String(l.qty) };
        if (at >= 0) list[at] = pick; else list.push(pick);
      }
      localStorage.setItem(LIST, JSON.stringify(list));
      localStorage.setItem(NOTE, summary.slice(0, 500));
    } catch {}
    router.push('/shop?list');
  };
  const phone = shop?.phone ? <> <a href={`tel:+${shop.phone.replace(/^0/, '234')}`} style={{ fontWeight: 600, textDecoration: 'underline' }}>{shop.phone.startsWith('234') ? `0${shop.phone.slice(3)}` : shop.phone}</a></> : null;

  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '12px clamp(10px, 2vw, 28px) 60px' }}>
      <nav aria-label="Store" className="glass" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '6px 8px 6px 12px', borderRadius: 18, maxWidth: 760, margin: '0 auto' }}>
        <Link href="/shop" style={{ display: 'inline-flex', alignItems: 'center', gap: 9, minHeight: 44, fontWeight: 650, fontSize: 17, letterSpacing: '-.02em' }}><Mark />{shop?.name ?? 'Power Store'}</Link>
        <Link href="/shop" className="press" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 14px', borderRadius: 13, background: '#FFFFFF', border: '1px solid rgba(16,24,34,.1)', fontSize: 14.5, fontWeight: 500 }}>Back to the shop</Link>
      </nav>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <header style={{ padding: 'clamp(24px, 4vw, 44px) 2px 16px' }}>
          <h1 style={{ margin: 0, fontSize: 'clamp(28px, 4vw, 44px)', lineHeight: 1.05, fontWeight: 600, letterSpacing: '-.035em' }}>What size of solar do you need?</h1>
          <p style={{ margin: '12px 0 0', maxWidth: 580, fontSize: 'clamp(15.5px, 1.6vw, 17px)', lineHeight: 1.5, color: '#434E5A' }}>Add what you will run, how many, and the hours a day. You get the inverter, battery and panels it needs, and the shop can quote a matching set from today&apos;s list.</p>
        </header>
        <section className="card rise" style={{ padding: 'clamp(16px, 3vw, 24px)' }}>
          <Sizer storeKey="power-store-sizer" ask="What will you run?" panelW={shelf ? panelSize(shelf) ?? undefined : undefined}
            onAsk={shelf ? (plan, summary) => ask(plan, summary, shelf) : undefined} />
          {shelf === false ? (
            <p role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, margin: '12px 0 0', padding: '10px 12px', borderRadius: 12, background: '#FDF3E7', color: '#92400E', fontSize: 14 }}>
              <span style={{ flex: 1, minWidth: 200 }}>Today&apos;s list could not load, so the shop cannot match a set yet.{phone}</span>
              <button type="button" onClick={() => { setShelf(null); void load(); }} className="press" style={{ minHeight: 38, padding: '0 12px', border: 0, borderRadius: 10, background: '#FFFFFF', color: '#92400E', font: '600 13.5px var(--sans)', cursor: 'pointer' }}>Try again</button>
            </p>
          ) : null}
          {problem ? <p role="alert" style={{ margin: '12px 0 0', padding: '10px 12px', borderRadius: 12, background: '#FDF3E7', color: '#92400E', fontSize: 14 }}>{problem}{phone}</p> : null}
        </section>
      </div>
    </main>
  );
}
