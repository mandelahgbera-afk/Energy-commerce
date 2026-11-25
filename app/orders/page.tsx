'use client';

// Orders and customers, for the counter, the dispatcher and the accountant. Every open order with
// one plain stage, worked out by the database from the money and goods records; booking a delivery
// with a pin; the tracking link sent by WhatsApp; and a small CRM: notes and follow-ups on the
// customer record the shop already keeps. Design and evidence: docs/plans/2026-11-25-orders-tracking-crm.md.
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browserDb } from '@/lib/supabase';
import { formatNaira } from '@/lib/money';
import { ago, dayWords, errorOf, localPhone, stageWords, timeWords, today, trackMessage, trackUrl, waLink, type Stage } from '@/lib/orders';
import { Segmented } from '@/components/kit/segmented';
import { Spinner, Tick } from '@/components/kit/feel';
import { StaffNav } from '@/components/staff-nav';
import type { MapPoint } from '@/components/shop-map';

const ShopMap = dynamic(() => import('@/components/shop-map'), { ssr: false, loading: () => <div className="shop-map" style={{ height: 300 }} /> });

type Delivery = { status: 'booked' | 'out' | 'delivered'; address: string; landmark: string | null; lat: number | null; lng: number | null; contact_name: string | null; contact_phone: string;
  scheduled_on: string; time_of_day: string | null; tries: number; rider: string | null; rider_lat: number | null; rider_lng: number | null; rider_seen_at: string | null; last_failed: string | null; override: string | null };
type Row = { order_id: string; invoice_no: string | null; created_at: string; channel: string; token: string; customer: { id: string; name: string | null; phone: string } | null;
  total: number | string; paid: number | string; waiting: number | string; on_credit: boolean; stage: Stage; items: string | null; delivery: Delivery | null };
type Board = { orders: Row[]; riders: { id: string; name: string }[] };

const ghost = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 44, padding: '0 14px', border: '1px solid rgba(16,24,34,.14)', borderRadius: 12, background: '#FFFFFF', color: '#10161E', font: '500 14px var(--sans)', cursor: 'pointer', textDecoration: 'none' } as const;
const solid = (on: boolean) => ({ ...ghost, border: 0, background: on ? '#1B5CF0' : '#C9D2DC', color: '#FFFFFF', font: '600 14px var(--sans)', cursor: on ? 'pointer' : 'default' }) as const;
const input = { width: '100%', minHeight: 48, boxSizing: 'border-box', padding: '10px 14px', border: '1px solid rgba(16,24,34,.16)', borderRadius: 12, background: '#FFFFFF', color: '#10161E', font: '400 15.5px var(--sans)' } as const;
const label = { display: 'grid', gap: 6, fontSize: 13.5, fontWeight: 600, color: '#2A3441' } as const;
const filters: { name: string; has: (r: Row) => boolean }[] = [
  { name: 'Open', has: (r) => !['delivered', 'cancelled'].includes(r.stage) },
  { name: 'Waiting for money', has: (r) => r.stage === 'placed' || r.stage === 'approval' },
  { name: 'Ready to go', has: (r) => r.stage === 'paid' },
  { name: 'On the way', has: (r) => r.stage === 'on_the_way' },
  { name: 'Delivered', has: (r) => r.stage === 'delivered' },
];

