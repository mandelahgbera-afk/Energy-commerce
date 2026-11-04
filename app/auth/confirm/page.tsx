'use client';

// Where every login email lands. The email carries a one-time token; this page checks it with
// Supabase, then asks for a password (an invite or a reset) or simply signs the person in (a
// sign-in link, a confirmed email or a changed email). Templates are in supabase/templates.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { browserDb } from '@/lib/supabase';
import { Spinner, Tick } from '@/components/kit/feel';
import { Mark } from '@/components/staff-nav';

type Kind = 'invite' | 'recovery' | 'magiclink' | 'email_change' | 'signup' | 'email';
const kinds: Kind[] = ['invite', 'recovery', 'magiclink', 'email_change', 'signup', 'email'];
const field = 'h-12 w-full rounded-field border border-ink/15 bg-white px-4 text-[15.5px] text-ink outline-none transition-[border-color,box-shadow] focus:border-action focus:shadow-[0_0_0_4px_rgba(27,92,240,.12)]';

export default function Confirm() {
  const router = useRouter();
  const db = useRef(browserDb()).current;
  const [stage, setStage] = useState<'checking' | 'password' | 'done' | 'failed'>('checking');
  const [kind, setKind] = useState<Kind | null>(null);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const u = new URLSearchParams(window.location.search);
    const hash = u.get('token_hash');
    const type = u.get('type') as Kind | null;
    if (!hash || !type || !kinds.includes(type)) { setStage('failed'); return; }
    setKind(type);
    void db.auth.verifyOtp({ token_hash: hash, type }).then(({ error }) => {
      if (error) { setStage('failed'); return; }
      if (type === 'invite' || type === 'recovery') setStage('password');
      else { setStage('done'); setTimeout(() => router.replace('/'), 1200); }
    });
  }, [db, router]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < 8) { setMessage('Use at least 8 characters.'); return; }
    if (password !== again) { setMessage('The two passwords are not the same.'); return; }
    setBusy(true);
    setMessage(null);
    const { error } = await db.auth.updateUser({ password });
    setBusy(false);
    if (error) { setMessage('That password could not be saved. Try a longer one.'); return; }
    setStage('done');
    setTimeout(() => router.replace('/'), 1200);
  };

  return (
    <main className="grid min-h-screen place-items-center px-5 py-10">
      <div className="glass rise w-full max-w-[400px] rounded-[26px] px-6 pb-6 pt-8 sm:px-7" aria-live="polite">
        <Mark size={44} />
        {stage === 'checking' ? (
          <p className="mt-6 flex items-center gap-3 text-[15.5px] text-ink/70"><Spinner size={18} stroke="#1B5CF0" />Checking your link…</p>
        ) : null}
        {stage === 'password' ? (
          <>
            <h1 className="mt-5 text-[26px] font-semibold tracking-[-.03em]">{kind === 'invite' ? 'Welcome to the team' : 'Choose a new password'}</h1>
            <p className="mt-1 text-[14.5px] text-ink/60">{kind === 'invite' ? 'Set a password to finish your login.' : 'Your link is good. Pick a password you have not used before.'}</p>
            <form onSubmit={save} className="mt-6 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink/70">New password<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} /></label>
              <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink/70">Type it again<input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={field} /></label>
              {message ? <p role="alert" className="rounded-small bg-warn/10 p-3 text-sm text-warn">{message}</p> : null}
              <button type="submit" disabled={busy} className="press mt-1 flex h-[52px] items-center justify-center gap-2 rounded-[15px] bg-action text-[15.5px] font-semibold text-white shadow-[0_10px_24px_rgba(27,92,240,.26)] disabled:opacity-70">
                {busy ? <><Spinner size={18} />Saving…</> : 'Save my password'}
              </button>
            </form>
          </>
        ) : null}
        {stage === 'done' ? (
          <p className="mt-6 flex items-center gap-3 text-[16px] font-medium"><span className="grid h-7 w-7 place-items-center rounded-full bg-[#0D9465]"><Tick size={16} /></span>You&apos;re in. Taking you to your screens…</p>
        ) : null}
        {stage === 'failed' ? (
          <>
            <h1 className="mt-5 text-[24px] font-semibold tracking-[-.03em]">This link has expired</h1>
            <p className="mt-2 text-[14.5px] leading-relaxed text-ink/60">Links from our emails work once and only for a short time. Ask the owner to send a new one, or reset your password from the sign-in page.</p>
            <Link href="/login" className="press mt-6 flex h-12 items-center justify-center rounded-[15px] bg-ink text-[15px] font-medium text-white">Go to sign in</Link>
          </>
        ) : null}
      </div>
    </main>
  );
}
