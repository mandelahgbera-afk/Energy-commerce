'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { browserDb, connected } from '@/lib/supabase';

export default function Home() {
  const [day, setDay] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!connected()) {
        setError('Not connected yet: fill in .env.local and restart.');
        return;
      }
      const db = browserDb();
      const { data } = await db.auth.getSession();
      if (!alive) return;
      setSignedIn(data.session?.user?.email ?? null);
      try {
        const { data, error: rpcError } = await db.rpc('shop_today');
        if (!alive) return;
        if (rpcError) setError(rpcError.message);
        else setDay(String(data));
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className="mx-auto max-w-md px-5 py-10">
      <header className="mb-8">
        <p className="tabular text-sm font-medium text-action">Power Store</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">The shop runs on its database.</h1>
        <p className="mt-2 text-sm text-ink/60">
          This will be the counter. Every number on it comes from the books.
        </p>
      </header>

      <section className="card p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink/60">Shop day</span>
          <span className="tabular text-sm font-medium">{day ?? '…'}</span>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
          <span className="text-sm text-ink/60">Signed in</span>
          <span className="text-sm font-medium">{signedIn ?? 'nobody yet'}</span>
        </div>
        {error ? (
          <p className="mt-4 rounded-field bg-warn/10 p-3 text-sm text-warn" role="status">
            {error}
          </p>
        ) : null}
      </section>

      {signedIn ? (
        <div className="mt-5 flex flex-col gap-2">
          <Link
            href="/counter"
            className="press flex h-12 items-center justify-center rounded-field bg-action text-sm font-medium text-white shadow-[0_8px_20px_rgba(27,92,240,.22)]"
          >
            Work the counter
          </Link>
          <div className="flex gap-2">
            <Link
              href="/kit"
              className="press flex h-12 flex-1 items-center justify-center rounded-field border border-ink/15 bg-white text-sm font-medium"
            >
              Component kit
            </Link>
            <button
              type="button"
              onClick={async () => {
                await browserDb().auth.signOut();
                window.location.reload();
              }}
              className="press flex h-12 flex-1 items-center justify-center rounded-field border border-ink/15 bg-white text-sm font-medium"
            >
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <Link
          href="/login"
          className="press mt-5 flex h-12 items-center justify-center rounded-field bg-ink text-sm font-medium text-white"
        >
          Sign in
        </Link>
      )}
    </main>
  );
}
