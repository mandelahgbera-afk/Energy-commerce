'use client';

// The rider's day: their own drops only, no prices. Call, get directions, then confirm at the door
// with the customer's 4-digit code, which books the sale. A drop that can't happen goes back to the
// shop with a reason the customer sees. While this screen is open the rider can share their last
// point, so the customer sees "seen 2 min ago"; nothing is kept once the drop closes.
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browserDb } from '@/lib/supabase';
import { ago, dayWords, errorOf, localPhone, timeWords, today } from '@/lib/orders';
import { Spinner, Tick } from '@/components/kit/feel';
import { StaffNav } from '@/components/staff-nav';
import type { MapPoint } from '@/components/shop-map';

const ShopMap = dynamic(() => import('@/components/shop-map'), { ssr: false, loading: () => <div className="shop-map" style={{ height: 300 }} /> });

type Drop = { order_id: string; invoice_no: string | null; customer: string | null; contact_name: string | null; contact_phone: string; address: string; landmark: string | null;
  lat: number | null; lng: number | null; scheduled_on: string; time_of_day: string | null; out_at: string; rider: string;
  items: { name: string; qty: number | string; unit: string; serials: string[] }[] };

const ghost = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 48, padding: '0 16px', border: '1px solid rgba(16,24,34,.14)', borderRadius: 13, background: '#FFFFFF', color: '#10161E', font: '550 15px var(--sans)', cursor: 'pointer', textDecoration: 'none' } as const;
const solid = (on: boolean, color = '#1B5CF0') => ({ ...ghost, border: 0, background: on ? color : '#C9D2DC', color: '#FFFFFF', font: '600 15px var(--sans)', cursor: on ? 'pointer' : 'default' }) as const;
const reasons = ['Customer not reachable', 'Nobody at the address', 'Customer asked for another day', 'Could not find the address', 'Customer refused the goods'];
const SEND_EVERY = 30000;

// Google's own directions link: no key, no account, and riders already use the app.
const directions = (d: Drop) => `https://www.google.com/maps/dir/?api=1&destination=${d.lat !== null && d.lng !== null ? `${d.lat},${d.lng}` : encodeURIComponent(d.address)}`;

