# Plan: app skeleton

Item from `docs/progress.md`: "App skeleton. Next.js in this folder, design tokens from the prototypes, one tested helper each for money and quantities, and the error-words table. Stop and ask the owner which login to test with."

Asked and answered: **a free Supabase staging project** (the owner made the account). The three credentials live in `.env.local`, which the owner fills and I never read — the app and the one-off scripts load it themselves. Everything here builds without the credentials; the staging hookup is two commands once they're in.

## Facts, checked today

- Stack fixed by `power-app`: Next.js 16, React 19, Tailwind 4, TypeScript, zod, Supabase. Same as Nazia. Node on this laptop is v24 ✓.
- Design tokens read from `design/screens/Kit.dc.html`: ink `#10161E`, page `#EEF1F4`, card white with `rgba(16,24,34,.07)` borders and 22px radius, inputs/buttons 14px, action blue `#1B5CF0`, green `#0D9465`/`#0F8F6B`, glass `rgba(255,255,255,.62)` blur 18px, Geist + Geist Mono (codes/part numbers), tabular numerals for money, 44px+ targets, calm .18s presses.
- Validated chart colours from `power-ui`: blue `#1B5CF0`, amber `#D97A0B`, green `#0F8F6B`; no others.
- `.env.*` is gitignored already; `check.mjs` and friends stay untouched; new tests use Node's built-in runner — no test framework package.
- `npm install` is slow on this network: install once at the root.

## Assumptions, probed by doing

- npm registry works from here (95% — `sim/` installed fine). Probe: the install itself; two failures means stop and report.
- No font download at build time: the skeleton names Geist with a system fallback; real Geist files get bundled locally in the component-kit item (build-time network is the risk).

## Design

1. **Root app:** `app/` (App Router), `app/globals.css` with the tokens as CSS variables + Tailwind theme, a quiet landing page that shows the shop day and whether anyone is signed in, and a minimal `/login` (email + password, Supabase auth) — the two screens the owner sees before more are built, per `power-ui`.
2. **`lib/money.ts`:** kobo ⇄ naira as integers with string maths (never floats), `formatNaira(150050)` → `₦1,500.50`. **`lib/quantity.ts`:** typed quantities as 3-decimal strings, one place to validate. **`lib/errors.ts`:** every raised error name → plain words + what to do next.
3. **`scripts/check-errors.mjs`:** greps every `raise exception 'name` in `supabase/migrations` and fails if `lib/errors.ts` misses one — the error table cannot drift.
4. **`lib/supabase.ts`:** browser client (anon key) and server client; service-role key referenced only by a later jobs module, never shipped to the browser.
5. **Staging hookup:** `scripts/db-apply.mjs` runs the 7 migration files against `SUPABASE_DB_URL` (reads `.env.local` itself; skips the test stubs); `scripts/db-owner.mjs` makes the first signed-up user the owner staff row.

## Pre-mortem: likely failures and their guards

- **Install dies on the network** → install once; if it fails twice, stop and tell the owner.
- **Skeleton drifts from the approved look** → only tokens copied from the Kit and the validated colours go in; the owner sees landing + login before anything else.
- **A float sneaks into money** → string maths only; tests cover `0.07`, `1,000`, `0.1+0.2` class traps and an empty box.
- **Error words go stale** → `check-errors.mjs` fails the gate.
- **Next 16 API surprises** → only client components and a plain server layout this item; no params/proxy use.

## Steps

| # | Step | Files | Proof it worked | If it fails |
|---|---|---|---|---|
| 1 | `package.json` + one install: next, react, react-dom, typescript, @types/react, @types/node, tailwindcss, @tailwindcss/postcss, @supabase/supabase-js, zod (about 300 MB installed in total) | root | install completes | retry once; else stop |
| 2 | configs, `app/` with tokens, landing + login, `lib/` helpers and error table, `scripts/` (check-errors, db-apply, db-owner) | many | `npm run build` green, `node scripts/check-errors.mjs` green, `node --test tests/` green | fix, rerun |
| 3 | Run it at 375px and desktop, check the two screens, then commit on `build` with docs | docs | plain report to the owner | — |

## Done means

`npm run build` and the three checks pass; the owner sees a landing page and a login in the approved look; money and quantities have tested helpers; the error table is pinned to the migrations. Staging applies when the owner says `.env.local` is filled.