export default function Orders() {
  const db = useRef(browserDb()).current;
  const [me, setMe] = useState<undefined | null | { role: string | null }>(undefined);
  const [tab, setTab] = useState(0);
  const [board, setBoard] = useState<Board | null>(null);
  const [filter, setFilter] = useState(0);
  const [mapOpen, setMapOpen] = useState(false);
  const [booking, setBooking] = useState<Row | null>(null);
  const [customer, setCustomer] = useState<string | null>(null);
  const [shopName, setShopName] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const crmError = useCallback((m: string) => setError(errorOf(m)), []);

  const load = useCallback(async () => {
    const { data, error: e } = await db.rpc('orders_board');
    if (e) { setError(errorOf(e.message)); return; }
    setBoard(data as Board);
  }, [db]);
  useEffect(() => {
    (async () => {
      const { data: s } = await db.auth.getSession();
      if (!s.session) { setMe(null); return; }
      const staff = await db.from('staff').select('role').eq('id', s.session.user.id).maybeSingle();
      setMe({ role: staff.data?.role ?? null });
      const shop = await db.rpc('shop_details');
      setShopName((shop.data as { name: string | null } | null)?.name ?? null);
    })();
    const c = new URLSearchParams(window.location.search).get('customer');
    if (c) { setTab(1); setCustomer(c); }
  }, [db]);
  const allowed = ['owner', 'counter', 'dispatcher', 'accountant'].includes(me?.role ?? '');
  useEffect(() => { if (allowed) void load(); }, [allowed, load]);
  // Riders move and money lands while the screen sits open: look again on return, and every minute.
  useEffect(() => {
    if (!allowed) return;
    const again = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', again);
    const t = window.setInterval(again, 60000);
    return () => { document.removeEventListener('visibilitychange', again); clearInterval(t); };
  }, [allowed, load]);

  const rows = useMemo(() => (board?.orders ?? []).filter(filters[filter].has), [board, filter]);
  const points = useMemo<MapPoint[]>(() => (board?.orders ?? []).flatMap((r) => {
    const d = r.delivery;
    if (!d || d.status === 'delivered' || r.stage === 'delivered') return [];
    const out: MapPoint[] = [];
    if (d.lat !== null && d.lng !== null) out.push({ id: r.order_id, lat: d.lat, lng: d.lng, kind: 'drop', label: `${r.invoice_no ?? 'Order'}: ${d.address}` });
    if (d.status === 'out' && d.rider_lat !== null && d.rider_lng !== null) out.push({ id: `rider-${r.order_id}`, lat: d.rider_lat, lng: d.rider_lng, kind: 'rider', label: `${d.rider ?? 'Rider'}, seen ${d.rider_seen_at ? ago(d.rider_seen_at) : ''}` });
    return out;
  }), [board]);

  const copy = async (r: Row) => {
    try { await navigator.clipboard.writeText(trackUrl(r.token)); setCopied(r.order_id); setTimeout(() => setCopied(null), 1800); } catch {}
  };

  if (me === undefined) return <main style={{ minHeight: '100vh' }} aria-busy="true" />;
  if (me === null || !allowed) {
    return (
      <main className="mx-auto max-w-sm px-5 py-20 text-center">
        <p className="text-lg font-semibold">{me === null ? 'Sign in to see the orders.' : 'Orders are for the counter, dispatch and accounts.'}</p>
        <Link href={me === null ? '/login' : '/'} className="press mt-4 inline-flex h-12 items-center rounded-field bg-action px-6 text-sm font-medium text-white">{me === null ? 'Sign in' : 'Back'}</Link>
      </main>
    );
  }

  const open = (board?.orders ?? []).filter(filters[0].has).length;
  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '12px clamp(10px, 2vw, 28px) 48px' }}>
      <StaffNav label="Staff" wide={1000}>
        <button type="button" onClick={() => void load()} className="press" style={{ ...ghost, minHeight: 40, borderColor: 'rgba(16,24,34,.1)' }}>Look again</button>
      </StaffNav>
      <div style={{ maxWidth: 1000, margin: '22px auto 0' }}>
        <div style={{ maxWidth: 360 }}><Segmented options={['Orders', 'Customers']} value={tab} onChange={(i) => { setTab(i); setError(null); }} label="Orders or customers" /></div>
        {error ? <p role="alert" style={{ margin: '14px 2px 0', padding: '10px 14px', borderRadius: 12, background: '#FDF3E7', color: '#92400E', fontSize: 14.5 }}>{error}</p> : null}
        {tab === 1 ? <Customers db={db} open={customer} onOpen={setCustomer} onError={crmError} shopName={shopName} /> : (
          <section aria-labelledby="o1" className="rise" style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <h1 id="o1" aria-live="polite" style={{ margin: '0 2px', fontSize: 'clamp(26px, 3vw, 34px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-.03em' }}>{board === null ? 'Getting the orders…' : open === 0 ? 'No open orders' : `${open} open ${open === 1 ? 'order' : 'orders'}`}</h1>
                <p style={{ margin: '6px 2px 0', fontSize: 15, color: '#434E5A' }}>Each stage comes from the money and the goods, so it is always the truth.</p>
              </div>
              {points.length ? <button type="button" onClick={() => setMapOpen((m) => !m)} aria-expanded={mapOpen} className="press" style={ghost}>{mapOpen ? 'Hide the map' : `Show on the map (${points.length})`}</button> : null}
            </div>
            {mapOpen && points.length ? <div className="rise" style={{ marginTop: 14 }}><ShopMap points={points} label="Deliveries and riders" height={320} /></div> : null}
            <div role="group" aria-label="Show" className="chip-row" style={{ marginTop: 16 }}>
              {filters.map((f, i) => <button key={f.name} type="button" aria-pressed={filter === i} onClick={() => setFilter(i)} className="press chip">{f.name}<span className="n">{(board?.orders ?? []).filter(f.has).length}</span></button>)}
            </div>
            {board && rows.length === 0 ? (
              <div className="card rise" style={{ marginTop: 14, padding: '32px 20px', textAlign: 'center' }}>
                <p style={{ margin: 0, fontSize: 16.5, fontWeight: 600 }}>Nothing here</p>
                <p style={{ margin: '6px auto 0', maxWidth: 380, fontSize: 14.5, lineHeight: 1.5, color: '#55606C' }}>Orders from the counter and the phone land here the moment they are made.</p>
              </div>
            ) : null}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 12, marginTop: 14 }}>
              {rows.map((r, i) => {
                const d = r.delivery;
                // A card tap waiting for the second person's check counts as paid to the customer, but staff still have to check it.
                const waiting = BigInt(String(r.waiting));
                const owes = BigInt(String(r.total)) - BigInt(String(r.paid)) - waiting;
                const phone = d?.contact_phone ?? r.customer?.phone ?? null;
                const canBook = !['delivered', 'cancelled'].includes(r.stage) && d?.status !== 'out';
                return (
                  <article key={r.order_id} className="card rise" style={{ padding: 18, animationDelay: `${Math.min(i, 6) * 40}ms` }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 16.5, fontWeight: 600, fontFamily: 'var(--mono)', letterSpacing: '-.01em' }}>{r.invoice_no ?? 'Order'}</span>
                          <span className={`stage-pill stage-${r.stage}`}>{stageWords[r.stage]}</span>
                        </div>
                        <div style={{ marginTop: 3, fontSize: 13.5, color: '#55606C' }}>
                          {r.customer ? <button type="button" onClick={() => { setTab(1); setCustomer(r.customer!.id); }} style={{ padding: 0, border: 0, background: 'none', color: '#1B5CF0', font: 'inherit', fontWeight: 550, cursor: 'pointer' }}>{r.customer.name ?? localPhone(r.customer.phone)}</button> : 'Walk-in'}
                          {r.customer?.name ? ` · ${localPhone(r.customer.phone)}` : ''} · {ago(r.created_at)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="tabular" style={{ fontSize: 18, fontWeight: 650, letterSpacing: '-.02em' }}>{formatNaira(r.total)}</div>
                        <div style={{ fontSize: 12.5, color: (owes > 0n && !r.on_credit) || waiting > 0n ? '#92400E' : '#0B6E4C', fontWeight: 550 }}>{owes <= 0n ? (waiting > 0n ? `${formatNaira(waiting)} card tap to check` : 'Paid') : r.on_credit ? 'On account' : `${formatNaira(owes)} to pay`}</div>
                      </div>
                    </div>
                    {r.items ? <p style={{ margin: '10px 0 0', fontSize: 14.5, color: '#2A3441' }}>{r.items}</p> : null}
                    {d ? (
                      <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 12, background: d.status === 'out' ? '#FFF9EB' : '#F6F8FA', fontSize: 14, lineHeight: 1.5 }}>
                        <div style={{ fontWeight: 600 }}>{d.status === 'out' ? `With ${d.rider ?? 'a rider'}${d.rider_seen_at ? `, seen ${ago(d.rider_seen_at)}` : ''}` : r.stage === 'delivered' ? 'Delivered' : `Delivery ${dayWords(d.scheduled_on, d.time_of_day)}`}{d.tries > 1 && d.status !== 'delivered' ? ` · try ${d.tries}` : ''}</div>
                        <div style={{ color: '#434E5A' }}>{d.address}{d.landmark ? `. Landmark: ${d.landmark}` : ''}{d.lat === null ? ' · no pin yet' : ''}</div>
                        {d.last_failed && r.stage !== 'delivered' ? <div style={{ color: '#92400E' }}>Last try: {d.last_failed}</div> : null}
                        {d.override ? <div style={{ color: '#92400E' }}>{d.override}</div> : null}
                      </div>
                    ) : null}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
                      {canBook ? <button type="button" onClick={() => setBooking(r)} className="press" style={d ? ghost : solid(true)}>{d ? 'Change the delivery' : 'Book a delivery'}</button> : null}
                      {phone ? <a href={waLink(phone, trackMessage({ name: d?.contact_name ?? r.customer?.name, invoice: r.invoice_no, token: r.token, day: d?.status === 'booked' ? d.scheduled_on : null, time: d?.time_of_day ? timeWords[d.time_of_day] : null, out: d?.status === 'out', shop: shopName }))} target="_blank" rel="noopener noreferrer" className="press" style={ghost}>Send the link</a> : null}
                      <button type="button" onClick={() => void copy(r)} className="press" style={ghost}>{copied === r.order_id ? 'Copied' : 'Copy link'}</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>
      {booking ? <BookSheet db={db} row={booking} shopName={shopName} onClose={() => setBooking(null)} onSaved={() => void load()} /> : null}
    </main>
  );
}

