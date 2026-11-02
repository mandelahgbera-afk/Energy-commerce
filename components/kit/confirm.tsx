'use client';

// A button that answers back: busy spinner, then a done tick, then idle again.
import { useEffect, useRef, useState } from 'react';
import { Spinner, Tick, bump } from './feel';

export function ConfirmButton({
  label = 'Add to bag',
  busyLabel = 'Adding',
  doneLabel = 'Added',
  onDone,
}: {
  label?: string;
  busyLabel?: string;
  doneLabel?: string;
  onDone?: () => void;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));

  const press = () => {
    if (state !== 'idle') return;
    setState('busy');
    later(() => {
      setState('done');
      onDone?.();
    }, 520);
    later(() => setState('idle'), 1900);
  };

  const bg = state === 'done' ? '#0E7A56' : '#1B5CF0';
  return (
    <button
      type="button"
      onClick={press}
      disabled={state !== 'idle'}
      className="press"
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 50,
        border: 0,
        borderRadius: 14,
        background: bg,
        color: '#FFFFFF',
        font: '550 15.5px Geist, system-ui, sans-serif',
        cursor: 'pointer',
        boxShadow: '0 8px 20px rgba(27,92,240,.22)',
        transition: 'background .18s, transform .12s, box-shadow .18s',
      }}
    >
      {state === 'busy' ? <Spinner /> : null}
      {state === 'done' ? <Tick /> : null}
      <span>{state === 'busy' ? busyLabel : state === 'done' ? doneLabel : label}</span>
    </button>
  );
}

/** The dark "Bag 2" pill that answers when the button is done. */
export function CountBadge({ label, value, live = true }: { label: string; value: number; live?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value) {
      bump(ref.current, [
        { transform: 'scale(1)' },
        { transform: 'scale(1.1)' },
        { transform: 'scale(1)' },
      ], { duration: 320, easing: 'cubic-bezier(.3,1.4,.5,1)' });
      prev.current = value;
    }
  }, [value]);
  return (
    <span
      ref={ref}
      aria-live={live ? 'polite' : undefined}
      className="tabular"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        height: 50,
        padding: '0 14px',
        background: '#10161E',
        color: '#FFFFFF',
        borderRadius: 14,
        fontSize: 14.5,
        fontWeight: 500,
      }}
    >
      {label} <b style={{ fontWeight: 650 }}>{value}</b>
    </span>
  );
}
