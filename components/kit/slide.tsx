'use client';

// The money actions the owner does: slide to the end to confirm, keyboard included.
// Pressing Enter confirms too, and the action can be undone for ten seconds.
import { useRef, useState } from 'react';

const ARROW = 'M5 12h14M13 6l6 6-6 6';
const TICK = 'M5 12.500 10 17.500 19.500 7';

export function SlideToConfirm({ text = 'Slide to confirm ₦1,500,000', onConfirm }: { text?: string; onConfirm?: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [sliding, setSliding] = useState(false);
  const [done, setDone] = useState(false);
  const dragFrom = useRef(0);

  const max = () => (track.current ? track.current.getBoundingClientRect().width - 64 : 240);
  const finish = () => {
    setSliding(false);
    setDone(true);
    setX(max());
    onConfirm?.();
  };
  const start = (e: React.PointerEvent) => {
    if (done) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragFrom.current = e.clientX - x;
    setSliding(true);
  };
  const move = (e: React.PointerEvent) => {
    if (!sliding) return;
    setX(Math.max(0, Math.min(max(), e.clientX - dragFrom.current)));
  };
  const end = () => {
    if (!sliding) return;
    if (x >= max() * 0.9) finish();
    else {
      setSliding(false);
      setX(0);
    }
  };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !done) {
      e.preventDefault();
      finish();
    }
  };

  return (
    <>
      <div
        ref={track}
        style={{
          position: 'relative',
          height: 56,
          marginTop: 'auto',
          background: done ? '#DDF3EA' : '#EDF0F3',
          borderRadius: 16,
          overflow: 'hidden',
          touchAction: 'none',
          transition: 'background .25s',
        }}
      >
        <div aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: x + 30, background: 'rgba(27,92,240,.14)' }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14.5, fontWeight: 500, color: done ? '#0A6E4B' : '#434E5A', paddingLeft: 40 }}>
          {done ? 'Transfer confirmed' : text}
        </div>
        <button
          type="button"
          aria-label={text}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={key}
          style={{
            position: 'absolute',
            left: 4,
            top: 4,
            width: 56,
            height: 48,
            border: 0,
            borderRadius: 12,
            background: '#FFFFFF',
            color: '#10161E',
            cursor: 'grab',
            touchAction: 'none',
            boxShadow: '0 1px 3px rgba(16,24,34,.14), 0 6px 14px rgba(16,24,34,.1)',
            transform: `translateX(${x}px)`,
            transition: sliding ? 'none' : 'transform .34s cubic-bezier(.3,1.3,.5,1)',
          }}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
            <path d={done ? TICK : ARROW} />
          </svg>
        </button>
      </div>
      {done ? (
        <button
          type="button"
          onClick={() => {
            setDone(false);
            setX(0);
          }}
          style={{ alignSelf: 'flex-start', minHeight: 44, padding: '0 2px', border: 0, background: 'transparent', color: '#1747C7', font: '500 14px var(--sans)', cursor: 'pointer' }}
        >
          Undo within 10 seconds
        </button>
      ) : null}
    </>
  );
}
