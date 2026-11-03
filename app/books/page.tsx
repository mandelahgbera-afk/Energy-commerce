'use client';

// The books, ported from Books.dc.html: how the month went, every entry, matching the bank, and
// closing the month. Everything is worked out by the database from the entries; this page lays
// it out and sends the accountant's or owner's decisions to the same functions as everywhere else.
// Entries are never edited or deleted here. A mistake gets a reversal, with a reason.
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserDb } from '@/lib/supabase';
import { friendly } from '@/lib/errors';
import { formatNaira, nairaToKobo, shortNaira } from '@/lib/money';
import { Tick } from '@/components/kit/feel';
import { StaffNav } from '@/components/staff-nav';

type Kobo = number | string;
type Tab = 'month' | 'entries' | 'bank' | 'close';
type Line = { code: string; name: string; kind: string; amount: Kobo };
type Month = { month: string; closed: boolean; lines: Line[]; income: Kobo; costs: Kobo; profit: Kobo; sheet: Line[]; own: Kobo; owe: Kobo; owner: Kobo; balanced: boolean; months: string[] };
type Txn = { id: string; occurred_on: string; kind: string; what: string; ref_type: string | null; reversal_of: string | null; reason: string | null; ledger_entries: { account_code: string; amount_kobo: Kobo }[] };
type Candidate = { bank_line_id: string; occurred_on: string; amount: Kobo; left: Kobo; reference: string | null; exact: boolean };
type Waiting = { payment_id: string; method: string; amount: Kobo; reference: string | null; recorded_on: string; invoice_no: string | null; customer: string | null; no_money_seen: boolean; candidates: Candidate[] };
type BankLine = { bank_line_id: string; occurred_on: string; amount: Kobo; left: Kobo; reference: string | null; narration: string | null };
type Check = { name: string; ok: boolean; problem: string; difference?: Kobo | null; detail?: string[] };

const K = (v: Kobo | null | undefined): bigint => BigInt(String(v ?? 0).split('.')[0] || '0');
const monthOf = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const ghost = { minHeight: 44, padding: '0 14px', border: '1px solid rgba(16,24,34,.16)', borderRadius: 12, background: '#FFFFFF', color: '#10161E', font: '500 14px var(--sans)', cursor: 'pointer' } as const;
const dark = { ...ghost, border: 0, background: '#10161E', color: '#FFFFFF' } as const;
const input = { height: 46, boxSizing: 'border-box', padding: '0 12px', border: '1px solid rgba(16,24,34,.16)', borderRadius: 12, background: '#FFFFFF', color: '#10161E', font: '500 15px var(--sans)' } as const;
const h1 = { margin: '0 2px', fontSize: 'clamp(24px, 3vw, 32px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-.028em' } as const;
const lead = { margin: '6px 2px 14px', fontSize: 15, lineHeight: 1.45, color: '#434E5A' } as const;
const tabLabel: Record<Tab, string> = { month: 'Month', entries: 'Entries', bank: 'Bank', close: 'Close' };

