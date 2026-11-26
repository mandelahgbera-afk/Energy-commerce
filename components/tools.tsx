'use client';

// The staff toolbox, one tap from every back-office screen: an exact calculator with VAT keys,
// quick notes kept on this device, and a price check that never leaves the screen you are on.
// It sits beside the work, not over it, so a cashier can add up while a sale stays open.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Segmented } from '@/components/kit/segmented';
import { browserDb } from '@/lib/supabase';
import { formatNaira } from '@/lib/money';
import { display, fresh, plain, press, show, type Calc } from '@/lib/calc';
import { presets, size, type Load, type Plan } from '@/lib/solar';
import { friendly } from '@/lib/errors';

const tabs = ['Calculator', 'Notes', 'Prices', 'Sizing'];

export function Tools() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(0);
  const panel = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [top, setTop] = useState(76);
  // The sizer's "Find in stock" opens the price check on that search.
  const [check, setCheck] = useState('');
  const find = (q: string) => { setCheck(q); setTab(2); };
  useEffect(() => { try { setTab(Number(localStorage.getItem('ps-tools-tab')) || 0); } catch {} }, []);
  // The open tool may have taken focus already (the calculator does, so typing works at once).
  useEffect(() => { if (open && !panel.current?.contains(document.activeElement)) panel.current?.focus(); }, [open]);
  const pick = (i: number) => { setTab(i); try { localStorage.setItem('ps-tools-tab', String(i)); } catch {} };
  return (
    <>
      <button ref={button} type="button" onClick={() => { setTop(Math.round((button.current?.getBoundingClientRect().bottom ?? 64) + 10)); setOpen((o) => !o); }} aria-expanded={open} aria-controls="tools" className="press tools-btn">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path d="M5 4h5v5H5ZM14 4h5v5h-5ZM5 15h5v5H5ZM16.5 14v7M13 17.5h7" /></svg>
        Tools
      </button>
      {/* On the page root: the nav's frosted blur would otherwise trap a fixed panel inside it. */}
      {open ? createPortal(
        <aside id="tools" ref={panel} tabIndex={-1} aria-label="Tools" className="glass rise tools-panel" style={{ '--tools-top': `${top}px` } as React.CSSProperties} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: '-.01em' }}>Tools</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close the tools" className="press" style={{ width: 44, height: 44, border: 0, borderRadius: 12, background: 'rgba(16,24,34,.05)', color: '#434E5A', fontSize: 20, cursor: 'pointer' }}>×</button>
          </div>
          <Segmented options={tabs} value={tab} onChange={pick} label="Choose a tool" />
          <div style={{ marginTop: 12 }}>{tab === 0 ? <Calculator /> : tab === 1 ? <Notes /> : tab === 2 ? <PriceCheck key={check} initial={check} /> : <Sizer onFind={find} />}</div>
        </aside>,
        document.body,
      ) : null}
    </>
  );
}

const keys = [['C', '⌫', '%', '÷'], ['7', '8', '9', '×'], ['4', '5', '6', '−'], ['1', '2', '3', '+'], ['00', '0', '.', '=']];
const typed: Record<string, string> = { '*': '×', x: '×', '/': '÷', '-': '−', '+': '+', Enter: '=', '=': '=', Backspace: '⌫', Delete: 'C', '%': '%', '.': '.', ',': '.' };

function Calculator() {
  const [s, setS] = useState<Calc>(fresh);
  const [copied, setCopied] = useState(false);
  const pad = useRef<HTMLDivElement>(null);
  useEffect(() => { pad.current?.focus(); }, []);
  const go = (k: string) => { setCopied(false); setS((x) => press(x, k)); };
  const value = display(s);
  const copy = async () => {
    try { await navigator.clipboard.writeText(s.entry || plain(s.acc ?? 0n)); setCopied(true); } catch {}
  };
  return (
    <div ref={pad} tabIndex={-1} style={{ outline: 'none' }} onKeyDown={(e) => {
      const k = /^\d$/.test(e.key) ? e.key : typed[e.key];
      if (!k || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      go(k);
    }}>
      <div className="calc-screen" aria-live="polite">
        <div className="calc-tape">{s.op && s.acc !== null ? `${show(plain(s.acc))} ${s.op}` : ' '}</div>
        <div className="calc-value tabular" style={{ fontSize: value.length > 14 ? 24 : 32 }}>{value}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginTop: 8 }}>
        <button type="button" onClick={() => go('vat+')} className="press calc-chip">+ 7.5% VAT</button>
        <button type="button" onClick={() => go('vat-')} className="press calc-chip">Take VAT out</button>
        <button type="button" onClick={copy} className="press calc-chip">{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <div role="group" aria-label="Calculator keys" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 8 }}>
        {keys.flat().map((k) => (
          <button key={k} type="button" onClick={() => go(k)} aria-label={k === '⌫' ? 'Delete the last digit' : k === 'C' ? 'Clear' : undefined}
            className={`press calc-key${/[÷×−+=]/.test(k) ? ' calc-op' : ''}${k === '=' ? ' calc-eq' : ''}`}>{k}</button>
        ))}
      </div>
      <p style={{ margin: '8px 2px 0', fontSize: 12.5, color: '#55606C' }}>Exact to six decimal places. Type on the keyboard too.</p>
    </div>
  );
}

