'use client';

// The public front door. Calm, warm, and built on the shop's own facts: its live catalogue,
// prices, and contact details. One illustrated scene carries the energy: sun on the roof panels,
// power flowing to the inverter and battery bank, and on to a workshop motor whose belt turns.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { browserDb } from '@/lib/supabase';
import { formatNaira } from '@/lib/money';
import { Tick } from '@/components/kit/feel';
import { Mark } from '@/components/staff-nav';

type Details = { name: string | null; phone: string | null; address: string | null; hours: string | null };
type Item = { product: string; name: string; family: string; price: number | string; state: 'in' | 'low' | 'out'; warranty_months: number };
const local = (p: string) => (p.startsWith('234') ? `0${p.slice(3)}` : p);
const ink = '#10161E';
const kinds = [
  { q: 'solar', title: 'Solar panels', line: 'Mono, poly and bifacial panels, sized for homes, shops and farms.', d: 'M5 17 8 7h8l3 10ZM10 7l-1 10M14 7l1 10M6.5 12h11M12 17v3M9 20h6', tint: ['#EEF3FF', '#DCE7FF'] },
  { q: 'inverter', title: 'Inverters', line: 'Hybrid inverters and charge controllers that keep the lights steady.', d: 'M4 5h16v14H4ZM8 12h2l1-3 2 6 1-3h2', tint: ['#F1F0FF', '#E3E1FF'] },
  { q: 'battery', title: 'Batteries', line: 'Lithium, tubular and car batteries, with the warranty on record.', d: 'M5 7h13v11H5ZM9 7V5h5v2M8 12.5h3M9.5 11v3M13 12.5h3', tint: ['#ECF8F2', '#D5F0E3'] },
  { q: 'bearing', title: 'Bearings, belts, chains', line: 'Find a part by its number or its size, and get the right one.', d: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18ZM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6Z', tint: ['#FFF4E3', '#FFE7C2'] },
];
const glyph = (t: string) => (/batter/i.test(t) ? kinds[2].d : /solar|panel/i.test(t) ? kinds[0].d : /inverter|controller/i.test(t) ? kinds[1].d : kinds[3].d);

function Scene() {
  return (
    <svg viewBox="0 0 560 440" width="100%" height="100%" role="img" aria-label="Sunlight on roof panels powers an inverter, a battery bank and a workshop motor">
      <defs>
        <linearGradient id="l-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#DCE8FF" /><stop offset=".62" stopColor="#F4F1FF" /><stop offset="1" stopColor="#FFF3DD" /></linearGradient>
        <radialGradient id="l-glow" cx="78%" cy="18%" r="40%"><stop offset="0" stopColor="#FFE7A8" stopOpacity=".95" /><stop offset="1" stopColor="#FFE7A8" stopOpacity="0" /></radialGradient>
        <linearGradient id="l-pv" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3460C0" /><stop offset="1" stopColor="#18306A" /></linearGradient>
        <linearGradient id="l-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#EEF1F5" /></linearGradient>
      </defs>
      <rect width="560" height="440" rx="30" fill="url(#l-sky)" />
      <rect width="560" height="440" rx="30" fill="url(#l-glow)" />
      <g className="l-rays" style={{ transformOrigin: '436px 82px' }}>
        {Array.from({ length: 16 }, (_, i) => <line key={i} x1="436" y1="34" x2="436" y2={i % 2 ? 44 : 48} stroke="#F2B544" strokeWidth="3.5" strokeLinecap="round" transform={`rotate(${i * 22.5} 436 82)`} />)}
      </g>
      <circle cx="436" cy="82" r="26" fill="#FFD25E" />
      <path d="M0 352 C140 322 300 318 560 346 L560 410 Q560 440 530 440 L30 440 Q0 440 0 410Z" fill="#E6F1DF" />
      {/* Home with roof panels */}
      <path d="M40 352 V250 L140 186 L240 250 V352Z" fill="url(#l-wall)" stroke={ink} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M28 258 L140 180 L252 258" fill="none" stroke={ink} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <g transform="translate(76 206) skewY(-34.8)">
        {[0, 1, 2].map((i) => <rect key={i} x={i * 30} y="0" width="27" height="40" rx="3" fill="url(#l-pv)" />)}
        <path d="M0 13 h88 M0 26 h88" stroke="#7FA0E6" strokeWidth="1.2" opacity=".75" />
      </g>
      <rect x="118" y="292" width="44" height="60" rx="4" fill="#F6E7CF" stroke={ink} strokeWidth="2" />
      <rect x="62" y="280" width="36" height="30" rx="4" fill="#DDE8FA" stroke={ink} strokeWidth="2" />
      {/* Inverter and battery bank */}
      <rect x="276" y="250" width="52" height="68" rx="8" fill="#FFFFFF" stroke={ink} strokeWidth="2.5" />
      <rect x="286" y="262" width="32" height="14" rx="3" fill="#10161E" />
      <circle className="l-led" cx="302" cy="300" r="4.5" fill="#0D9465" />
      {[0, 1].map((b) => (
        <g key={b} transform={`translate(${346 + b * 52} 262)`}>
          <rect width="42" height="90" rx="8" fill="#FFFFFF" stroke={ink} strokeWidth="2.5" />
          {[0, 1, 2, 3].map((i) => <rect key={i} className={`l-cell l-c${i}`} x="8" y={70 - i * 18} width="26" height="12" rx="3" fill="#0D9465" style={{ animationDelay: `${b * 0.4 + i * 0.7}s` }} />)}
        </g>
      ))}
      {/* Workshop motor with belt, pulley and bearing */}
      <rect x="452" y="300" width="78" height="52" rx="10" fill="#FFFFFF" stroke={ink} strokeWidth="2.5" />
      <g className="l-spin" style={{ transformOrigin: '476px 326px' }}><circle cx="476" cy="326" r="14" fill="none" stroke="#55606C" strokeWidth="3" /><path d="M476 312v28M462 326h28" stroke="#55606C" strokeWidth="2.5" /></g>
      <g className="l-spin" style={{ transformOrigin: '512px 326px' }}><circle cx="512" cy="326" r="9" fill="none" stroke="#55606C" strokeWidth="3" /><circle cx="512" cy="326" r="3" fill="#55606C" /></g>
      <path d="M476 312 L512 317 M476 340 L512 335" stroke={ink} strokeWidth="2.5" strokeLinecap="round" />
      {/* Power lines with energy flowing */}
      <path className="l-flow" d="M200 232 C240 232 250 270 276 276" fill="none" stroke="#1B5CF0" strokeWidth="3" strokeLinecap="round" strokeDasharray="5 9" />
      <path className="l-flow" d="M328 290 L346 290" fill="none" stroke="#1B5CF0" strokeWidth="3" strokeLinecap="round" strokeDasharray="5 9" />
      <path className="l-flow" d="M440 300 C444 290 448 300 452 312" fill="none" stroke="#1B5CF0" strokeWidth="3" strokeLinecap="round" strokeDasharray="5 9" />
    </svg>
  );
}

export function Landing() {
  const router = useRouter();
  const root = useRef<HTMLElement>(null);
  const [shop, setShop] = useState<Details | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    const db = browserDb();
    void db.rpc('shop_details').then(({ data }) => { if (data) setShop(data as Details); });
    void db.rpc('catalogue', { p_limit: 12 }).then(({ data }) => {
      const d = data as { families: { count: number }[]; items: Item[] } | null;
      if (!d) return;
      setItems(d.items.filter((i) => i.state !== 'out').slice(0, 10));
      setCount(d.families.reduce((s, f) => s + Number(f.count), 0));
    });
  }, []);

  // Sections ease in as they reach the screen.
  useEffect(() => {
    const els = root.current?.querySelectorAll('.l-reveal') ?? [];
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('l-in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -4% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [items.length]);

  const name = shop?.name ?? 'Power Store';
  const find = (e: React.FormEvent) => { e.preventDefault(); router.push(q.trim() ? `/shop?q=${encodeURIComponent(q.trim())}` : '/shop'); };
  const wrap = { maxWidth: 1200, margin: '0 auto' } as const;

  return (
    <main ref={root} style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '12px clamp(12px, 3vw, 32px) 32px', overflowX: 'clip' }}>
      <nav aria-label="Site" className="glass" style={{ ...wrap, position: 'sticky', top: 12, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '6px 8px 6px 12px', borderRadius: 18 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, minHeight: 44, fontSize: 17, fontWeight: 650, letterSpacing: '-.02em' }}><Mark />{name}</span>
        <span className="l-links" style={{ display: 'flex', gap: 2 }}>
          {[['#shelf', 'In stock'], ['#how', 'How it works'], ['#trade', 'For installers'], ['#visit', 'Visit']].map(([h, l]) => <a key={h} href={h} className="l-link">{l}</a>)}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Link href="/login" className="l-link">Staff</Link>
          <Link href="/shop" className="press" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 16px', borderRadius: 13, background: ink, color: '#FFFFFF', fontSize: 14.5, fontWeight: 550 }}>Shop now</Link>
        </span>
      </nav>

      {/* Hero */}
      <section style={{ ...wrap, position: 'relative', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'clamp(28px, 4vw, 60px)', padding: 'clamp(40px, 6vw, 84px) 0 clamp(36px, 5vw, 64px)' }}>
        <div aria-hidden="true" className="l-aura" />
        <div className="rise" style={{ flex: '1 1 440px', minWidth: 0 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px 6px 10px', borderRadius: 20, background: 'rgba(255,255,255,.78)', border: '1px solid rgba(16,24,34,.07)', fontSize: 13, fontWeight: 600, color: '#2A3441' }}>
            <span className="livedot" style={{ width: 7, height: 7, borderRadius: 4, background: '#0D9465' }} />{count ? `${count} products · today's prices` : 'Stock shown live from our shelves'}
          </span>
          <h1 style={{ margin: '18px 0 0', fontSize: 'clamp(40px, 6vw, 70px)', lineHeight: 1, fontWeight: 600, letterSpacing: '-.045em' }}>
            Steady power,<br /><span className="l-ink">honestly priced.</span>
          </h1>
          <p style={{ margin: '20px 0 0', maxWidth: 530, fontSize: 'clamp(16px, 1.7vw, 19px)', lineHeight: 1.55, color: '#434E5A' }}>Panels, inverters and batteries, and the bearings, belts and chains that keep machines running. Real stock from our own shelves, at today&apos;s price.</p>
          <form onSubmit={find} role="search" className="glass l-search" style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 540, marginTop: 26, padding: '6px 6px 6px 16px', borderRadius: 18 }}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19" style={{ flex: 'none', fill: 'none', stroke: '#55606C', strokeWidth: 2, strokeLinecap: 'round' }}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
            <label htmlFor="lq" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Find a part</label>
            <input id="lq" value={q} onChange={(e) => setQ(e.target.value.slice(0, 80))} placeholder="6205 2RS, 25 x 52 x 15, 5 kVA inverter" autoComplete="off" style={{ flex: 1, minWidth: 0, height: 46, border: 0, outline: 'none', background: 'transparent', font: '450 16px var(--sans)', color: ink }} />
            <button type="submit" className="press" style={{ flex: 'none', minHeight: 44, padding: '0 18px', border: 0, borderRadius: 13, background: '#1B5CF0', color: '#FFFFFF', font: '600 15px var(--sans)', cursor: 'pointer', boxShadow: '0 10px 22px rgba(27,92,240,.26)' }}>Find it</button>
          </form>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 18px', marginTop: 18, fontSize: 14, color: '#434E5A' }}>
            {['Warranty on record', 'Trade prices for installers', 'Pay when you agree the quote'].map((p) => <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><Tick size={15} stroke="#0D9465" />{p}</span>)}
          </div>
        </div>
        <div className="rise" style={{ position: 'relative', flex: '1 1 400px', minWidth: 0, maxWidth: 600, animationDelay: '120ms', filter: 'drop-shadow(0 34px 60px rgba(16,24,34,.14))' }}>
          <Scene />
          <span className="glass l-chip" style={{ left: '-2%', top: '16%' }}><b>₦</b> Today&apos;s price, on every item</span>
          <span className="glass l-chip" style={{ right: '-2%', bottom: '10%', animationDelay: '1.2s' }}><span style={{ display: 'grid', placeItems: 'center', width: 20, height: 20, borderRadius: 10, background: '#0D9465' }}><Tick size={12} /></span>Warranty recorded</span>
        </div>
      </section>

      {/* On the shelf today: the live catalogue */}
      {items.length ? (
        <section id="shelf" aria-labelledby="l-shelf" className="l-reveal" style={{ ...wrap, marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '0 2px' }}>
            <h2 id="l-shelf" style={{ margin: 0, fontSize: 'clamp(22px, 2.6vw, 30px)', fontWeight: 600, letterSpacing: '-.03em' }}>On the shelf today</h2>
            <Link href="/shop" style={{ fontSize: 14.5, fontWeight: 600, color: '#1B5CF0' }}>See everything →</Link>
          </div>
          <div className="l-rail" style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(210px, 1fr)', gap: 12, marginTop: 14, padding: '2px 2px 12px', overflowX: 'auto', scrollSnapType: 'x mandatory' }}>
            {items.map((it) => (
              <Link key={it.product} href={`/shop?q=${encodeURIComponent(it.name)}`} className="card l-item" style={{ display: 'flex', flexDirection: 'column', padding: 14, scrollSnapAlign: 'start' }}>
                <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', height: 92, borderRadius: 14, background: 'radial-gradient(90% 90% at 30% 20%, #F6F8FF, #EDF0F4)' }}>
                  <svg viewBox="0 0 24 24" width="40" height="40" style={{ fill: 'none', stroke: '#1B5CF0', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d={glyph(`${it.family} ${it.name}`)} /></svg>
                </span>
                <span style={{ marginTop: 12, fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>{it.name}</span>
                <span style={{ flex: 1 }} />
                <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginTop: 10 }}>
                  <span className="tabular" style={{ fontSize: 17, fontWeight: 650, letterSpacing: '-.02em' }}>{formatNaira(it.price).replace(/\.00$/, '')}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: it.state === 'low' ? '#92400E' : '#0A6E4B' }}>{it.state === 'low' ? 'Few left' : 'In stock'}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* What we sell */}
      <section aria-label="What we sell" className="l-reveal" style={{ ...wrap, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 12, marginTop: 28 }}>
        {kinds.map((k) => (
          <Link key={k.q} href={`/shop?q=${k.q}`} className="card l-kind" style={{ position: 'relative', display: 'block', padding: 22, overflow: 'hidden' }}>
            <span aria-hidden="true" style={{ position: 'absolute', right: -30, top: -30, width: 130, height: 130, borderRadius: 65, background: `radial-gradient(circle, ${k.tint[1]}, transparent 70%)` }} />
            <span aria-hidden="true" style={{ position: 'relative', display: 'grid', placeItems: 'center', width: 48, height: 48, borderRadius: 14, background: `linear-gradient(160deg, ${k.tint[0]}, ${k.tint[1]})` }}>
              <svg viewBox="0 0 24 24" width="24" height="24" style={{ fill: 'none', stroke: '#1B5CF0', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d={k.d} /></svg>
            </span>
            <span style={{ position: 'relative', display: 'block', marginTop: 16, fontSize: 18, fontWeight: 600, letterSpacing: '-.015em' }}>{k.title}</span>
            <span style={{ position: 'relative', display: 'block', marginTop: 5, fontSize: 14.5, lineHeight: 1.5, color: '#55606C' }}>{k.line}</span>
            <span className="l-go" style={{ position: 'relative', display: 'inline-block', marginTop: 14, fontSize: 14, fontWeight: 600, color: '#1B5CF0' }}>Browse →</span>
          </Link>
        ))}
      </section>

      {/* Why buy here: a quiet bento of promises */}
      <section aria-labelledby="l-why" className="l-reveal" style={{ ...wrap, marginTop: 'clamp(40px, 6vw, 72px)' }}>
        <h2 id="l-why" style={{ margin: '0 2px', maxWidth: 640, fontSize: 'clamp(26px, 3.2vw, 40px)', lineHeight: 1.08, fontWeight: 600, letterSpacing: '-.035em' }}>Bought with confidence, from people who keep records.</h2>
        <div className="l-bento" style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginTop: 20 }}>
          <div className="card l-b1" style={{ padding: 24, background: 'linear-gradient(160deg, #FFFFFF, #F4F7FF)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1B5CF0' }}>The right part</div>
            <div style={{ marginTop: 8, fontSize: 21, fontWeight: 600, letterSpacing: '-.02em' }}>Search the way you know it.</div>
            <p style={{ margin: '8px 0 0', fontSize: 14.5, lineHeight: 1.5, color: '#55606C' }}>&ldquo;6205 2RS&rdquo;, &ldquo;6205-2rs&rdquo; or just the size, 25 x 52 x 15. Each one finds the same bearing.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 16 }}>{['6205 2RS', '6205-2rs', '25 x 52 x 15'].map((c) => <span key={c} style={{ padding: '5px 10px', borderRadius: 9, background: '#FFFFFF', border: '1px solid rgba(16,24,34,.1)', font: '500 13px var(--mono)' }}>{c}</span>)}</div>
          </div>
          <div className="card l-b2" style={{ padding: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#0A6E4B' }}>Warranty</div>
            <div style={{ marginTop: 8, fontSize: 21, fontWeight: 600, letterSpacing: '-.02em' }}>On record from day one.</div>
            <p style={{ margin: '8px 0 0', fontSize: 14.5, lineHeight: 1.5, color: '#55606C' }}>Batteries are sold by serial number, so your warranty is tied to your unit, not a paper receipt.</p>
          </div>
          <div className="card l-b3" style={{ padding: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#92400E' }}>Honest pricing</div>
            <div style={{ marginTop: 8, fontSize: 21, fontWeight: 600, letterSpacing: '-.02em' }}>Today&apos;s price, shown.</div>
            <p style={{ margin: '8px 0 0', fontSize: 14.5, lineHeight: 1.5, color: '#55606C' }}>No &ldquo;call for price&rdquo; games. The quote you agree is the price you pay.</p>
          </div>
          <div className="card l-b4" style={{ padding: 24, background: ink, color: '#FFFFFF', borderColor: ink }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#8DB0FF' }}>No surprises</div>
            <div style={{ marginTop: 8, fontSize: 21, fontWeight: 600, letterSpacing: '-.02em' }}>Pay only when you agree.</div>
            <p style={{ margin: '8px 0 0', fontSize: 14.5, lineHeight: 1.5, color: '#A9B4C0' }}>Ask for a quote, and we call to confirm price, stock and delivery. Nothing is charged before that.</p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" aria-labelledby="l-how" className="card l-reveal" style={{ ...wrap, boxSizing: 'border-box', marginTop: 'clamp(40px, 6vw, 72px)', padding: 'clamp(22px, 3.4vw, 40px)' }}>
        <h2 id="l-how" style={{ margin: 0, fontSize: 'clamp(24px, 2.8vw, 34px)', fontWeight: 600, letterSpacing: '-.03em' }}>Three steps, no account.</h2>
        <ol className="l-steps" style={{ listStyle: 'none', margin: '22px 0 0', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 22 }}>
          {[['Find it', 'Search by part number, by size, or simply by name.'], ['Ask for a quote', 'Add what you need and leave your number. No long WhatsApp threads.'], ['We confirm, you pay', 'The shop calls to confirm price, stock and delivery. You pay when you agree.']].map(([t, d], i) => (
            <li key={t} style={{ position: 'relative', display: 'flex', gap: 14 }}>
              <span className="tabular" style={{ display: 'grid', placeItems: 'center', width: 36, height: 36, flex: 'none', borderRadius: 18, background: i === 2 ? '#1B5CF0' : ink, color: '#FFFFFF', fontSize: 15, fontWeight: 650 }}>{i + 1}</span>
              <span><span style={{ display: 'block', fontSize: 17, fontWeight: 600 }}>{t}</span><span style={{ display: 'block', marginTop: 4, fontSize: 14.5, lineHeight: 1.5, color: '#55606C' }}>{d}</span></span>
            </li>
          ))}
        </ol>
        <Link href="/shop" className="press" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 50, marginTop: 26, padding: '0 22px', borderRadius: 15, background: '#1B5CF0', color: '#FFFFFF', fontSize: 15.5, fontWeight: 600, boxShadow: '0 12px 26px rgba(27,92,240,.24)' }}>Start with the shop</Link>
      </section>

      {/* For installers */}
      <section id="trade" aria-labelledby="l-trade" className="l-reveal" style={{ ...wrap, position: 'relative', overflow: 'hidden', boxSizing: 'border-box', marginTop: 14, padding: 'clamp(26px, 4vw, 48px)', borderRadius: 26, background: 'radial-gradient(60% 120% at 90% 0%, rgba(27,92,240,.4), transparent 60%), radial-gradient(40% 80% at 100% 100%, rgba(255,210,94,.14), transparent 60%), #0D131A', color: '#FFFFFF' }}>
        <div style={{ position: 'relative', maxWidth: 640 }}>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: '#8DB0FF' }}>Installers and workshops</span>
          <h2 id="l-trade" style={{ margin: '12px 0 0', fontSize: 'clamp(26px, 3.4vw, 42px)', lineHeight: 1.06, fontWeight: 600, letterSpacing: '-.035em' }}>Your trade price, every time, without asking.</h2>
          <p style={{ margin: '14px 0 0', fontSize: 16, lineHeight: 1.55, color: '#A9B4C0' }}>Once you&apos;re on our trade list, your number is enough. Trade prices apply at the counter and in every quote, and credit terms are available by agreement.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 22 }}>
            {shop?.phone ? <a href={`https://wa.me/${shop.phone}?text=${encodeURIComponent('Hello, I would like to open a trade account.')}`} target="_blank" rel="noopener noreferrer" className="press" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 50, padding: '0 20px', borderRadius: 15, background: '#FFFFFF', color: ink, fontSize: 15.5, fontWeight: 600 }}>Ask on WhatsApp</a> : null}
            <Link href="/shop" className="press" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 50, padding: '0 20px', borderRadius: 15, border: '1px solid rgba(255,255,255,.22)', color: '#FFFFFF', fontSize: 15.5, fontWeight: 550 }}>See prices</Link>
          </div>
        </div>
      </section>

      {/* Visit */}
      <section id="visit" aria-label="Visit us" style={{ ...wrap, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginTop: 14 }}>
        {[
          ['Visit', shop?.address ?? 'Ask us for directions'],
          ['Open', shop?.hours ?? 'Call us for opening hours'],
          ['Call or WhatsApp', shop?.phone ? local(shop.phone) : 'See the shop for contact'],
        ].map(([t, v]) => (
          <div key={t} className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#55606C' }}>{t}</div>
            <div style={{ marginTop: 6, fontSize: 16.5, fontWeight: 600, lineHeight: 1.4 }}>{t === 'Call or WhatsApp' && shop?.phone ? <a href={`tel:+${shop.phone}`}>{v}</a> : v}</div>
          </div>
        ))}
      </section>

      <footer style={{ ...wrap, marginTop: 30, paddingTop: 18, borderTop: '1px solid rgba(16,24,34,.08)', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10, fontSize: 13.5, color: '#55606C' }}>
        <span>© {new Date().getFullYear()} {name}. Prices are today&apos;s shelf prices.</span>
        <Link href="/login" style={{ color: '#434E5A' }}>Staff sign in</Link>
      </footer>

      <style>{`
        .l-link { display: inline-flex; align-items: center; min-height: 44px; padding: 0 12px; border-radius: 11px; font-size: 14px; color: #434E5A; transition: background .18s, color .18s }
        .l-link:hover { background: rgba(16,24,34,.05); color: #10161E }
        .l-aura { position: absolute; z-index: -1; left: 0; right: 0; top: -40px; height: 520px; pointer-events: none;
          background: radial-gradient(40% 50% at 12% 30%, rgba(27,92,240,.10), transparent 70%), radial-gradient(30% 40% at 70% 10%, rgba(255,210,94,.16), transparent 70%) }
        .l-ink { background: linear-gradient(90deg, #1B5CF0, #4F7BF5 60%, #0D9465); -webkit-background-clip: text; background-clip: text; color: transparent }
        .l-search { transition: box-shadow .2s, border-color .2s }
        .l-search:focus-within { border-color: rgba(27,92,240,.35); box-shadow: 0 0 0 4px rgba(27,92,240,.12), 0 14px 32px rgba(16,24,34,.12) }
        .l-chip { position: absolute; display: inline-flex; align-items: center; gap: 8px; padding: 9px 14px 9px 10px; border-radius: 14px; font-size: 13.5px; font-weight: 550; color: #10161E; animation: l-float 6s ease-in-out infinite }
        .l-chip b { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 10px; background: #1B5CF0; color: #FFFFFF; font-size: 12px }
        @keyframes l-float { 50% { transform: translateY(-6px) } }
        @keyframes l-turn { to { transform: rotate(360deg) } }
        @keyframes l-flow { to { stroke-dashoffset: -28 } }
        @keyframes l-fill { 0%, 10% { opacity: .16 } 26%, 100% { opacity: 1 } }
        @keyframes l-blink { 50% { opacity: .35 } }
        .l-rays { animation: l-turn 70s linear infinite }
        .l-spin { animation: l-turn 3.2s linear infinite }
        .l-flow { animation: l-flow 1.4s linear infinite }
        .l-cell { animation: l-fill 7s ease-in-out infinite both }
        .l-led { animation: l-blink 2.4s ease-in-out infinite }
        .l-reveal { opacity: 0; transform: translateY(18px); transition: opacity .7s cubic-bezier(.2,.7,.2,1), transform .7s cubic-bezier(.2,.7,.2,1) }
        .l-reveal.l-in { opacity: 1; transform: none }
        .l-rail::-webkit-scrollbar { display: none } .l-rail { scrollbar-width: none }
        .l-item, .l-kind { transition: transform .24s cubic-bezier(.2,.7,.2,1), box-shadow .24s, border-color .24s }
        .l-item:hover, .l-kind:hover { transform: translateY(-3px); border-color: rgba(27,92,240,.22); box-shadow: 0 18px 38px rgba(16,24,34,.10) }
        .l-go { transition: transform .24s } .l-kind:hover .l-go { transform: translateX(4px) }
        .l-b1 { grid-column: span 3 } .l-b2 { grid-column: span 3 } .l-b3 { grid-column: span 3 } .l-b4 { grid-column: span 3 }
        @media (min-width: 980px) { .l-b1 { grid-column: span 4 } .l-b2 { grid-column: span 2 } .l-b3 { grid-column: span 2 } .l-b4 { grid-column: span 4 } }
        @media (max-width: 860px) { .l-links { display: none !important } }
        @media (max-width: 640px) { .l-b1, .l-b2, .l-b3, .l-b4 { grid-column: span 6 } .l-chip { display: none } }
        @media (prefers-reduced-motion: reduce) {
          .l-rays, .l-spin, .l-flow, .l-cell, .l-led, .l-chip { animation: none } .l-cell { opacity: 1 }
          .l-reveal { opacity: 1; transform: none; transition: none } .l-item:hover, .l-kind:hover { transform: none }
        }
      `}</style>
    </main>
  );
}
