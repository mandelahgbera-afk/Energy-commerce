'use client';

// The customer's own page: what they own, when the warranty runs, and how each unit is doing.
// Anyone holding the private link on a receipt sees that order's units; a signed-in customer
// sees everything they own. This is a health record, not a live monitor, and nothing here
// controls any device.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { browserDb } from '@/lib/supabase';
import { Unit, UnitCard } from '@/components/energy';
import { Mark } from '@/components/staff-nav';

type Shop = { name: string | null; phone: string | null };

export default function MyPage() {
  const db = useRef(browserDb()).current;
  const [who, setWho] = useState<'loading' | 'guest' | 'customer' | 'staff'>('loading');
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data: s } = await db.auth.getSession();
      if (s.session) {
        const staff = await db.from('staff').select('role').eq('id', s.session.user.id).maybeSingle();
        if (staff.data?.role) { if (live) setWho('staff'); return; }
        const { data, error: e } = await db.rpc('my_equipment');
        if (!live) return;
        if (e) { setError(e.message.split(':')[0]); setWho('guest'); return; }
        setUnits((data ?? []) as Unit[]);
        setWho('customer');
        return;
      }
      const token = new URLSearchParams(window.location.search).get('r');
      if (token) {
        const { data, error: e } = await db.rpc('receipt_equipment', { p_token: token });
        if (!live) return;
        if (e) setError(e.message.split(':')[0]);
        setUnits((data ?? []) as Unit[]);
        setWho('guest');
        return;
      }
      setWho('guest');
    })();
    return () => { live = false; };
  }, [db]);

  useEffect(() => { void db.rpc('shop_details').then(({ data }) => { if (data) setShop(data as Shop); }); }, [db]);

  if (who === 'loading') return <main style={{ minHeight: '100vh' }} aria-busy="true" />;

  if (who === 'staff') {
    return (
      <main className="mx-auto max-w-sm px-5 py-20 text-center">
        <p className="text-lg font-semibold">This page is for customers.</p>
        <p style={{ color: '#55606C', margin: '6px 0 0', fontSize: 14.5 }}>The readings screen is on your staff bar.</p>
        <Link href="/" className="press mt-4 inline-flex h-12 items-center rounded-field bg-action px-6 text-sm font-medium text-white">Back</Link>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '12px clamp(10px, 2vw, 28px) 48px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Mark size={30} />
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>Power Store</span>
        </div>
        <h1 style={{ margin: '22px 2px 6px', fontSize: 'clamp(26px, 3vw, 34px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-.03em' }}>Your health record</h1>
        <p style={{ margin: '0 2px 16px', fontSize: 14.5, color: '#55606C', lineHeight: 1.5 }}>
          What you own, when the warranty runs, and how each unit is doing. Checks are recorded at sale, set-up and service, and the shop sees them too, so a fault is proven instead of argued. Nothing here controls your equipment.
        </p>
        {error ? (
          <p role="alert" style={{ margin: '0 2px 16px', padding: '10px 14px', borderRadius: 12, background: '#FDF3E7', color: '#92400E', fontSize: 14.5 }}>
            {error === 'no_such_order' ? 'That link does not match any order. Check the link, or ask the shop.' : error === 'not_allowed' ? 'This record needs your own login, or the link on your receipt.' : 'Could not open the record. Try again, or ask the shop.'}
          </p>
        ) : null}
        {units !== null && units.length === 0 && !error ? (
          <div className="card rise" style={{ padding: '34px 20px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 16.5, fontWeight: 600 }}>{who === 'guest' ? 'No units on this receipt' : 'Nothing on record yet'}</p>
            <p style={{ margin: '6px auto 0', maxWidth: 380, fontSize: 14.5, lineHeight: 1.5, color: '#55606C' }}>
              {who === 'guest' ? 'This order\u2019s equipment appears here once it is handed over.' : 'Anything you buy that carries a serial number appears here after it is delivered.'}
            </p>
          </div>
        ) : null}
        {units !== null && units.length > 0 ? (
          <div style={{ display: 'grid', gap: 12 }}>
            {units.map((u) => <UnitCard key={u.id} unit={u} />)}
          </div>
        ) : null}
        {who === 'guest' ? (
          <div className="card" style={{ marginTop: 14, padding: '14px 16px' }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Questions? Ask the shop.</p>
            <p style={{ margin: '4px 0 0', fontSize: 13.5, color: '#55606C', lineHeight: 1.5 }}>
              {shop?.name ? `${shop.name}. ` : ''}A check at the shop is free, and the record here shows what it found.
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
              {shop?.phone ? (
                <a href={`https://wa.me/${shop.phone}`} target="_blank" rel="noopener noreferrer" className="press" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 16px', borderRadius: 12, background: '#0A6E4B', color: '#fff', fontSize: 14, fontWeight: 500 }}>WhatsApp the shop</a>
              ) : null}
              <Link href="/shop" className="press" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 16px', borderRadius: 12, border: '1px solid rgba(16,24,34,.14)', color: '#10161E', fontSize: 14, fontWeight: 500 }}>Browse the shop</Link>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
