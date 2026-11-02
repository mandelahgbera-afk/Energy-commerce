# Power Store

One dealer's own online store and full back office, for solar panels, solar and car batteries, and "power transmission" goods (bearings, belts, chains). These dealers only sell. They do not install. It is **not a platform**: no `tenant_id`, and each shop gets its own Supabase project in the shop's name.

The owner of this project is a builder, not an accountant or a DBA. Talk to them in plain words, with a real scene or a naira example. Report results as they are: what passed, what failed, what you did not check. Do not say "should work" about anything you did not run.

## Start of every session

1. Read this file, then `docs/progress.md`. Nothing else yet.
2. Run `cd sim && node check.mjs`. If it fails before you have changed anything, stop and tell the owner.
3. Do **one** item from `docs/progress.md`, then stop and report. One item per session keeps credits under control and lets the owner check your work.

## Skills: load the one that fits before you start

| Skill | Load before |
|---|---|
| `power-plan` | Any item touching more than one layer, any money or permission change, any replan |
| `power-database` | Any migration, table, database function, policy or grant |
| `power-testing` | Writing or running tests, or a test failing in a way you don't understand |
| `power-app` | Next.js code: routes, server actions, data calls, forms |
| `power-ui` | Any screen, component, graph, animation or customer-facing wording |

Source of truth: `docs/plans/2026-11-01-power-store-plan.md` (long: read only the section you need) and `docs/plans/2026-11-01-phase-1-core.md`. When reality disagrees with a plan, update the plan and say what changed.

## Rules that must never break

1. **Money is whole kobo in `bigint`.** ₦1,500.50 is `150050`. Never a float, in SQL or in TypeScript. No `Number(x) * 1.075`.
2. **The database decides.** All money and stock changes go through database functions with row locks. The app never writes to a table, and never works out a total that it then saves. API roles have no write access to any table.
3. **History is never edited.** `ledger_txns`, `ledger_entries`, `stock_movements` and `audit_log` are append-only. A mistake gets a reversal. Do not add an update or delete path, and do not remove these triggers.
4. **Every transaction balances, every month closes properly.** Do not weaken `ledger_balanced`, `ledger_entries_sealed`, `ledger_period_open` or `i_books_check()`.
5. **A deposit is not a sale.** Money ahead of goods is `goods_owed`. Revenue is recognised at delivery only.
6. **A transfer alert is not money.** A transfer stays pending until a second person confirms it against a bank line, or the owner vouches for it.
7. **Counter staff never see cost or profit, by any route.** Cost lives only in `product_costs`, `order_line_costs`, `goods_receipts` and the ledger. Never add cost to a table, function result, error message or API response that counter staff can reach.
8. **Every write that can be retried takes a client key.** One tap makes one key, and a retry reuses it. On a bad network a sale must never record twice.
9. **Counts are blind.** Till and shelf counts never show the expected figure to the person counting.
10. **Never weaken a test to get it passing.** No deleting, renaming, skipping or loosening. If you truly believe a test is wrong, stop and show the owner why. `node check.mjs` fails if a baseline test goes missing.
11. **The five migrations dated `20261101` are locked.** Change behaviour with a new migration file (`create or replace function ...`). `node check.mjs` fails if a locked file changes.

## Stop and ask the owner before

- Spending anything or creating any account: Vercel Pro, domain, Supabase project, Cloudflare, Flutterwave, Resend, Mapbox, anything paid. The budget rule: free tools wherever quality holds, only the domain and Vercel paid. Say the cost when you ask.
- Connecting to any real database or service, pushing to a remote, deploying.
- Adding an npm package. Name it, its size and why, and check first whether the stack already covers it.
- Changing a decision in plan section 8, the accounting model, or who can see what.
- Guessing a fact only the shop can answer: VAT per product, hold times, discount limits, credit terms, deposit rules. Keep it a setting, write it down as open, and move on.
- Anything outside this folder. **Gleey (`C:\Users\hp\Downloads\eventwebapp`) is being developed by someone else right now. Never change it.** Gleey and Nazia (`C:\Users\hp\Downloads\Naziawebapp\naziaa`) may be read for patterns if the owner approves, never edited. Never read or reuse any `.env` file from anywhere.

Also never: use Termii. Add the WhatsApp Cloud API (the owner said not yet; reminders are email plus staff-sent click-to-chat). Use wording or controls that imply this product switches anyone's appliances on or off.

## This laptop

16 GB RAM, 4 threads, one nearly full drive.

- All video and image rendering runs in Docker, never on the host. E2e screenshots are fine. This project should rarely need rendering at all.
- After real-Postgres, race or simulation runs, run `node ~/.claude/tools/dev-clean.mjs --yes`.
- Never run `docker system prune -a` or `docker image prune -a`.
- `npm install` is slow on this network. Install once, and keep builds and tests small.

## Credits: how to work cheaply

DeepSeek charges far less for input it has already seen, but only for an exact match from the start of the conversation. New input and output are what cost money.

- Search before reading: use grep, then read only the lines you need. Never read a file you already have in this session. Never open `node_modules`, lock files or whole `design/screens/*.dc.html` files unless that screen is your item.
- Keep output small. Run tests through `node check.mjs`, which prints only failures and totals. Never paste long logs back. Pipe anything noisy through `tail -20`.
- Use `node check.mjs` after each change. Use `node check.mjs --full` only before committing a money, stock or permission change. Run `simulate.mjs` only when the schema grew and the owner wants new size numbers.
- Two failed fixes for the same error means stop guessing. Read the code properly or ask. Three means stop and report.
- Write short plans and short reports. No summaries of what you are about to do.
- Use the `explore` subagent for wide searches. Use `reviewer` once per finished money, stock or permission change. Nothing else fans out.
- Do not edit this file or `opencode.json` during a session. It breaks the cheap prefix for everything after it.

## Finishing an item

1. `node check.mjs` passes, plus `--full` if money, stock or permissions changed.
2. Tick the item in `docs/progress.md`, with the real numbers and anything left open.
3. Commit on the `build` branch, one commit per item, with a message saying why. Create it from `main` if it doesn't exist. `main` stays as the last version someone reviewed, so never commit to it after the baseline. Never push.
4. Tell the owner in plain words: what now works, what you ran and its result, what you did not check, and what is next. Then stop.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
