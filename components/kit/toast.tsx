'use client';

// Calm news, with a way back. Auto-dismisses after five seconds.
import { useRef, useState } from 'react';

export function Toast({ message = '6205-2RS removed', triggerLabel = 'Remove from bag' }: { message?: string; triggerLabel?: string }) {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => {
    setOn(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), 5000);
  };
  const undo = () => {
    if (timer.current) clearTimeout(timer.current);
    setOn(false);
  };
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        height: 118,
        marginTop: 'auto',
        padding: 10,
        boxSizing: 'border-box',
        borderRadius: 16,
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #C9D6E6, #8FA6C4 55%, #5F7A9E)',
      }}
    >
      {!on ? (
        <button
          type="button"
          onClick={show}
          className="press"
          style={{ alignSelf: 'center', minHeight: 44, padding: '0 16px', border: 0, borderRadius: 12, background: '#FFFFFF', color: '#10161E', font: '500 14px var(--sans)', cursor: 'pointer' }}
        >
          {triggerLabel}
        </button>
      ) : (
        <div
          className="glass rise"
          role="status"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%', boxSizing: 'border-box', padding: '6px 6px 6px 14px', borderRadius: 14, fontSize: 14, fontWeight: 500 }}
        >
          {message}
          <button
            type="button"
            onClick={undo}
            className="press"
            style={{ minHeight: 44, padding: '0 12px', border: 0, borderRadius: 10, background: '#10161E', color: '#FFFFFF', font: '500 13.5px var(--sans)', cursor: 'pointer' }}
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
