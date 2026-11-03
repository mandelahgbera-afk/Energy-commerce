'use client';

// The owner's today screen, ported from OwnerToday.dc.html. Every figure comes from owner_today(),
// which works it out from the records; this page only lays it out and sends the owner's yes or no
// to the same functions the rest of the shop uses.
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { browserDb } from '@/lib/supabase';
import { friendly } from '@/lib/errors';
import { formatNaira, shortNaira } from '@/lib/money';
import { Tick } from '@/components/kit/feel';
import { StaffNav } from '@/components/staff-nav';

type Kobo = number | string;
type Person = { customer_id: string | null; name: string | null; phone: string | null; reminders_ok: boolean | null };
type QueueItem =
  | { type: 'approval'; id: string; kind: 'discount' | 'credit'; order_id: string; invoice_no: string | null; customer: string | null; asked_by: string | null; total: Kobo; profit: Kobo;
      detail: { list_total?: Kobo; asked_total?: Kobo; owes?: Kobo; limit?: Kobo } }
  | { type: 'payment'; id: string; method: string; amount: Kobo; invoice_no: string | null; customer: string | null; recorded_on: string; reference: string | null }
  | { type: 'stock_count'; id: string; counted_on: string; location: string; lines: number; differences: number; value_change: Kobo }
  | { type: 'safe_count'; id: string; counted_on: string; counted: Kobo }
  | { type: 'hold_lapsed'; id: string; invoice_no: string | null; customer: string | null; holds: Kobo };
type Today = {
  today: string;
  queue: QueueItem[];
  money_in_today: Record<string, Kobo>;
  tiles: { sales: Kobo; profit: Kobo; money_in: Kobo; money_out: Kobo; prev_profit: Kobo; prev_money_in: Kobo; prev_money_out: Kobo };
  series: { date: string; in: Kobo; out: Kobo }[];
  debts: { band: number; label: string; total: Kobo; customers: (Person & { owes: Kobo; oldest_days: number })[] }[];
  running_out: { product_id: string; sku: string; name: string; free: Kobo; days_left: number | null; lead_days: number; low_stock_at: Kobo }[];
  batteries_due: { month: string; units: number; customers: Person[] | null }[];
  battery_life_months: number;
};

const K = (v: Kobo | null | undefined): bigint => BigInt(String(v ?? 0).split('.')[0] || '0');
const channels = [
  { key: 'transfer', name: 'Transfer', color: '#1B5CF0' },
  { key: 'pos', name: 'Card', color: '#D97A0B' },
  { key: 'cash', name: 'Cash', color: '#0F8F6B' },
];
const bandColors = ['#86A9F7', '#5585F3', '#1B5CF0', '#0F3A9E'];
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
const pctChange = (now: bigint, before: bigint) => (before === 0n ? null : Number(((now - before) * 1000n) / (before < 0n ? -before : before)) / 10);
// Click-to-chat: staff press send themselves. Nothing is sent by the system.
const whatsapp = (phone: string, text: string) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;

