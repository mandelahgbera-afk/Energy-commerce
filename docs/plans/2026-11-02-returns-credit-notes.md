# Returns and credit notes (2026-11-02)

Goal: a customer can bring delivered goods back. Stock and money reverse exactly, at the original cost; part returns work; a returned serial goes back on the shelf or to repair/scrap; retry-safe; role-checked. Cash out stays the accountant's `refund_order`.

## Facts (checked)

- `orders` tracks `paid_kobo` / `billed_kobo` / `goods_status`; `order_lines` tracks `delivered_qty` plus running `billed_kobo` / `billed_vat_kobo` (`supabase/migrations/20261101000300_selling.sql:108-160,527-535`).
- Delivery posts `sales`, `vat_payable`, `cogs`, `stock` plus `i_balance_lines` (selling.sql:549-557). `i_balance_lines` is the only correct way to move `customers_owe` / `goods_owed` (selling.sql:251-258).
- Original cost per delivered line lives in `order_line_costs.cost_kobo` (selling.sql:164-167), fed by `i_take_value` at delivery (selling.sql:524-525). Current average in `product_costs` must not be used for a return.
- `stock_reason` already has `'returned'` (stock.sql:73); a movement with only `to_location` adds stock and updates balances via trigger (stock.sql:130-151).
- `serial_units`: `(status = 'in_stock') = (location_id is not null)` (stock.sql:87-103). Repair and scrap are location kinds (stock.sql:56).
- `order_line_serials` is the unit's *current* sale, not history (stock_movements keeps that): `return_goods` deletes the pairing when the unit comes back and `i_deliver` adds a fresh one on every sale (selling.sql:182-186,518).
- `i_post_txn` drops zero entries and balances the rest (ledger.sql:130-172); `ledger_period_open` refuses entries on/before the last closed month (ledger.sql:108-128), so a return after month close posts into the open month automatically.
- `refund_order` refunds only held money (`paid - billed`) and needs the accountant (selling.sql:726-769). After a return, `paid - billed` grows by exactly the return value, so it works unchanged.
- New tables must enable RLS themselves; grants are explicit (security.sql:5-22). The "every table has RLS" and "nothing a counter can read has a cost" scenes sweep all tables (sim/edge.mjs:1081,1206).
- Doc number kinds in use: `INV`, `RCT`, `RFD`, `OPN`. New: `CN` (credit note).
- `require_staff` passes the owner through everything (foundation.sql:40-51).

## Hand-worked examples (the money probe)

Full: battery ₦1,000,000, cost ₦700,000, paid in full, delivered. Return → `sales +1,000,000; cogs -700,000; stock +700,000; goods_owed -1,000,000`. Sums to 0. Then `refund_order` 1,000,000 transfer → `bank -1,000,000; goods_owed +1,000,000`.

Credit: 3 units, billed ₦3,000,000, paid ₦1,500,000. Return 1 → `sales +1,000,000; cogs -400,000; stock +400,000; customers_owe -1,000,000` (debt now ₦500,000). Return the other 2 → `sales +2,000,000; cogs -800,000; stock +800,000; customers_owe -500,000; goods_owed -1,500,000`. Sums to 0.

Rounding: reversing by the same running total that billed means part returns add up exactly. Price 100, qty 3: 33 + 34 + 33 = 100 (checked by hand).

## Assumptions

- A returned serial can be sold again later — 95% (real shop reality). Probe: composite PK change + a re-sale scene.
- Counter and accountant may authorise returns; storekeepers/dispatchers may not. Cash back stays `refund_order`. Judgement, consistent with existing roles; owner can veto.
- Credit note = the return record with doc `CN`; no new ledger account. `goods_owed` / `customers_owe` already say what is owed either way. Judgement.

## Pre-mortem

1. Rounding strands kobos on part returns → scenes assert exact totals; `i_books_check` runs after every scene.
2. Re-sold serial claims the wrong order's line → pairing deleted on return; scenes for cross-order re-sale and same-order re-delivery.
3. Counter reads cost through the return path → the new table has no cost column; the existing cost-sweep scene covers it.
4. Return deadlocks against a sale of the same product → lock order held: order → lines by product_id → stock balances → serial units → product costs → doc number last; race scene proves it.

## Steps

| # | Step | Files | Proof it worked | If it fails |
|---|---|---|---|---|
| 1 | New migration: `returns` table (RLS, policy, append-only triggers), composite PK on `order_line_serials`, `return_goods` function, explicit grant | `supabase/migrations/20261102000000_returns.sql` | `node check.mjs`: 92 baseline scenes still pass | Fix until green; locked files untouched |
| 2 | Rule scenes: full return with exact `moved()`, three part returns = exact full, credit part return, serial back to shelf then re-sold, serial to repair, retry changes nothing, `key_reused`, `more_than_delivered`, `nothing_to_return`, `serial_not_on_line`, return after a month closed; update allow-list and refusal table | `sim/edge.mjs` | `node check.mjs` all pass | Debug scene by scene with `node edge.mjs` |
| 3 | Race scene: ten returns of one delivered order at once, stock comes back once | `sim/race.mjs` | `node check.mjs --full` | Fix locks or validation |
| 4 | Second reader (reviewer agent) attacks the change | — | No unhandled attack in the report | Fix holes found, add scenes |
| 5 | Tick `docs/progress.md`, commit on `build` | — | `git log` shows one commit | — |

## Done means

- `return_goods`: full and part returns, original cost, serials to shelf/repair/scrap, credit-note doc `CN`, retry-safe, roles enforced.
- `node check.mjs --full` green; all 92 old scenes untouched and passing plus the new ones.
- `docs/progress.md` ticked, committed on `build`, plain-words report to the owner.

## What changed after the second reader

The reviewer proved three holes, now fixed with scenes:

1. A serial re-sold on another order could still be returned against the old order's line and steal the new sale's stock. Fixed: the return deletes the `order_line_serials` pairing, so only the line that currently sold the unit can take it back. Scene: "a serial re-sold on another order cannot be returned against the old one".
2. Re-delivering a returned serial on the same line crashed on the pairing primary key. Fixed by the same delete (no PK change needed). Scene: the re-sale scene now re-delivers on the same order first.
3. The return locked serial units before stock balances, the reverse of delivery's order, which could deadlock a return against a sale. Fixed by locking the shelf before the units. Race scene: "a return racing a sale of the same serial never deadlocks and never doubles the unit" (8 parallel rounds).
