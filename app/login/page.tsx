'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { browserDb, connected } from '@/lib/supabase';
import { Spinner } from '@/components/kit/feel';
import { Mark } from '@/components/staff-nav';

const field = 'h-12 w-full rounded-field border border-ink/15 bg-white px-4 text-[15.5px] text-ink outline-none transition-[border-color,box-shadow] focus:border-action focus:shadow-[0_0_0_4px_rgba(27,92,240,.12)]';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!connected()) {
      setMessage('The app is not connected yet: fill in .env.local and restart.');
      return;
    }
    setBusy(true);
    setMessage(null);
    const { error } = await browserDb().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setMessage('That email or password does not match.');
      setBusy(false);
      return;
    }
    router.push('/');
  };

  return (
    <main className="grid min-h-screen place-items-center px-5 py-10">
      <div className="w-full max-w-[400px]">
        <div className="glass rise rounded-[26px] px-6 pb-6 pt-8 sm:px-7">
          <Mark size={44} />
          <h1 className="mt-5 text-[26px] font-semibold tracking-[-.03em]">Staff sign in</h1>
          <p className="mt-1 text-[14.5px] text-ink/60">For the shop&apos;s own team. Customers don&apos;t need an account.</p>
          <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink/70">
              Email
              <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
            </label>
            <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink/70">
              Password
              <span className="relative">
                <input type={show ? 'text' : 'password'} required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${field} pr-20`} />
                <button type="button" onClick={() => setShow(!show)} aria-pressed={show} className="absolute right-1.5 top-1.5 h-9 rounded-[10px] px-3 text-[13px] font-medium text-ink/60 hover:bg-soft">
                  {show ? 'Hide' : 'Show'}
                </button>
              </span>
            </label>
            {message ? (
              <p className="rise rounded-small bg-warn/10 p-3 text-sm text-warn" role="status">
                {message}
              </p>
            ) : null}
            <button type="submit" disabled={busy} className="press mt-1 flex h-[52px] items-center justify-center gap-2 rounded-[15px] bg-action text-[15.5px] font-semibold text-white shadow-[0_10px_24px_rgba(27,92,240,.26)] disabled:opacity-70">
              {busy ? <><Spinner size={18} />Signing in…</> : 'Sign in'}
            </button>
          </form>
        </div>
        <p className="mt-5 text-center text-sm text-ink/60">
          Looking for parts? <Link href="/shop" className="font-medium text-action">Browse the shop</Link>
        </p>
      </div>
    </main>
  );
}