export default function Owner() {
  const db = useRef(browserDb()).current;
  const [session, setSession] = useState<undefined | null | { role: string | null }>(undefined);
  const [period, setPeriod] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<Today | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [band, setBand] = useState(0);
  const [month, setMonth] = useState(0);
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);

  const showError = useCallback((msg: string) => {
    const [name, ...rest] = msg.split(':');
    setError(friendly(name, rest.join(':').trim()));
  }, []);

  const load = useCallback(async (days: number) => {
    const { data: d, error: e } = await db.rpc('owner_today', { p_days: days });
    if (e) showError(e.message);
    else setData(d as Today);
  }, [db, showError]);

  useEffect(() => {
    (async () => {
      const { data: s } = await db.auth.getSession();
      if (!s.session) {
        setSession(null);
        return;
      }
      const me = await db.from('staff').select('role').eq('id', s.session.user.id).maybeSingle();
      setSession({ role: me.data?.role ?? null });
    })();
  }, [db]);

  const allowed = session?.role === 'owner' || session?.role === 'accountant';
  useEffect(() => {
    if (allowed) void load(period);
  }, [allowed, period, load]);

  // The owner's yes or no goes to the same function the rest of the shop would use.
  const act = async (item: QueueItem, yes: boolean) => {
    setBusy(item.id);
    setError(null);
    let call: PromiseLike<{ error: { message: string } | null }> | null = null;
    let text = '';
    if (item.type === 'approval') {
      call = db.rpc('decide_approval', { p_approval: item.id, p_yes: yes, p_note: yes ? 'Approved on the owner screen' : 'Refused on the owner screen' });
      text = yes ? 'Approved. The counter can go ahead.' : 'Refused. The order is cancelled and its stock is free.';
    } else if (item.type === 'payment') {
      call = yes ? db.rpc('confirm_payment', { p_payment: item.id }) : db.rpc('reject_payment', { p_payment: item.id, p_reason: 'Not in the bank' });
      text = yes ? `Confirmed. ${formatNaira(item.amount)} is now money in the books.` : 'Marked as not received. The goods stay until it is paid.';
    } else if (item.type === 'stock_count') {
      call = yes ? db.rpc('approve_stock_count', { p_count: item.id }) : db.rpc('reject_stock_count', { p_count: item.id, p_reason: 'Recount asked on the owner screen' });
      text = yes ? 'Count accepted. The shelves and the books now agree with it.' : 'Recount asked. Nothing changed.';
    } else if (item.type === 'safe_count') {
      call = yes ? db.rpc('approve_safe_count', { p_count: item.id }) : db.rpc('reject_safe_count', { p_count: item.id, p_reason: 'Recount asked on the owner screen' });
      text = yes ? 'Safe count accepted.' : 'Recount asked. Nothing changed.';
    } else if (item.type === 'hold_lapsed') {
      call = yes ? db.rpc('reserve_order', { p_order: item.id }) : null;
      text = yes ? 'Goods held again for them.' : 'Left for now.';
    }
    const result = call ? await call : { error: null };
    setBusy(null);
    if (result.error) {
      showError(result.error.message);
      return;
    }
    setResolved((r) => ({ ...r, [item.id]: text }));
    setTimeout(() => void load(period), 1400);
  };

  const series = useMemo(() => {
    if (!data) return [];
    const days = data.series.map((p) => ({ label: day(p.date), full: p.date === data.today ? `Today, ${day(p.date)}` : day(p.date), in: K(p.in), out: K(p.out) }));
    if (period !== 90) return days;
    // Ninety days read better as weeks, counted back from today.
    const weeks: typeof days = [];
    for (let end = days.length; end > 0; end -= 7) {
      const chunk = days.slice(Math.max(0, end - 7), end);
      weeks.unshift({ label: chunk[chunk.length - 1].label, full: `Week to ${chunk[chunk.length - 1].label}`, in: chunk.reduce((s, p) => s + p.in, 0n), out: chunk.reduce((s, p) => s + p.out, 0n) });
    }
    return weeks;
  }, [data, period]);

  if (session === undefined) return <main style={{ minHeight: '100vh' }} aria-busy="true" />;
  if (session === null || !allowed) {
    return (
      <main className="mx-auto max-w-sm px-5 py-20 text-center">
        <p className="text-lg font-semibold">{session === null ? 'Sign in to see your day.' : 'This page is for the owner and the accountant.'}</p>
        <Link href={session === null ? '/login' : '/'} className="press mt-4 inline-flex h-12 items-center rounded-field bg-action px-6 text-sm font-medium text-white">
          {session === null ? 'Sign in' : 'Back'}
        </Link>
      </main>
    );
  }

  const open = data ? data.queue.filter((q) => !resolved[q.id]).length : 0;
  const inToday = data ? channels.map((c) => ({ ...c, value: K(data.money_in_today[c.key]) })) : [];
  const inTodayTotal = inToday.reduce((s, c) => s + c.value, 0n);

  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '12px clamp(10px, 2vw, 28px) 40px' }}>
      <StaffNav label="Owner" wide={1240}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          {[['#top', 'Today'], ['#money', 'Money'], ['#owes', 'Debts'], ['#stock', 'Stock']].map(([href, label]) => (
            <a key={href} href={href} style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 12px', borderRadius: 10, fontSize: 14.5, color: '#434E5A' }}>{label}</a>
          ))}
        </div>
      </StaffNav>

      <div id="top" style={{ maxWidth: 1240, margin: '18px auto 0' }}>
        <h1 aria-live="polite" style={{ margin: '0 2px 16px', fontSize: 'clamp(26px, 3vw, 36px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-.03em' }}>
          {!data ? 'Getting your day…' : open === 0 ? 'All clear. Nothing needs you.' : open === 1 ? '1 thing needs you.' : `${open} things need you.`}
        </h1>
        {error ? <p role="alert" style={{ margin: '0 2px 12px', padding: '10px 14px', borderRadius: 12, background: '#FDF3E7', color: '#92400E', fontSize: 14.5 }}>{error}</p> : null}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
          <section aria-label="Things that need you" style={{ flex: '999 1 480px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data?.queue.map((q) => <QueueCard key={q.id} item={q} done={resolved[q.id]} busy={busy === q.id} onAnswer={(yes) => void act(q, yes)} />)}
            {data && data.queue.length === 0 ? (
              <div className="card rise" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 20, fontSize: 16, fontWeight: 550, background: '#EEF9F4' }}>
                <Tick size={24} stroke="#0D9465" />All clear. Nothing needs you right now.
              </div>
            ) : null}
          </section>

          <aside aria-label="Money in today" className="card" style={{ flex: '1 1 300px', minWidth: 0, padding: 22 }}>
            <div style={{ fontSize: 14, color: '#434E5A' }}>Money in today</div>
            <div className="tabular" style={{ marginTop: 4, fontSize: 34, fontWeight: 600, letterSpacing: '-.03em' }}>{data ? formatNaira(inTodayTotal) : '…'}</div>
            <div style={{ marginTop: 2, fontSize: 13, color: '#55606C' }}>Confirmed by the bank or counted into a till</div>
            <div aria-hidden="true" style={{ display: 'flex', gap: 2, height: 10, marginTop: 14, borderRadius: 6, overflow: 'hidden', background: '#F1F3F5' }}>
              {inToday.filter((c) => c.value > 0n).map((c) => <div key={c.key} style={{ flexGrow: Number(c.value / 10000n) || 1, background: c.color }} />)}
            </div>
            <dl style={{ margin: '12px 0 0', display: 'grid', gap: 6 }}>
              {inToday.map((c) => (
                <div key={c.key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14.5 }}>
                  <dt style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#434E5A' }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: c.color }} />{c.name}</dt>
                  <dd className="tabular" style={{ margin: 0, fontWeight: 600 }}>{formatNaira(c.value)}</dd>
                </div>
              ))}
            </dl>
          </aside>
        </div>

        <div id="money" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '26px 2px 12px' }}>
          <span style={{ fontSize: 14.5, color: '#434E5A' }}>Show</span>
          <div role="group" aria-label="Period" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 84px)', padding: 3, background: 'rgba(16,24,34,.07)', borderRadius: 12 }}>
            {([7, 30, 90] as const).map((p) => (
              <button key={p} type="button" aria-pressed={period === p} onClick={() => { setHover(null); setPeriod(p); }} className="press" style={{ height: 40, border: 0, borderRadius: 9, background: period === p ? '#FFFFFF' : 'transparent', boxShadow: period === p ? '0 1px 2px rgba(16,24,34,.12)' : 'none', color: '#10161E', font: '500 14px var(--sans)', cursor: 'pointer' }}>
                {p} days
              </button>
            ))}
          </div>
        </div>

        {data ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <Tile label="Money in" now={K(data.tiles.money_in)} before={K(data.tiles.prev_money_in)} upIsGood days={period} />
            <Tile label="Money out" now={K(data.tiles.money_out)} before={K(data.tiles.prev_money_out)} upIsGood={false} days={period} />
            <Tile label="Gross profit" note="Sales less what the goods cost. Running costs are not taken off." now={K(data.tiles.profit)} before={K(data.tiles.prev_profit)} upIsGood days={period} />
          </div>
        ) : null}

        <section className="card" style={{ marginTop: 12, padding: 22 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 }}>
            <div>
              <h2 className="title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Money in and money out</h2>
              <p className="sub">{period === 90 ? 'Per week, last 90 days' : `Per day, last ${period} days`}. Cash banked or moved between accounts is neither.</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 14 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ width: 14, height: 3, borderRadius: 2, background: '#1B5CF0' }} />Money in</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ width: 14, height: 3, borderRadius: 2, background: '#D97A0B' }} />Money out</span>
              <button type="button" aria-pressed={table} onClick={() => { setTable(!table); setHover(null); }} className="press" style={{ minHeight: 44, padding: '0 14px', border: '1px solid rgba(16,24,34,.16)', borderRadius: 12, background: '#FFFFFF', color: '#10161E', font: '500 14px var(--sans)', cursor: 'pointer' }}>
                {table ? 'View as graph' : 'View as table'}
              </button>
            </div>
          </div>
          {series.length === 0 ? null : table ? <MoneyTable points={series} /> : <MoneyChart points={series} hover={hover} setHover={setHover} plotRef={plotRef} />}
        </section>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12, alignItems: 'flex-start' }}>
          <section id="owes" className="card" style={{ flex: '1 1 420px', minWidth: 0, padding: 22 }}>
            <h2 className="title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Who owes us</h2>
            {data ? <Debts debts={data.debts} band={band} setBand={setBand} /> : null}
          </section>

          <section className="card" style={{ flex: '1 1 420px', minWidth: 0, padding: 22 }}>
            <h2 className="title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>If the dollar moves</h2>
            <p className="sub" style={{ marginTop: 6 }}>
              Once supplier orders record what each product cost in dollars, this shows how much your stock and margins move when the naira does. Until then it would be guesswork, so it stays empty.
            </p>
          </section>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12, alignItems: 'flex-start' }}>
          <section id="stock" className="card" style={{ flex: '1 1 420px', minWidth: 0, padding: 22 }}>
            <h2 className="title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>What is running out</h2>
            <p className="sub">Days of stock left at the last 30 days&apos; pace, against how long the supplier takes.</p>
            {data ? <RunningOut rows={data.running_out} /> : null}
          </section>

          <section className="card" style={{ flex: '1 1 420px', minWidth: 0, padding: 22 }}>
            <h2 className="title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Who is due for a new battery</h2>
            <p className="sub">Batteries reaching {data?.battery_life_months ?? 24} months, the usual replacement age until the shop sets its own. Tap a month.</p>
            {data ? <Batteries months={data.batteries_due} month={month} setMonth={setMonth} /> : null}
          </section>
        </div>
      </div>
    </main>
  );
}

