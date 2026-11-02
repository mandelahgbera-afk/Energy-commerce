'use client';

// The counter: scan, scan, Cash, Exact, Complete — five actions for a simple sale. A retry on a
// bad network never records twice (one key per tap), and the till close is blind: the system's
// expected figure is never shown, not even after the count (rule 9).
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserDb } from '@/lib/supabase';
import { friendly } from '@/lib/errors';
import { formatNaira, nairaToKobo } from '@/lib/money';
import { toQty } from '@/lib/quantity';
import { saleBlocker, type SaleLine } from '@/lib/sale-math';
import { cashNotes, countedKobo, noteKobo } from '@/lib/till';
import { Tick } from '@/components/kit/feel';
import { StaffNav } from '@/components/staff-nav';

type Hit = { product: string; sku: string; name: string; part_number: string | null; price: bigint | number | string; match: string; state: string };
type Kobo = bigint | number | string;
// What the database says this sale costs. The screen shows only this, and sends these unit prices back.
type PreviewLine = { product_id: string; qty: number; list_price: Kobo; unit_price: Kobo; trade: boolean; line_total: Kobo; enough_stock: boolean; over_limit: boolean };
type Preview = {
  customer: null | { id: string; name: string | null; trade: boolean; owes: Kobo; holds: Kobo };
  lines: PreviewLine[];
  total: Kobo;
  list_total: Kobo;
  needs_approval: boolean;
};
type ReceiptLine = { name: string; qty: string; total: Kobo };
type Done = { invoice: string; state: string; method: string; total: bigint; lines: ReceiptLine[] };

