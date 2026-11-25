'use client';

// The customer's own page, from the private link on their receipt or in the shop's WhatsApp message.
// No account. One plain stage at a time, the day, the rider's name and last point, the 4-digit code
// to give the rider, and a button to drop their own pin. Evidence for each part:
// docs/plans/2026-11-25-orders-tracking-crm.md, decisions 1 to 7.
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browserDb } from '@/lib/supabase';
import { formatNaira } from '@/lib/money';
import { ago, dayWords, errorOf, timeWords, type Stage } from '@/lib/orders';
import { Spinner, Tick } from '@/components/kit/feel';
import { Mark } from '@/components/staff-nav';
import type { MapPoint } from '@/components/shop-map';

const ShopMap = dynamic(() => import('@/components/shop-map'), { ssr: false, loading: () => <div className="shop-map" style={{ height: 280 }} /> });

type Track = {
  invoice_no: string | null; stage: Stage; placed_at: string; paid_at: string | null; delivered_at: string | null;
  total: number | string; paid: number | string; balance: number | string; on_credit: boolean;
  items: { name: string; qty: number | string; unit: string }[];
  delivery: null | { status: 'booked' | 'out' | 'delivered'; address: string; landmark: string | null; lat: number | null; lng: number | null; scheduled_on: string; time_of_day: string | null;
    tries: number; rider: string | null; rider_lat: number | null; rider_lng: number | null; rider_seen_at: string | null; code: string | null };
  events: { kind: string; at: string; note: string | null }[];
  shop: { name: string | null; phone: string | null };
};

const ghost = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 48, padding: '0 16px', border: '1px solid rgba(16,24,34,.14)', borderRadius: 13, background: '#FFFFFF', color: '#10161E', font: '550 15px var(--sans)', cursor: 'pointer', textDecoration: 'none' } as const;
const solid = { ...ghost, border: 0, background: '#1B5CF0', color: '#FFFFFF', font: '600 15px var(--sans)', boxShadow: '0 10px 24px rgba(27,92,240,.24)' } as const;
const when = (iso: string) => new Date(iso).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Africa/Lagos' });