export default function Books() {
  const db = useRef(browserDb()).current;
  const [me, setMe] = useState<undefined | null | { role: string | null }>(undefined);
  const [tab, setTab] = useState<Tab>('month');
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<Month | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showError = useCallback((msg: string) => {
    const [name, ...rest] = msg.split(':');
    setError(friendly(name, rest.join(':').trim()));
  }, []);
  const load = useCallback(async (m: string) => {
    const { data: d, error: e } = await db.rpc('books_month', { p_month: m });
    if (e) showError(e.message);
    else setData(d as Month);
  }, [db, showError]);

  useEffect(() => {
    (async () => {
      const { data: s } = await db.auth.getSession();
      if (!s.session) { setMe(null); return; }
      const staff = await db.from('staff').select('role').eq('id', s.session.user.id).maybeSingle();
      setMe({ role: staff.data?.role ?? null });
      const { data: today } = await db.rpc('shop_today');
      setMonth(`${String(today).slice(0, 7)}-01`);
    })();
  }, [db]);
  const allowed = me?.role === 'owner' || me?.role === 'accountant';
  useEffect(() => { if (allowed && month) void load(month); }, [allowed, month, load]);

  if (me === undefined) return <main style={{ minHeight: '100vh' }} aria-busy="true" />;
  if (me === null || !allowed) {
    return (
      <main className="mx-auto max-w-sm px-5 py-20 text-center">
        <p className="text-lg font-semibold">{me === null ? 'Sign in to see the books.' : 'The books are for the owner and the accountant.'}</p>
        <Link href={me === null ? '/login' : '/'} className="press mt-4 inline-flex h-12 items-center rounded-field bg-action px-6 text-sm font-medium text-white">{me === null ? 'Sign in' : 'Back'}</Link>
      </main>
    );
  }

  const tabs: Tab[] = ['month', 'entries', 'bank', 'close'];
  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '12px clamp(10px, 2vw, 28px) 40px' }}>
      <StaffNav label="Books" wide={1040}>
        {month ? <span style={{ fontSize: 14, fontWeight: 550, color: '#434E5A' }}>{monthOf(month)}</span> : null}
        <div role="group" aria-label="Books" style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(4, minmax(64px, 88px))', padding: 3, background: 'rgba(16,24,34,.07)', borderRadius: 12 }}>
          <span aria-hidden="true" style={{ position: 'absolute', top: 3, bottom: 3, left: 3, width: 'calc((100% - 6px) / 4)', background: '#FFFFFF', borderRadius: 9, boxShadow: '0 1px 2px rgba(16,24,34,.12), 0 4px 10px rgba(16,24,34,.08)', transform: `translateX(${tabs.indexOf(tab) * 100}%)`, transition: 'transform .28s cubic-bezier(.3,1.2,.5,1)' }} />
          {tabs.map((t) => <button key={t} type="button" aria-pressed={tab === t} onClick={() => { setError(null); setTab(t); }} style={{ position: 'relative', height: 40, border: 0, background: 'transparent', color: '#10161E', font: '500 14px var(--sans)', cursor: 'pointer' }}>{tabLabel[t]}</button>)}
        </div>
      </StaffNav>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <div aria-live="polite" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 4px 16px', fontSize: 14, color: data && !data.balanced ? '#92400E' : '#0A6E4B' }}>
          {data ? (data.balanced ? <Tick size={16} stroke="#0D9465" /> : null) : null}
          {data ? `${data.balanced ? 'The books balance.' : 'The books do not balance. Tell the owner now.'} Own ${formatNaira(data.own)} = owe ${formatNaira(data.owe)} + owner ${formatNaira(data.owner)}` : 'Reading the books…'}
        </div>
        {error ? <p role="alert" style={{ margin: '0 2px 12px', padding: '10px 14px', borderRadius: 12, background: '#FDF3E7', color: '#92400E', fontSize: 14.5 }}>{error}</p> : null}
        {tab === 'month' && data && month ? <MonthTab data={data} month={month} setMonth={setMonth} /> : null}
        {tab === 'entries' ? <Entries db={db} onError={showError} onChange={() => month && void load(month)} /> : null}
        {tab === 'bank' ? <Bank db={db} onError={showError} onChange={() => month && void load(month)} /> : null}
        {tab === 'close' ? <Close db={db} owner={me.role === 'owner'} months={data?.months ?? []} onError={showError} /> : null}
      </div>
    </main>
  );
}