type Note = { id: string; text: string; at: number; done: boolean };
const NOTES = 'ps-notes';
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
};

function Notes() {
  // Only ever mounted after a tap, so reading storage here is safe.
  const [notes, setNotes] = useState<Note[]>(() => { try { return JSON.parse(localStorage.getItem(NOTES) ?? '[]'); } catch { return []; } });
  const [text, setText] = useState('');
  useEffect(() => { try { localStorage.setItem(NOTES, JSON.stringify(notes)); } catch {} }, [notes]);
  const add = () => {
    const t = text.trim();
    if (!t) return;
    setNotes((n) => [{ id: crypto.randomUUID(), text: t.slice(0, 600), at: Date.now(), done: false }, ...n].slice(0, 200));
    setText('');
  };
  const open = notes.filter((n) => !n.done).length;
  return (
    <div>
      <label htmlFor="note" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>New note</label>
      <textarea id="note" value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Musa will pay the balance Friday…"
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(); } }} className="note-box" />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
        <span style={{ fontSize: 12.5, color: '#55606C' }}>Kept on this device only.</span>
        <button type="button" onClick={add} disabled={!text.trim()} className="press" style={{ minHeight: 40, padding: '0 14px', border: 0, borderRadius: 11, background: text.trim() ? '#1B5CF0' : '#C9D2DC', color: '#FFFFFF', font: '550 14px var(--sans)', cursor: text.trim() ? 'pointer' : 'default' }}>Add note</button>
      </div>
      {notes.length ? (
        <ul aria-label={`${open} open ${open === 1 ? 'note' : 'notes'}`} style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'grid', gap: 6, maxHeight: '44vh', overflowY: 'auto' }}>
          {notes.map((n) => (
            <li key={n.id} className="rise note" data-done={n.done || undefined}>
              <label className="note-tick"><input type="checkbox" checked={n.done} aria-label={n.done ? 'Mark as not done' : 'Mark as done'} onChange={() => setNotes((all) => all.map((x) => (x.id === n.id ? { ...x, done: !x.done } : x)))} /></label>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="note-text">{n.text}</span>
                <span style={{ display: 'block', marginTop: 2, fontSize: 12, color: '#6B7682' }}>{ago(n.at)}</span>
              </span>
              <button type="button" aria-label="Delete this note" onClick={() => setNotes((all) => all.filter((x) => x.id !== n.id))} className="press note-x">×</button>
            </li>
          ))}
        </ul>
      ) : <p style={{ margin: '14px 2px 0', fontSize: 14, color: '#55606C' }}>No notes yet. A promise to call back, a part to reorder, a customer&apos;s size: jot it here.</p>}
    </div>
  );
}

type Hit = { product: string; sku: string; name: string; part_number: string | null; price: number | string; state: 'in' | 'low' | 'out'; match?: string };
const stateWords = { in: 'In stock', low: 'Low', out: 'Out' } as const;

