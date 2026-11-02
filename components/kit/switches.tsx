'use client';

// Switches and checks that move like real ones.
import { useState } from 'react';
import { Tick } from './feel';

export function Switch({ label, initial = true }: { label: string; initial?: boolean }) {
  const [on, setOn] = useState(initial);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => setOn((v) => !v)}
      className="press"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        minHeight: 48,
        padding: 0,
        border: 0,
        background: 'transparent',
        color: '#10161E',
        font: '500 14.5px Geist, system-ui, sans-serif',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
      }}
    >
      {label}
      <span aria-hidden="true" style={{ flex: 'none', position: 'relative', width: 46, height: 28, borderRadius: 14, background: on ? '#1B5CF0' : '#C6CED6', transition: 'background .22s' }}>
        <span
          style={{
            position: 'absolute',
            left: 3,
            top: 3,
            width: 22,
            height: 22,
            borderRadius: '50%',
            background: '#FFFFFF',
            boxShadow: '0 1px 3px rgba(16,24,34,.25)',
            transform: `translateX(${on ? 18 : 0}px)`,
            transition: 'transform .26s cubic-bezier(.3,1.35,.5,1)',
          }}
        />
      </span>
    </button>
  );
}

export function CheckRow({ label, initial = false }: { label: string; initial?: boolean }) {
  const [on, setOn] = useState(initial);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={() => setOn((v) => !v)}
      className="press"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        minHeight: 48,
        padding: 0,
        border: 0,
        background: 'transparent',
        color: '#10161E',
        font: '500 14.5px Geist, system-ui, sans-serif',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          borderRadius: 7,
          border: `1.5px solid ${on ? '#1B5CF0' : '#9AA4AF'}`,
          background: on ? '#1B5CF0' : '#FFFFFF',
          boxSizing: 'border-box',
          transition: 'background .18s, border-color .18s',
        }}
      >
        {on ? <Tick size={16} /> : null}
      </span>
      {label}
    </button>
  );
}
