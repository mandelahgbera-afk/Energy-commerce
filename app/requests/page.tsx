'use client';

// Quote requests from the public catalogue, for the counter. "Make the quote" prices it by the
// same rules as any quote (trade prices for trade customers), for the customer found by phone.
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserDb } from '@/lib/supabase';
import { friendly } from '@/lib/errors';
import { formatNaira } from '@/lib/money';
import { Tick } from '@/components/kit/feel';

type Request = { id: string; request_no: string; name: string; phone: string; email: string | null; note: string | null; created_at: string;
  lines: { product_id: string; sku: string; name: string; qty: number | string; price: number | string; active: boolean }[] };
const ghost = { minHeight: 44, padding: '0 14px', border: '1px solid rgba(16,24,34,.16)', borderRadius: 12, background: '#FFFFFF', color: '#10161E', font: '500 14px Geist, system-ui, sans-serif', cursor: 'pointer' } as const;
const local = (phone: string) => (phone.startsWith('234') ? `0${phone.slice(3)}` : phone);
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

export default function Requests() {
  const db = useRef(browserDb()).current;
  const [me, setMe] = useState<undefined | null | { role: string | null }>(undefined);
  const [rows, setRows] = useState<Request[] | null>(null);
  const [shop, setShop] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: e } = await db.rpc('open_quote_requests');
    if (e) { const [n, ...rest] = e.message.split(':'); setError(friendly(n, rest.join(':').trim())); return; }
    setRows(data as Request[]);
  }, [db]);
  useEffect(() => {
    (async () => {
      const { data: s } = await db.auth.getSession();
      if (!s.session) { setMe(null); return; }
      const staff = await db.from('staff').select('role').eq('id', s.session.user.id).maybeSingle();
      setMe({ role: staff.data?.role ?? null });
      const loc = await db.from('locations').select('id').eq('kind', 'shop').limit(1);
      setShop(loc.data?.[0]?.id ?? null);
    })();
  }, [db]);
  const waiting = rows?.filter((r) => !done[r.id]).length ?? 0;
  const allowed = ['owner', 'counter', 'accountant'].includes(me?.role ?? '');
  useEffect(() => { if (allowed) void load(); }, [allowed, load]);

  const act = async (r: Request, quote: boolean) => {
    setBusy(r.id);
    setError(null);
    const res = quote ? await db.rpc('quote_from_request', { p_request: r.id, p_location: shop }) : await db.rpc('close_quote_request', { p_request: r.id, p_reason: 'Closed from the request list' });
    if (res.error) { setBusy(null); const [n, ...rest] = res.error.message.split(':'); setError(friendly(n, rest.join(':').trim())); return; }
    let text = 'Closed. Nothing was quoted.';
    if (quote) {
      const q = await db.from('quotes').select('quote_no, total_kobo').eq('id', res.data as string).maybeSingle();
      text = `Quote ${q.data?.quote_no ?? ''} made for ${formatNaira(q.data?.total_kobo ?? 0)}. Call ${r.name} on ${local(r.phone)}.`;
    }
    setBusy(null);
    setDone((d) => ({ ...d, [r.id]: text }));
  };

  if (me === undefined) return <main style={{ minHeight: '100vh' }} aria-busy="true" />;
  if (me === null || !allowed) {
    return (
      <main className="mx-auto max-w-sm px-5 py-20 text-center">
        <p className="text-lg font-semibold">{me === null ? 'Sign in to see quote requests.' : 'Quote requests are for the counter.'}</p>
        <Link href={me === null ? '/login' : '/'} className="press mt-4 inline-flex h-12 items-center rounded-field bg-action px-6 text-sm font-medium text-white">{me === null ? 'Sign in' : 'Back'}</Link>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '12px clamp(10px, 2vw, 28px) 40px' }}>
      <nav aria-label="Staff" className="glass" style={{ position: 'sticky', top: 12, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '6px 18px', borderRadius: 18, maxWidth: 900, margin: '0 auto' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, fontWeight: 650, fontSize: 17, letterSpacing: '-.02em' }}>Quote requests</span>
        <Link href="/shop" style={{ fontSize: 14, color: '#434E5A' }}>See the public shop</Link>
      </nav>
      <div style={{ maxWidth: 900, margin: '18px auto 0' }}>
        <h1 style={{ margin: '0 2px', fontSize: 'clamp(24px, 3vw, 32px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-.028em' }}>{rows === null ? 'Getting the requests…' : waiting === 0 ? 'No requests waiting.' : `${waiting} ${waiting === 1 ? 'request' : 'requests'} waiting`}</h1>
        <p style={{ margin: '6px 2px 14px', fontSize: 15, color: '#434E5A' }}>From the public shop. The quote uses today&apos;s prices, and trade prices for trade customers.</p>
        {error ? <p role="alert" style={{ margin: '0 2px 12px', padding: '10px 14px', borderRadius: 12, background: '#FDF3E7', color: '#92400E', fontSize: 14.5 }}>{error}</p> : null}
        <div style={{ display: 'grid', gap: 10 }}>
          {rows?.map((r) => {
            const total = r.lines.reduce((s, l) => s + Math.round(Number(l.price) * Number(l.qty)), 0);
            return (
              <article key={r.id} className="card rise" style={{ padding: 18, background: done[r.id] ? '#EEF9F4' : '#FFFFFF' }}>
                {done[r.id] ? <div aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 15, fontWeight: 550 }}><Tick size={20} stroke="#0D9465" />{done[r.id]}</div> : (
                  <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1B5CF0' }}>{r.request_no} · {ago(r.created_at)}</div>
                        <div style={{ marginTop: 2, fontSize: 16.5, fontWeight: 600 }}>{r.name}, <a href={`tel:+${r.phone}`} style={{ color: '#10161E' }}>{local(r.phone)}</a></div>
                        {r.note ? <div style={{ marginTop: 3, fontSize: 14, color: '#434E5A' }}>&ldquo;{r.note}&rdquo;</div> : null}
                      </div>
                      <div className="tabular" style={{ textAlign: 'right' }}><div style={{ fontSize: 13, color: '#55606C' }}>At shelf prices</div><div style={{ fontSize: 18, fontWeight: 650 }}>{formatNaira(total)}</div></div>
                    </div>
                    <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
                      {r.lines.map((l) => <li key={l.product_id} className="tabular" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0', borderTop: '1px solid #F1F3F5', fontSize: 14.5 }}><span>{String(Number(l.qty))} × {l.name}{l.active ? '' : ' (no longer sold)'}</span><span>{formatNaira(Math.round(Number(l.price) * Number(l.qty)))}</span></li>)}
                    </ul>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
                      <button type="button" disabled={busy === r.id} onClick={() => void act(r, false)} style={ghost}>Close</button>
                      <button type="button" disabled={busy === r.id || !shop} onClick={() => void act(r, true)} style={{ ...ghost, border: 0, background: '#10161E', color: '#FFFFFF' }}>{busy === r.id ? 'Making it…' : 'Make the quote'}</button>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}