function PriceCheck({ initial = '' }: { initial?: string }) {
  const db = useRef(browserDb()).current;
  const [q, setQ] = useState(initial);
  const [gone, setGone] = useState<string | null>(null);
  // Only the owner can take a wrongly taught code off; the database refuses anyone else.
  const unlink = async () => {
    const { error } = await db.rpc('unlink_barcode', { p_code: q });
    if (error) { const [n, ...d] = error.message.split(':'); setProblem(friendly(n, d.join(':').trim())); return; }
    setGone(q.trim()); setHits([]);
  };
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const term = q.trim();
    if (!term) { setHits(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      const { data, error } = await db.rpc('search_parts', { p_query: term, p_limit: 6 });
      if (!live) return;
      setProblem(error ? 'Could not check right now. Try again in a moment.' : null);
      setHits(error ? null : ((data ?? []) as Hit[]));
    }, 180);
    return () => { live = false; clearTimeout(t); };
  }, [q, db]);
  return (
    <div>
      <label htmlFor="pc" style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>Part number, size or name</label>
      <input id="pc" value={q} onChange={(e) => setQ(e.target.value.slice(0, 80))} autoComplete="off" placeholder="6205 2rs, 25 52 15, 200Ah" className="note-box" style={{ height: 48, font: '500 16px var(--mono)' }} />
      {problem ? <p role="alert" className="scan-miss">{problem}</p> : null}
      {hits && hits.length === 0 ? <p style={{ margin: '10px 2px 0', fontSize: 14, color: '#92400E' }}>Nothing matches. Check the number, or try the size.</p> : null}
      {hits?.length ? (
        <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: 4 }}>
          {hits.map((h) => (
            <li key={h.product} className="rise" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 12, background: 'rgba(255,255,255,.7)' }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14.5, fontWeight: 500 }}>{h.name}</span>
                <span style={{ display: 'block', fontSize: 12.5, color: '#55606C', fontFamily: 'var(--mono)' }}>{h.part_number ?? h.sku}</span>
              </span>
              <span style={{ textAlign: 'right' }}>
                <span className="tabular" style={{ display: 'block', fontSize: 14.5, fontWeight: 600 }}>{formatNaira(h.price)}</span>
                <span className={`stock-pill stock-${h.state}`}>{stateWords[h.state] ?? h.state}</span>
              </span>
              {h.match === 'barcode' ? <button type="button" onClick={unlink} className="press calc-chip" style={{ flex: 'none', minHeight: 36, padding: '0 10px' }} title="Owner only">Take code off</button> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {gone ? <p role="status" className="scan-ok">Code {gone} taken off. Scan it at the counter to teach it to the right part.</p> : null}
      <p style={{ margin: '10px 2px 0', fontSize: 12.5, color: '#55606C' }}>Shelf prices today. Trade prices show on the sale itself.</p>
    </div>
  );
}

// What size of system a customer needs, from what they will run. A guide for the conversation at
// the counter; the shop still checks the site before quoting. Kept on this device between visits.
const SIZER = 'ps-sizer';
const backups = [['Half a day', 0.5], ['A day', 1], ['Two days', 2]] as const;
const watts = (w: number) => (w >= 1000 ? `${(w / 1000).toLocaleString('en-NG', { maximumFractionDigits: 1 })} kW` : `${Math.round(w)} W`);

