'use client';

// The number moves in the direction you press, and the count bumps to answer.
import { useRef, useState } from 'react';
import { bump } from './feel';

export function QuantityStepper({ initial = 2, min = 1, total }: { initial?: number; min?: number; total?: string }) {
  const [qty, setQty] = useState(initial);
  const qtyRef = useRef<HTMLSpanElement>(null);
  const nudge = (dir: 1 | -1) => {
    setQty((q) => {
      const next = q + dir;
      if (next < min) return q;
      bump(qtyRef.current, [
        { transform: dir > 0 ? 'translateY(9px)' : 'translateY(-9px)', opacity: 0.2 },
        { transform: 'none', opacity: 1 },
      ]);
      return next;
    });
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 'auto' }}>
      <div role="group" aria-label="Quantity" style={{ display: 'flex', alignItems: 'center', background: '#F1F3F5', borderRadius: 13 }}>
        <button type="button" onClick={() => nudge(-1)} aria-label="One fewer" className="press" style={stepperButton}>
          −
        </button>
        <span ref={qtyRef} aria-live="polite" className="tabular" style={{ display: 'inline-block', width: 40, textAlign: 'center', fontSize: 17, fontWeight: 600 }}>
          {qty}
        </span>
        <button type="button" onClick={() => nudge(1)} aria-label="One more" className="press" style={stepperButton}>
          +
        </button>
      </div>
      {total ? (
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13, color: '#55606C' }}>Total</div>
          <div className="tabular" style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-.02em' }}>{total}</div>
        </div>
      ) : null}
    </div>
  );
}

const stepperButton: React.CSSProperties = {
  width: 48,
  height: 48,
  border: 0,
  borderRadius: 13,
  background: 'transparent',
  color: '#10161E',
  font: '400 22px Geist, system-ui, sans-serif',
  cursor: 'pointer',
};