function MonthTab({ data, month, setMonth }: { data: Month; month: string; setMonth: (m: string) => void }) {
  const income = K(data.income);
  const cogs = data.lines.filter((l) => l.code === 'cogs').reduce((s, l) => s + K(l.amount), 0n);
  const running = K(data.costs) - cogs;
  const profit = K(data.profit);
  // A waterfall from sales down to profit, so the owner sees where the money went.
  const steps = [
    { label: 'Sales', value: income, from: 0n, to: income, color: '#1B5CF0' },
    { label: 'Cost of goods', value: -cogs, from: income - cogs, to: income, color: '#D97A0B' },
    { label: 'Running costs', value: -running, from: income - cogs - running, to: income - cogs, color: '#D97A0B' },
    { label: 'Profit', value: profit, from: profit < 0n ? profit : 0n, to: profit < 0n ? 0n : profit, color: profit < 0n ? '#92400E' : '#0F8F6B' },
  ];
  const lo = steps.reduce((m, s) => (s.from < m ? s.from : m), 0n);
  const hi = steps.reduce((m, s) => (s.to > m ? s.to : m), 1n);
  const span = Number(hi - lo) || 1;
  const pct = (v: bigint) => (Number(v - lo) / span) * 100;
  const goodsOwed = data.sheet.find((l) => l.code === 'goods_owed');
  return (
    <section aria-labelledby="m1" className="rise">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
        <h1 id="m1" style={h1}>How {monthOf(month).split(' ')[0]} went</h1>
        <select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} style={input}>
          {[...new Set([month, ...data.months])].sort().reverse().map((m) => <option key={m} value={m}>{monthOf(m)}{m === month && data.closed ? ', closed' : ''}</option>)}
        </select>
      </div>
      <div className="card" style={{ marginTop: 14, padding: 22 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <div className="tabular" style={{ fontSize: 44, fontWeight: 600, letterSpacing: '-.038em', color: profit < 0n ? '#92400E' : '#10161E' }}>{formatNaira(profit < 0n ? -profit : profit)}</div>
          <span style={{ padding: '4px 11px', borderRadius: 12, fontSize: 13, fontWeight: 650, background: profit < 0n ? '#FDF3E7' : '#EEF9F4', color: profit < 0n ? '#92400E' : '#0A6E4B' }}>{profit < 0n ? 'Loss' : 'Profit'}</span>
        </div>
        <div style={{ fontSize: 14, color: '#434E5A' }}>{profit < 0n ? 'Loss after all costs' : 'Profit after all costs'}, worked out from every entry this month</div>
        <div role="img" aria-label={steps.map((s) => `${s.label} ${formatNaira(s.value)}`).join(', ')} style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: gutter, height: 200, marginTop: 34, alignItems: 'stretch' }}>
          <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: `${pct(0n)}%`, borderTop: '1.5px solid rgba(16,24,34,.26)' }} />
          {steps.map((s, i) => (
            <div key={s.label} style={{ position: 'relative' }}>
              {i > 0 ? <div aria-hidden="true" style={{ position: 'absolute', right: '100%', width: gutter, bottom: `${pct(steps[i - 1].value < 0n ? steps[i - 1].from : steps[i - 1].to)}%`, borderTop: '1.5px dashed rgba(16,24,34,.28)' }} /> : null}
              <div className="wf-bar" style={{ position: 'absolute', left: 0, right: 0, bottom: `${pct(s.from)}%`, height: `${Math.max(1, pct(s.to) - pct(s.from))}%`, borderRadius: 8, background: `linear-gradient(180deg, ${s.color}, ${s.color}CC)`, animationDelay: `${i * 90}ms` }} />
              <div className="tabular" style={{ position: 'absolute', left: 0, right: 0, bottom: `calc(${pct(s.to)}% + 6px)`, textAlign: 'center', fontSize: 13.5, fontWeight: 650 }}>{signed(s.value, shortNaira)}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: gutter, marginTop: 12 }}>
          {steps.map((s) => <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#434E5A' }}><span aria-hidden="true" style={{ width: 9, height: 9, flex: 'none', borderRadius: 3, background: s.color }} />{s.label}</div>)}
        </div>
        <style>{'@keyframes wf-grow { from { transform: scaleY(0) } } .wf-bar { transform-origin: bottom; animation: wf-grow .6s cubic-bezier(.2,.7,.2,1) both } @media (prefers-reduced-motion: reduce) { .wf-bar { animation: none } }'}</style>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 12, alignItems: 'flex-start' }}>
        <Table id="m2" title="Money earned and spent" rows={data.lines.map((l) => ({ name: l.name, value: l.kind === 'expense' ? -K(l.amount) : K(l.amount) }))} total={{ name: profit < 0n ? 'Loss' : 'Profit', value: profit }} />
        <Table id="m3" title="What we own and owe" rows={[
          ...data.sheet.filter((l) => l.kind === 'asset').map((l) => ({ name: l.name, value: K(l.amount) })),
          { name: 'Total we own', value: K(data.own), strong: true },
          ...data.sheet.filter((l) => l.kind === 'liability').map((l) => ({ name: l.name, value: K(l.amount) })),
          { name: "Owner's share, with all profit so far", value: K(data.owner), strong: true },
        ]} note={goodsOwed ? 'A deposit is money we owe in goods, not profit, until the goods leave.' : undefined} />
      </div>
    </section>
  );
}