// Staff get "Find in stock"; the public shop passes onAsk instead, to turn the sizes into a quote list.
export function Sizer({ onFind, onAsk, storeKey = SIZER, ask = 'What will the customer run?' }: {
  onFind?: (q: string) => void; onAsk?: (plan: Plan, summary: string) => void; storeKey?: string; ask?: string;
}) {
  const [loads, setLoads] = useState<Load[]>(() => { try { return JSON.parse(localStorage.getItem(storeKey) ?? '[]'); } catch { return []; } });
  const [backup, setBackup] = useState(1);
  const [copied, setCopied] = useState(false);
  useEffect(() => { try { localStorage.setItem(storeKey, JSON.stringify(loads)); } catch {} setCopied(false); }, [loads, backup, storeKey]);
  const plan = size(loads, { backupDays: backups[backup][1] });
  const edit = (i: number, patch: Partial<Load>) => setLoads((all) => all.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const num = (v: string) => Number(v.replace(',', '.')) || 0;
  const summary = plan ? [
    `What you run: ${loads.filter((l) => l.qty > 0).map((l) => `${l.qty} × ${l.name}`).join(', ')}.`,
    `Power at once: ${watts(plan.runningW)}. Energy a day: ${watts(plan.dailyWh)}h.`,
    plan.kva ? `Inverter: ${plan.kva} kVA, ${plan.volts} V.` : 'Inverter: larger than one unit; we will design it with you.',
    `Battery: ${plan.lithiumKwh} kWh lithium, or ${plan.tubular} × 220 Ah tubular.`,
    `Panels: ${plan.panels} × ${plan.panelW} W.`,
    'A guide from the shop. We confirm on site before the final quote.',
  ].join('\n') : '';
  return (
    <div>
      <label htmlFor="sz-add" style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>{ask}</label>
      <select id="sz-add" value="" onChange={(e) => { const p = presets[Number(e.target.value)]; if (p) setLoads((all) => [...all, { ...p }]); }} className="note-box" style={{ height: 46, cursor: 'pointer' }}>
        <option value="">Add an appliance…</option>
        {presets.map((p, i) => <option key={p.name} value={i}>{p.name}, {p.watts} W</option>)}
      </select>
      {loads.length ? (
        <ul aria-label="Appliances" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 4 }}>
          {loads.map((l, i) => (
            <li key={i} className="sz-row">
              <span className="sz-name">{l.name}</span>
              <label className="sz-num"><input inputMode="numeric" value={l.qty} onChange={(e) => edit(i, { qty: num(e.target.value) })} aria-label={`How many: ${l.name}`} />×</label>
              <label className="sz-num"><input inputMode="numeric" value={l.watts} onChange={(e) => edit(i, { watts: num(e.target.value) })} aria-label={`Watts each: ${l.name}`} />W</label>
              <label className="sz-num"><input inputMode="decimal" value={l.hours} onChange={(e) => edit(i, { hours: num(e.target.value) })} aria-label={`Hours a day: ${l.name}`} />h</label>
              <button type="button" onClick={() => setLoads((all) => all.filter((_, j) => j !== i))} aria-label={`Remove ${l.name}`} className="press note-x">×</button>
            </li>
          ))}
        </ul>
      ) : <p style={{ margin: '10px 2px 0', fontSize: 14, color: '#55606C' }}>Add each appliance, how many, and the hours a day. The sizes appear here.</p>}
      {loads.length ? (
        <div style={{ marginTop: 10 }}>
          <Segmented options={backups.map((b) => b[0])} value={backup} onChange={setBackup} label="Battery backup" />
        </div>
      ) : null}
      {plan ? (
        <div className="rise" style={{ display: 'grid', gap: 6, marginTop: 10 }} aria-live="polite">
          <div className="sz-use">{watts(plan.runningW)} at once · {watts(plan.dailyWh)}h a day</div>
          {[
            { what: 'Inverter', main: plan.kva ? `${plan.kva} kVA, ${plan.volts} V` : 'Bigger than one unit', sub: null, q: plan.kva ? `${plan.kva} kva` : null },
            { what: 'Battery', main: `${plan.lithiumKwh} kWh lithium`, sub: `or ${plan.tubular} × 220 Ah tubular`, q: 'lithium' },
            { what: 'Panels', main: `${plan.panels} × ${plan.panelW} W`, sub: `${watts(plan.panels * plan.panelW)} in all`, q: `${plan.panelW} w` },
          ].map(({ what, main, sub, q }) => (
            <div key={what} className="sz-card">
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.5, color: '#55606C' }}>{what}</span>
                <span className="tabular" style={{ display: 'block', fontSize: 16, fontWeight: 600 }}>{main}</span>
                {sub ? <span style={{ display: 'block', fontSize: 12.5, color: '#55606C' }}>{sub}</span> : null}
              </span>
              {q && onFind ? <button type="button" onClick={() => onFind(q)} className="press calc-chip" style={{ flex: 'none', minHeight: 36, padding: '0 10px' }}>Find in stock</button> : null}
            </div>
          ))}
          <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(summary); setCopied(true); } catch {} }} className="press calc-chip" style={{ minHeight: 42 }}>{copied ? 'Copied. Paste it in WhatsApp' : 'Copy for WhatsApp'}</button>
          {onAsk ? <button type="button" onClick={() => onAsk(plan, summary)} className="press" style={{ minHeight: 48, border: 0, borderRadius: 13, background: '#10161E', color: '#FFFFFF', font: '600 15px var(--sans)', cursor: 'pointer' }}>Ask the shop for a quote on this</button> : null}
        </div>
      ) : null}
      <p style={{ margin: '10px 2px 0', fontSize: 12.5, color: '#55606C' }}>A guide, not a design: 4.5 sun hours, motors start at three times their power. Check the site before the final quote.</p>
    </div>
  );
}
