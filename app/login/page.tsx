'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { browserDb, connected } from '@/lib/supabase';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    <main className="mx-auto max-w-sm px-5 py-16">
      <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-1 text-sm text-ink/60">Staff only. Customers get their own door later.</p>
      <form onSubmit={submit} className="card mt-6 flex flex-col gap-4 p-5">
        <label className="flex flex-col gap-1.5 text-sm text-ink/60">
          Email
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 rounded-field border border-ink/15 bg-white px-4 text-ink outline-none focus:border-action"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-ink/60">
          Password
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 rounded-field border border-ink/15 bg-white px-4 text-ink outline-none focus:border-action"
          />
        </label>
        {message ? (
          <p className="rounded-small bg-warn/10 p-3 text-sm text-warn" role="status">
            {message}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="press h-12 rounded-field bg-action text-sm font-medium text-white shadow-[0_8px_20px_rgba(27,92,240,.22)] disabled:opacity-60"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
