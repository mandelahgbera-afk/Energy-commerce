'use client';

// A glass thumb slides to your choice on a spring.
import { useState } from 'react';

export function Segmented({ options, initial = 0 }: { options: string[]; initial?: number }) {
  const [choice, setChoice] = useState(initial);
  return (
    <div
      role="group"
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        padding: 4,
        marginTop: 'auto',
        background: '#E6EAEE',
        borderRadius: 14,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 4,
          bottom: 4,
          left: 4,
          width: `calc((100% - 8px) / ${options.length})`,
          background: '#FFFFFF',
          borderRadius: 11,
          boxShadow: '0 1px 2px rgba(16,24,34,.1), 0 6px 14px rgba(16,24,34,.09)',
          transform: `translateX(${choice * 100}%)`,
          transition: 'transform .32s cubic-bezier(.3,1.25,.5,1)',
        }}
      />
      {options.map((label, i) => (
        <button
          key={label}
          type="button"
          onClick={() => setChoice(i)}
          aria-pressed={i === choice}
          style={{
            position: 'relative',
            height: 42,
            border: 0,
            background: 'transparent',
            color: i === choice ? '#10161E' : '#434E5A',
            font: '500 14px Geist, system-ui, sans-serif',
            cursor: 'pointer',
            transition: 'color .2s',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
