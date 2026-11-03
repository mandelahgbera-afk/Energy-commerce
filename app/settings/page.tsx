'use client';

// The owner's settings: the shop's public details, the selling rules the shop confirms on the day
// (hold times, the till's paid-out limit, battery life), and the team's roles and discount limits.
// Every change goes through a database function that checks it is the owner and audits it.
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserDb } from '@/lib/supabase';
import { friendly } from '@/lib/errors';
import { koboToNaira, nairaToKobo } from '@/lib/money';
import { Spinner, Tick } from '@/components/kit/feel';
import { StaffNav } from '@/components/staff-nav';

type Settings = { hold_unpaid_hours: number; hold_deposit_days: number; till_paid_out_limit_kobo: number | string; battery_life_months: number;
  shop_name: string | null; shop_phone: string | null; shop_address: string | null; shop_hours: string | null };
type Person = { id: string; name: string; role: string; discount_limit_pct: number | string; active: boolean };
type Form = { name: string; phone: string; address: string; hours: string; holdHours: string; holdDays: string; paidOut: string; battery: string };

const roles = [['counter', 'Counter'], ['storekeeper', 'Storekeeper'], ['dispatcher', 'Dispatcher'], ['driver', 'Driver'], ['accountant', 'Accountant']] as const;
const field = { width: '100%', height: 46, boxSizing: 'border-box', padding: '0 12px', border: '1px solid rgba(16,24,34,.14)', borderRadius: 12, background: '#FFFFFF', color: '#10161E', font: '450 15px var(--sans)' } as const;
const label = { display: 'block', marginBottom: 5, fontSize: 13, fontWeight: 550, color: '#434E5A' } as const;
const errorOf = (message: string) => { const [n, ...rest] = message.split(':'); return friendly(n, rest.join(':').trim()); };
const local = (phone: string | null) => (phone ? (phone.startsWith('234') ? `0${phone.slice(3)}` : phone) : '');
const toForm = (s: Settings): Form => ({
  name: s.shop_name ?? '', phone: local(s.shop_phone), address: s.shop_address ?? '', hours: s.shop_hours ?? '',
  holdHours: String(s.hold_unpaid_hours), holdDays: String(s.hold_deposit_days), paidOut: koboToNaira(s.till_paid_out_limit_kobo).replace(/\.00$/, ''), battery: String(s.battery_life_months),
});

function Section({ id, title, about, children }: { id: string; title: string; about: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="card rise" style={{ padding: 'clamp(18px, 3vw, 26px)' }}>
      <h2 id={id} style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-.012em' }}>{title}</h2>
      <p style={{ margin: '4px 0 0', fontSize: 14, lineHeight: 1.45, color: '#55606C' }}>{about}</p>
      <div style={{ marginTop: 16 }}>{children}</div>
    </section>
  );
}

function Rule({ id, text, unit, value, onChange, hint }: { id: string; text: string; unit: string; value: string; onChange: (v: string) => void; hint: string }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '6px 16px', padding: '12px 0', borderTop: '1px solid rgba(16,24,34,.06)' }}>
      <label htmlFor={id} style={{ flex: '1 1 260px', minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 550 }}>{text}</span>
        <span style={{ display: 'block', marginTop: 2, fontSize: 13, color: '#55606C' }}>{hint}</span>
      </label>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {unit === '₦' ? <span style={{ fontSize: 15, color: '#55606C' }}>₦</span> : null}
        <input id={id} inputMode={unit === '₦' ? 'decimal' : 'numeric'} value={value} onChange={(e) => onChange(e.target.value.slice(0, 16))} className="fld tabular" style={{ ...field, width: unit === '₦' ? 130 : 84, textAlign: 'right' }} />
        {unit !== '₦' ? <span style={{ minWidth: 48, fontSize: 14, color: '#434E5A' }}>{unit}</span> : null}
      </span>
    </div>
  );
}

