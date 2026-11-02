'use client';

// One tap to copy, with proof it worked — and a way to recover if the tap was refused.
import { useRef, useState } from 'react';
import { Tick } from './feel';

export function CopyRow({ label, value, copyValue }: { label: string; value: string; copyValue?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const copy = () => {
    const done = (r: 'ok' | 'fail') => {
      setState(r);
      timers.current.push(setTimeout(() => setState('idle'), 1800));
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(copyValue ?? value).then(() => done('ok'), () => done('fail'));
    } else {
      done('fail');
    }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 10px 10px 14px', marginTop: 'auto', background: '#F1F3F5', borderRadius: 14 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: '#55606C' }}>{label}</div>
        <div style={{ font: "500 18px var(--mono)", letterSpacing: '.02em' }}>{value}</div>
      </div>
      <button
        type="button"
        onClick={copy}
        className="press"
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minHeight: 44,
          padding: '0 14px',
          border: 0,
          borderRadius: 11,
          background: state === 'ok' ? '#0E7A56' : '#10161E',
          color: '#FFFFFF',
          font: '500 14px var(--sans)',
          cursor: 'pointer',
        }}
      >
        {state === 'ok' ? <Tick size={16} /> : null}
        <span aria-live="polite">{state === 'ok' ? 'Copied' : state === 'fail' ? 'Press and hold to copy' : 'Copy'}</span>
      </button>
    </div>
  );
}