// A true minus and a thin gap, so a negative amount never reads as a struck-through naira sign.
const signed = (v: bigint, show: (k: bigint) => string = formatNaira) => (v < 0n ? `− ${show(-v)}` : show(v));
const gutter = 'clamp(10px, 3vw, 28px)';

function Table({ id, title, rows, total, note }: { id: string; title: string; rows: { name: string; value: bigint; strong?: boolean }[]; total?: { name: string; value: bigint }; note?: string }) {
  return (
    <section aria-labelledby={id} className="card" style={{ flex: '1 1 380px', minWidth: 0, padding: 22 }}>
      <h2 id={id} style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{title}</h2>
      <table className="tabular" style={{ width: '100%', marginTop: 10, borderCollapse: 'collapse', fontSize: 14.5 }}>
        <tbody>
          {rows.map((r) => <tr key={r.name}><td style={{ padding: '8px 0', borderBottom: '1px solid #F1F3F5', fontWeight: r.strong ? 600 : 400 }}>{r.name}</td><td style={{ padding: '8px 0', textAlign: 'right', borderBottom: '1px solid #F1F3F5', fontWeight: r.strong ? 600 : 500, color: r.value < 0n ? '#92400E' : undefined }}>{signed(r.value)}</td></tr>)}
          {total ? <tr><td style={{ padding: '10px 0 0', fontWeight: 600 }}>{total.name}</td><td style={{ padding: '10px 0 0', textAlign: 'right', fontWeight: 650, color: total.value < 0n ? '#92400E' : undefined }}>{signed(total.value)}</td></tr> : null}
        </tbody>
      </table>
      {rows.length === 0 ? <p className="sub">Nothing recorded yet.</p> : null}
      {note ? <p className="sub" style={{ marginTop: 10 }}>{note}</p> : null}
    </section>
  );
}

const reasons = ['Wrong amount', 'Typed twice', 'Wrong account', 'Not ours'];

