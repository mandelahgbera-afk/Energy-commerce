'use client';

// Quote requests from the public catalogue, for the counter. "Make the quote" prices it by the
// same rules as any quote (trade prices for trade customers), for the customer found by phone.
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserDb } from '@/lib/supabase';
import { friendly } from '@/lib/errors';
import { formatNaira } from '@/lib/money';
import { lineTotalKobo } from '@/lib/sale-math';
import { Spinner, Tick } from '@/components/kit/feel';
import { StaffNav } from '@/components/staff-nav';

type Request = { id: string; request_no: string; name: string; phone: string; email: string | null; note: string | null; created_at: string;
  lines: { product_id: string; sku: string; name: string; qty: number | string; price: number | string; active: boolean }[] };
const reasons = ['Out of stock', 'Customer changed their mind', 'Could not reach them', 'Asked twice'];
const ghost = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 44, padding: '0 14px', border: '1px solid rgba(16,24,34,.14)', borderRadius: 12, background: '#FFFFFF', color: '#10161E', font: '500 14px var(--sans)', cursor: 'pointer' } as const;
const local = (phone: string) => (phone.startsWith('234') ? `0${phone.slice(3)}` : phone);
const line = (l: Request['lines'][number]) => { try { return lineTotalKobo(BigInt(l.price), String(l.qty)); } catch { return 0n; } };
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const errorOf = (message: string) => { const [n, ...rest] = message.split(':'); return friendly(n, rest.join(':').trim()); };

