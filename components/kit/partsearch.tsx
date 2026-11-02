'use client';

// Any spelling, or a size — results rise in one by one, and a miss is calm.
import { useState } from 'react';
import { formatNaira } from '@/lib/money';

export type PartHit = { code: string; note: string; size: string; priceKobo: bigint | number; stock: string };

const norm = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function PartSearch({ parts }: { parts: PartHit[] }) {
  const [query, setQuery] = useState('6205');
  const q = norm(query);
  const qSize = query.toLowerCase().replace(/[^0-9a-z]+/g, ' ').trim();
  const hits = q ? parts.filter((p) => norm(p.code).includes(q) || p.size.startsWith(qSize)) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label htmlFor="ps" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>
        Search parts
      </label>
      <input
        id="ps"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Part number or size"
        autoComplete="off"
        style={{
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minHeight: 120 }}>
        {hits.slice(0, 3).map((p, i) => (
          <div
            key={p.code}
            className="rise"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '9px 12px',
              borderRadius: 12,
              background: i === 0 ? '#F4F6F8' : 'transparent',
              animationDelay: `${i * 40}ms`,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ font: "500 15px var(--mono)" }}>{p.code}</div>
              <div style={{ fontSize: 13.5, color: '#55606C' }}>{p.note}</div>
            </div>
            <div style={{ flex: 'none', textAlign: 'right' }}>
              <div className="tabular" style={{ fontSize: 15, fontWeight: 600 }}>{formatNaira(p.priceKobo)}</div>
              <div style={{ fontSize: 13, color: '#0A6E4B', fontWeight: 500 }}>{p.stock}</div>
            </div>
          </div>
        ))}
        {q && hits.length === 0 ? (
          <div className="rise" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 6px' }}>
            <span
              aria-hidden="true"
              style={{
                flex: 'none',
                width: 84,
                height: 84,
                borderRadius: '50%',
                background: 'radial-gradient(circle at 50% 45%, #FFFFFF 0 26%, transparent 27%)',
                boxShadow: 'inset 0 0 0 6px #E6EAEE',
              }}
            />
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>No match for that</div>
              <div style={{ fontSize: 14, lineHeight: 1.4, color: '#55606C' }}>Check the number, measure the old part, or send us a photo.</div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