function Entries({ db, onError, onChange }: { db: ReturnType<typeof browserDb>; onError: (m: string) => void; onChange: () => void }) {
  const [rows, setRows] = useState<Txn[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [reversed, setReversed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [acct, setAcct] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (f: string) => {
    let q = db.from('ledger_txns').select('id, occurred_on, kind, what, ref_type, reversal_of, reason, ledger_entries(account_code, amount_kobo)').order('created_at', { ascending: false }).limit(60);
    if (f.trim()) q = q.ilike('what', `%${f.trim().replace(/[%_]/g, '')}%`);
    const { data, error } = await q;
    if (error) { onError(error.message); return; }
    const txns = (data ?? []) as unknown as Txn[];
    setRows(txns);
    const ids = txns.map((t) => t.id);
    if (ids.length) {
      const { data: rev } = await db.from('ledger_txns').select('reversal_of').in('reversal_of', ids);
      setReversed(new Set((rev ?? []).map((r) => r.reversal_of as string)));
    }
  }, [db, onError]);
  useEffect(() => { void db.from('ledger_accounts').select('code, name').then(({ data }) => setNames(Object.fromEntries((data ?? []).map((a) => [a.code, a.name])))); }, [db]);
  useEffect(() => { const t = setTimeout(() => void load(filter), 200); return () => clearTimeout(t); }, [filter, load]);

  const reverse = async (t: Txn, reason: string) => {
    setBusy(true);
    const { error } = await db.rpc('reverse_txn', { p_txn: t.id, p_reason: reason });
    setBusy(false);
    setAsking(null);
    if (error) { onError(error.message); return; }
    void load(filter);
    onChange();
  };

  return (
    <section aria-labelledby="e1" className="rise">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <h1 id="e1" style={h1}>Every entry</h1>
          <p style={{ ...lead, marginBottom: 0 }}>Written by sales, stock and payments. Entries are never edited or deleted. A mistake gets reversed, with a reason.</p>
        </div>
        <button type="button" role="switch" aria-checked={acct} onClick={() => setAcct(!acct)} style={{ ...ghost, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          Accountant view
          <span aria-hidden="true" style={{ position: 'relative', width: 36, height: 22, borderRadius: 11, background: acct ? '#1B5CF0' : '#C6CED6', transition: 'background .2s' }}>
            <span style={{ position: 'absolute', top: 2, left: acct ? 16 : 2, width: 18, height: 18, borderRadius: 9, background: '#FFFFFF', transition: 'left .2s cubic-bezier(.3,1.2,.5,1)' }} />
          </span>
        </button>
      </div>
      <label htmlFor="f" style={{ display: 'block', margin: '14px 2px 6px', fontSize: 14, fontWeight: 550 }}>Search entries</label>
      <input id="f" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search, such as Okafor or rent" style={{ ...input, width: '100%' }} />
      <div className="card" style={{ marginTop: 12, padding: '4px 18px' }}>
        {rows === null ? <p className="sub" style={{ padding: '12px 0' }}>Reading the entries…</p> : null}
        {rows && rows.length === 0 ? <p className="sub" style={{ padding: '12px 0' }}>Nothing matches.</p> : null}
        {rows?.map((t) => {
          const amount = t.ledger_entries.reduce((s, e) => (K(e.amount_kobo) > 0n ? s + K(e.amount_kobo) : s), 0n);
          const canReverse = (t.ref_type === 'expense' || t.ref_type === 'journal') && t.reversal_of === null && !reversed.has(t.id);
          return (
            <div key={t.id} style={{ padding: '12px 0', borderBottom: '1px solid #F1F3F5' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 550 }}>{t.what}</div>
                  <div style={{ fontSize: 13, color: '#55606C' }}>{day(t.occurred_on)}{reversed.has(t.id) ? ' · Reversed' : ''}{t.reason ? ` · ${t.reversal_of ? 'Reversed' : 'Reason'}: ${t.reason}` : ''}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <b className="tabular" style={{ fontWeight: 600 }}>{formatNaira(amount)}</b>
                  {canReverse ? <button type="button" onClick={() => setAsking(asking === t.id ? null : t.id)} style={ghost}>Reverse</button> : null}
                </div>
              </div>
              {asking === t.id ? (
                <div className="rise" style={{ marginTop: 10, padding: 12, borderRadius: 12, background: '#F4F6F8' }}>
                  <div style={{ fontSize: 14, fontWeight: 550 }}>Why are you reversing this?</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {reasons.map((r) => <button key={r} type="button" disabled={busy} onClick={() => void reverse(t, r)} style={ghost}>{r}</button>)}
                  </div>
                </div>
              ) : null}
              {acct ? (
                <table className="tabular rise" style={{ width: '100%', marginTop: 8, borderCollapse: 'collapse', fontSize: 13.5 }}>
                  <thead><tr>{['Account', 'Debit', 'Credit'].map((h, i) => <th key={h} scope="col" style={{ padding: '4px 0', textAlign: i ? 'right' : 'left', fontWeight: 500, color: '#55606C' }}>{h}</th>)}</tr></thead>
                  <tbody>{t.ledger_entries.map((e, i) => <tr key={i}><td style={{ padding: '3px 0' }}>{names[e.account_code] ?? e.account_code}</td><td style={{ textAlign: 'right' }}>{K(e.amount_kobo) > 0n ? formatNaira(e.amount_kobo) : ''}</td><td style={{ textAlign: 'right' }}>{K(e.amount_kobo) < 0n ? formatNaira(-K(e.amount_kobo)) : ''}</td></tr>)}</tbody>
                </table>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Bank({ db, onError, onChange }: { db: ReturnType<typeof browserDb>; onError: (m: string) => void; onChange: () => void }) {
  const [m, setM] = useState<{ books_bank: Kobo; waiting: Waiting[]; unmatched: BankLine[] } | null>(null);
  const [stmt, setStmt] = useState('');
  const [form, setForm] = useState({ on: '', amount: '', reference: '' });
  const [done, setDone] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const lineKey = useRef<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await db.rpc('bank_matches');
    if (error) onError(error.message);
    else setM(data as typeof m);
  }, [db, onError]);
  useEffect(() => { void load(); void db.rpc('shop_today').then(({ data }) => setForm((f) => ({ ...f, on: String(data) }))); }, [load, db]);

  let stmtKobo: bigint | null = null;
  try { stmtKobo = stmt.trim() ? nairaToKobo(stmt) : null; } catch { stmtKobo = null; }
  const diff = m && stmtKobo !== null ? K(m.books_bank) - stmtKobo : null;

  const act = async (id: string, call: PromiseLike<{ error: { message: string } | null }>, text: string) => {
    setBusy(true);
    const { error } = await call;
    setBusy(false);
    if (error) { onError(error.message); return; }
    setDone((d) => ({ ...d, [id]: text }));
    setTimeout(() => void load(), 1200);
    onChange();
  };
  const addLine = async () => {
    let amount: bigint;
    try { amount = nairaToKobo(form.amount); } catch { onError('bad_amount'); return; }
    if (amount <= 0n || !form.on) { onError('bad_amount'); return; }
    lineKey.current ??= crypto.randomUUID();
    setBusy(true);
    const { error } = await db.rpc('add_bank_line', { p_key: lineKey.current, p_on: form.on, p_amount: Number(amount), p_reference: form.reference || null, p_narration: null });
    setBusy(false);
    if (error) { onError(error.message); return; }
    lineKey.current = null;
    setForm((f) => ({ ...f, amount: '', reference: '' }));
    void load();
  };

  return (
    <section aria-labelledby="b1" className="rise">
      <h1 id="b1" style={h1}>Match the bank</h1>
      <p style={lead}>The bank statement against our records. This is where a fake alert gets caught: a transfer is only money once its line is on the statement.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <div className="card" style={{ padding: 18 }}>
          <label htmlFor="stmt" style={{ fontSize: 14, color: '#434E5A' }}>Bank statement says</label>
          <input id="stmt" inputMode="decimal" value={stmt} onChange={(e) => setStmt(e.target.value)} placeholder="Type the balance" className="tabular" style={{ ...input, width: '100%', marginTop: 6, fontSize: 18, fontWeight: 600 }} />
        </div>
        <div className="card" style={{ padding: 18 }}><div style={{ fontSize: 14, color: '#434E5A' }}>Our books say</div><div className="tabular" style={{ marginTop: 6, fontSize: 26, fontWeight: 600 }}>{m ? formatNaira(m.books_bank) : '…'}</div></div>
        <div className="card" style={{ padding: 18 }}><div style={{ fontSize: 14, color: '#434E5A' }}>Difference</div><div aria-live="polite" className="tabular" style={{ marginTop: 6, fontSize: 26, fontWeight: 600, color: diff === null ? '#55606C' : diff === 0n ? '#0A6E4B' : '#92400E' }}>{diff === null ? '—' : formatNaira(diff)}</div></div>
      </div>

      {m && m.waiting.length ? <h2 style={{ margin: '20px 2px 8px', fontSize: 18, fontWeight: 600 }}>Needs you</h2> : null}
      <div style={{ display: 'grid', gap: 10 }}>
        {m?.waiting.map((w) => (
          <article key={w.payment_id} className="card rise" style={{ padding: 18, background: done[w.payment_id] ? '#EEF9F4' : '#FFFFFF' }}>
            {done[w.payment_id] ? <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 550 }}><Tick size={20} stroke="#0D9465" />{done[w.payment_id]}</div> : (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: w.no_money_seen ? '#92400E' : '#1B5CF0' }}>{w.no_money_seen ? 'This may be a fake alert' : w.method === 'pos' ? 'Card tap waiting for the bank' : 'Transfer waiting for the bank'}</div>
                <div style={{ marginTop: 2, fontSize: 16.5, fontWeight: 600 }}>{formatNaira(w.amount)} from {w.customer ?? 'a walk-in customer'}</div>
                <div style={{ marginTop: 2, fontSize: 14, color: '#434E5A' }}>For {w.invoice_no ?? 'an order'}, recorded {day(w.recorded_on)}{w.reference ? `, reference ${w.reference}` : ''}.{w.no_money_seen ? ' Nothing on the statement could be its money.' : ''}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                  {w.candidates.filter((c) => c.exact).map((c) => (
                    <button key={c.bank_line_id} type="button" disabled={busy} onClick={() => void act(w.payment_id, db.rpc('confirm_payment', { p_payment: w.payment_id, p_bank_line: c.bank_line_id }), `Matched. ${formatNaira(w.amount)} is now money in the books.`)} style={dark}>
                      Match to {formatNaira(c.left)} on {day(c.occurred_on)}{c.reference ? ` (${c.reference})` : ''}
                    </button>
                  ))}
                  {/* A bigger line is only right when one transfer paid for several orders, so it is never the plain choice. */}
                  {w.candidates.some((c) => c.exact) ? null : w.candidates.map((c) => (
                    <button key={c.bank_line_id} type="button" disabled={busy} title="Only if one transfer paid for more than one order" onClick={() => void act(w.payment_id, db.rpc('confirm_payment', { p_payment: w.payment_id, p_bank_line: c.bank_line_id }), `Matched as part of a bigger line. ${formatNaira(w.amount)} is now money in the books.`)} style={ghost}>
                      Part of {formatNaira(c.left)} on {day(c.occurred_on)}, only if one transfer paid several orders
                    </button>
                  ))}
                  <button type="button" disabled={busy} onClick={() => void act(w.payment_id, db.rpc('reject_payment', { p_payment: w.payment_id, p_reason: 'Not on the bank statement' }), 'Marked as not received. The goods stay until it is paid.')} style={ghost}>Not in the bank</button>
                </div>
              </>
            )}
          </article>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14, alignItems: 'flex-start' }}>
        <section className="card" style={{ flex: '1 1 380px', minWidth: 0, padding: 20 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Add a line from the statement</h2>
          <p className="sub">Money in, as the bank shows it. Then match it above.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            <input type="date" aria-label="Date on the statement" value={form.on} onChange={(e) => setForm({ ...form, on: e.target.value })} style={input} />
            <input inputMode="decimal" aria-label="Amount on the statement" placeholder="Amount" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="tabular" style={{ ...input, width: 140 }} />
            <input aria-label="Reference on the statement" placeholder="Reference" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} style={{ ...input, flex: '1 1 140px' }} />
            <button type="button" disabled={busy || !form.amount.trim()} onClick={() => void addLine()} style={dark}>Add line</button>
          </div>
        </section>
        <section className="card" style={{ flex: '1 1 380px', minWidth: 0, padding: 20 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>In the bank, not matched yet</h2>
          {m && m.unmatched.length === 0 ? <p className="sub">Every line is matched.</p> : null}
          {m?.unmatched.map((b) => (
            <div key={b.bank_line_id} className="tabular" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '9px 0', borderTop: '1px solid #F1F3F5', fontSize: 14.5 }}>
              <span>{day(b.occurred_on)}{b.reference ? ` · ${b.reference}` : ''}</span><b style={{ fontWeight: 600 }}>{formatNaira(b.left)}{K(b.left) !== K(b.amount) ? ` of ${formatNaira(b.amount)}` : ''}</b>
            </div>
          ))}
        </section>
      </div>
    </section>
  );
}

function Close({ db, owner, months, onError }: { db: ReturnType<typeof browserDb>; owner: boolean; months: string[]; onError: (m: string) => void }) {
  const [month, setMonth] = useState<string>('');
  const [stmt, setStmt] = useState('');
  const [res, setRes] = useState<{ closed: boolean; finished: boolean; checks: Check[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(false);
  useEffect(() => { if (!month && months.length) setMonth(months.find((m) => m < `${new Date().toISOString().slice(0, 7)}-01`) ?? months[0]); }, [months, month]);

  let stmtKobo: bigint | null = null;
  try { stmtKobo = stmt.trim() ? nairaToKobo(stmt) : null; } catch { stmtKobo = null; }
  const stmtArg = stmtKobo === null ? null : Number(stmtKobo);
  useEffect(() => {
    if (!month) return;
    const t = setTimeout(async () => {
      const { data, error } = await db.rpc('month_close_checks', { p_month: month, p_statement_balance: stmtArg });
      if (error) onError(error.message);
      else setRes(data as typeof res);
    }, 200);
    return () => clearTimeout(t);
  }, [db, month, stmtArg, onError, closed]);

  const ready = res !== null && !res.closed && res.finished && res.checks.every((c) => c.ok);
  const close = async () => {
    if (!ready || !owner || stmtArg === null) return;
    setBusy(true);
    const { error } = await db.rpc('close_month', { p_month: month, p_statement_balance: stmtArg });
    setBusy(false);
    if (error) { onError(error.message); return; }
    setClosed(true);
  };

  return (
    <section aria-labelledby="c1" className="rise">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
        <h1 id="c1" style={h1}>{month ? `Close ${monthOf(month)}` : 'Close a month'}</h1>
        <select aria-label="Month to close" value={month} onChange={(e) => { setClosed(false); setMonth(e.target.value); }} style={input}>
          {months.map((m) => <option key={m} value={m}>{monthOf(m)}</option>)}
        </select>
      </div>
      <p style={lead}>Once closed, nothing can be added to the month or changed in it. Corrections go into the next month, as reversals.</p>
      <div className="card" style={{ padding: 18 }}>
        <label htmlFor="cstmt" style={{ fontSize: 14, fontWeight: 550 }}>Bank statement balance at the end of the month</label>
        <input id="cstmt" inputMode="decimal" value={stmt} onChange={(e) => setStmt(e.target.value)} placeholder="Type it from the statement" className="tabular" style={{ ...input, width: '100%', marginTop: 6, fontSize: 17 }} />
        <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0 }}>
          {res?.checks.map((c) => (
            <li key={c.name} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 0', borderTop: '1px solid #F1F3F5' }}>
              <span aria-hidden="true" style={{ flex: 'none', display: 'grid', placeItems: 'center', width: 22, height: 22, marginTop: 1, borderRadius: 11, background: c.ok ? '#0D9465' : '#F4D9B5' }}>{c.ok ? <Tick size={13} /> : <span style={{ fontSize: 13, fontWeight: 700, color: '#92400E' }}>!</span>}</span>
              <span><span style={{ display: 'block', fontSize: 15, fontWeight: 550 }}>{c.name}</span>{c.ok ? null : <span style={{ display: 'block', fontSize: 13.5, color: '#92400E' }}>{c.difference != null ? `The bank differs from the statement by ${formatNaira(c.difference)}.` : c.problem.charAt(0).toUpperCase() + c.problem.slice(1) + '.'}</span>}</span>
            </li>
          ))}
        </ul>
      </div>
      {closed || res?.closed ? (
        <div className="card rise" aria-live="polite" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, padding: 18, background: '#EEF9F4', fontSize: 16, fontWeight: 600 }}><Tick size={22} stroke="#0D9465" />{monthOf(month)} is closed.</div>
      ) : (
        <button type="button" onClick={() => void close()} disabled={!ready || !owner || busy} className="press" style={{ width: '100%', minHeight: 56, marginTop: 14, border: 0, borderRadius: 15, background: ready && owner ? '#1B5CF0' : '#8E99A4', color: '#FFFFFF', font: '600 17px var(--sans)', cursor: ready && owner ? 'pointer' : 'default' }}>
          {busy ? 'Closing…' : !res?.finished ? 'This month is not over yet' : !owner ? 'Only the owner closes a month' : ready ? `Close ${monthOf(month)}` : 'Clear every check first'}
        </button>
      )}
    </section>
  );
}
