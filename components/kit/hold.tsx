'use client';

// The time left on a quote's price hold, always visible. A live countdown ring.
import { useEffect, useState } from 'react';

const pad = (n: number) => String(n).padStart(2, '0');

export function PriceHold({ seconds = 47 * 3600 + 59 * 60 + 12, start = 48 * 3600, heldText = '₦4,800,000 held until Friday, 6 PM' }: {
  seconds?: number;
  start?: number;
  heldText?: string;
}) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  const pct = ((left / start) * 100).toFixed(2);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 'auto' }}>
      <svg aria-hidden="true" viewBox="0 0 44 44" width="52" height="52" style={{ flex: 'none', transform: 'rotate(-90deg)' }}>
        <circle cx="22" cy="22" r="18" style={{ fill: 'none', stroke: '#E6EAEE', strokeWidth: 4 }} />
        <circle
          cx="22"
          cy="22"
          r="18"
          pathLength={100}
          style={{ fill: 'none', stroke: '#1B5CF0', strokeWidth: 4, strokeLinecap: 'round', strokeDasharray: `${pct} 100`, transition: 'stroke-dasharray 1s linear' }}
        />
      </svg>
      <div>
        <div className="tabular" style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-.02em' }}>{pad(h)}:{pad(m)}:{pad(s)}</div>
        <div style={{ fontSize: 13.5, color: '#55606C' }}>{heldText}</div>
      </div>
    </div>
  );
}
