'use client';

// A phone number that checks itself as you type, without shouting.
import { useState } from 'react';
import { Tick } from './feel';

const digits = (s: string) => s.replace(/\D/g, '');
const valid = (d: string) => /^0[789][01]\d{8}$/.test(d);

export function PhoneInput({ hint = 'We use this for your order and warranty.' }: { hint?: string }) {
  const [phone, setPhone] = useState('');
  const [focused, setFocused] = useState(false);
  const d = digits(phone);
  const ok = valid(d);
  const hasError = d.length >= 11 && !ok;

  const change = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = digits(e.target.value).slice(0, 11);
    const spaced = raw.length > 7 ? `${raw.slice(0, 4)} ${raw.slice(4, 7)} ${raw.slice(7)}` : raw.length > 4 ? `${raw.slice(0, 4)} ${raw.slice(4)}` : raw;
    setPhone(spaced);
  };

  return (
    <div style={{ marginTop: 'auto' }}>
      <div style={{ position: 'relative' }}>
        <label
          htmlFor="ph"
          style={{
            position: 'absolute',
            left: 15,
            top: focused || phone ? 8 : 18,
            fontSize: focused || phone ? 12 : 15.5,
            color: '#55606C',
            pointerEvents: 'none',
            transition: 'top .16s, font-size .16s',
          }}
        >
          Phone number
        </label>
        <input
          id="ph"
          inputMode="numeric"
          value={phone}
          onChange={change}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="tabular"
          style={{
            width: '100%',
            height: 56,
            boxSizing: 'border-box',
            padding: '19px 44px 0 15px',
            border: `1px solid ${hasError ? '#B45309' : ok ? '#0D9465' : 'rgba(16,24,34,.18)'}`,
            borderRadius: 14,
            background: '#FFFFFF',
            color: '#10161E',
            font: '450 16px var(--sans)',
            transition: 'border-color .2s',
            outline: 'none',
          }}
        />
        {ok ? (
          <span style={{ position: 'absolute', right: 14, top: 18 }}>
            <Tick size={20} stroke="#0D9465" />
          </span>
        ) : null}
      </div>
      <div aria-live="polite" style={{ minHeight: 18, fontSize: 13, color: hasError ? '#92400E' : ok ? '#0A6E4B' : '#55606C' }}>
        {hasError ? 'That does not look like a Nigerian mobile number.' : ok ? 'Looks right.' : hint}
      </div>
    </div>
  );
}