function BookSheet({ db, row, shopName, onClose, onSaved }: { db: ReturnType<typeof browserDb>; row: Row; shopName: string | null; onClose: () => void; onSaved: () => void }) {
  const d = row.delivery;
  const [address, setAddress] = useState(d?.address ?? '');
  const [landmark, setLandmark] = useState(d?.landmark ?? '');
  const [contact, setContact] = useState(d?.contact_name ?? row.customer?.name ?? '');
  const [phone, setPhone] = useState(localPhone(d?.contact_phone ?? row.customer?.phone ?? ''));
  const [on, setOn] = useState(d?.scheduled_on && d.scheduled_on >= today() ? d.scheduled_on : today());
  const [time, setTime] = useState(['', 'morning', 'afternoon', 'evening'].indexOf(d?.time_of_day ?? ''));
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(d?.lat != null && d?.lng != null ? { lat: d.lat, lng: d.lng } : null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const first = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const points = useMemo<MapPoint[]>(() => (pin ? [{ id: 'pin', ...pin, kind: 'drop', label: 'The drop' }] : []), [pin]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const t = ['', 'morning', 'afternoon', 'evening'][time] || null;
    const { error } = await db.rpc('book_delivery', { p_order: row.order_id, p_address: address, p_on: on, p_time: t, p_landmark: landmark || null,
      p_contact_name: contact || null, p_contact_phone: phone || null, p_lat: pin?.lat ?? null, p_lng: pin?.lng ?? null });
    setBusy(false);
    if (error) { setProblem(errorOf(error.message)); return; }
    setSaved(true);
    onSaved();
  };
  const digits = phone.replace(/\D/g, '');
  const phone234 = digits.startsWith('0') ? `234${digits.slice(1)}` : digits;

  return (
    <div className="sheet-back" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="bk" className="sheet rise">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h2 id="bk" style={{ margin: 0, fontSize: 21, fontWeight: 600, letterSpacing: '-.02em' }}>{saved ? 'Delivery booked' : `Deliver ${row.invoice_no ?? 'this order'}`}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="press" style={{ ...ghost, width: 44, padding: 0, fontSize: 20 }}>×</button>
        </div>
        {saved ? (
          <div className="rise" style={{ marginTop: 16 }}>
            <p style={{ display: 'flex', alignItems: 'center', gap: 10, margin: 0, fontSize: 15.5, fontWeight: 550 }}><span style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, flex: 'none', borderRadius: 14, background: '#0D9465' }}><Tick size={16} /></span>Booked for {dayWords(on, ['', 'morning', 'afternoon', 'evening'][time] || null)}.</p>
            <p style={{ margin: '10px 0 0', fontSize: 14.5, color: '#434E5A', lineHeight: 1.5 }}>Send the customer their link. It shows the day, the code for the rider and a button to drop their pin. The stock room sees it on the pack list once the money is in.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
              {phone234.length === 13 ? <a href={waLink(phone234, trackMessage({ name: contact, invoice: row.invoice_no, token: row.token, day: on, time: timeWords[['', 'morning', 'afternoon', 'evening'][time]] ?? null, shop: shopName }))} target="_blank" rel="noopener noreferrer" className="press" style={solid(true)}>Send on WhatsApp</a> : null}
              <button type="button" onClick={onClose} className="press" style={ghost}>Done</button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void save(); }} style={{ display: 'grid', gap: 14, marginTop: 16 }}>
            <label style={label}>Address<textarea ref={first} value={address} onChange={(e) => setAddress(e.target.value.slice(0, 300))} rows={2} placeholder="12 Allen Avenue, Ikeja" style={{ ...input, resize: 'vertical' }} /></label>
            <label style={label}>Landmark<input value={landmark} onChange={(e) => setLandmark(e.target.value.slice(0, 200))} placeholder="Opposite the filling station, blue gate" style={input} /></label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <label style={label}>Who receives it<input value={contact} onChange={(e) => setContact(e.target.value.slice(0, 80))} autoComplete="off" style={input} /></label>
              <label style={label}>Their phone<input value={phone} onChange={(e) => setPhone(e.target.value.slice(0, 20))} inputMode="tel" autoComplete="off" style={{ ...input, fontFamily: 'var(--mono)' }} /></label>
            </div>
            <label style={label}>Day<input type="date" value={on} min={today()} onChange={(e) => setOn(e.target.value)} style={input} /></label>
            <div style={label}>Time of day<Segmented options={['Any time', 'Morning', 'Afternoon', 'Evening']} value={time < 0 ? 0 : time} onChange={setTime} label="Time of day" /></div>
            <div style={label}>
              <span>Pin <span style={{ fontWeight: 400, color: '#55606C' }}>{pin ? 'Tap the map to move it.' : 'Optional. Tap the map where the drop is, or let the customer drop it from their link.'}</span></span>
              <ShopMap points={points} label="Tap to place the drop" onPick={(lat, lng) => setPin({ lat, lng })} height={240} />
              {pin ? <button type="button" onClick={() => setPin(null)} style={{ ...ghost, justifySelf: 'start', minHeight: 36, fontSize: 13 }}>Remove the pin</button> : null}
            </div>
            {problem ? <p role="alert" style={{ margin: 0, padding: '10px 14px', borderRadius: 12, background: '#FDF3E7', color: '#92400E', fontSize: 14.5 }}>{problem}</p> : null}
            <button type="submit" disabled={busy || address.trim().length < 3} className="press" style={{ ...solid(!busy && address.trim().length >= 3), minHeight: 52, fontSize: 15.5 }}>{busy ? <><Spinner size={18} />Saving…</> : d ? 'Save the change' : 'Book the delivery'}</button>
          </form>
        )}
      </div>
    </div>
  );
}