export default function Requests() {
  const db = useRef(browserDb()).current;
  const [me, setMe] = useState<undefined | null | { role: string | null }>(undefined);
  const [rows, setRows] = useState<Request[] | null>(null);
  const [shop, setShop] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: e } = await db.rpc('open_quote_requests');
    if (e) { setError(errorOf(e.message)); return; }
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
  const allowed = ['owner', 'counter', 'accountant'].includes(me?.role ?? '');
  useEffect(() => { if (allowed) void load(); }, [allowed, load]);
  // New requests arrive from the street: look again whenever the counter comes back to this tab.
  useEffect(() => {
    if (!allowed) return;
    const again = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
  }, [allowed, load]);

  const act = async (r: Request, reason: string | null) => {
    setBusy(r.id);
    setError(null);
    const res = reason === null ? await db.rpc('quote_from_request', { p_request: r.id, p_location: shop }) : await db.rpc('close_quote_request', { p_request: r.id, p_reason: reason });
    if (res.error) { setBusy(null); setError(errorOf(res.error.message)); return; }
    let text = `Closed: ${reason}. Nothing was quoted.`;
    if (reason === null) {
      const q = await db.from('quotes').select('quote_no, total_kobo').eq('id', res.data as string).maybeSingle();
      text = `Quote ${q.data?.quote_no ?? ''} made for ${formatNaira(q.data?.total_kobo ?? 0)}. Call ${r.name} on ${local(r.phone)}.`;
    }
    setBusy(null);
    setClosing(null);
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

  const waiting = rows?.filter((r) => !done[r.id]).length ?? 0;
  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '12px clamp(10px, 2vw, 28px) 40px' }}>
      <StaffNav label="Staff" wide={900}>
        <button type="button" onClick={() => void load()} className="press" style={{ ...ghost, minHeight: 40, borderColor: 'rgba(16,24,34,.1)' }}>Look again</button>
      </StaffNav>
      <div style={{ maxWidth: 900, margin: '22px auto 0' }}>
        <h1 aria-live="polite" style={{ margin: '0 2px', fontSize: 'clamp(26px, 3vw, 34px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-.03em' }}>{rows === null ? 'Getting the requests…' : waiting === 0 ? 'No requests waiting.' : `${waiting} ${waiting === 1 ? 'request' : 'requests'} waiting`}</h1>
        <p style={{ margin: '6px 2px 16px', fontSize: 15, color: '#434E5A' }}>From the <Link href="/shop" style={{ color: '#1B5CF0', fontWeight: 500 }}>public shop</Link>. The quote uses today&apos;s prices, and trade prices for trade customers.</p>
        {error ? <p role="alert" style={{ margin: '0 2px 12px', padding: '10px 14px', borderRadius: 12, background: '#FDF3E7', color: '#92400E', fontSize: 14.5 }}>{error}</p> : null}
        {rows !== null && rows.length === 0 ? (
          <div className="card rise" style={{ padding: '34px 20px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 16.5, fontWeight: 600 }}>All caught up</p>
            <p style={{ margin: '6px auto 0', maxWidth: 380, fontSize: 14.5, lineHeight: 1.5, color: '#55606C' }}>When someone asks for a quote on the shop, it appears here with their number and what they need.</p>
          </div>
        ) : null}
        <div style={{ display: 'grid', gap: 12 }}>
          {rows?.map((r, i) => {
            const total = r.lines.reduce((s, l) => s + line(l), 0n);
            const isBusy = busy === r.id;
            return (
              <article key={r.id} className="card rise" style={{ padding: 18, animationDelay: `${Math.min(i, 6) * 40}ms`, background: done[r.id] ? '#F3FAF7' : '#FFFFFF', borderColor: done[r.id] ? 'rgba(13,148,101,.18)' : undefined, transition: 'background .3s' }}>
                {done[r.id] ? (
                  <div aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 15, fontWeight: 550 }}>
                    <span style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, flex: 'none', borderRadius: 14, background: '#0D9465' }}><Tick size={16} /></span>{done[r.id]}
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ display: 'flex', gap: 12, minWidth: 0 }}>
                        <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 42, height: 42, flex: 'none', borderRadius: 21, background: 'linear-gradient(160deg, #EEF3FF, #E0E8FD)', color: '#1B5CF0', fontSize: 16, fontWeight: 650 }}>{r.name.trim().charAt(0).toUpperCase()}</span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: '-.01em' }}>{r.name}</div>
                          <div className="tabular" style={{ marginTop: 2, fontSize: 13.5, color: '#55606C' }}><span style={{ fontFamily: 'var(--mono)' }}>{r.request_no}</span> · {ago(r.created_at)} · {local(r.phone)}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}><div style={{ fontSize: 12.5, color: '#55606C' }}>At shelf prices</div><div className="tabular" style={{ fontSize: 19, fontWeight: 650, letterSpacing: '-.02em' }}>{formatNaira(total)}</div></div>
                    </div>
                    {r.note ? <p style={{ margin: '12px 0 0', padding: '10px 14px', borderRadius: 12, background: '#F6F8FA', borderLeft: '3px solid #1B5CF0', fontSize: 14.5, lineHeight: 1.45, color: '#2A3441' }}>{r.note}</p> : null}
                    <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
                      {r.lines.map((l) => (
                        <li key={l.product_id} className="tabular" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderTop: '1px solid rgba(16,24,34,.06)', fontSize: 14.5 }}>
                          <span><span style={{ fontWeight: 600 }}>{String(Number(l.qty))} ×</span> {l.name}{l.active ? '' : <span style={{ color: '#92400E' }}> (no longer sold)</span>}</span><span>{formatNaira(line(l))}</span>
                        </li>
                      ))}
                    </ul>
                    {closing === r.id ? (
                      <div className="rise" role="group" aria-label="Why close it" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 14 }}>
                        <span style={{ fontSize: 14, color: '#434E5A', marginRight: 4 }}>Why close it?</span>
                        {reasons.map((why) => <button key={why} type="button" disabled={isBusy} onClick={() => void act(r, why)} className="press" style={{ ...ghost, minHeight: 40, borderRadius: 20 }}>{why}</button>)}
                        <button type="button" onClick={() => setClosing(null)} style={{ ...ghost, minHeight: 40, border: 0, background: 'transparent', color: '#55606C' }}>Keep it</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
                        <a href={`tel:+${r.phone}`} className="press" style={ghost}>Call</a>
                        <a href={`https://wa.me/${r.phone}`} target="_blank" rel="noopener noreferrer" className="press" style={ghost}>WhatsApp</a>
                        <button type="button" disabled={isBusy} onClick={() => setClosing(r.id)} className="press" style={ghost}>Close</button>
                        <button type="button" disabled={isBusy || !shop} onClick={() => void act(r, null)} className="press" style={{ ...ghost, border: 0, background: '#10161E', color: '#FFFFFF', boxShadow: '0 6px 16px rgba(16,22,30,.18)' }}>{isBusy ? <><Spinner size={16} />Making it…</> : 'Make the quote'}</button>
                      </div>
                    )}
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
