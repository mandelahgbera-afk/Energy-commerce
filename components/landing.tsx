'use client';

// The public front door: calm, warm and plain-spoken. One illustration carries the "energy"
// (a sun, panels and a battery that fills slowly), and everything else is the shop's own facts.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { browserDb } from '@/lib/supabase';
import { Tick } from '@/components/kit/feel';
import { Mark } from '@/components/staff-nav';

type Details = { name: string | null; phone: string | null; address: string | null; hours: string | null };
const local = (p: string) => (p.startsWith('234') ? `0${p.slice(3)}` : p);
const kinds = [
  { q: 'solar', title: 'Solar panels', line: 'Mono and poly panels, sized for homes and shops.', d: 'M5 17 8 7h8l3 10ZM10 7l-1 10M14 7l1 10M6.5 12h11M12 17v3M9 20h6' },
  { q: 'inverter', title: 'Inverters', line: 'Hybrid inverters that keep the lights steady.', d: 'M4 5h16v14H4ZM8 12h2l1-3 2 6 1-3h2' },
  { q: 'battery', title: 'Batteries', line: 'Lithium, tubular and car batteries, with warranty.', d: 'M5 7h13v11H5ZM9 7V5h5v2M8 12.5h3M9.5 11v3M13 12.5h3' },
  { q: 'bearing', title: 'Bearings, belts, chains', line: 'Find a part by its number or its size.', d: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18ZM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6Z' },
];
const promises = ['Warranty shown on every item', 'Trade prices for installers', 'Pay only when you agree the quote'];

function Scene() {
  return (
    <svg viewBox="0 0 480 380" width="100%" height="100%" role="img" aria-label="Sunlight on solar panels charging a battery">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#E8F0FF" /><stop offset="1" stopColor="#FFF6E5" /></linearGradient>
        <linearGradient id="pv" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2A4F9E" /><stop offset="1" stopColor="#1B3570" /></linearGradient>
      </defs>
      <rect width="480" height="380" rx="28" fill="url(#sky)" />
      <g className="sun" style={{ transformOrigin: '360px 92px' }}>
        {Array.from({ length: 12 }, (_, i) => <line key={i} x1="360" y1="40" x2="360" y2="54" stroke="#F5B53C" strokeWidth="4" strokeLinecap="round" transform={`rotate(${i * 30} 360 92)`} />)}
      </g>
      <circle cx="360" cy="92" r="28" fill="#FFD25E" />
      <path d="M30 300 C150 270 330 270 450 300 L450 380 L30 380Z" fill="#EAF2E3" />
      {[70, 165].map((x) => (
        <g key={x}>
          <path d={`M${x} 250 l22 -70 h86 l-14 70Z`} fill="url(#pv)" />
          <path d={`M${x + 36} 180 l-12 70 M${x + 66} 180 l-12 70 M${x + 10} 215 h98`} stroke="#6E8FD6" strokeWidth="1.6" opacity=".7" />
          <path d={`M${x + 50} 250 v34`} stroke="#8E99A4" strokeWidth="4" strokeLinecap="round" />
        </g>
      ))}
      <path className="flow" d="M296 262 C320 262 330 250 352 250" fill="none" stroke="#1B5CF0" strokeWidth="3" strokeLinecap="round" strokeDasharray="6 8" />
      <rect x="352" y="206" width="84" height="96" rx="14" fill="#FFFFFF" stroke="#10161E" strokeWidth="3" />
      <rect x="380" y="196" width="28" height="12" rx="4" fill="#10161E" />
      {[0, 1, 2, 3].map((i) => <rect key={i} className={`cell c${i}`} x="366" y={278 - i * 20} width="56" height="14" rx="4" fill="#0D9465" />)}
      <circle cx="96" cy="326" r="18" fill="none" stroke="#55606C" strokeWidth="3" />
      <circle cx="96" cy="326" r="7" fill="none" stroke="#55606C" strokeWidth="3" />
    </svg>
  );
}

export function Landing() {
  const [shop, setShop] = useState<Details | null>(null);
  useEffect(() => { void browserDb().rpc('shop_details').then(({ data }) => { if (data) setShop(data as Details); }); }, []);
  const name = shop?.name ?? 'Power Store';

  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '12px clamp(12px, 3vw, 32px) 40px', overflowX: 'clip' }}>
      <nav aria-label="Site" className="glass" style={{ position: 'sticky', top: 12, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, maxWidth: 1180, margin: '0 auto', padding: '6px 8px 6px 12px', borderRadius: 18 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, minHeight: 44, fontSize: 17, fontWeight: 650, letterSpacing: '-.02em' }}><Mark />{name}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Link href="/login" className="lnd-quiet" style={{ padding: '0 12px', minHeight: 44, display: 'inline-flex', alignItems: 'center', fontSize: 14, color: '#55606C' }}>Staff</Link>
          <Link href="/shop" className="press" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 16px', borderRadius: 13, background: '#10161E', color: '#FFFFFF', fontSize: 14.5, fontWeight: 550 }}>Shop now</Link>
        </span>
      </nav>

      <section style={{ maxWidth: 1180, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'clamp(24px, 4vw, 56px)', padding: 'clamp(36px, 6vw, 80px) 0 clamp(28px, 4vw, 48px)' }}>
        <div className="rise" style={{ flex: '1 1 420px', minWidth: 0 }}>
          <span style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: '#1B5CF0' }}>Solar · Batteries · Power parts</span>
          <h1 style={{ margin: '14px 0 0', fontSize: 'clamp(38px, 5.6vw, 64px)', lineHeight: 1.02, fontWeight: 600, letterSpacing: '-.04em' }}>Steady power,<br />honestly priced.</h1>
          <p style={{ margin: '18px 0 0', maxWidth: 520, fontSize: 'clamp(16px, 1.7vw, 19px)', lineHeight: 1.55, color: '#434E5A' }}>Panels, inverters and batteries, and the bearings, belts and chains that keep machines running. Real stock from our own shelves, at today&apos;s price.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 26 }}>
            <Link href="/shop" className="press" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 52, padding: '0 22px', borderRadius: 15, background: '#1B5CF0', color: '#FFFFFF', fontSize: 16, fontWeight: 600, boxShadow: '0 12px 28px rgba(27,92,240,.26)' }}>Browse the shop</Link>
            {shop?.phone ? <a href={`tel:+${shop.phone}`} className="press" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 52, padding: '0 20px', borderRadius: 15, border: '1px solid rgba(16,24,34,.14)', background: '#FFFFFF', fontSize: 15.5, fontWeight: 550 }}>Call {local(shop.phone)}</a> : null}
          </div>
          <ul style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', listStyle: 'none', margin: '24px 0 0', padding: 0, fontSize: 14, color: '#434E5A' }}>
            {promises.map((p) => <li key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Tick size={15} stroke="#0D9465" />{p}</li>)}
          </ul>
        </div>
        <div className="rise lnd-art" style={{ flex: '1 1 380px', minWidth: 0, maxWidth: 560, animationDelay: '120ms', filter: 'drop-shadow(0 30px 50px rgba(16,24,34,.12))' }}><Scene /></div>
      </section>

      <section aria-label="What we sell" style={{ maxWidth: 1180, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {kinds.map((k, i) => (
          <Link key={k.q} href={`/shop?q=${k.q}`} className="card rise lnd-kind" style={{ display: 'block', padding: 20, animationDelay: `${180 + i * 50}ms` }}>
            <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 44, height: 44, borderRadius: 13, background: 'linear-gradient(160deg, #EEF3FF, #FFF4DE)' }}>
              <svg viewBox="0 0 24 24" width="22" height="22" style={{ fill: 'none', stroke: '#1B5CF0', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d={k.d} /></svg>
            </span>
            <span style={{ display: 'block', marginTop: 14, fontSize: 17, fontWeight: 600, letterSpacing: '-.012em' }}>{k.title}</span>
            <span style={{ display: 'block', marginTop: 4, fontSize: 14, lineHeight: 1.45, color: '#55606C' }}>{k.line}</span>
          </Link>
        ))}
      </section>

      <section aria-label="How it works" className="card" style={{ maxWidth: 1180, margin: '14px auto 0', boxSizing: 'border-box', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18, padding: 'clamp(20px, 3vw, 32px)' }}>
        {[['Find it', 'Search by part number, size like 25 x 52 x 15, or simply by name.'], ['Ask for a quote', 'Add what you need. No account, no long WhatsApp threads.'], ['We confirm and you pay', 'The shop calls to confirm price, stock and delivery. You pay when you agree.']].map(([t, d], i) => (
          <div key={t} style={{ display: 'flex', gap: 14 }}>
            <span className="tabular" style={{ display: 'grid', placeItems: 'center', width: 32, height: 32, flex: 'none', borderRadius: 16, background: '#10161E', color: '#FFFFFF', fontSize: 14, fontWeight: 650 }}>{i + 1}</span>
            <span><span style={{ display: 'block', fontSize: 16, fontWeight: 600 }}>{t}</span><span style={{ display: 'block', marginTop: 3, fontSize: 14, lineHeight: 1.5, color: '#55606C' }}>{d}</span></span>
          </div>
        ))}
      </section>

      {shop && (shop.address || shop.hours || shop.phone) ? (
        <section aria-label="Visit us" style={{ maxWidth: 1180, margin: '14px auto 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 24px', padding: '18px 4px', fontSize: 15, color: '#2A3441' }}>
          <span style={{ fontWeight: 600 }}>Visit {name}</span>
          {shop.address ? <span>{shop.address}</span> : null}
          {shop.hours ? <span style={{ color: '#55606C' }}>{shop.hours}</span> : null}
          {shop.phone ? <a href={`https://wa.me/${shop.phone}`} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, color: '#0A6E4B' }}>WhatsApp us</a> : null}
        </section>
      ) : null}

      <footer style={{ maxWidth: 1180, margin: '28px auto 0', paddingTop: 18, borderTop: '1px solid rgba(16,24,34,.08)', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, fontSize: 13.5, color: '#55606C' }}>
        <span>© {new Date().getFullYear()} {name}. Prices are today&apos;s shelf prices.</span>
        <Link href="/login" style={{ color: '#434E5A' }}>Staff sign in</Link>
      </footer>
      <style>{`
        @keyframes lnd-turn { to { transform: rotate(360deg) } }
        @keyframes lnd-flow { to { stroke-dashoffset: -28 } }
        @keyframes lnd-fill { 0%, 8% { opacity: .18 } 22%, 100% { opacity: 1 } }
        .sun { animation: lnd-turn 60s linear infinite }
        .flow { animation: lnd-flow 1.6s linear infinite }
        .cell { animation: lnd-fill 6s ease-in-out infinite both }
        .c1 { animation-delay: .8s } .c2 { animation-delay: 1.6s } .c3 { animation-delay: 2.4s }
        .lnd-kind { transition: transform .24s cubic-bezier(.2,.7,.2,1), box-shadow .24s, border-color .24s }
        .lnd-kind:hover { transform: translateY(-3px); border-color: rgba(27,92,240,.22); box-shadow: 0 16px 36px rgba(16,24,34,.09) }
        .lnd-quiet:hover { color: #10161E }
        @media (prefers-reduced-motion: reduce) { .sun, .flow, .cell { animation: none } .lnd-kind:hover { transform: none } }
      `}</style>
    </main>
  );
}