type CrmRow = { id: string; name: string | null; phone: string; kind: string; orders: number; spent: number | string; owes: number | string; last_order_at: string | null; open_follow_ups: number; next_due: string | null };
type Due = { id: string; customer_id: string; customer: string | null; phone: string; what: string; due_on: string; assigned_to: string; mine: boolean };
type CrmList = { customers: CrmRow[]; due: Due[]; team: { id: string; name: string; me: boolean }[] };
type CrmOne = { id: string; name: string | null; phone: string; email: string | null; kind: string; since: string; owes: number | string; credit_limit: number | string;
  orders: { order_id: string; invoice_no: string | null; created_at: string; total: number | string; paid: number | string; stage: Stage; token: string }[];
  notes: { kind: string; body: string; at: string; by: string | null }[];
  follow_ups: { id: string; what: string; due_on: string; assigned_to: string; done_at: string | null }[] };
const noteKinds = [['call', 'Call'], ['whatsapp', 'WhatsApp'], ['visit', 'Visit'], ['note', 'Note']] as const;
const kindWords: Record<string, string> = { retail: 'Retail', installer: 'Installer', business: 'Business' };

function Customers({ db, open, onOpen, onError, shopName }: { db: ReturnType<typeof browserDb>; open: string | null; onOpen: (id: string | null) => void; onError: (m: string) => void; shopName: string | null }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<CrmList | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const { data, error } = await db.rpc('crm_customers', { p_query: q.trim() || null });
      if (!live) return;
      if (error) onError(error.message); else setList(data as CrmList);
    }, q ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [db, q, tick, onError]);
  const done = async (id: string) => {
    const { error } = await db.rpc('close_follow_up', { p_follow_up: id });
    if (error) onError(error.message); else setTick((n) => n + 1);
  };

  if (open) return <Customer db={db} id={open} team={list?.team ?? []} onBack={() => { onOpen(null); setTick((n) => n + 1); }} onError={onError} shopName={shopName} />;
  return (
    <section aria-labelledby="c1" className="rise" style={{ marginTop: 18 }}>
      <h1 id="c1" style={{ margin: '0 2px', fontSize: 'clamp(26px, 3vw, 34px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-.03em' }}>Customers</h1>
      <p style={{ margin: '6px 2px 14px', fontSize: 15, color: '#434E5A' }}>Everyone who has bought, newest first. Notes and follow-ups stay on their record.</p>
      {list?.due.length ? (
        <div className="card rise" style={{ padding: 16, marginBottom: 14, background: '#FFFBF0', borderColor: 'rgba(138,90,0,.16)' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 15.5, fontWeight: 650 }}>Due today: {list.due.length}</h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
            {list.due.map((f) => (
              <li key={f.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid rgba(16,24,34,.06)' }}>
                <span style={{ flex: 1, minWidth: 200 }}>
                  <button type="button" onClick={() => onOpen(f.customer_id)} style={{ padding: 0, border: 0, background: 'none', color: '#1B5CF0', font: '600 15px var(--sans)', cursor: 'pointer' }}>{f.customer ?? localPhone(f.phone)}</button>
                  <span style={{ display: 'block', fontSize: 14, color: '#2A3441' }}>{f.what}</span>
                  <span style={{ fontSize: 12.5, color: f.due_on < today() ? '#92400E' : '#55606C' }}>{f.due_on < today() ? `Late, due ${dayWords(f.due_on)}` : 'Today'} · {f.mine ? 'yours' : f.assigned_to}</span>
                </span>
                <a href={`tel:+${f.phone}`} className="press" style={{ ...ghost, minHeight: 40 }}>Call</a>
                <button type="button" onClick={() => void done(f.id)} className="press" style={{ ...ghost, minHeight: 40 }}>Done</button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <label htmlFor="cq" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Find a customer</label>
      <input id="cq" value={q} onChange={(e) => setQ(e.target.value.slice(0, 80))} placeholder="Name or phone number" autoComplete="off" style={{ ...input, minHeight: 52, fontSize: 16 }} />
      {list && list.customers.length === 0 ? <p style={{ margin: '14px 2px', fontSize: 14.5, color: '#55606C' }}>{q ? 'Nobody matches. Try part of the phone number.' : 'No customers yet. Every sale with a phone number adds one.'}</p> : null}
      <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
        {list?.customers.map((c, i) => (
          <button key={c.id} type="button" onClick={() => onOpen(c.id)} className="card press rise" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', textAlign: 'left', color: '#10161E', font: 'inherit', cursor: 'pointer', animationDelay: `${Math.min(i, 8) * 30}ms` }}>
            <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 40, height: 40, flex: 'none', borderRadius: 20, background: 'linear-gradient(160deg, #EEF3FF, #E0E8FD)', color: '#1B5CF0', fontWeight: 650 }}>{(c.name ?? '#').trim().charAt(0).toUpperCase()}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 15.5, fontWeight: 600 }}>{c.name ?? localPhone(c.phone)}{c.kind !== 'retail' ? <span style={{ marginLeft: 8, padding: '1px 8px', borderRadius: 9, background: '#EEF3FF', color: '#1B5CF0', fontSize: 12, fontWeight: 600 }}>{kindWords[c.kind]}</span> : null}</span>
              <span className="tabular" style={{ display: 'block', fontSize: 13, color: '#55606C' }}>{localPhone(c.phone)} · {c.orders} {Number(c.orders) === 1 ? 'order' : 'orders'}{c.last_order_at ? `, last ${ago(c.last_order_at)}` : ''}{Number(c.open_follow_ups) ? ` · ${c.open_follow_ups} to follow up` : ''}</span>
            </span>
            {/* Spent counts goods handed over, so a first order still on its way shows nothing rather than ₦0. */}
            {BigInt(String(c.spent)) > 0n || BigInt(String(c.owes)) > 0n ? <span style={{ textAlign: 'right' }}>
              <span className="tabular" style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{formatNaira(c.spent)}</span>
              {BigInt(String(c.owes)) > 0n ? <span className="tabular" style={{ fontSize: 12.5, color: '#92400E', fontWeight: 550 }}>owes {formatNaira(c.owes)}</span> : <span style={{ fontSize: 12.5, color: '#55606C' }}>bought</span>}
            </span> : null}
          </button>
        ))}
      </div>
    </section>
  );
}

function Customer({ db, id, team, onBack, onError, shopName }: { db: ReturnType<typeof browserDb>; id: string; team: CrmList['team']; onBack: () => void; onError: (m: string) => void; shopName: string | null }) {
  const [c, setC] = useState<CrmOne | null>(null);
  const [kind, setKind] = useState<string>('call');
  const [body, setBody] = useState('');
  const [what, setWhat] = useState('');
  const [due, setDue] = useState(today());
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const noteKey = useRef<string | null>(null);
  const fuKey = useRef<string | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await db.rpc('crm_customer', { p_customer: id });
    if (error) onError(error.message); else setC(data as CrmOne);
  }, [db, id, onError]);
  useEffect(() => { void load(); }, [load]);

  const addNote = async () => {
    if (busy || !body.trim()) return;
    setBusy('note');
    noteKey.current ??= crypto.randomUUID();
    const { error } = await db.rpc('add_customer_note', { p_key: noteKey.current, p_customer: id, p_kind: kind, p_body: body });
    setBusy(null);
    if (error) { onError(error.message); return; }
    noteKey.current = null;
    setBody('');
    void load();
  };
  const addFollowUp = async () => {
    if (busy || !what.trim()) return;
    setBusy('fu');
    fuKey.current ??= crypto.randomUUID();
    const { error } = await db.rpc('add_follow_up', { p_key: fuKey.current, p_customer: id, p_what: what, p_due_on: due, p_assignee: who || null });
    setBusy(null);
    if (error) { onError(error.message); return; }
    fuKey.current = null;
    setWhat('');
    void load();
  };
  const close = async (f: string) => {
    const { error } = await db.rpc('close_follow_up', { p_follow_up: f });
    if (error) onError(error.message); else void load();
  };

  if (!c) return <p role="status" style={{ marginTop: 24, fontSize: 15, color: '#55606C' }}>Opening the customer…</p>;
  const owes = BigInt(String(c.owes));
  return (
    <section aria-labelledby="cu" className="rise" style={{ marginTop: 18 }}>
      <button type="button" onClick={onBack} className="press" style={{ ...ghost, minHeight: 40 }}>← All customers</button>
      <div className="card" style={{ marginTop: 12, padding: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1 id="cu" style={{ margin: 0, fontSize: 'clamp(24px, 3vw, 30px)', fontWeight: 600, letterSpacing: '-.03em' }}>{c.name ?? localPhone(c.phone)}</h1>
            <p className="tabular" style={{ margin: '4px 0 0', fontSize: 14, color: '#55606C' }}>{localPhone(c.phone)} · {kindWords[c.kind]} · customer since {new Date(c.since).toLocaleDateString('en-NG', { month: 'short', year: 'numeric' })}{c.email ? ` · ${c.email}` : ''}</p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <a href={`tel:+${c.phone}`} className="press" style={ghost}>Call</a>
            <a href={waLink(c.phone, `Hello${c.name ? ` ${c.name.split(' ')[0]}` : ''}, this is ${shopName || 'the shop'}. `)} target="_blank" rel="noopener noreferrer" className="press" style={ghost}>WhatsApp</a>
          </div>
        </div>
        {owes > 0n ? <p className="tabular" style={{ margin: '12px 0 0', padding: '8px 12px', borderRadius: 10, background: '#FDF3E7', color: '#92400E', fontSize: 14, fontWeight: 550 }}>Owes {formatNaira(owes)}</p> : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginTop: 12 }}>
        <div className="card" style={{ padding: 18 }}>
          <h2 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 650 }}>Log what happened</h2>
          <div role="radiogroup" aria-label="Kind" className="chip-row">
            {noteKinds.map(([k, w]) => <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className="press chip">{w}</button>)}
          </div>
          <label htmlFor="nb" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>What was said</label>
          <textarea id="nb" value={body} onChange={(e) => setBody(e.target.value.slice(0, 500))} rows={3} placeholder="Wants a quote for two 200Ah batteries. Prefers mornings." style={{ ...input, marginTop: 10, resize: 'vertical' }} />
          <button type="button" onClick={() => void addNote()} disabled={!body.trim() || busy !== null} className="press" style={{ ...solid(Boolean(body.trim()) && busy === null), marginTop: 10, width: '100%' }}>{busy === 'note' ? 'Saving…' : 'Save to their record'}</button>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <h2 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 650 }}>Follow up</h2>
          <label htmlFor="fw" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>What to do</label>
          <input id="fw" value={what} onChange={(e) => setWhat(e.target.value.slice(0, 300))} placeholder="Call with the battery price" style={input} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
            <label style={{ ...label, fontWeight: 500 }}>On<input type="date" value={due} min={today()} onChange={(e) => setDue(e.target.value)} style={input} /></label>
            <label style={{ ...label, fontWeight: 500 }}>Who<select value={who} onChange={(e) => setWho(e.target.value)} style={input}>
              <option value="">Me</option>
              {team.filter((t) => !t.me).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></label>
          </div>
          <button type="button" onClick={() => void addFollowUp()} disabled={!what.trim() || busy !== null} className="press" style={{ ...solid(Boolean(what.trim()) && busy === null), marginTop: 10, width: '100%' }}>{busy === 'fu' ? 'Saving…' : 'Add the follow-up'}</button>
          {c.follow_ups.length ? (
            <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
              {c.follow_ups.map((f) => (
                <li key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid rgba(16,24,34,.06)', opacity: f.done_at ? 0.55 : 1 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 14 }}><span style={{ textDecoration: f.done_at ? 'line-through' : undefined }}>{f.what}</span><span style={{ display: 'block', fontSize: 12.5, color: !f.done_at && f.due_on < today() ? '#92400E' : '#55606C' }}>{dayWords(f.due_on)} · {f.assigned_to}</span></span>
                  {f.done_at ? <span style={{ fontSize: 12.5, color: '#0B6E4C', fontWeight: 600 }}>Done</span> : <button type="button" onClick={() => void close(f.id)} className="press" style={{ ...ghost, minHeight: 36, fontSize: 13 }}>Done</button>}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12, marginTop: 12 }}>
        <div className="card" style={{ padding: 18 }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 650 }}>Orders</h2>
          {c.orders.length ? (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {c.orders.map((o) => (
                <li key={o.order_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderTop: '1px solid rgba(16,24,34,.06)' }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600 }}>{o.invoice_no ?? 'Order'}</span>
                    <span style={{ fontSize: 12.5, color: '#55606C' }}>{new Date(o.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  </span>
                  <span className={`stage-pill stage-${o.stage}`}>{stageWords[o.stage]}</span>
                  <span className="tabular" style={{ width: 110, textAlign: 'right', fontSize: 14, fontWeight: 600 }}>{formatNaira(o.total)}</span>
                  <a href={`/track?r=${o.token}`} target="_blank" rel="noopener noreferrer" aria-label={`Tracking page for ${o.invoice_no ?? 'this order'}`} style={{ color: '#1B5CF0', fontSize: 13, fontWeight: 550 }}>Track</a>
                </li>
              ))}
            </ul>
          ) : <p style={{ margin: 0, fontSize: 14, color: '#55606C' }}>No orders yet.</p>}
        </div>
        <div className="card" style={{ padding: 18 }}>
          <h2 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 650 }}>What was said</h2>
          {c.notes.length ? (
            <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {c.notes.map((n, i) => (
                <li key={`${n.at}-${i}`} style={{ padding: '10px 0', borderTop: '1px solid rgba(16,24,34,.06)' }}>
                  <div style={{ fontSize: 12.5, color: '#55606C' }}><span style={{ fontWeight: 600, color: '#1B5CF0' }}>{noteKinds.find(([k]) => k === n.kind)?.[1]}</span> · {ago(n.at)}{n.by ? ` · ${n.by}` : ''}</div>
                  <div style={{ marginTop: 2, fontSize: 14.5, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{n.body}</div>
                </li>
              ))}
            </ol>
          ) : <p style={{ margin: 0, fontSize: 14, color: '#55606C' }}>Nothing logged yet. A call, a visit or a WhatsApp: log it here so the next person knows.</p>}
        </div>
      </div>
    </section>
  );
}
