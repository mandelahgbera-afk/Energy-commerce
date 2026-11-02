# Plan: owner's money and the safe

Item from `docs/progress.md`: "Owner's money and the safe. Owner puts money in or takes it out (not a running cost). Safe count, so ledger cash can be compared with tills plus safe."

Closes the two known gaps in `power-database`: owner drawings/capital are not built, and cash in the safe is not modelled (ledger `cash` is tills plus safe, but only tills are counted).

## Facts, checked today

- `ledger_accounts` already has `owner_money` (equity) and `cash` ("Cash in tills") — `supabase/migrations/20261101000100_ledger.sql:15,21`.
- Opening balances move against `owner_money` — `20261101000100_ledger.sql:208-225`. Same shape for owner in/out.
- `move_money`, `record_expense`, `pay_supplier` are accountant-only and never check balances; mistakes are reversed — `20261101000100_ledger.sql:175-196,227-271`. House style: no balance checks.
- Blind count pattern: `submit_stock_count` (storekeeper, client key + hash) and `approve_stock_count` / `reject_stock_count` (owner only) — `20261101000200_stock.sql:411-505`. Approve posts the difference and refuses `count_out_of_date` when a later decision already settled the same ground.
- Till expected formula: float + confirmed cash payments − paid outs — `20261101000300_selling.sql:949-953`. `close_till` posts its difference with an internal key.
- `close_month` blocks while a till is open or a stock count is undecided — `20261101000300_selling.sql:1135-1136`.
- Locked files get no edits; new work is a new migration with `create or replace function` — AGENTS rule 11. Grants and RLS for new objects live in the new migration — pattern in `20261102000000_returns.sql:21-27,155`.
- Allow-list and role-refusal tests hardcode function names — `sim/edge.mjs:1112-1182`. New tests need no baseline entry (returns added 9 scenes without touching `baseline.json`; `check.mjs` prints 101 passing today).

## Design decisions (my judgement, shop may correct later)

1. **One `cash` account stays.** Ledger cash = tills + safe. Owner money in/out posts straight against `cash` or `bank` — never a till, or a till count would show a fake difference.
2. **Owner in/out is equity, never expense.** In: `cash`/`bank` +, `owner_money` −. Out: reverse. `ref_type = 'journal'` so `reverse_txn` can fix a typo. Accountant only (owner passes). No balance check, house style.
3. **Safe counts mirror stock counts.** `submit_safe_count` (counter or accountant, blind — returns only the id, counters can't read the table), `approve_safe_count` / `reject_safe_count` (owner only). Expected is computed at approval: ledger `cash` − expected cash in open tills. Difference posts `cash` ± and a new `safe_differences` expense account.
4. **Staleness:** approval refuses `count_out_of_date` if any cash posting or till open/close happened after the count was taken. Expected-at-approval + staleness means two old counts can't take the same loss twice (the first approval's posting changes what the second would compare against, and the second is stale anyway).
5. **`close_month`** (create or replace) also refuses while a safe count is undecided. Whether a monthly safe count should be mandatory is left open for the shop.
6. `cash_position()` (accountant) returns ledger cash, open-till cash and the implied safe, so the books can be compared with tills plus safe.

## What the second reader changed

The reviewer proved 4 holes; all are closed and covered by scenes (2 extra rule scenes, 110 total now):

1. **TOCTOU:** the staleness check, the cash sum and the till sum were three statements under READ COMMITTED — a cash payment committing in between inflated the diff and created cash. Fixed: `approve_safe_count` holds the `shop_settings` row `for update` through check and sums; every posting already takes a share of that row, so one consistent moment is guaranteed.
2. **Staleness was measured from submission time** — a count taken at 09:00 and tapped in at 11:00 hid a 10:00 withdrawal. Fixed: `submit_safe_count` takes a caller-supplied `p_counted_at` (rejects future times), and staleness compares against it.
3. **A submit could slip past `close_month`'s new blocker** while the month closed, stranding the count. Fixed: `submit_safe_count` takes a share of `shop_settings` too.
4. **Till open/close raced the approval** (no posting to serialize on). Fixed: `open_till`/`close_till` (create or replace) take a share of `shop_settings`, so the approval sees one set of tills. Lock order stays cycle-free (share locks never block share locks; the update holder wants nothing else).
5. **A wrongly approved count could not be reversed** — same as stock and till counts, by design: the next count corrects it exactly (expected is recomputed from the ledger each time). A scene proves the naira comes back; documented here so it stays a decision.

## Pre-mortem: likely failures and their guards

- **The split surprises someone** (till closed with zero difference but cash not yet in the safe). Guard: staleness refuses old counts, `cash_position()` shows the open-till slice; the app will say "count after the tills are in".
- **A wrong owner draw posts and confuses the month.** Guard: reversible via `reverse_txn`; scene proves it.
- **Two counts double the loss.** Guard: expected at approval + staleness; scene proves it.

## Steps

| # | Step | Files | Proof it worked | If it fails |
|---|---|---|---|---|
| 1 | New migration `20261102000100_owner_money.sql`: insert `safe_differences` account; `safe_counts` table with RLS (accountant reads); `owner_money_in`, `owner_money_out`; `submit_safe_count`, `reject_safe_count`, `approve_safe_count`; `cash_position`; create-or-replace `close_month`; grants | `supabase/migrations/20261102000100_owner_money.sql` | schema loads; `node check.mjs` still 101/101 | fix SQL, rerun |
| 2 | Edge scenes: in/out moves equity (moved()), profit untouched; key retry and reuse; blind submit (counter sees nothing, can't read the table); zero-diff approval posts nothing; shortage and over post correctly; stale count refused after a cash sale and after a till opens/closes; two counts don't double the loss; close_month blocks undecided, passes decided; wrong draw reversed; `cash_position` split matches; role refusals and allow-list extended | `sim/edge.mjs` | new scenes pass; `node check.mjs` green | fix scene or function, rerun |
| 3 | Race scene: cash sales racing a safe-count approval — either `count_out_of_date` or an exact difference, books agree; two approvals of one count post once | `sim/race.mjs` | `node check.mjs --full` green on real Postgres | fix locks/staleness |
| 4 | Tick `docs/progress.md`, commit on `build` with the why | `docs/progress.md` | plain report to the owner | — |

## Done means

`node check.mjs --full` green; the safe can be counted blind and its difference lands in the books; the owner can put money in and take it out as equity. Open for the shop: is a monthly safe count mandatory, and who counts the safe.
