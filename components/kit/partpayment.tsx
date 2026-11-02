'use client';

// Part payment: a transfer counts only once the bank confirms it. The paid number counts up.
import { useEffect, useRef, useState } from 'react';
import { formatNaira } from '@/lib/money';

export function PartPayment({ total = 480000000, paid = 300000000, tap = 60000000 }: { total?: bigint | number; paid?: bigint | number; tap?: bigint | number }) {
  const [shown, setShown] = useState(Number(paid));
  const [confirmed, setConfirmed] = useState(Number(paid));
  const [state, setState] = useState<'idle' | 'waiting' | 'ok'>('idle');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const roll = (to: number) => {
    const from = shown;
    const start = Date.now();
    const step = () => {
      const p = Math.min(1, (Date.now() - start) / 700);
      const e = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(from + (to - from) * e));
      if (p < 1) timers.current.push(setTimeout(step, 16));
    };
    step();
  };

  const pay = () => {
    setState('waiting');
    timers.current.push(
      setTimeout(() => {
        const to = Math.min(Number(total), confirmed + Number(tap));
        setConfirmed(to);
        setState('ok');
        roll(to);
      }, 1600),
    );
    timers.current.push(setTimeout(() => setState('idle'), 3700));
  };

  const pct = ((confirmed / Number(total)) * 100).toFixed(1);
  const note =
    state === 'waiting'
      ? 'Waiting for the bank to confirm. A screenshot alone does not count.'
      : state === 'ok'
        ? 'Confirmed by the bank.'
        : confirmed >= Number(total)
          ? 'Paid in full. Your goods are released.'
          : `${formatNaira(Number(total) - confirmed)} left to pay.`;

  return (
    <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <span className="tabular" style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-.025em' }}>{formatNaira(shown)}</span>
        <span style={{ fontSize: 13.5, color: '#55606C' }}>of {formatNaira(total)}</span>
      </div>
      <div style={{ position: 'relative', height: 10, background: '#E6EAEE', borderRadius: 5, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: '#1B5CF0', borderRadius: 5, transition: 'width .7s cubic-bezier(.2,.7,.2,1)' }} />
        {state === 'waiting' ? (
          <div className="sweep" aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.7), transparent)' }} />
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 52 }}>
        <div style={{ minWidth: 0, fontSize: 14, lineHeight: 1.35, color: '#434E5A' }} aria-live="polite">{note}</div>
        {state === 'idle' && confirmed < Number(total) ? (
          <button
            type="button"
            onClick={pay}
            className="press"
            style={{ flex: 'none', minHeight: 44, padding: '0 14px', border: 0, borderRadius: 12, background: '#10161E', color: '#FFFFFF', font: '500 14px var(--sans)', cursor: 'pointer' }}
          >
            I sent {formatNaira(tap)}
          </button>
        ) : null}
      </div>
    </div>
  );
}