// One look per kind of decision, so a transfer to confirm and a stock count read apart at a glance.
const queueLook = (kind: string) =>
  kind.startsWith('Confirm') ? { icon: 'M3 10l9-6 9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18', ink: '#0A6E4B', bg: '#EEF9F4' }
  : kind === 'Stock count' ? { icon: 'M3 8l9-5 9 5v8l-9 5-9-5ZM3 8l9 5 9-5M12 13v8', ink: '#92400E', bg: '#FDF3E7' }
  : kind === 'Safe count' ? { icon: 'M4 4h16v16H4ZM15 12a3 3 0 1 1-6 0a3 3 0 0 1 6 0ZM12 4v2M12 18v2', ink: '#92400E', bg: '#FDF3E7' }
  : kind === 'Hold ran out' ? { icon: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18ZM12 7v5l3 2', ink: '#55606C', bg: '#F1F3F5' }
  : kind === 'Credit request' ? { icon: 'M3 6h18v12H3ZM3 10h18M7 15h4', ink: '#1B5CF0', bg: '#EEF3FF' }
  : { icon: 'M3 12V4h8l9 9-8 8ZM7.5 7.5h.01', ink: '#1B5CF0', bg: '#EEF3FF' };

function QueueCard({ item, done, busy, onAnswer }: { item: QueueItem; done?: string; busy: boolean; onAnswer: (yes: boolean) => void }) {
  let kind = '';
  let title = '';
  let body = '';
  let okText = 'Accept';
  let altText = 'Not now';
  if (item.type === 'approval' && item.kind === 'discount') {
    const list = K(item.detail.list_total);
    const asked = K(item.detail.asked_total);
    const pct = list > 0n ? Number(((list - asked) * 1000n) / list) / 10 : 0;
    const net = K(item.total);
    const profit = K(item.profit);
    const profitPct = net > 0n ? Number((profit * 1000n) / net) / 10 : 0;
    kind = 'Discount request';
    title = `${item.asked_by ?? 'Staff'} asks ${pct}% off ${item.invoice_no ?? 'an order'}`;
    body = `${item.customer ? `For ${item.customer}. ` : ''}The sale comes to ${formatNaira(item.total)}. A yes leaves ${formatNaira(profit)} profit, ${profitPct}% of the price.`;
    okText = 'Approve';
    altText = 'Refuse';
  } else if (item.type === 'approval') {
    kind = 'Credit request';
    title = `${item.customer ?? 'A customer'} wants ${formatNaira(item.detail.asked_total ?? item.total)} on credit`;
    body = `They owe ${formatNaira(item.detail.owes ?? 0)} now, and their limit is ${formatNaira(item.detail.limit ?? 0)}.`;
    okText = 'Approve';
    altText = 'Refuse';
  } else if (item.type === 'payment') {
    kind = item.method === 'pos' ? 'Confirm a card tap' : 'Confirm a transfer';
    title = `${formatNaira(item.amount)} from ${item.customer ?? 'a walk-in customer'}`;
    body = `For ${item.invoice_no ?? 'an order'}${item.reference ? `, reference ${item.reference}` : ''}. Check it is in the bank before you confirm.`;
    okText = 'It is in the bank';
    altText = 'Not in the bank';
  } else if (item.type === 'stock_count') {
    const v = K(item.value_change);
    kind = 'Stock count';
    title = `${item.differences} of ${item.lines} lines differ at ${item.location}`;
    body = v === 0n ? 'The count matches the books in value.' : `About ${formatNaira(v < 0n ? -v : v)} ${v < 0n ? 'less' : 'more'} than the books say.`;
    okText = 'Accept the count';
    altText = 'Recount';
  } else if (item.type === 'safe_count') {
    kind = 'Safe count';
    title = `Counted ${formatNaira(item.counted)}`;
    body = 'Accepting moves the books to this figure, and any difference is recorded.';
    okText = 'Accept';
    altText = 'Recount';
  } else {
    kind = 'Hold ran out';
    title = `${item.invoice_no ?? 'An order'}${item.customer ? ` for ${item.customer}` : ''}`;
    body = `They have paid ${formatNaira(item.holds)}, and their goods went back on sale.`;
    okText = 'Hold the goods again';
    altText = 'Leave for now';
  }
  const look = queueLook(kind);
  return (
    <article className="card rise" style={{ padding: 18, background: done ? '#F3FAF7' : '#FFFFFF', borderColor: done ? 'rgba(13,148,101,.18)' : undefined }}>
      {done ? (
        <div aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 15, fontWeight: 550 }}><span style={{ display: 'grid', placeItems: 'center', width: 28, height: 28, flex: 'none', borderRadius: 14, background: '#0D9465' }}><Tick size={16} /></span>{done}</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', gap: 14 }}>
            <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 40, height: 40, flex: 'none', borderRadius: 12, background: look.bg }}>
              <svg viewBox="0 0 24 24" width="20" height="20" style={{ fill: 'none', stroke: look.ink, strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d={look.icon} /></svg>
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: look.ink }}>{kind}</div>
              <div style={{ marginTop: 2, fontSize: 16.5, fontWeight: 600, letterSpacing: '-.012em' }}>{title}</div>
              <div style={{ marginTop: 3, fontSize: 14, lineHeight: 1.45, color: '#434E5A' }}>{body}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={busy} onClick={() => onAnswer(false)} className="press" style={{ minHeight: 44, padding: '0 14px', border: '1px solid rgba(16,24,34,.16)', borderRadius: 12, background: '#FFFFFF', color: '#10161E', font: '500 14px var(--sans)', cursor: 'pointer' }}>{altText}</button>
            <button type="button" disabled={busy} onClick={() => onAnswer(true)} className="press" style={{ minHeight: 44, padding: '0 16px', border: 0, borderRadius: 12, background: '#10161E', color: '#FFFFFF', font: '500 14px var(--sans)', cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving…' : okText}</button>
          </div>
        </div>
      )}
    </article>
  );
}

