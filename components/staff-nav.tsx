'use client';

// The bar at the top of every back-office screen: the mark, the screens this person's role can
// open, and the page's own controls on the right. It looks the role up itself, once per visit.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { browserDb } from '@/lib/supabase';

export const screens = [
  { href: '/counter', label: 'Counter', about: 'Sell, take payment, close the till.', roles: ['owner', 'counter'] },
  { href: '/stock', label: 'Stock room', about: 'Receive deliveries, pack orders, count shelves.', roles: ['owner', 'storekeeper', 'dispatcher', 'counter', 'accountant'] },
  { href: '/requests', label: 'Requests', about: 'Quote requests from the public shop.', roles: ['owner', 'counter', 'accountant'] },
  { href: '/owner', label: "Owner's day", about: 'Approvals, money in and out, who owes.', roles: ['owner', 'accountant'] },
  { href: '/books', label: 'Books', about: 'The month, entries, the bank and closing.', roles: ['owner', 'accountant'] },
] as const;

let known: string | null = null;

export function Mark({ size = 30 }: { size?: number }) {
  return (
    <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', flex: 'none', width: size, height: size, borderRadius: size * 0.3, background: 'linear-gradient(150deg, #23324A, #10161E)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.14), 0 2px 6px rgba(16,22,30,.18)' }}>
      <svg viewBox="0 0 24 24" width={size * 0.54} height={size * 0.54}><path d="M13.5 2 5 13.2h6L9.8 22 19 10.4h-6.1Z" fill="#FFD25E" /></svg>
    </span>
  );
}

export function StaffNav({ label, wide, children }: { label: string; wide?: number; children?: React.ReactNode }) {
  const path = usePathname();
  const [role, setRole] = useState<string | null>(known);
  useEffect(() => {
    if (known) return;
    let live = true;
    (async () => {
      const db = browserDb();
      const { data } = await db.auth.getSession();
      if (!data.session || !live) return;
      const r = (await db.from('staff').select('role').eq('id', data.session.user.id).maybeSingle()).data?.role ?? null;
      if (!live) return;
      known = r;
      setRole(r);
    })();
    return () => { live = false; };
  }, []);
  const mine = screens.filter((s) => role && (s.roles as readonly string[]).includes(role));
  return (
    <nav aria-label={label} className="glass staff-nav" style={wide ? { maxWidth: wide } : undefined}>
      <Link href="/" className="staff-brand"><Mark />Power Store</Link>
      {mine.length ? (
        <div className="staff-links">
          {mine.map((s) => <Link key={s.href} href={s.href} aria-current={path === s.href ? 'page' : undefined} className="staff-link">{s.label}</Link>)}
        </div>
      ) : null}
      {children ? <div className="staff-tools">{children}</div> : null}
    </nav>
  );
}