export default function Rider() {
  const db = useRef(browserDb()).current;
  const [me, setMe] = useState<undefined | null | { role: string | null }>(undefined);
  const [drops, setDrops] = useState<Drop[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState<'off' | 'on' | 'blocked'>('off');
  const [here, setHere] = useState<{ lat: number; lng: number; at: number } | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [finished, setFinished] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const { data, error: e } = await db.rpc('my_drops');
    if (e) { setError(errorOf(e.message)); return; }
    setDrops(data as Drop[]);
  }, [db]);
  useEffect(() => {
    (async () => {
      const { data: s } = await db.auth.getSession();
      if (!s.session) { setMe(null); return; }
      const staff = await db.from('staff').select('role').eq('id', s.session.user.id).maybeSingle();
      setMe({ role: staff.data?.role ?? null });
    })();
  }, [db]);
  const allowed = ['owner', 'driver'].includes(me?.role ?? '');
  useEffect(() => { if (allowed) void load(); }, [allowed, load]);
  useEffect(() => {
    if (!allowed) return;
    const again = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', again);
    const t = window.setInterval(again, 60000);
    return () => { document.removeEventListener('visibilitychange', again); clearInterval(t); };
  }, [allowed, load]);

  // Sends at most every 30 seconds, only while this screen is open and sharing is on.
  const last = useRef(0);
  useEffect(() => {
    if (sharing !== 'on' || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const point = { lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)), at: Date.now() };
        setHere(point);
        if (Date.now() - last.current < SEND_EVERY) return;
        last.current = Date.now();
        void db.rpc('share_position', { p_lat: point.lat, p_lng: point.lng });
      },
      (e) => { if (e.code === e.PERMISSION_DENIED) setSharing('blocked'); },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [sharing, db]);

  const points = useMemo<MapPoint[]>(() => [
    ...(drops ?? []).filter((d) => d.lat !== null && d.lng !== null && !finished[d.order_id]).map((d) => ({ id: d.order_id, lat: d.lat!, lng: d.lng!, kind: 'drop' as const, label: `${d.contact_name ?? d.customer ?? 'Drop'}: ${d.address}` })),
    ...(here ? [{ id: 'me', lat: here.lat, lng: here.lng, kind: 'rider' as const, label: 'You' }] : []),
  ], [drops, here, finished]);

  if (me === undefined) return <main style={{ minHeight: '100vh' }} aria-busy="true" />;
  if (me === null || !allowed) {
    return (
      <main className="mx-auto max-w-sm px-5 py-20 text-center">
        <p className="text-lg font-semibold">{me === null ? 'Sign in to see your drops.' : 'This screen is for riders.'}</p>
        <Link href={me === null ? '/login' : '/'} className="press mt-4 inline-flex h-12 items-center rounded-field bg-action px-6 text-sm font-medium text-white">{me === null ? 'Sign in' : 'Back'}</Link>
      </main>
    );
  }

  const left = (drops ?? []).filter((d) => !finished[d.order_id]);
  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '12px clamp(10px, 2vw, 28px) 48px' }}>
      <StaffNav label="Staff" wide={720}>
        <button type="button" onClick={() => void load()} className="press" style={{ ...ghost, minHeight: 40, borderColor: 'rgba(16,24,34,.1)', fontWeight: 500, fontSize: 14 }}>Look again</button>
      </StaffNav>
      <div style={{ maxWidth: 720, margin: '22px auto 0' }}>
        <h1 aria-live="polite" style={{ margin: '0 2px', fontSize: 'clamp(26px, 3vw, 34px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-.03em' }}>{drops === null ? 'Getting your drops…' : left.length === 0 ? 'No drops right now' : `${left.length} ${left.length === 1 ? 'drop' : 'drops'} to make`}</h1>
        <p style={{ margin: '6px 2px 14px', fontSize: 15, color: '#434E5A' }}>The sale is only recorded when the customer gives you their code.</p>
        {error ? <p role="alert" style={{ margin: '0 2px 12px', padding: '10px 14px', borderRadius: 12, background: '#FDF3E7', color: '#92400E', fontSize: 14.5 }}>{error}</p> : null}

        {left.length ? (
          <div className="card" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: 16, marginBottom: 12 }}>
            <span style={{ flex: 1, minWidth: 200, fontSize: 14.5, lineHeight: 1.45 }}>
              <strong style={{ display: 'block', fontSize: 15 }}>{sharing === 'on' ? 'Customers can see where you are' : 'Let customers see where you are'}</strong>
              <span style={{ color: '#55606C' }}>{sharing === 'blocked' ? 'Location is blocked for this site. Allow it in the browser, then try again.' : sharing === 'on' ? `Only your last point, while this screen is open${here ? `. Updated ${ago(new Date(here.at).toISOString())}` : ''}.` : 'Only your last point, only while this screen is open, and wiped when the drop closes.'}</span>
            </span>
            {sharing === 'on'
              ? <button type="button" onClick={() => setSharing('off')} className="press" style={ghost}>Stop sharing</button>
              : <button type="button" onClick={() => { last.current = 0; setSharing('on'); }} className="press" style={solid(true)}>Share my location</button>}
            {points.length ? <button type="button" onClick={() => setMapOpen((m) => !m)} aria-expanded={mapOpen} className="press" style={ghost}>{mapOpen ? 'Hide the map' : 'Map'}</button> : null}
          </div>
        ) : null}
        {mapOpen && points.length ? <div className="rise" style={{ marginBottom: 12 }}><ShopMap points={points} label="Your drops" height={300} /></div> : null}

        {drops && drops.length === 0 ? (
          <div className="card rise" style={{ padding: '32px 20px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 16.5, fontWeight: 600 }}>All clear</p>
            <p style={{ margin: '6px auto 0', maxWidth: 360, fontSize: 14.5, lineHeight: 1.5, color: '#55606C' }}>When the stock room gives you an order, it appears here with the address and the items.</p>
          </div>
        ) : null}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12 }}>
          {(drops ?? []).map((d) => <DropCard key={d.order_id} db={db} d={d} done={finished[d.order_id]} onDone={(text) => setFinished((f) => ({ ...f, [d.order_id]: text }))} />)}
        </div>
      </div>
    </main>
  );
}