export default function SettingsPage() {
  const db = useRef(browserDb()).current;
  const [me, setMe] = useState<undefined | null | { id: string; role: string | null }>(undefined);
  const [saved, setSaved] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [team, setTeam] = useState<Person[]>([]);
  const [edits, setEdits] = useState<Record<string, { role: string; limit: string; active: boolean }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const [s, t] = await Promise.all([
      db.from('shop_settings').select('*').maybeSingle(),
      db.from('staff').select('id, name, role, discount_limit_pct, active').order('name'),
    ]);
    if (s.data) { const f = toForm(s.data as Settings); setSaved(f); setForm(f); }
    setTeam((t.data ?? []) as Person[]);
    setEdits({});
  }, [db]);
  useEffect(() => {
    (async () => {
      const { data } = await db.auth.getSession();
      if (!data.session) { setMe(null); return; }
      const r = await db.from('staff').select('role').eq('id', data.session.user.id).maybeSingle();
      setMe({ id: data.session.user.id, role: r.data?.role ?? null });
    })();
  }, [db]);
  const owner = me?.role === 'owner';
  useEffect(() => { if (owner) void load(); }, [owner, load]);

  const dirty = !!form && !!saved && JSON.stringify(form) !== JSON.stringify(saved);
  const set = (k: keyof Form) => (v: string) => { setNote(null); setForm((f) => (f ? { ...f, [k]: v } : f)); };

  const save = async () => {
    if (!form || busy) return;
    let paidOut: bigint;
    try { paidOut = nairaToKobo(form.paidOut); } catch { setNote({ ok: false, text: friendly('bad_amount', '') }); return; }
    const whole = (v: string) => (/^\d{1,4}$/.test(v.trim()) ? Number(v.trim()) : -1);
    setBusy('settings');
    const { error } = await db.rpc('save_settings', {
      p_hold_unpaid_hours: whole(form.holdHours), p_hold_deposit_days: whole(form.holdDays), p_till_paid_out_limit: Number(paidOut), p_battery_life_months: whole(form.battery),
      p_shop_name: form.name, p_shop_phone: form.phone, p_shop_address: form.address, p_shop_hours: form.hours,
    });
    setBusy(null);
    if (error) { setNote({ ok: false, text: errorOf(error.message) }); return; }
    setNote({ ok: true, text: 'Saved. New orders and holds use these from now.' });
    await load();
  };

  const saveMember = async (p: Person) => {
    const e = edits[p.id];
    if (!e || busy) return;
    setBusy(p.id);
    const { error } = await db.rpc('save_staff', { p_user: p.id, p_name: p.name, p_role: e.role, p_discount_limit: Number(e.limit), p_active: e.active });
    setBusy(null);
    if (error) { setNote({ ok: false, text: errorOf(error.message) }); return; }
    setNote({ ok: true, text: `${p.name} is updated.` });
    await load();
  };

  if (me === undefined) return <main style={{ minHeight: '100vh' }} aria-busy="true" />;
  if (me === null || !owner) {
    return (
      <main className="mx-auto max-w-sm px-5 py-20 text-center">
        <p className="text-lg font-semibold">{me === null ? 'Sign in to change settings.' : 'Settings are for the owner.'}</p>
        <Link href={me === null ? '/login' : '/'} className="press mt-4 inline-flex h-12 items-center rounded-field bg-action px-6 text-sm font-medium text-white">{me === null ? 'Sign in' : 'Back'}</Link>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100vh', boxSizing: 'border-box', padding: '12px clamp(10px, 2vw, 28px) 120px' }}>
      <StaffNav label="Staff" wide={900} />
      <div style={{ maxWidth: 900, margin: '22px auto 0', display: 'grid', gap: 14 }}>
        <header style={{ padding: '0 2px' }}>
          <h1 style={{ margin: 0, fontSize: 'clamp(26px, 3vw, 34px)', lineHeight: 1.1, fontWeight: 600, letterSpacing: '-.03em' }}>Settings</h1>
          <p style={{ margin: '6px 0 0', fontSize: 15, color: '#434E5A' }}>Set these with the shop. Every change is recorded with who made it and what it was before.</p>
        </header>
        {note ? (
          <p role={note.ok ? 'status' : 'alert'} className="rise" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: 0, padding: '11px 14px', borderRadius: 12, background: note.ok ? '#EEF9F4' : '#FDF3E7', color: note.ok ? '#0A6E4B' : '#92400E', fontSize: 14.5, fontWeight: 550 }}>
            {note.ok ? <Tick size={18} stroke="#0D9465" /> : null}{note.text}
          </p>
        ) : null}
        {!form ? <div className="card" style={{ height: 240 }} aria-busy="true" /> : (
          <>
            <Section id="s1" title="The shop" about="Shown on the public shop, so customers can call or find you. Leave any of them empty to hide it.">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                <div><label htmlFor="shop-name" style={label}>Shop name</label><input id="shop-name" value={form.name} onChange={(e) => set('name')(e.target.value.slice(0, 80))} placeholder="Power Store" className="fld" style={field} /></div>
                <div><label htmlFor="shop-phone" style={label}>Phone</label><input id="shop-phone" inputMode="tel" value={form.phone} onChange={(e) => set('phone')(e.target.value.slice(0, 20))} placeholder="0803 123 4567" className="fld" style={field} /></div>
                <div><label htmlFor="shop-address" style={label}>Address</label><input id="shop-address" value={form.address} onChange={(e) => set('address')(e.target.value.slice(0, 200))} placeholder="12 Allen Avenue, Ikeja" className="fld" style={field} /></div>
                <div><label htmlFor="shop-hours" style={label}>Opening hours</label><input id="shop-hours" value={form.hours} onChange={(e) => set('hours')(e.target.value.slice(0, 120))} placeholder="Monday to Saturday, 8am to 6pm" className="fld" style={field} /></div>
              </div>
            </Section>

            <Section id="s2" title="Selling rules" about="The shop's own rules. Ask on the day of the visit; the numbers here are only starting points.">
              <Rule id="hold-hours" text="Hold unpaid goods for" unit="hours" value={form.holdHours} onChange={set('holdHours')} hint="Goods on an unpaid order go back on sale after this." />
              <Rule id="hold-days" text="Hold goods with a deposit for" unit="days" value={form.holdDays} onChange={set('holdDays')} hint="A customer who paid part keeps their goods this long." />
              <Rule id="paid-out" text="Most a till can pay out" unit="₦" value={form.paidOut} onChange={set('paidOut')} hint="Paying out more from a till needs the owner." />
              <Rule id="battery" text="A battery needs replacing after" unit="months" value={form.battery} onChange={set('battery')} hint="Used for “Who is due for a new battery” on your day." />
            </Section>
          </>
        )}

        <Section id="s3" title="The team" about="Roles decide what each person can open. A discount limit is the most they can take off a sale without asking you.">
          {team.map((p) => {
            const e = edits[p.id] ?? { role: p.role, limit: String(Number(p.discount_limit_pct)), active: p.active };
            const changed = !!edits[p.id] && (e.role !== p.role || Number(e.limit) !== Number(p.discount_limit_pct) || e.active !== p.active);
            const you = p.id === me.id;
            return (
              <div key={p.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', padding: '12px 0', borderTop: '1px solid rgba(16,24,34,.06)', opacity: e.active ? 1 : 0.6 }}>
                <span aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 38, height: 38, flex: 'none', borderRadius: 19, background: 'linear-gradient(160deg, #EEF3FF, #E0E8FD)', color: '#1B5CF0', fontWeight: 650 }}>{p.name.trim().charAt(0).toUpperCase()}</span>
                <span style={{ flex: '1 1 140px', minWidth: 0, fontSize: 15, fontWeight: 600 }}>{p.name}{you ? <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 9, background: '#F1F3F5', fontSize: 12, fontWeight: 550, color: '#434E5A' }}>You</span> : null}</span>
                {p.role === 'owner' ? <span style={{ fontSize: 14, color: '#434E5A' }}>Owner, can do everything</span> : (
                  <>
                    <select aria-label={`Role for ${p.name}`} value={e.role} onChange={(ev) => setEdits((x) => ({ ...x, [p.id]: { ...e, role: ev.target.value } }))} style={{ ...field, width: 150 }}>
                      {roles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#434E5A' }}>
                      <input aria-label={`Discount limit for ${p.name}`} inputMode="decimal" value={e.limit} onChange={(ev) => setEdits((x) => ({ ...x, [p.id]: { ...e, limit: ev.target.value.slice(0, 5) } }))} className="fld tabular" style={{ ...field, width: 64, textAlign: 'right' }} />% off
                    </span>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#434E5A' }}>
                      <input type="checkbox" checked={e.active} onChange={(ev) => setEdits((x) => ({ ...x, [p.id]: { ...e, active: ev.target.checked } }))} style={{ width: 18, height: 18, accentColor: '#1B5CF0' }} />Can sign in
                    </label>
                    <button type="button" disabled={!changed || busy !== null} onClick={() => void saveMember(p)} className="press" style={{ minHeight: 42, padding: '0 14px', border: 0, borderRadius: 11, background: changed ? '#10161E' : '#E6EAEE', color: changed ? '#FFFFFF' : '#8E99A4', font: '500 14px var(--sans)', cursor: changed ? 'pointer' : 'default' }}>{busy === p.id ? 'Saving…' : 'Save'}</button>
                  </>
                )}
              </div>
            );
          })}
          <p style={{ margin: '12px 0 0', fontSize: 13, color: '#55606C' }}>Adding a new person&apos;s login is done with the developer for now.</p>
        </Section>
      </div>

      {dirty ? (
        <div className="glass rise" style={{ position: 'fixed', left: '50%', bottom: 16, zIndex: 30, transform: 'translateX(-50%)', width: 'min(560px, calc(100% - 20px))', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 8px 8px 18px', borderRadius: 18 }}>
          <span style={{ fontSize: 14.5, fontWeight: 550 }}>You have changes</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => { setForm(saved); setNote(null); }} className="press" style={{ minHeight: 44, padding: '0 14px', border: '1px solid rgba(16,24,34,.12)', borderRadius: 13, background: '#FFFFFF', font: '500 14.5px var(--sans)', cursor: 'pointer' }}>Undo</button>
            <button type="button" onClick={() => void save()} disabled={busy !== null} className="press" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '0 18px', border: 0, borderRadius: 13, background: '#1B5CF0', color: '#FFFFFF', font: '600 15px var(--sans)', cursor: 'pointer', boxShadow: '0 8px 20px rgba(27,92,240,.24)' }}>{busy === 'settings' ? <><Spinner size={16} />Saving…</> : 'Save changes'}</button>
          </span>
        </div>
      ) : null}
      <style>{'.fld { transition: border-color .18s, box-shadow .18s } .fld:focus { border-color: #1B5CF0 !important; box-shadow: 0 0 0 4px rgba(27,92,240,.12); outline: none }'}</style>
    </main>
  );
}