export default function TrackPage() {
  const db = useRef(browserDb()).current;
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [t, setT] = useState<Track | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState<{ lat: number; lng: number } | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinNote, setPinNote] = useState<string | null>(null);

  const load = useCallback(async (r: string) => {
    const { data, error } = await db.rpc('track_order', { p_token: r });
    if (error) { setProblem(error.message.startsWith('no_such_order') || error.message.includes('uuid') ? 'This link does not match an order. Use the link from your receipt or from the shop’s message.' : errorOf(error.message)); return; }
    setProblem(null);
    setT(data as Track);
  }, [db]);
  useEffect(() => { setToken(new URLSearchParams(window.location.search).get('r')); }, []);
  useEffect(() => { if (token) void load(token); }, [token, load]);
  // Look again every 30 seconds while the rider is out, every two minutes otherwise, and on return.
  useEffect(() => {
    if (!token || !t || ['delivered', 'cancelled'].includes(t.stage)) return;
    const again = () => { if (document.visibilityState === 'visible') void load(token); };
    const timer = window.setInterval(again, t.stage === 'on_the_way' ? 30000 : 120000);
    document.addEventListener('visibilitychange', again);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', again); };
  }, [token, t, load]);

  const d = t?.delivery ?? null;
  const canPin = Boolean(d && d.status !== 'delivered' && t && !['delivered', 'cancelled'].includes(t.stage));
  const points = useMemo<MapPoint[]>(() => {
    const out: MapPoint[] = [];
    const drop = pending ?? (d?.lat != null && d?.lng != null ? { lat: d.lat, lng: d.lng } : null);
    if (drop) out.push({ id: 'drop', ...drop, kind: 'drop', label: pending ? 'Your new pin' : 'Your drop' });
    if (d?.status === 'out' && d.rider_lat != null && d.rider_lng != null) out.push({ id: 'rider', lat: d.rider_lat, lng: d.rider_lng, kind: 'rider', label: d.rider ?? 'Rider' });
    return out;
  }, [d, pending]);

  const savePin = async (p: { lat: number; lng: number }) => {
    if (!token || pinBusy) return;
    setPinBusy(true);
    setPinNote(null);
    const { error } = await db.rpc('set_drop_pin', { p_token: token, p_lat: p.lat, p_lng: p.lng });
    setPinBusy(false);
    if (error) { setPinNote(errorOf(error.message)); return; }
    setPending(null);
    setPinNote('Pin saved. The rider will go straight there.');
    void load(token);
  };
  const useMyLocation = () => {
    if (!navigator.geolocation) { setPinNote('This phone cannot share its location here. Tap the map where you are instead.'); return; }
    setPinBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setPinBusy(false); setPending({ lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) }); setPinNote('Is this the right place? Save it, or tap the map to move it.'); },
      () => { setPinBusy(false); setPinNote('Location is off or blocked. Tap the map where you are instead.'); },
      { enableHighAccuracy: true, timeout: 20000 },
    );
  };

  if (token === undefined || (token && !t && !problem)) {
    return <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }} aria-busy="true"><span style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#55606C' }}><Spinner size={18} stroke="#1B5CF0" />Finding your order…</span></main>;
  }
  if (!token || problem || !t) {
    return (
      <main className="mx-auto max-w-sm px-5 py-20 text-center">
        <Mark size={44} />
        <p className="mt-5 text-lg font-semibold">{problem ?? 'Open this page from the link on your receipt or in the shop’s message.'}</p>
      </main>
    );
  }

  const steps = d ? ['Placed', 'Paid', 'On the way', 'Delivered'] : ['Placed', 'Paid', 'Collected'];
  const reached = t.stage === 'delivered' ? steps.length : t.stage === 'on_the_way' ? 3 : t.stage === 'paid' ? 2 : 1;
  const balance = BigInt(String(t.balance));
  const failed = t.events.filter((e) => e.kind === 'failed');
  const headline = t.stage === 'cancelled' ? 'This order was cancelled'
    : t.stage === 'delivered' ? (d ? 'Delivered' : 'Collected')
    : t.stage === 'on_the_way' ? `${d?.rider ?? 'Your rider'} is on the way`
    : t.stage === 'paid' ? (d ? `Coming ${dayWords(d.scheduled_on)}` : 'Paid and ready for you')
    : t.stage === 'approval' ? 'The shop is checking your order' : 'We have your order';
  const sub = t.stage === 'cancelled' ? 'Nothing more will happen with it. Call the shop with any question.'
    : t.stage === 'delivered' ? (t.delivered_at ? when(t.delivered_at) : '')
    : t.stage === 'on_the_way' ? (d?.rider_seen_at ? `Last seen ${ago(d.rider_seen_at)}.` : 'Keep your phone near you.') + ' Have your code ready.'
    : t.stage === 'paid' ? (d ? `${d.time_of_day ? `In the ${timeWords[d.time_of_day]}. ` : ''}We will tell you when the rider leaves.` : 'Come to the shop with this page or your receipt.')
    : balance > 0n && !t.on_credit ? `${formatNaira(balance)} to pay before it can leave the shop.` : 'It moves as soon as the shop has checked it.';

  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '16px clamp(12px, 3vw, 28px) 48px' }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 16, fontWeight: 650 }}><Mark />{t.shop.name ?? 'Power Store'}</span>
          {t.shop.phone ? <a href={`tel:${t.shop.phone}`} className="press" style={{ ...ghost, minHeight: 40, fontSize: 14 }}>Call the shop</a> : null}
        </header>

        <section aria-labelledby="h" className="card rise" style={{ marginTop: 18, padding: 'clamp(18px, 4vw, 26px)' }}>
          <p style={{ margin: 0, fontSize: 13, color: '#55606C', fontFamily: 'var(--mono)' }}>{t.invoice_no ?? 'Your order'}</p>
          <h1 id="h" aria-live="polite" style={{ margin: '6px 0 0', fontSize: 'clamp(26px, 6vw, 34px)', lineHeight: 1.1, fontWeight: 650, letterSpacing: '-.03em' }}>{headline}</h1>
          <p style={{ margin: '8px 0 18px', fontSize: 15.5, lineHeight: 1.5, color: '#434E5A' }}>{sub}</p>
          {t.stage !== 'cancelled' ? (
            <ol className="track-steps" aria-label="Where your order is" style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}>
              {steps.map((s, i) => <li key={s} data-done={i < reached || undefined} data-now={i === reached - 1 && t.stage !== 'delivered' ? '' : undefined} aria-current={i === reached - 1 ? 'step' : undefined}>{s}</li>)}
            </ol>
          ) : null}
        </section>

        {d?.code && t.stage !== 'delivered' ? (
          <section aria-labelledby="code" className="card rise" style={{ marginTop: 12, padding: 20, background: 'linear-gradient(160deg, #FFFFFF, #F2F6FF)' }}>
            <h2 id="code" style={{ margin: 0, fontSize: 15, fontWeight: 650 }}>Your delivery code</h2>
            <p className="code-digits" style={{ margin: '6px 0 4px' }} aria-label={d.code.split('').join(' ')}>{d.code}</p>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: '#434E5A' }}>Read it to the rider once you have the goods and have checked them. Nobody from the shop will ask for it on the phone.</p>
          </section>
        ) : null}

        {d && t.stage !== 'cancelled' ? (
          <section aria-labelledby="where" className="card rise" style={{ marginTop: 12, padding: 18 }}>
            <h2 id="where" style={{ margin: 0, fontSize: 15, fontWeight: 650 }}>{t.stage === 'delivered' ? 'Delivered to' : 'Delivering to'}</h2>
            <p style={{ margin: '4px 0 0', fontSize: 15.5, lineHeight: 1.45 }}>{d.address}</p>
            {d.landmark ? <p style={{ margin: '2px 0 0', fontSize: 14, color: '#55606C' }}>Landmark: {d.landmark}</p> : null}
            {t.stage !== 'delivered' ? <p style={{ margin: '6px 0 0', fontSize: 14, color: '#434E5A' }}>{dayWords(d.scheduled_on, d.time_of_day ? timeWords[d.time_of_day] : null)}</p> : null}
            {failed.length && t.stage !== 'delivered' ? (
              <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: 6 }}>
                {failed.map((f) => <li key={f.at} style={{ padding: '8px 12px', borderRadius: 10, background: '#FFF9EB', fontSize: 14, color: '#5A3D00' }}>We tried {when(f.at)}: {f.note}</li>)}
              </ul>
            ) : null}
            {(points.length || canPin) && t.stage !== 'delivered' ? (
              <div style={{ marginTop: 14 }}>
                <ShopMap points={points} label={d.status === 'out' ? 'Your drop and the rider' : 'Your drop'} onPick={canPin ? (lat, lng) => { setPending({ lat, lng }); setPinNote('Is this the right place? Save it, or tap again to move it.'); } : undefined} height={280} />
                {d.status === 'out' && d.rider_seen_at ? <p style={{ margin: '8px 2px 0', fontSize: 13.5, color: '#55606C' }}>{d.rider} was last seen {ago(d.rider_seen_at)}. The map shows the last point their phone sent.</p> : null}
              </div>
            ) : null}
            {canPin ? (
              <div style={{ marginTop: 12 }}>
                <p style={{ margin: '0 0 8px', fontSize: 14, color: '#434E5A' }}>{d.lat === null ? 'Help the rider find you: drop a pin where the goods should go.' : 'Moved? Drop a new pin.'}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {pending ? <button type="button" onClick={() => void savePin(pending)} disabled={pinBusy} className="press" style={solid}>{pinBusy ? 'Saving…' : 'Save this pin'}</button> : null}
                  <button type="button" onClick={useMyLocation} disabled={pinBusy} className="press" style={pending ? ghost : solid}>{pinBusy && !pending ? 'Finding you…' : 'Use where I am now'}</button>
                </div>
                {pinNote ? <p role="status" style={{ margin: '8px 2px 0', fontSize: 14, color: '#434E5A', display: 'flex', alignItems: 'center', gap: 8 }}>{pinNote.startsWith('Pin saved') ? <Tick size={16} stroke="#0D9465" /> : null}{pinNote}</p> : null}
              </div>
            ) : null}
          </section>
        ) : null}

        <section aria-labelledby="what" className="card rise" style={{ marginTop: 12, padding: 18 }}>
          <h2 id="what" style={{ margin: 0, fontSize: 15, fontWeight: 650 }}>What you ordered</h2>
          <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
            {t.items.map((it, i) => <li key={`${it.name}-${i}`} style={{ padding: '8px 0', borderTop: i ? '1px solid rgba(16,24,34,.06)' : 0, fontSize: 15 }}><strong>{String(Number(it.qty))} ×</strong> {it.name}</li>)}
          </ul>
          <dl className="tabular" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 12px', margin: '10px 0 0', paddingTop: 10, borderTop: '1px solid rgba(16,24,34,.08)', fontSize: 14.5 }}>
            <dt style={{ color: '#55606C' }}>Total</dt><dd style={{ margin: 0, fontWeight: 600 }}>{formatNaira(t.total)}</dd>
            <dt style={{ color: '#55606C' }}>Paid</dt><dd style={{ margin: 0 }}>{formatNaira(t.paid)}</dd>
            {balance > 0n ? <><dt style={{ color: '#92400E', fontWeight: 600 }}>{t.on_credit ? 'On your account' : 'To pay'}</dt><dd style={{ margin: 0, color: '#92400E', fontWeight: 650 }}>{formatNaira(balance)}</dd></> : null}
          </dl>
        </section>
        <p style={{ margin: '18px 4px 0', fontSize: 12.5, lineHeight: 1.5, color: '#6B7682' }}>This page is private to you. Anyone with the link can see it, so share it only with the person receiving the goods.</p>
      </div>
    </main>
  );
}