function DropCard({ db, d, done, onDone }: { db: ReturnType<typeof browserDb>; d: Drop; done?: string; onDone: (text: string) => void }) {
  const [mode, setMode] = useState<'idle' | 'code' | 'fail'>('idle');
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const codeBox = useRef<HTMLInputElement>(null);
  // A new step gets a new key, so a code try and a failed drop never share one.
  useEffect(() => { key.current = null; if (mode === 'code') codeBox.current?.focus(); }, [mode]);
  const name = d.contact_name ?? d.customer ?? 'The customer';

  const confirm = async () => {
    if (busy || code.length !== 4) return;
    setBusy(true);
    setProblem(null);
    key.current ??= crypto.randomUUID();
    const { data, error } = await db.rpc('confirm_drop', { p_key: key.current, p_order: d.order_id, p_code: code });
    setBusy(false);
    if (error) { setProblem(errorOf(error.message)); return; }
    const r = data as { delivery?: string; wrong_code?: boolean; tries_left?: number };
    if (r.wrong_code) {
      key.current = null;
      setCode('');
      setProblem(r.tries_left ? `That code is not right. ${r.tries_left} ${r.tries_left === 1 ? 'try' : 'tries'} left. Ask ${name.split(' ')[0]} to read it from their tracking page.` : 'That code is not right, and the tries are used up. Call the shop: a dispatcher can confirm it.');
      codeBox.current?.focus();
      return;
    }
    onDone(`Delivered to ${name}. The sale is recorded.`);
  };
  const fail = async () => {
    if (busy || reason.trim().length < 3) return;
    setBusy(true);
    setProblem(null);
    key.current ??= crypto.randomUUID();
    const { error } = await db.rpc('fail_drop', { p_key: key.current, p_order: d.order_id, p_reason: reason.trim(), p_next_on: next || null });
    setBusy(false);
    if (error) { setProblem(errorOf(error.message)); return; }
    onDone('Not delivered. Bring the goods back to the stock room.');
  };

  if (done) {
    return (
      <div className="card rise" aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 18, background: '#F3FAF7', borderColor: 'rgba(13,148,101,.18)', fontSize: 15.5, fontWeight: 550 }}>
        <span style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, flex: 'none', borderRadius: 14, background: '#0D9465' }}><Tick size={16} /></span>{d.invoice_no}: {done}
      </div>
    );
  }
  return (
    <article className="card rise" style={{ padding: 18 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 17.5, fontWeight: 650, letterSpacing: '-.01em' }}>{name}</div>
          <div className="tabular" style={{ marginTop: 2, fontSize: 13.5, color: '#55606C' }}><span style={{ fontFamily: 'var(--mono)' }}>{d.invoice_no}</span> · {dayWords(d.scheduled_on, d.time_of_day ? timeWords[d.time_of_day] : null)}{d.scheduled_on < today() ? ' (late)' : ''}</div>
        </div>
        <span style={{ fontSize: 12.5, color: '#55606C' }}>Out {ago(d.out_at)}</span>
      </div>
      <p style={{ margin: '12px 0 0', fontSize: 15.5, lineHeight: 1.45 }}>{d.address}</p>
      {d.landmark ? <p style={{ margin: '4px 0 0', padding: '8px 12px', borderRadius: 10, background: '#FFF9EB', fontSize: 14.5, color: '#5A3D00' }}>Landmark: {d.landmark}</p> : null}
      <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
        {d.items.map((it, i) => (
          <li key={`${it.name}-${i}`} style={{ padding: '7px 0', borderTop: '1px solid rgba(16,24,34,.06)', fontSize: 14.5 }}>
            <strong>{String(Number(it.qty))} ×</strong> {it.name}
            {it.serials?.length ? <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: 12.5, color: '#55606C' }}>{it.serials.join(', ')}</span> : null}
          </li>
        ))}
      </ul>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
        <a href={`tel:+${d.contact_phone}`} className="press" style={ghost} aria-label={`Call ${localPhone(d.contact_phone)}`}>Call</a>
        <a href={directions(d)} target="_blank" rel="noopener noreferrer" className="press" style={ghost}>Directions</a>
      </div>
      {mode === 'idle' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginTop: 8 }}>
          <button type="button" onClick={() => { setMode('code'); setProblem(null); }} className="press" style={solid(true, '#0D9465')}>Delivered</button>
          <button type="button" onClick={() => { setMode('fail'); setProblem(null); }} className="press" style={ghost}>Couldn&apos;t</button>
        </div>
      ) : null}
      {mode === 'code' ? (
        <form className="rise" onSubmit={(e) => { e.preventDefault(); void confirm(); }} style={{ marginTop: 12, padding: 14, borderRadius: 14, background: '#F3FAF7' }}>
          <label htmlFor={`c-${d.order_id}`} style={{ display: 'block', fontSize: 14.5, fontWeight: 600 }}>The customer&apos;s 4-digit code</label>
          <p style={{ margin: '2px 0 8px', fontSize: 13, color: '#55606C' }}>It is on their tracking page. Hand over the goods once it is accepted.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id={`c-${d.order_id}`} ref={codeBox} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="one-time-code" maxLength={4} size={4}
              style={{ flex: 1, minWidth: 0, height: 56, boxSizing: 'border-box', padding: '0 16px', border: '1.5px solid #10161E', borderRadius: 14, background: '#FFFFFF', font: '600 26px var(--mono)', letterSpacing: '.3em', textAlign: 'center' }} />
            <button type="submit" disabled={busy || code.length !== 4} className="press" style={{ ...solid(!busy && code.length === 4, '#0D9465'), minHeight: 56 }}>{busy ? <Spinner size={18} /> : 'Confirm'}</button>
          </div>
          <button type="button" onClick={() => setMode('idle')} style={{ marginTop: 8, padding: 0, border: 0, background: 'none', color: '#55606C', font: '500 13.5px var(--sans)', cursor: 'pointer' }}>Back</button>
        </form>
      ) : null}
      {mode === 'fail' ? (
        <form className="rise" onSubmit={(e) => { e.preventDefault(); void fail(); }} style={{ marginTop: 12, padding: 14, borderRadius: 14, background: '#FFF9EB' }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>What happened?</div>
          <p style={{ margin: '2px 0 8px', fontSize: 13, color: '#5A3D00' }}>The customer sees this on their tracking page.</p>
          <div role="radiogroup" aria-label="Reason" className="chip-row">
            {reasons.map((r) => <button key={r} type="button" role="radio" aria-checked={reason === r} onClick={() => setReason(r)} className="press chip">{r}</button>)}
          </div>
          <label htmlFor={`r-${d.order_id}`} style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Or say it in your words</label>
          <input id={`r-${d.order_id}`} value={reasons.includes(reason) ? '' : reason} onChange={(e) => setReason(e.target.value.slice(0, 300))} placeholder="Or say it in your words" style={{ width: '100%', minHeight: 46, boxSizing: 'border-box', marginTop: 8, padding: '0 14px', border: '1px solid rgba(16,24,34,.16)', borderRadius: 12, font: '400 15px var(--sans)' }} />
          <label style={{ display: 'grid', gap: 4, marginTop: 8, fontSize: 13.5, fontWeight: 550 }}>New day, if the customer gave one<input type="date" value={next} min={today()} onChange={(e) => setNext(e.target.value)} style={{ minHeight: 46, padding: '0 12px', border: '1px solid rgba(16,24,34,.16)', borderRadius: 12, font: '400 15px var(--sans)' }} /></label>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="submit" disabled={busy || reason.trim().length < 3} className="press" style={{ ...solid(!busy && reason.trim().length >= 3, '#92400E'), flex: 1 }}>{busy ? <Spinner size={18} /> : 'Bring it back'}</button>
            <button type="button" onClick={() => setMode('idle')} className="press" style={ghost}>Back</button>
          </div>
        </form>
      ) : null}
      {problem ? <p role="alert" style={{ margin: '10px 0 0', padding: '10px 14px', borderRadius: 12, background: '#FDF3E7', color: '#92400E', fontSize: 14.5 }}>{problem}</p> : null}
    </article>
  );
}
