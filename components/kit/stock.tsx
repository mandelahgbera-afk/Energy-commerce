'use client';

// In, low and out — never colour alone, always words too.
import { useState } from 'react';

export function StockState({ stock }: { stock: 'in' | 'low' | 'out' }) {
  const [notified, setNotified] = useState(false);
  if (stock === 'out') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 14.5, fontWeight: 500 }}>
        <span style={{ color: '#55606C' }}>Out of stock</span>
        <button
          type="button"
          onClick={() => setNotified((n) => !n)}
          aria-pressed={notified}
          className="press"
          style={{
            minHeight: 44,
            padding: '0 13px',
            border: `1px solid ${notified ? '#BBCDF9' : 'rgba(16,24,34,.16)'}`,
            borderRadius: 11,
            background: notified ? '#E7EEFE' : '#FFFFFF',
            color: notified ? '#1747C7' : '#10161E',
            font: '500 13.5px Geist, system-ui, sans-serif',
            cursor: 'pointer',
          }}
        >
          {notified ? 'We will tell you' : 'Tell me when it is back'}
        </button>
      </div>
    );
  }
  if (stock === 'low') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14.5, fontWeight: 500 }}>
        <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" style={{ fill: 'none', stroke: '#B45309', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
          <path d="M8 2 15 14H1ZM8 6.500v3.500M8 12v.01" />
        </svg>
        Only 3 left
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 14.5, fontWeight: 500 }}>
      <span className="livedot" aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: '#0D9465' }} />
      48 in Ikeja, ready today
    </div>
  );
}
