'use client';

// The front door. Staff see the screens their role can open; anyone else is pointed to the shop.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { browserDb, connected } from '@/lib/supabase';
import { Mark, StaffNav, screens } from '@/components/staff-nav';

const icon: Record<string, string> = {
  '/counter': 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2ZM9 8h6M9 12h6',
  '/stock': 'M3 8l9-5 9 5v8l-9 5-9-5ZM3 8l9 5 9-5M12 13v8',
  '/requests': 'M4 4h16v12H9l-5 4ZM8 9h8M8 12h5',
  '/owner': 'M4 20V11M10 20V5M16 20v-6M2 20h20',
  '/books': 'M5 3h11l3 3v15H5ZM9 9h6M9 13h6M9 17h4',
  '/shop': 'M3 9l2-5h14l2 5M4 9v11h16V9M9 20v-6h6v6',
  '/import': 'M4 3h10l6 6v12H4ZM14 3v6h6M8 13h8M8 17h8M8 9h3',
  '/settings':'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
};
const roleName: Record<string, string> = { owner: 'Owner', counter: 'Counter', accountant: 'Accountant', storekeeper: 'Storekeeper', dispatcher: 'Dispatcher' };
const greet = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

function Tile({ href, label, about, i }: { href: string; label: string; about: string; i: number }) {
  return (
    <Link href={href} className="card rise home-tile" style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: 18, animationDelay: `${i * 40}ms` }}>
      <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', flex: 'none', width: 44, height: 44, borderRadius: 13, background: 'linear-gradient(160deg, #EEF3FF, #E3EAFD)' }}>
        <svg viewBox="0 0 24 24" width="22" height="22" style={{ fill: 'none', stroke: '#1B5CF0', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d={icon[href]} /></svg>
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 16.5, fontWeight: 600, letterSpacing: '-.012em' }}>{label}</span>
        <span style={{ display: 'block', marginTop: 3, fontSize: 14, lineHeight: 1.45, color: '#55606C' }}>{about}</span>
      </span>
      <svg aria-hidden="true" className="home-arrow" viewBox="0 0 24 24" width="18" height="18" style={{ flex: 'none', marginTop: 3, fill: 'none', stroke: '#8E99A4', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M9 6l6 6-6 6" /></svg>
    </Link>
  );
}

export default function Home() {
  const [state, setState] = useState<'loading' | 'out' | 'in' | 'offline'>('loading');
  const [me, setMe] = useState<{ name: string; role: string | null; email: string } | null>(null);
  const [day, setDay] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!connected()) { setState('offline'); return; }
      const db = browserDb();
      const { data } = await db.auth.getSession();
      if (!alive) return;
      if (!data.session) { setState('out'); return; }
      const [staff, today] = await Promise.all([
        db.from('staff').select('name, role').eq('id', data.session.user.id).maybeSingle(),
        db.rpc('shop_today'),
      ]);
      if (!alive) return;
      setMe({ name: staff.data?.name ?? '', role: staff.data?.role ?? null, email: data.session.user.email ?? '' });
      if (!today.error) setDay(new Date(`${today.data}T12:00:00`).toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' }));
      setState('in');
    })();
    return () => { alive = false; };
  }, []);

  if (state === 'loading') return <main style={{ minHeight: '100vh' }} aria-busy="true" />;

  if (state !== 'in') {
    return (
      <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', boxSizing: 'border-box', padding: 20 }}>
        <div className="glass rise" style={{ width: '100%', maxWidth: 420, boxSizing: 'border-box', padding: '34px 28px 28px', borderRadius: 26, textAlign: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}><Mark size={52} /></div>
          <h1 style={{ margin: '18px 0 0', fontSize: 28, fontWeight: 600, letterSpacing: '-.03em' }}>Power Store</h1>
          <p style={{ margin: '8px 0 0', fontSize: 15.5, lineHeight: 1.5, color: '#434E5A' }}>Solar panels, batteries and power parts, priced from the shop&apos;s own books.</p>
          {state === 'offline' ? <p role="status" style={{ margin: '16px 0 0', padding: '10px 12px', borderRadius: 12, background: '#FDF3E7', color: '#92400E', fontSize: 14 }}>Not connected yet: fill in .env.local and restart.</p> : null}
          <div style={{ display: 'grid', gap: 8, marginTop: 24 }}>
            <Link href="/shop" className="press" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 52, borderRadius: 15, background: '#1B5CF0', color: '#FFFFFF', fontSize: 16, fontWeight: 600, boxShadow: '0 10px 24px rgba(27,92,240,.26)' }}>Browse the shop</Link>
            <Link href="/login" className="press" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 50, borderRadius: 15, border: '1px solid rgba(16,24,34,.14)', background: '#FFFFFF', fontSize: 15, fontWeight: 550 }}>Staff sign in</Link>
          </div>
        </div>
      </main>
    );
  }

  const mine = screens.filter((s) => me?.role && (s.roles as readonly string[]).includes(me.role));
  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '12px clamp(10px, 2vw, 28px) 40px' }}>
      <StaffNav label="Staff" wide={980}>
        <button type="button" onClick={async () => { await browserDb().auth.signOut(); window.location.reload(); }} className="press" style={{ minHeight: 40, padding: '0 14px', border: '1px solid rgba(16,24,34,.12)', borderRadius: 11, background: '#FFFFFF', color: '#10161E', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>Sign out</button>
      </StaffNav>
      <div style={{ maxWidth: 980, margin: '0 auto' }}>
        <header style={{ padding: 'clamp(26px, 5vw, 48px) 4px 20px' }}>
          <p className="tabular" style={{ margin: 0, fontSize: 14, fontWeight: 550, color: '#1B5CF0' }}>{day ?? 'Today'}{me?.role ? ` · ${roleName[me.role] ?? me.role}` : ''}</p>
          <h1 style={{ margin: '6px 0 0', fontSize: 'clamp(28px, 4vw, 40px)', lineHeight: 1.08, fontWeight: 600, letterSpacing: '-.032em' }}>{greet()}{me?.name ? `, ${me.name}` : ''}.</h1>
          <p style={{ margin: '8px 0 0', fontSize: 15.5, color: '#434E5A' }}>{mine.length ? 'Where to?' : `Signed in as ${me?.email}. Ask the owner to give this login a role.`}</p>
        </header>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {mine.map((s, i) => <Tile key={s.href} href={s.href} label={s.label} about={s.about} i={i} />)}
          <Tile href="/shop" label="Public shop" about="What customers see, with today's prices." i={mine.length} />
        </div>
        <p style={{ margin: '28px 4px 0', fontSize: 13.5, color: '#55606C' }}>
          <Link href="/help" style={{ color: '#434E5A' }}>Help</Link> · <Link href="/kit" style={{ color: '#434E5A' }}>Component kit</Link>
        </p>
      </div>
      <style>{`
        .home-tile { transition: transform .24s cubic-bezier(.2,.7,.2,1), box-shadow .24s, border-color .24s; }
        .home-tile:hover { transform: translateY(-2px); border-color: rgba(27,92,240,.22); box-shadow: 0 16px 36px rgba(16,24,34,.09); }
        .home-arrow { transition: transform .24s cubic-bezier(.2,.7,.2,1), stroke .24s; }
        .home-tile:hover .home-arrow { transform: translateX(3px); stroke: #1B5CF0; }
        @media (hover: none), (prefers-reduced-motion: reduce) { .home-tile:hover, .home-tile:hover .home-arrow { transform: none; } }
      `}</style>
    </main>
  );
}
