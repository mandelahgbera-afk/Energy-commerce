'use client';

// Anyone can check a serial. The answer is calm, and it never shows the owner's details.
import { useRef, useState } from 'react';
import { Tick } from './feel';

export function SerialCheck({ goodSerial = 'PS-5K-204417' }: { goodSerial?: string }) {
  const [serial, setSerial] = useState(goodSerial);
  const [state, setState] = useState<'idle' | 'checking' | 'good' | 'bad'>('idle');
  const [bar, setBar] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));

  const check = () => {
    const ok = serial.toUpperCase().replace(/[^A-Z0-9]/g, '') === goodSerial.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setState('checking');
    setBar(0);
    later(() => {
      setState(ok ? 'good' : 'bad');
      if (ok) later(() => setBar(87), 60);
    }, 1100);
  };

  const bg = state === 'good' ? '#EEF9F4' : state === 'bad' ? '#FDF4E7' : '#F4F6F8';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <label htmlFor="sn" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>
          Serial number
        </label>
        <input
          id="sn"
          value={serial}
          onChange={(e) => {
            setSerial(e.target.value);
            setState('idle');
            setBar(0);
          }}
          placeholder="Serial number"
          style={{
            flex: '1 1 200px',
            minWidth: 0,
            height: 50,
            boxSizing: 'border-box',
            padding: '0 16px',
            border: '1px solid rgba(16,24,34,.15)',
            borderRadius: 14,
            background: '#FFFFFF',
            color: '#10161E',
            font: "400 16px var(--mono)",
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={check}
          className="press"
          style={{ flex: 'none', height: 50, padding: '0 22px', border: 0, borderRadius: 14, background: '#10161E', color: '#FFFFFF', font: '550 15px var(--sans)', cursor: 'pointer' }}
        >
          Check
        </button>
      </div>
      <div aria-live="polite" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 16, minHeight: 106, padding: '12px 16px', borderRadius: 16, background: bg, overflow: 'hidden', transition: 'background .3s' }}>
        {state === 'checking' ? (
          <>
            <div className="sweep" aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent, rgba(27,92,240,.12), transparent)' }} />
            <div style={{ fontSize: 14.5, color: '#434E5A' }}>Checking our records</div>
          </>
        ) : null}
        {state === 'idle' ? <div style={{ fontSize: 14.5, color: '#55606C' }}>The result appears here. It never shows the owner&apos;s details.</div> : null}
        {state === 'good' ? (
          <>
            <span aria-hidden="true" style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 82, height: 82 }}>
              <Tick size={44} stroke="#0D9465" />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.012em' }}>Genuine. Sold by Power Store on 14 March 2026.</div>
              <div style={{ marginTop: 2, fontSize: 14, color: '#434E5A' }}>5 kVA hybrid inverter. Warranty until 14 March 2031.</div>
              <div style={{ height: 6, marginTop: 9, background: 'rgba(16,24,34,.09)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${bar}%`, background: '#0F8F6B', borderRadius: 3, transition: 'width .9s cubic-bezier(.2,.7,.2,1)' }} />
              </div>
              <div style={{ marginTop: 4, fontSize: 13, color: '#434E5A' }}>4 years, 4 months left</div>
            </div>
          </>
        ) : null}
        {state === 'bad' ? (
          <>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="30" height="30" style={{ flex: 'none', fill: 'none', stroke: '#B45309', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
              <path d="M12 3 23 21H1ZM12 10v5M12 18v.01" />
            </svg>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-.012em' }}>We have no record of this serial</div>
              <div style={{ marginTop: 2, fontSize: 14, lineHeight: 1.4, color: '#434E5A' }}>It may be mistyped, or not sold by us. Send us a photo of the label and we will check.</div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
