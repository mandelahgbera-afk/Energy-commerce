'use client';

// Staff record a check on a customer's equipment: backup hours, charge, how it feels, a note.
// The counter looks a customer up by phone, sees their units, and saves with one key per tap,
// so a retry on a bad network never records twice.
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserDb } from '@/lib/supabase';
import { friendly } from '@/lib/errors';
import { Unit, UnitCard } from '@/components/energy';
import { Spinner } from '@/components/kit/feel';
import { StaffNav } from '@/components/staff-nav';

const normalize = (raw: string): string | null => {
  const d = raw.replace(/\D/g, '');
  if (/^0\d{10}$/.test(d)) return `234${d.slice(1)}`;
  if (/^234\d{10}$/.test(d)) return d;
  return null;
};

const feltOptions = [
  { id: 'strong', label: 'Feels strong' },
  { id: 'weaker', label: 'Feels weaker' },
  { id: 'weak', label: 'Feels weak' },
] as const;

export default function Readings() {
  const db = useRef(browserDb()).current;
  const [me, setMe] = useState<undefined | null | { role: string | null }>(undefined);
  const [phone, setPhone] = useState('');
  const [customer, setCustomer] = useState<{ id: string; name: string | null } | null>(null);
  const [units, setUnits] = useState<Unit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [hours, setHours] = useState('');
  const [charge, setCharge] = useState('');
  const [felt, setFelt] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: s } = await db.auth.getSession();
      if (!s.session) { setMe(null); return; }
      const staff = await db.from('staff').select('role').eq('id', s.session.user.id).maybeSingle();
      setMe({ role: staff.data?.role ?? null });
    })();
  }, [db]);
  const allowed = ['owner', 'counter', 'dispatcher', 'accountant'].includes(me?.role ?? '');

  const errorOf = useCallback((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    const [n, ...rest] = msg.split(':');
    setError(friendly(n, rest.join(':').trim()));
  }, []);

  const load = useCallback(async (id: string) => {
    const { data, error: e } = await db.rpc('customer_equipment', { p_customer: id });
    if (e) { errorOf(e); setUnits([]); return; }
    setUnits(data as Unit[]);
  }, [db, errorOf]);

  const find = async () => {
    setBusy(true); setError(null); setSaved(false); setPicking(null); setUnits(null);
    const p = normalize(phone);
    if (!p) { setBusy(false); setError('That phone number does not look right. Check the digits.'); return; }
    const { data: id, error: e } = await db.rpc('save_customer', { p_phone: p });
    if (e) { setBusy(false); errorOf(e); return; }
    const who = await db.from('customers').select('name').eq('id', id as string).maybeSingle();
    setCustomer({ id: id as string, name: who.data?.name ?? null });
    await load(id as string);
    setBusy(false);
  };

  const save = async (unit: string) => {
    setBusy(true); setError(null);
    const h = hours.trim() === '' ? null : hours.trim();
    const c = charge.trim() === '' ? null : charge.trim();
    if (h !== null && !/^\d{1,3}(\.\d{1,2})?$/.test(h)) { setBusy(false); setError('Backup hours must be a number like 6.5, up to 240.'); return; }
    if (c !== null && !/^\d{1,3}$/.test(c)) { setBusy(false); setError('Charge must be a whole number from 0 to 100.'); return; }
    if (h === null && c === null && !felt) { setBusy(false); setError('Say at least one thing: hours, charge, or how it feels.'); return; }
    if (!keyRef.current) keyRef.current = crypto.randomUUID();
    let res: { data?: unknown; error?: { message: string } | null };
    try {
      res = await db.rpc('add_reading', {
        p_key: keyRef.current, p_unit: unit,
        p_backup_hours: h, p_charge_pct: c, p_felt: felt, p_note: note.trim() === '' ? null : note.trim(),
      });
    } catch {
      // The network dropped it: keep the key, so the retry returns the first answer, never a second reading.
      setBusy(false);
      setError('The network dropped. Try again — the same reading will not record twice.');
      return;
    }
    // The database answered, either way: the request is settled, so the key is spent.
    keyRef.current = null;
    if (res.error) { setBusy(false); errorOf(res.error); return; }
    setHours(''); setCharge(''); setFelt(null); setNote(''); setPicking(null); setSaved(true);
    if (customer) await load(customer.id);
    setBusy(false);
  };

  if (me === undefined) return <main style={{ minHeight: '100vh' }} aria-busy="true" />;
  if (me === null || !allowed) {
    return (
      <main className="mx-auto max-w-sm px-5 py-20 text-center">
        <p className="text-lg font-semibold">{me === null ? 'Sign in to record readings.' : 'Readings are for staff who serve customers.'}</p>
        <Link href={me === null ? '/login' : '/'} className="press mt-4 inline-flex h-12 items-center rounded-field bg-action px-6 text-sm font-medium text-white">{me === null ? 'Sign in' : 'Back'}</Link>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '12px clamp(10px, 2vw, 28px) 40px' }}>
      <StaffNav label="Staff" wide={720} />
      <div style={{ maxWidth: 720, margin: '22px auto 0' }}>
        <h1 style={{ margin: '0 2px', fontSize: 'clamp(26px, 3vw, 34px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-.03em' }}>Readings</h1>
        <p style={{ margin: '6px 2px 16px', fontSize: 15, color: '#434E5A' }}>A check at sale, set-up or service. It becomes part of the customer&apos;s health record, which they see from the link on their receipt.</p>
        {error ? <p role="alert" style={{ margin: '0 2px 12px', padding: '10px 14px', borderRadius: 12, background: '#FDF3E7', color: '#92400E', fontSize: 14.5 }}>{error}</p> : null}
        {saved ? <p role="status" style={{ margin: '0 2px 12px', padding: '10px 14px', borderRadius: 12, background: '#EAF6F1', color: '#0A6E4B', fontSize: 14.5 }}>Reading saved. The customer&apos;s record shows it now.</p> : null}
        <div className="card" style={{ padding: '14px 14px 12px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label htmlFor="ph" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Customer phone number</label>
          <input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void find(); }} placeholder="Customer phone, e.g. 0803…" inputMode="tel" style={{ flex: '1 1 200px', minHeight: 44, padding: '0 14px', borderRadius: 12, border: '1px solid rgba(16,24,34,.14)', background: '#fff', fontSize: 15 }} />
          <button type="button" onClick={() => void find()} disabled={busy} className="press" style={{ minHeight: 44, padding: '0 18px', borderRadius: 12, background: '#1B5CF0', color: '#fff', fontSize: 14.5, fontWeight: 600, border: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {busy && !picking ? <Spinner size={15} /> : null}Find
          </button>
        </div>
        {units !== null && customer ? (
          <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
            <p style={{ margin: '0 2px', fontSize: 13.5, color: '#55606C' }}>
              {customer.name ? `${customer.name}: ` : ''}{units.length === 0 ? 'no units on record yet.' : `${units.length} ${units.length === 1 ? 'unit' : 'units'} on record.`}
            </p>
            {units.map((u) => (
              <UnitCard
                key={u.id}
                unit={u}
                footer={
                  u.closed_on === null ? (
                    picking === u.id ? (
                      <div className="card" style={{ width: '100%', padding: '12px 14px', background: '#FBFCFE' }}>
                        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <label style={{ flex: '1 1 140px', fontSize: 12.5, color: '#55606C' }}>
                            Backup hours
                            <input id="rh" value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" placeholder="6.5" style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, minHeight: 44, padding: '0 12px', borderRadius: 12, border: '1px solid rgba(16,24,34,.14)', fontSize: 15 }} />
                          </label>
                          <label style={{ flex: '1 1 120px', fontSize: 12.5, color: '#55606C' }}>
                            Charge %
                            <input id="rc" value={charge} onChange={(e) => setCharge(e.target.value)} inputMode="numeric" placeholder="80" style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 4, minHeight: 44, padding: '0 12px', borderRadius: 12, border: '1px solid rgba(16,24,34,.14)', fontSize: 15 }} />
                          </label>
                        </div>
                        <div role="group" aria-label="How does it feel?" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                          {feltOptions.map((f) => (
                            <button key={f.id} type="button" aria-pressed={felt === f.id} onClick={() => setFelt(felt === f.id ? null : f.id)} className="press" style={{ minHeight: 40, padding: '0 14px', borderRadius: 999, border: '1px solid rgba(16,24,34,.14)', background: felt === f.id ? '#1B5CF0' : '#fff', color: felt === f.id ? '#fff' : '#10161E', fontSize: 13.5, fontWeight: 500 }}>{f.label}</button>
                          ))}
                        </div>
                        <input id="rn" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note, e.g. checked after a full charge" style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 10, minHeight: 44, padding: '0 12px', borderRadius: 12, border: '1px solid rgba(16,24,34,.14)', fontSize: 14.5 }} />
                        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                          <button id="save-reading" type="button" onClick={() => void save(u.id)} disabled={busy} className="press" style={{ minHeight: 44, padding: '0 18px', borderRadius: 12, background: '#1B5CF0', color: '#fff', fontSize: 14.5, fontWeight: 600, border: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            {busy ? <Spinner size={15} /> : null}Save the reading
                          </button>
                          <button type="button" onClick={() => setPicking(null)} className="press" style={{ minHeight: 44, padding: '0 16px', borderRadius: 12, border: '1px solid rgba(16,24,34,.14)', background: '#fff', fontSize: 14 }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={() => { setPicking(u.id); setSaved(false); }} className="press" style={{ minHeight: 44, padding: '0 18px', borderRadius: 12, background: '#1B5CF0', color: '#fff', fontSize: 14.5, fontWeight: 600, border: 'none' }}>Record a check</button>
                    )
                  ) : null
                }
              />
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}