function Tile({ label, note, now, before, upIsGood, days }: { label: string; note?: string; now: bigint; before: bigint; upIsGood: boolean; days: number }) {
  const change = pctChange(now, before);
  const good = change === null ? null : (change >= 0) === upIsGood;
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ fontSize: 14, color: '#434E5A' }}>{label}</div>
      <div className="tabular" style={{ marginTop: 4, fontSize: 28, fontWeight: 600, letterSpacing: '-.028em' }}>{shortNaira(now)}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 13, color: '#55606C' }}>
        {change === null ? `Nothing in the ${days} days before to compare with.` : (
          <>
            <span className="tabular" style={{ padding: '2px 8px', borderRadius: 10, fontWeight: 650, background: good ? '#EEF9F4' : '#FDF3E7', color: good ? '#0A6E4B' : '#92400E' }}>{change >= 0 ? '↑' : '↓'} {Math.abs(change)}%</span>
            {`${change >= 0 ? 'more' : 'less'} than the ${days} days before`}
          </>
        )}
      </div>
      {note ? <div style={{ marginTop: 4, fontSize: 12.5, color: '#55606C' }}>{note}</div> : null}
    </div>
  );
}

type Point = { label: string; full: string; in: bigint; out: bigint };

function MoneyChart({ points, hover, setHover, plotRef }: { points: Point[]; hover: number | null; setHover: (i: number | null) => void; plotRef: React.RefObject<HTMLDivElement | null> }) {
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [plotRef]);
  const max = points.reduce((m, p) => { const hi = p.in > p.out ? p.in : p.out; return hi > m ? hi : m; }, 0n);
  // A round top for the scale, so the gridlines read as plain amounts.
  const nice = (v: number) => { const e = 10 ** Math.floor(Math.log10(v || 1)); const f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e; };
  const step = nice((Number(max) * 1.12) / 4) || 100000;
  const top = Math.max(step, Math.ceil((Number(max) * 1.12) / step) * step);
  const X = (i: number) => (points.length === 1 ? 0 : (i / (points.length - 1)) * 1000);
  const Y = (v: bigint) => 280 - (Number(v) / top) * 280;
  const line = (key: 'in' | 'out') => points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(p[key]).toFixed(1)}`).join(' ');
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1; v += step) ticks.push(v);
  // As many dates as fit, about one per 70px and no more than seven, so they never run into each other on a phone.
  const fit = Math.max(2, Math.min(7, Math.floor(width / 70)));
  const every = Math.max(1, Math.ceil((points.length - 1) / (fit - 1)));
  const h = hover !== null && points[hover] ? hover : null;
  const hp = h !== null ? points[h] : null;
  const hl = h !== null ? (points.length === 1 ? 0 : (h / (points.length - 1)) * 100) : 0;
  const totalIn = points.reduce((s, p) => s + p.in, 0n);
  const totalOut = points.reduce((s, p) => s + p.out, 0n);
  const pick = (clientX: number) => {
    const r = plotRef.current?.getBoundingClientRect();
    if (!r) return;
    setHover(Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (points.length - 1)));
  };
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
      <div aria-hidden="true" style={{ position: 'relative', width: 46, height: 240, fontSize: 12, color: '#55606C' }}>
        {ticks.map((v) => <span key={v} className="tabular" style={{ position: 'absolute', right: 0, top: `${100 - (v / top) * 100}%`, transform: 'translateY(-50%)' }}>{shortNaira(Math.round(v))}</span>)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          ref={plotRef}
          tabIndex={0}
          role="img"
          aria-label={`Money in and out. Total in ${shortNaira(totalIn)}, total out ${shortNaira(totalOut)}. Use the left and right arrows to read each point.`}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
          onFocus={() => { if (hover === null) setHover(points.length - 1); }}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const cur = hover ?? points.length - 1;
            setHover(Math.max(0, Math.min(points.length - 1, cur + (e.key === 'ArrowLeft' ? -1 : 1))));
          }}
          style={{ position: 'relative', height: 240, outlineOffset: 4 }}
        >
          {ticks.map((v) => <div key={v} aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, top: `${100 - (v / top) * 100}%`, borderTop: '1px solid #EEF1F4' }} />)}
          <svg aria-hidden="true" viewBox="0 0 1000 280" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
            <path d={`${line('in')} L1000 280 L0 280 Z`} fill="rgba(27,92,240,.07)" />
            <path d={line('out')} fill="none" stroke="#D97A0B" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            <path d={line('in')} fill="none" stroke="#1B5CF0" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
          {hp ? (
            <>
              <div aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, left: `${hl}%`, borderLeft: '1px solid rgba(16,24,34,.25)' }} />
              <div aria-hidden="true" style={{ position: 'absolute', left: `${hl}%`, top: `${(Y(hp.in) / 280) * 100}%`, width: 10, height: 10, marginLeft: -5, marginTop: -5, borderRadius: 5, background: '#1B5CF0', boxShadow: '0 0 0 2px #FFFFFF' }} />
              <div aria-hidden="true" style={{ position: 'absolute', left: `${hl}%`, top: `${(Y(hp.out) / 280) * 100}%`, width: 10, height: 10, marginLeft: -5, marginTop: -5, borderRadius: 5, background: '#D97A0B', boxShadow: '0 0 0 2px #FFFFFF' }} />
              <div aria-live="polite" className="glass" style={{ position: 'absolute', top: 8, left: hl > 58 ? 'auto' : `calc(${hl}% + 14px)`, right: hl > 58 ? `calc(${100 - hl}% + 14px)` : 'auto', minWidth: 170, padding: '10px 12px', borderRadius: 12, fontSize: 13.5 }}>
                <div style={{ fontWeight: 600 }}>{hp.full}</div>
                <div className="tabular" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 4 }}><span>In</span><b style={{ fontWeight: 600 }}>{formatNaira(hp.in)}</b></div>
                <div className="tabular" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>Out</span><b style={{ fontWeight: 600 }}>{formatNaira(hp.out)}</b></div>
                <div className="tabular" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 2, paddingTop: 2, borderTop: '1px solid rgba(16,24,34,.08)' }}><span>Left over</span><b style={{ fontWeight: 600 }}>{formatNaira(hp.in - hp.out)}</b></div>
              </div>
            </>
          ) : null}
        </div>
        <div aria-hidden="true" style={{ position: 'relative', height: 20, marginTop: 6, fontSize: 12, color: '#55606C' }}>
          {points.map((p, i) => ((points.length - 1 - i) % every === 0 ? (
            <span key={p.full} style={{ position: 'absolute', left: `${points.length === 1 ? 0 : (i / (points.length - 1)) * 100}%`, transform: i === points.length - 1 ? 'translateX(-100%)' : i === 0 ? 'none' : 'translateX(-50%)', whiteSpace: 'nowrap' }}>{p.label}</span>
          ) : null))}
        </div>
      </div>
    </div>
  );
}

function MoneyTable({ points }: { points: Point[] }) {
  return (
    <div tabIndex={0} style={{ maxHeight: 320, overflow: 'auto', marginTop: 14 }}>
      <table className="tabular" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr>{['Date', 'Money in', 'Money out', 'Left over'].map((h, i) => <th key={h} scope="col" style={{ position: 'sticky', top: 0, padding: '8px 10px', textAlign: i ? 'right' : 'left', fontWeight: 500, color: '#55606C', background: '#FFFFFF', borderBottom: '1px solid #E6EAEE' }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {points.slice().reverse().map((p) => (
            <tr key={p.full}>
              <td style={{ padding: '8px 10px', borderBottom: '1px solid #F1F3F5' }}>{p.full}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid #F1F3F5' }}>{formatNaira(p.in)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid #F1F3F5' }}>{formatNaira(p.out)}</td>
              <td style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid #F1F3F5' }}>{formatNaira(p.in - p.out)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Debts({ debts, band, setBand }: { debts: Today['debts']; band: number; setBand: (b: number) => void }) {
  const total = debts.reduce((s, b) => s + K(b.total), 0n);
  const chosen = debts[band] ?? debts[0];
  return (
    <>
      <div className="tabular" style={{ marginTop: 4, fontSize: 28, fontWeight: 600, letterSpacing: '-.028em' }}>{formatNaira(total)}</div>
      <p className="sub">By how long since the goods left. Tap a band to see those customers.</p>
      <div style={{ display: 'flex', gap: 2, height: 14, marginTop: 12, borderRadius: 7, overflow: 'hidden', background: '#F1F3F5' }}>
        {debts.filter((b) => K(b.total) > 0n).map((b) => (
          <button key={b.band} type="button" aria-label={`${b.label}, ${formatNaira(b.total)}`} aria-pressed={b.band === band} onClick={() => setBand(b.band)} style={{ flexGrow: Number(K(b.total) / 10000n) || 1, border: 0, padding: 0, background: bandColors[b.band], opacity: b.band === band ? 1 : 0.55, cursor: 'pointer' }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(108px, 1fr))', gap: 6, marginTop: 10 }}>
        {debts.map((b) => (
          <button key={b.band} type="button" aria-pressed={b.band === band} onClick={() => setBand(b.band)} className="press" style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '6px 10px', border: 0, borderRadius: 10, background: b.band === band ? '#F1F3F5' : 'transparent', color: '#10161E', textAlign: 'left', font: '450 13.5px var(--sans)', cursor: 'pointer' }}>
            <span aria-hidden="true" style={{ flex: 'none', width: 10, height: 10, borderRadius: 3, background: bandColors[b.band] }} />
            <span><span style={{ display: 'block' }}>{b.label}</span><b className="tabular" style={{ fontWeight: 600 }}>{shortNaira(b.total)}</b></span>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        {chosen && chosen.customers.length === 0 ? <p className="sub">Nobody in this band.</p> : null}
        {chosen?.customers.map((c) => (
          <div key={c.customer_id ?? 'walk-in'} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderTop: '1px solid #F1F3F5' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 550 }}>{c.name ?? (c.customer_id ? 'Customer with no name' : 'Walk-in, no name or phone')}</div>
              <div style={{ fontSize: 13, color: '#55606C' }}>Oldest {c.oldest_days} days</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <b className="tabular" style={{ fontWeight: 600 }}>{formatNaira(c.owes)}</b>
              <Reach person={c} text={`Hello${c.name ? ` ${c.name}` : ''}, this is Power Store. Your balance of ${formatNaira(c.owes)} is due. Thank you.`} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// WhatsApp only for customers who agreed to reminders; a phone call otherwise.
function Reach({ person, text }: { person: Person; text: string }) {
  if (!person.phone) return null;
  const style = { display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 14px', border: '1px solid rgba(16,24,34,.16)', borderRadius: 12, background: '#FFFFFF', color: '#10161E', fontSize: 14, fontWeight: 500 } as const;
  return person.reminders_ok ? (
    <a href={whatsapp(person.phone, text)} target="_blank" rel="noreferrer" className="press" style={style}>Remind</a>
  ) : (
    <a href={`tel:+${person.phone}`} className="press" style={style}>Call</a>
  );
}

function RunningOut({ rows }: { rows: Today['running_out'] }) {
  if (rows.length === 0) return <p className="sub" style={{ marginTop: 12 }}>Nothing is running out.</p>;
  const scale = 75;
  return (
    <div style={{ marginTop: 12 }}>
      {rows.map((r) => {
        const left = r.days_left === null ? null : Number(r.days_left);
        const warn = K(r.free) <= 0n || (left !== null && left <= r.lead_days);
        const note = K(r.free) <= 0n ? 'None left on the shelf.'
          : left === null ? `${String(r.free)} left, under the low-stock line of ${String(r.low_stock_at)}.`
            : `${String(r.free)} left, about ${left} days at this pace.${r.lead_days ? ` The supplier takes ${r.lead_days}.` : ''}`;
        return (
          <div key={r.product_id} style={{ padding: '10px 0', borderTop: '1px solid #F1F3F5' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 550 }}>{r.name}</div>
              {warn ? <span style={{ fontSize: 13, fontWeight: 600, color: '#92400E' }}>Order now</span> : null}
            </div>
            <div style={{ fontSize: 13, color: warn ? '#92400E' : '#55606C' }}>{note}</div>
            {left !== null ? (
              <div role="img" aria-label={`${left} days of stock, the supplier takes ${r.lead_days} days`} style={{ position: 'relative', height: 8, marginTop: 6, borderRadius: 4, background: '#F1F3F5' }}>
                <div style={{ width: `${Math.min(100, (left / scale) * 100)}%`, height: '100%', borderRadius: 4, background: warn ? '#D97A0B' : '#1B5CF0' }} />
                {r.lead_days ? <div aria-hidden="true" style={{ position: 'absolute', top: -3, bottom: -3, left: `${Math.min(100, (r.lead_days / scale) * 100)}%`, borderLeft: '2px solid #10161E' }} /> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Batteries({ months, month, setMonth }: { months: Today['batteries_due']; month: number; setMonth: (m: number) => void }) {
  const max = Math.max(1, ...months.map((m) => Number(m.units)));
  const chosen = months[month] ?? months[0];
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 120, marginTop: 14 }}>
        {months.map((m, i) => (
          <button key={m.month} type="button" aria-pressed={i === month} aria-label={`${monthName(m.month)}: ${m.units} batteries`} onClick={() => setMonth(i)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 4, height: '100%', minWidth: 44, border: 0, padding: 0, background: 'transparent', cursor: 'pointer' }}>
            <span className="tabular" style={{ fontSize: 13, fontWeight: 600 }}>{m.units}</span>
            <span style={{ width: '100%', height: `${Math.max(4, (Number(m.units) / max) * 90)}px`, borderRadius: '6px 6px 2px 2px', background: i === month ? '#1B5CF0' : '#B9CBF8' }} />
          </button>
        ))}
      </div>
      <div aria-hidden="true" style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        {months.map((m) => <span key={m.month} style={{ flex: 1, minWidth: 44, textAlign: 'center', fontSize: 12.5, color: '#55606C' }}>{monthName(m.month)}</span>)}
      </div>
      <div aria-live="polite" style={{ marginTop: 10 }}>
        {chosen && (chosen.customers ?? []).length === 0 ? <p className="sub">Nobody due in {chosen ? monthName(chosen.month) : 'this month'}.</p> : null}
        {(chosen?.customers ?? []).map((c) => (
          <div key={c.customer_id ?? c.phone ?? 'x'} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderTop: '1px solid #F1F3F5' }}>
            <div style={{ fontSize: 15, fontWeight: 550 }}>{c.name ?? 'Customer with no name'}</div>
            <Reach person={c} text={`Hello${c.name ? ` ${c.name}` : ''}, this is Power Store. The battery you bought from us is reaching the age most need replacing. Come in for a free test.`} />
          </div>
        ))}
      </div>
    </>
  );
}