export default function Counter() {
  const db = useRef(browserDb()).current;
  const [session, setSession] = useState<null | undefined | { email: string }>(undefined);
  const [limitPct, setLimitPct] = useState(5);
  const [location, setLocation] = useState<{ id: string; name: string } | null>(null);
  const [till, setTill] = useState<{ id: string; float: bigint | number | string } | null>(null);
  const [tab, setTab] = useState<'sell' | 'till'>('sell');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [hitsFor, setHitsFor] = useState('');
  const pendingEnter = useRef(false);
  const [active, setActive] = useState(0);
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [serials, setSerials] = useState<Record<string, string[]>>({});
  const [phone, setPhone] = useState('');
  const [preview, setPreview] = useState<{ key: string; data: Preview } | null>(null);
  const [discount, setDiscount] = useState('0');
  const [method, setMethod] = useState<string | null>(null);
  const [tender, setTender] = useState<bigint | null>(null);
  const [floatText, setFloatText] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [tillCounts, setTillCounts] = useState<Record<number, string>>({});
  const [tillClosed, setTillClosed] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const saleKey = useRef<string | null>(null);

  const focusScan = useCallback(() => scanRef.current?.focus(), []);
  const showError = useCallback((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    const [name, ...rest] = msg.split(':');
    const detail = rest.join(':').trim();
    if (name === 'payment_required' && detail) {
      setError(`${formatNaira(BigInt(String(detail).split(' ')[0]))} is still owed before these goods can leave.`);
      return;
    }
    setError(friendly(name, detail));
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await db.auth.getSession();
      if (!data.session) {
        setSession(null);
        return;
      }
      setSession({ email: data.session.user.email ?? '' });
      const me = await db.from('staff').select('discount_limit_pct').eq('id', data.session.user.id).maybeSingle();
      if (me.data) setLimitPct(Number(me.data.discount_limit_pct));
      const locs = await db.from('locations').select('id, name').eq('kind', 'shop').limit(1);
      if (locs.data?.[0]) setLocation(locs.data[0]);
      const { data: tillData } = await db.rpc('my_till');
      if (tillData && typeof tillData === 'object' && 'id' in tillData) setTill(tillData as { id: string; float: bigint });
    })();
  }, [db]);

  useEffect(() => {
    if (tab === 'sell') focusScan();
  }, [tab, focusScan]);

  // A scanner types the whole code and presses Enter at once. Each answer is kept only if it is
  // for what is in the box now, and an Enter that comes before its answer waits for it, so a late
  // answer for a half-typed number can never add the wrong part.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setHitsFor('');
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      const { data, error: e } = await db.rpc('search_parts', { p_query: q, p_limit: 4 });
      if (!live || e) return;
      const rows = (data ?? []) as Hit[];
      setHits(rows);
      setHitsFor(q);
      setActive(0);
      if (pendingEnter.current && rows.length) {
        pendingEnter.current = false;
        void addHit(rows[0]);
      }
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // addHit is read when the answer lands, from this same render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, db]);

  const discountPct = Math.min(100, Math.max(0, Number(discount.replace(/\D/g, '').slice(0, 3)) || 0));
  // "This sale as it stands", so a preview of an older version of it is never shown or charged.
  const saleShape = JSON.stringify([lines.map((l) => [l.productId, l.qty]), phone, discountPct, location?.id ?? null]);

  // The database prices the sale by the same rules the sale itself uses: trade prices, the
  // customer found from any phone format, VAT, the discount judged line by line.
  useEffect(() => {
    if (lines.length === 0) {
      setPreview(null);
      return;
    }
    const shape = saleShape;
    // Only the answer for the sale as it stands now counts. An older one landing late is dropped.
    let live = true;
    const t = setTimeout(async () => {
      const { data, error: e } = await db.rpc('preview_sale', {
        p_lines: lines.map((l) => ({ product_id: l.productId, qty: Number(l.qty) })),
        p_location: location?.id ?? null,
        p_phone: phone || null,
        p_discount_pct: discountPct,
      });
      if (!live) return;
      if (e) {
        showError(e.message);
        return;
      }
      setPreview({ key: shape, data: data as Preview });
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // saleShape stands for lines, phone, discount and location together.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleShape, db]);

  const current = preview && preview.key === saleShape ? preview.data : null;
  const priced = (productId: string) => current?.lines.find((x) => x.product_id === productId);
  const payable = current ? BigInt(String(current.total)) : 0n;

  const addHit = useCallback(async (hit: Hit) => {
    const { data: prod } = await db.from('products').select('tracking').eq('id', hit.product).maybeSingle();
    const needsSerials = prod?.tracking === 'serial';
    setLines((cur) => {
      const at = cur.findIndex((l) => l.productId === hit.product);
      if (at >= 0) {
        return cur.map((l, i) => (i === at ? { ...l, qty: toQty(String(Number(l.qty) + 1)) } : l));
      }
      return [...cur, { productId: hit.product, name: hit.name, sku: hit.sku, unitPriceKobo: BigInt(hit.price), qty: '1', needsSerials, serials: [] }];
    });
    setQuery('');
    setHits([]);
    setDone(null);
    setError(null);
    if (needsSerials && location) {
      const { data } = await db.rpc('oldest_serials', { p_product: hit.product, p_location: location.id, p_count: 6 });
      if (data) setSerials((s) => ({ ...s, [hit.product]: (data as { serial: string }[]).map((x) => x.serial) }));
    }
    // Back to the scan box, unless the cashier has already moved to another field.
    const at = document.activeElement;
    if (!(at instanceof HTMLInputElement || at instanceof HTMLTextAreaElement) || at === scanRef.current) focusScan();
  }, [db, location, focusScan]);

  const updateLine = (productId: string, patch: Partial<SaleLine>) =>
    setLines((cur) => cur.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));

  const blocker = saleBlocker(lines, method, tender, discountPct, limitPct, till !== null);
  const short = current?.lines.find((x) => !x.enough_stock);
  const waiting = lines.length > 0 && current === null;
  const blocked = busy || blocker !== null || waiting || short !== undefined;

  const blockerText = (): string | null => {
    if (waiting) return 'Working out the price…';
    if (short) return `Not enough of ${lines.find((l) => l.productId === short.product_id)?.name ?? 'one item'} on the shelf.`;
    if (blocker?.kind === 'serial') return `Pick the serial number for ${blocker.line}.`;
    if (blocker?.kind === 'discount') return `Discount is above your limit (${blocker.limitPct}%). Ask the owner, or lower it.`;
    if (blocker?.kind === 'method') return 'Choose how they are paying.';
    if (blocker?.kind === 'tender') return 'Choose the cash received.';
    if (blocker?.kind === 'till') return 'Open your till before taking cash.';
    return null;
  };

  const complete = async () => {
    if (blocked || !current) return;
    setBusy(true);
    setError(null);
    if (!saleKey.current) saleKey.current = crypto.randomUUID();
    const key = saleKey.current;
    const phoneDigits = phone.replace(/\D/g, '');
    // The prices the customer was shown are the prices sent, so what is shown is what is charged.
    const lineArgs = lines.map((l) => ({
      product_id: l.productId,
      qty: Number(l.qty),
      unit_price: Number(priced(l.productId)?.unit_price ?? 0),
      ...(l.serials.length ? { serials: l.serials } : {}),
    }));
    const receipt: ReceiptLine[] = lines.map((l) => ({ name: l.name, qty: l.qty, total: priced(l.productId)?.line_total ?? 0 }));
    try {
      if (method === 'Credit') {
        const order = await db.rpc('create_order', { p_key: `credit:${key}`, p_location: location?.id, p_lines: lineArgs, p_phone: phoneDigits || null, p_on_credit: true });
        if (order.error) {
          showError(order.error);
          return;
        }
        const delivery = await db.rpc('deliver_order', { p_key: `credit-go:${key}`, p_order: order.data });
        if (delivery.error) {
          const name = String(delivery.error.message).split(':')[0];
          if (name === 'awaiting_approval') {
            setDone({ invoice: '', state: 'awaiting_approval', method: 'Credit', total: payable, lines: receipt });
          } else {
            showError(delivery.error);
          }
          return;
        }
        const row = await db.from('orders').select('invoice_no, total_kobo').eq('id', order.data).maybeSingle();
        setDone({ invoice: row.data?.invoice_no ?? '', state: 'credit', method: 'Credit', total: BigInt(String(row.data?.total_kobo ?? payable)), lines: receipt });
      } else {
        const dbMethod = method === 'Cash' ? 'cash' : method === 'POS' ? 'pos' : 'transfer';
        const sale = await db.rpc('counter_sale', { p_key: key, p_location: location?.id, p_lines: lineArgs, p_method: dbMethod, p_phone: phoneDigits || null });
        if (sale.error) {
          showError(sale.error);
          return;
        }
        // The receipt shows what the books recorded, not what the screen expected.
        const r = sale.data as { invoice_no: string; total: number | string; state: string };
        setDone({ invoice: r.invoice_no, state: r.state, method: method ?? '', total: BigInt(String(r.total)), lines: receipt });
      }
      setMethod(null);
      setTender(null);
      setDiscount('0');
      saleKey.current = null;
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };

  const openTill = async () => {
    const { error: e } = await db.rpc('open_till', { p_float: Number(nairaToKobo(floatText)) });
    if (e) {
      showError(e.message);
      return;
    }
    setFloatText('0');
    const { data } = await db.rpc('my_till');
    if (data && typeof data === 'object' && 'id' in data) setTill(data as { id: string; float: bigint });
  };

  const submitTill = async () => {
    const counted = countedKobo(tillCounts);
    if (counted === 0n) return;
    setBusy(true);
    const { error: e } = await db.rpc('close_till', { p_counted: Number(counted) });
    setBusy(false);
    if (e) {
      showError(e.message);
      return;
    }
    setTillClosed(true);
    setTill(null);
  };

  if (session === undefined) {
    return <main style={{ minHeight: '100vh', background: '#EEF1F4' }} aria-busy="true" />;
  }
  if (session === null) {
    return (
      <main className="mx-auto max-w-sm px-5 py-20 text-center">
        <p className="text-lg font-semibold">Sign in to work the counter.</p>
        <Link href="/login" className="press mt-4 inline-flex h-12 items-center rounded-field bg-action px-6 text-sm font-medium text-white">
          Sign in
        </Link>
      </main>
    );
  }

  const doneTitle = done ? (done.state === 'awaiting_transfer' ? 'Waiting on the bank'
    : done.state === 'awaiting_approval' ? 'Waiting for the owner'
      : done.state === 'credit' ? 'Added to their account'
        : done.method === 'POS' ? 'Card tap recorded'
          : 'Sale complete') : '';
  const doneNote = done ? (done.state === 'awaiting_transfer' ? 'Finance has it. Release the goods once they confirm.'
    : done.state === 'awaiting_approval' ? 'The owner will decide this one.'
      : done.method === 'POS' ? 'The money lands once finance matches the bank line.'
        : done.state === 'credit' ? 'Goods left on their account.'
          : phone ? 'Saved to their record, with warranty and reminders.' : 'Stock and books are updated.') : '';

  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '12px clamp(10px, 2vw, 28px) 32px', fontFamily: 'var(--sans)', color: '#10161E', background: 'radial-gradient(70% 380px at 70% 0, #FFFFFF 0%, rgba(255,255,255,0) 100%), #EEF1F4' }}>
      <StaffNav label="Staff">
        <div role="group" aria-label="Counter" style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(2, 120px)', padding: 3, background: 'rgba(16,24,34,.07)', borderRadius: 12 }}>
          <span aria-hidden="true" style={{ position: 'absolute', top: 3, bottom: 3, left: 3, width: 120, background: '#FFFFFF', borderRadius: 9, boxShadow: '0 1px 2px rgba(16,24,34,.12), 0 4px 10px rgba(16,24,34,.08)', transform: `translateX(${tab === 'sell' ? 0 : 120}px)`, transition: 'transform .28s cubic-bezier(.3,1.2,.5,1)' }} />
          {(['sell', 'till'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} aria-pressed={tab === t} style={{ position: 'relative', height: 40, border: 0, background: 'transparent', color: '#10161E', font: '500 14px var(--sans)', cursor: 'pointer' }}>
              {t === 'sell' ? 'Sell' : 'Close the till'}
            </button>
          ))}
        </div>
        <span style={{ fontSize: 13.5, color: '#434E5A' }}>{session.email}{location ? ` · ${location.name}` : ''}</span>
      </StaffNav>

      {tab === 'sell' ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start', maxWidth: 1320, margin: '14px auto 0' }}>
          <div style={{ flex: '999 1 460px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <section className="card" aria-label="Add items" style={{ position: 'relative', padding: 18 }}>
              <label htmlFor="scan" style={{ display: 'block', marginBottom: 7, fontSize: 14.5, fontWeight: 600 }}>Scan or type a part</label>
              <input
                id="scan"
                ref={scanRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown' && hits.length) { e.preventDefault(); setActive((a) => (a + 1) % hits.length); }
                  if (e.key === 'ArrowUp' && hits.length) { e.preventDefault(); setActive((a) => (a - 1 + hits.length) % hits.length); }
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (hitsFor === query.trim() && hits.length) void addHit(hits[Math.min(active, hits.length - 1)]);
                    else if (query.trim()) pendingEnter.current = true;
                  }
                }}
                autoComplete="off"
                placeholder="Scan the barcode, or type 6205 2rs"
                style={{ width: '100%', height: 56, boxSizing: 'border-box', padding: '0 16px', border: '1.5px solid #10161E', borderRadius: 14, background: '#FFFFFF', color: '#10161E', font: "500 18px var(--mono)" }}
              />
              {hits.length > 0 ? (
                <div role="listbox" aria-label="Matching items" style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
                  {hits.map((h, i) => (
                    <button key={h.product} type="button" role="option" aria-selected={i === active} onClick={() => void addHit(h)} className="press" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 50, padding: '6px 12px', border: 0, borderRadius: 11, background: i === active ? '#EEF3FF' : 'transparent', color: '#10161E', textAlign: 'left', fontFamily: 'var(--sans)', cursor: 'pointer' }}>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 15, fontWeight: 500 }}>{h.name}</span>
                        <span style={{ display: 'block', fontSize: 13, color: '#55606C' }}>{h.part_number ?? h.sku} · {h.state}</span>
                      </span>
                      <span className="tabular" style={{ flex: 'none', fontSize: 15, fontWeight: 600 }}>{formatNaira(h.price)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              {query.trim() && hitsFor === query.trim() && hits.length === 0 ? <div style={{ marginTop: 8, fontSize: 14, color: '#92400E' }}>Nothing matches. Check the number, or search by size.</div> : null}
            </section>

            <section className="card" aria-label="Items on this sale" style={{ padding: '8px 18px 10px' }}>
              {lines.length === 0 ? <div style={{ padding: '22px 0', textAlign: 'center', fontSize: 15, color: '#55606C' }}>Scan the first item to start.</div> : null}
              {lines.map((l) => {
                const pl = priced(l.productId);
                return (
                  <div key={l.productId} style={{ padding: '10px 0', borderBottom: '1px solid #F1F3F5' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px' }}>
                      <div style={{ flex: '1 1 170px', minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 500 }}>{l.name}</div>
                        <div style={{ fontSize: 13, color: '#55606C' }}>{pl ? `${formatNaira(pl.unit_price)} each${pl.trade ? ', trade price' : ''}` : '…'}</div>
                      </div>
                      <div role="group" aria-label={`Quantity of ${l.name}`} style={{ flex: 'none', display: 'flex', alignItems: 'center', background: '#F1F3F5', borderRadius: 12 }}>
                        <button type="button" aria-label={`One fewer: ${l.name}`} className="press" style={stepStyle} onClick={() => {
                          const next = Number(l.qty) - 1;
                          if (next < 1) setLines((cur) => cur.filter((x) => x.productId !== l.productId));
                          else updateLine(l.productId, { qty: toQty(String(next)), serials: l.serials.slice(0, next) });
                        }}>−</button>
                        <span aria-live="polite" className="tabular" style={{ width: 28, textAlign: 'center', fontSize: 15.5, fontWeight: 600 }}>{l.qty}</span>
                        <button type="button" aria-label={`One more: ${l.name}`} className="press" style={stepStyle} onClick={() => updateLine(l.productId, { qty: toQty(String(Number(l.qty) + 1)) })}>+</button>
                      </div>
                      <div className="tabular" style={{ flex: '0 0 96px', textAlign: 'right', fontSize: 15.5, fontWeight: 600 }}>{pl ? formatNaira(pl.line_total) : '…'}</div>
                    </div>
                    {l.needsSerials ? (
                      <div className="rise" style={{ marginTop: 8, padding: '10px 12px', background: l.serials.length >= Number(l.qty) ? '#EEF9F4' : '#F4F6F8', borderRadius: 12 }}>
                        <div style={{ fontSize: 13.5, lineHeight: 1.35, color: '#434E5A' }}>
                          {l.serials.length >= Number(l.qty) ? 'Warranty starts today on the serial you chose.' : 'Scan the unit, or pick its serial. Give the oldest first.'}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                          {(serials[l.productId] ?? []).map((code) => {
                            const on = l.serials.includes(code);
                            return (
                              <button key={code} type="button" onClick={() => {
                                const picked = on ? l.serials.filter((c) => c !== code) : l.serials.length >= Number(l.qty) ? [...l.serials.slice(1), code] : [...l.serials, code];
                                updateLine(l.productId, { serials: picked });
                              }} aria-pressed={on} className="press" style={{ minHeight: 44, padding: '0 11px', border: `1px solid ${on ? '#10161E' : 'rgba(16,24,34,.16)'}`, borderRadius: 10, background: on ? '#10161E' : '#FFFFFF', color: on ? '#FFFFFF' : '#10161E', font: "500 13.5px var(--mono)", cursor: 'pointer' }}>
                                {code}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </section>
          </div>

          <aside className="glass" aria-label="This sale" style={{ flex: '1 1 340px', minWidth: 0, position: 'sticky', top: 76, boxSizing: 'border-box', padding: 18, borderRadius: 24 }}>
            {!done ? (
              <>
                <label htmlFor="ph" style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 550 }}>Customer phone, for warranty and reminders</label>
                <input id="ph" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))} placeholder="0803 123 4567, or leave blank" className="tabular" style={{ width: '100%', height: 48, boxSizing: 'border-box', padding: '0 14px', border: '1px solid rgba(16,24,34,.16)', borderRadius: 13, background: '#FFFFFF', color: '#10161E', font: '450 15.5px var(--sans)' }} />
                {current?.customer ? (
                  <div className="rise" style={{ marginTop: 6, padding: '9px 12px', background: '#EEF3FF', borderRadius: 11, fontSize: 13.5, lineHeight: 1.4 }}>
                    <b style={{ fontWeight: 600 }}>{current.customer.name ?? 'Known customer'}.</b>{current.customer.trade ? ' Trade prices applied.' : ''} Owes {formatNaira(current.customer.owes)}. Holds {formatNaira(current.customer.holds)}.
                  </div>
                ) : null}

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12 }}>
                  <label htmlFor="disc" style={{ fontSize: 14, fontWeight: 550 }}>Discount</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input id="disc" inputMode="numeric" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/\D/g, '').slice(0, 3))} aria-describedby="disc-note" style={{ width: 64, height: 44, boxSizing: 'border-box', padding: '0 10px', border: '1px solid rgba(16,24,34,.16)', borderRadius: 11, background: '#FFFFFF', color: '#10161E', textAlign: 'right', font: '500 15px var(--sans)' }} />
                    <span style={{ fontSize: 15 }}>%</span>
                  </div>
                </div>
                <div id="disc-note" aria-live="polite" style={{ minHeight: 18, marginTop: 3, textAlign: 'right', fontSize: 13, color: discountPct > limitPct ? '#92400E' : '#55606C' }}>
                  {discountPct > limitPct ? `Your limit is ${limitPct}%.` : discountPct ? 'Within your limit.' : ''}
                </div>

                <dl className="tabular" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '5px 14px', margin: '12px 0 0', fontSize: 14.5 }}>
                  <dt style={{ color: '#434E5A' }}>Items</dt><dd style={{ margin: 0, textAlign: 'right' }}>{current ? formatNaira(current.list_total) : lines.length ? '…' : formatNaira(0)}</dd>
                  <dt style={{ color: '#434E5A' }}>Discount</dt><dd style={{ margin: 0, textAlign: 'right' }}>{current && BigInt(String(current.list_total)) > payable ? `−${formatNaira(BigInt(String(current.list_total)) - payable)}` : formatNaira(0)}</dd>
                </dl>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginTop: 6 }}>
                  <span style={{ fontSize: 15, fontWeight: 550 }}>To pay</span>
                  <span className="tabular" style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-.03em' }}>{lines.length && !current ? '…' : formatNaira(payable)}</span>
                </div>

                <div role="group" aria-label="How they are paying" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 5, marginTop: 10 }}>
                  {(['Cash', 'POS', 'Transfer', 'Credit'] as const).map((m) => {
                    const off = m === 'Credit' && !current?.customer;
                    const on = method === m;
                    return (
                      <button key={m} type="button" onClick={() => { setMethod(m); setTender(null); }} aria-pressed={on} disabled={off} className="press" style={{ minHeight: 48, padding: '0 2px', border: `1px solid ${on ? '#10161E' : 'rgba(16,24,34,.16)'}`, borderRadius: 12, background: on ? '#10161E' : '#FFFFFF', color: on ? '#FFFFFF' : '#10161E', font: '500 14px var(--sans)', cursor: 'pointer', opacity: off ? 0.45 : 1 }}>
                        {m}
                      </button>
                    );
                  })}
                </div>

                {method === 'Cash' ? (
                  <div className="rise" style={{ marginTop: 10 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {[0n, ...([100000n, 500000n, 1000000n].map((r) => payable + (r - (payable % r)) % r))]
                        .filter((v, i, arr) => arr.findIndex((x) => x === v) === i)
                        .map((v) => (
                          <button key={String(v)} type="button" onClick={() => setTender(v)} aria-pressed={tender === v} className="press" style={{ flex: '1 1 70px', minHeight: 44, border: `1px solid ${tender === v ? '#10161E' : 'rgba(16,24,34,.16)'}`, borderRadius: 11, background: tender === v ? '#10161E' : '#FFFFFF', color: tender === v ? '#FFFFFF' : '#10161E', font: '500 13.5px var(--sans)', cursor: 'pointer' }}>
                            {v === 0n ? 'Exact' : formatNaira(v)}
                          </button>
                        ))}
                    </div>
                    <div aria-live="polite" className="tabular" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 15 }}>
                      <span>Change to give</span>
                      <b style={{ fontWeight: 600 }}>{formatNaira(tender ? (tender > payable ? tender - payable : 0n) : 0n)}</b>
                    </div>
                  </div>
                ) : null}
                {method === 'POS' ? <p className="rise" style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.4, color: '#434E5A' }}>Goods leave now. The money lands once finance matches the bank line.</p> : null}
                {method === 'Transfer' ? <p className="rise" style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.4, color: '#92400E' }}>Goods stay here until finance confirms the money is in the bank. A screenshot does not count.</p> : null}
                {method === 'Credit' ? <p className="rise" style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.4, color: '#434E5A' }}>Added to {current?.customer?.name ?? 'their'}&apos;s account.</p> : null}
                {method === 'Cash' && !till ? (
                  <div className="rise" style={{ marginTop: 10, padding: '10px 12px', background: '#F4F6F8', borderRadius: 12 }}>
                    <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.4, color: '#434E5A' }}>Your till is not open. Open it with the float you received.</p>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <input inputMode="decimal" value={floatText} onChange={(e) => setFloatText(e.target.value)} aria-label="Float" className="tabular" style={{ flex: 1, height: 44, boxSizing: 'border-box', padding: '0 12px', border: '1px solid rgba(16,24,34,.16)', borderRadius: 11, background: '#FFFFFF', color: '#10161E', font: '500 15px var(--sans)' }} />
                      <button type="button" className="press" onClick={() => void openTill()} style={{ minHeight: 44, padding: '0 16px', border: 0, borderRadius: 11, background: '#10161E', color: '#FFFFFF', font: '500 14px var(--sans)', cursor: 'pointer' }}>
                        Open till
                      </button>
                    </div>
                  </div>
                ) : null}

                <p aria-live="polite" style={{ minHeight: 18, margin: '8px 0 0', fontSize: 13.5, color: '#92400E' }}>{error ?? blockerText()}</p>
                <button type="button" onClick={() => void complete()} disabled={blocked} className="press" style={{ width: '100%', minHeight: 56, marginTop: 4, border: 0, borderRadius: 15, background: blocked ? '#8E99A4' : '#1B5CF0', color: '#FFFFFF', font: '600 17px var(--sans)', cursor: 'pointer' }}>
                  {busy ? 'Recording…' : method === 'Transfer' ? 'Send to finance, hold goods' : 'Complete sale'}
                </button>
              </>
            ) : (
              <div className="rise" aria-live="polite">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 19, fontWeight: 600, letterSpacing: '-.018em' }}>
                  <Tick size={24} stroke="#0D9465" />
                  <span>{doneTitle}</span>
                </div>
                <div style={{ marginTop: 4, fontSize: 14, color: '#434E5A' }}>{doneNote}</div>
                {done.invoice ? (
                  <div style={{ marginTop: 12, padding: 14, background: '#FFFFFF', borderRadius: 12, font: '400 13px/1.55 var(--mono)' }}>
                    <div style={{ fontWeight: 500 }}>POWER STORE</div>
                    <div>Receipt {done.invoice}</div>
                    <div style={{ margin: '6px 0', borderTop: '1px dashed #C6CED6' }} />
                    {done.lines.map((l) => (
                      <div key={l.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <span>{l.qty} × {l.name}</span>
                        <span className="tabular" style={{ flex: 'none' }}>{formatNaira(l.total)}</span>
                      </div>
                    ))}
                    <div style={{ margin: '6px 0', borderTop: '1px dashed #C6CED6' }} />
                    <div className="tabular" style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 500 }}>
                      <span>TOTAL</span>
                      <span>{formatNaira(done.total)}</span>
                    </div>
                  </div>
                ) : null}
                <button type="button" onClick={() => { setDone(null); setLines([]); setPhone(''); setDiscount('0'); setError(null); focusScan(); }} className="press" style={{ width: '100%', minHeight: 56, marginTop: 8, border: 0, borderRadius: 15, background: '#1B5CF0', color: '#FFFFFF', font: '600 17px var(--sans)', cursor: 'pointer' }}>
                  New sale
                </button>
              </div>
            )}
          </aside>
        </div>
      ) : (
        <div className="rise" style={{ maxWidth: 640, margin: '18px auto 0' }}>
          <h1 style={{ margin: '0 2px', fontSize: 'clamp(26px, 3vw, 34px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-.028em' }}>Close the till</h1>
          <p style={{ margin: '6px 2px 14px', fontSize: 15.5, lineHeight: 1.45, color: '#434E5A' }}>
            {tillClosed ? 'Your count is saved and recorded in the books.' : 'Count what is in the drawer and type each note. The system total is never shown, so the count stays honest.'}
          </p>
          <section className="card" aria-label="Count the cash" style={{ padding: 18 }}>
            {cashNotes.map((n) => (
              <div key={n} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '3px 0' }}>
                <span className="tabular" style={{ flex: '0 0 70px', fontSize: 15.5, fontWeight: 550 }}>₦{n.toLocaleString('en-NG')}</span>
                <div role="group" aria-label={`Number of ₦${n} notes`} style={{ display: 'flex', alignItems: 'center', background: '#F1F3F5', borderRadius: 12 }}>
                  <button type="button" aria-label={`One fewer ₦${n} note`} disabled={tillClosed} className="press" style={stepStyle} onClick={() => setTillCounts((c) => ({ ...c, [n]: String(Math.max(0, Number(c[n]?.replace(/\D/g, '') || 0) - 1)) }))}>−</button>
                  <input inputMode="numeric" aria-label={`Number of ₦${n} notes`} disabled={tillClosed} value={tillCounts[n] ?? ''} onChange={(e) => setTillCounts((c) => ({ ...c, [n]: e.target.value.replace(/\D/g, '').slice(0, 5) }))} className="tabular" style={{ width: 58, height: 44, boxSizing: 'border-box', padding: 0, border: 0, background: 'transparent', color: '#10161E', textAlign: 'center', font: '600 15.5px var(--sans)' }} />
                  <button type="button" aria-label={`One more ₦${n} note`} disabled={tillClosed} className="press" style={stepStyle} onClick={() => setTillCounts((c) => ({ ...c, [n]: String(Number(c[n]?.replace(/\D/g, '') || 0) + 1) }))}>+</button>
                </div>
                <span className="tabular" style={{ flex: '0 0 100px', textAlign: 'right', fontSize: 15.5 }}>{formatNaira(noteKobo(n, tillCounts[n]))}</span>
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginTop: 10, paddingTop: 10, borderTop: '1px solid #E6EAEE' }}>
              <span style={{ fontSize: 15, fontWeight: 550 }}>You counted</span>
              <span className="tabular" style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-.028em' }}>{formatNaira(countedKobo(tillCounts))}</span>
            </div>
          </section>
          {!tillClosed ? (
            <button type="button" onClick={() => void submitTill()} disabled={busy || countedKobo(tillCounts) === 0n} className="press" style={{ width: '100%', minHeight: 54, marginTop: 12, border: 0, borderRadius: 15, background: busy || countedKobo(tillCounts) === 0n ? '#8E99A4' : '#1B5CF0', color: '#FFFFFF', font: '600 16px var(--sans)', cursor: 'pointer' }}>
              This is my count
            </button>
          ) : (
            <section className="card rise" aria-live="polite" style={{ marginTop: 12, background: '#EEF9F4', padding: 18 }}>
              <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-.016em' }}>The count is saved.</div>
              <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.45, color: '#434E5A' }}>Any difference goes to the books and to the owner to review. It does not stop you closing.</p>
            </section>
          )}
        </div>
      )}
    </main>
  );
}

const stepStyle: React.CSSProperties = { width: 44, height: 44, border: 0, borderRadius: 12, background: 'transparent', color: '#10161E', font: '400 21px var(--sans)', cursor: 'pointer' };
