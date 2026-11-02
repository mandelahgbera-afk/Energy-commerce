---
name: power-database
description: The money and stock core of Power Store. Load before writing or changing any migration, table, database function, policy or grant, and before anything touching money, stock, payments, tills, orders or permissions. Holds the accounting model, lock order, function template, checklists and traps already found.
---

# The Power Store database

`supabase/migrations/`: `..000000_foundation` (staff, customers, audit, numbers), `..000100_ledger`, `..000200_stock`, `..000300_selling`, `..000400_security`. These five are **locked**. New work goes in a new file with a later timestamp, using `create or replace function` to change behaviour.

Grep for what you need instead of reading whole files: `grep -n "create function" supabase/migrations/*.sql`.

## The accounting model

Amounts are kobo. **A positive amount is a debit, a negative amount is a credit.** Every transaction sums to zero or it can't commit.

An order runs on two tracks: `paid_kobo` (money confirmed) and `billed_kobo` (value of goods handed over).

| Event | Entries |
|---|---|
| Goods arrive | + `stock`, − `suppliers_owed` |
| Money before goods | + `bank` or `cash`, − `goods_owed` |
| Goods delivered | − `sales` (without VAT), − `vat_payable`, + `cogs`, − `stock`, and the balance moves (below) |
| Money after goods | + `bank` or `cash`, − `customers_owe` |
| Refund of held money | − `bank` or `cash`, + `goods_owed` |
| Count short | + `stock_differences`, − `stock` |
| Till short | + `till_differences`, − `cash` |

**A real scene.** A battery sells for ₦1,000,000 and cost ₦700,000. The customer sends ₦400,000: bank +₦400,000, goods owed −₦400,000. There is no sale yet, because the shop still owes them the goods. They pay ₦600,000 more. Goods leave: goods owed +₦1,000,000, sales −₦1,000,000, cost of goods +₦700,000, stock −₦700,000. Profit of ₦300,000 appears only now.

**Never work out `customers_owe` or `goods_owed` by hand.** Call `i_balance_lines(o, new_paid, new_billed)`, which returns the right movement for any combination of early, late, over or part payment.

Prices include VAT. Stock value is tracked exactly in `product_costs` (`value_kobo` over `on_hand`), and the last unit takes whatever is left, so rounding can't strand a kobo.

## A new function

```sql
create function do_thing(p_key text, p_order uuid, p_amount bigint) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := require_staff(array['accountant']::staff_role[]);  -- the owner always passes
  o orders;
  v_id uuid;
begin
  select * into o from orders where id = p_order for update;    -- 1. lock the parent
  if not found then raise exception 'no_such_order'; end if;
  select id into v_id from payments where client_key = p_key;   -- 2. a retry returns the first result
  if found then return v_id; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'bad_amount'; end if;  -- 3. validate
  -- 4. write, post with i_post_txn and a derived key, then i_audit
  return v_id;
end $$;
grant execute on function do_thing(text, uuid, bigint) to authenticated;
```

- Names: `i_*` are internal, take the actor as an argument, and are never granted. `p_*` are parameters. `v_*` are locals. A local named like a column raises "ambiguous" at runtime.
- Screens never pass a date. Only accountant and owner functions take `p_on`, defaulting to `shop_today()`.
- Errors are short names, optionally `name: detail`, which the app maps to plain words. Never put cost in one.
- Anything important gets `i_audit`.
- **Every quantity goes through `i_check_qty(unit, qty)` before anything uses it**, and before any cost sum. It refuses NaN, more than 3 decimals, fractions of an `each` item, and over 1,000,000.
- **A key reused for something different raises `key_reused`.** It never returns the old result as if the new request had worked. Compare the stored request (order, kind, method, amount, or a `client_hash` of the lines) before returning.
- Key lookup comes before state checks, so a retry after the till or month has closed still gets its first answer.
- Client keys passed to `i_post_txn` get a fixed prefix (`'expense:' || p_key`), so they can never collide with internal keys like `'till:' || id`.
- Validate with `is null` in mind. `x <> y` and `x <= 0` are null, not true, when an argument is null, and the check silently passes.

## Lock order, everywhere

**order → payment → customer → stock by product id → serial unit and product_costs → document numbers.** Breaking it freezes two sellers against each other.

- Loop lines by `order by product_id`, or `order by (value ->> 'product_id')::uuid` for JSON input. Never sort the text.
- Take document numbers (`i_next_doc`) last, because that row lock is held to commit.
- Lock a customer with `for no key update`. Plain `for update` blocks ordinary foreign-key checks and can deadlock.
- Lock both shelves in location order for a transfer.

## New table checklist

- `alter table ... enable row level security`, grant `select` only as needed, and add a policy. The loop in the security migration only covered tables that existed then, so new tables must do this themselves.
- Money columns are `bigint` ending `_kobo`. Quantities are `numeric(14,3)`.
- Holds cost or margin? Owner and accountant only, in a separate table from anything counter staff read. A test fails on such column names in readable tables.
- History? Add `before update or delete` and `before truncate` triggers using `forbid_change()`.
- Derived from other records? Add a comparison to `i_books_check()` with a new migration.

## New money or stock event checklist

1. Does it take a client key, and does a retry change nothing?
2. Which accounts move? Work one naira example by hand first, then assert it with `moved()`.
3. Can it collide with a sale, a delivery, a confirm or a close? Add a race scene.
4. What if the month is closed? What if the order is cancelled, awaiting approval, or part-delivered?
5. Which roles? Add it to the allow-list test and the refusal table, and run `node check.mjs --full`.

## Traps already found

A second reader attacked the first version and proved 15 serious bugs, all now fixed with scenes in `sim/edge.mjs`. These are the kinds of mistake to expect:

- **Judging the whole when the parts matter.** A counter with a 0% discount limit gave a ₦100,000 panel away free by overpricing another line on the same order, because only order totals were compared. Discount is judged per line.
- **A missing check at one door out of five.** Fractions were refused when selling but accepted when delivering, receiving, transferring and counting. A whole panel could leave at 0.1% of its price.
- **Postgres quoting a row in its error.** A failed check on `product_costs` put the exact cost in the error's DETAIL, which reaches the caller. Cost updates go through `i_take_value` and `i_add_value`, which replace the error. Validate before building a row, so a refusal can't quote a hidden figure.
- **An error as a side channel.** Whether a huge quantity overflowed `cost × qty` told a storekeeper the cost, by binary search, in 63 calls with no trace. Check bounds before touching a secret.
- **A null argument slipping past.** `transfer_stock` with no from-location made stock from nothing. `close_month` with a null statement skipped the bank check.
- **Only checking the exact month.** An entry dated before a closed month changed that month's closing balance. Anything on or before the latest closed month is now refused.
- **Trusting a key too much.** A reused key returned another order's result as if it had worked. An accountant could use up `'till:<id>'` and hide a till shortage.
- **Two counts of one shelf took the same loss twice.** Counts now take a key, go stale if the shelf was adjusted after they were taken, and can be refused.

Also:

- `on conflict do nothing` still evaluates `VALUES`, so `i_next_doc` inside the insert burns a number on a retry and leaves a gap. Insert first, then set the number.
- Row-level triggers don't fire on zero rows, so "cannot update" tests need real rows. `truncate` needs its own statement trigger.
- Default arguments run as the caller, so `shop_today()` stays granted. Postgres gives every new function to the public unless revoked, and the migration's default-privilege revoke covers only functions created by the same role. The allow-list test is the backstop.
- A check constraint can fire before your friendly check. Validate before the first insert.
- Ledger entries must be added in the same database transaction as their `ledger_txns` row (`ledger_entries_sealed`).
- `close_till` and `my_till` must never return the expected figure.
- `search_path` is always `public, pg_temp`. Without `pg_temp` named last, Postgres searches temp tables first, and a stranger's temp table named `staff` would pass `require_staff`.
- Every posting holds a share of the `shop_settings` row, and `close_month` takes it with `nowait`, so nothing lands in a month while it closes. Never make `close_month` wait: it would freeze the shop.
- A `FOR UPDATE` on a customer conflicts with foreign-key checks. `FOR NO KEY UPDATE` doesn't.
- Test driver: postgres.js double-encodes `$n::jsonb` strings, so use `$n::text::jsonb`, as `buildCall` in `sim/lib.mjs` does.
- PGlite and real Postgres behave the same so far. Check on real before trusting anything about locks.

## Not built yet

Quotes and versions, returns and credit notes, delivery trips and waybills, supplier orders and landed cost, warranty claims, trade-ins, reminders and outbox, instalment plans, public online checkout and gateway webhook, exchange-rate repricing, serial numbers in stock counts, part search and substitutes, undelivered-remainder cancellation, one customer payment across orders without a bank line. See plan section 11 for the intended tables and section 10 for what not to copy from Nazia.

## Known gaps, stated honestly

Not bugs to fix quietly. Each needs a plan or a decision.

- **Blind counts are blind on screen, not absolute.** A counter can add up their own cash payments for the day, as they could on paper. Storekeepers have no shelf numbers, and a pick list stops at 20 units.
- **POS is trusted on entry.** A counter can record `pos` and goods leave with no second person. Only the bank match at month end catches a fake one. Fix with POS settlement matching in step 5.3.
- **Cash in the safe isn't modelled.** Ledger `cash` is tills plus safe, and only tills are counted. A safe count is needed.
- **A whole bounce after a part refund is refused** (`already_refunded`). Rare, and needs a decision.
- **A bank line isn't tied to a payment by reference.** One line can pay several orders, so the second person decides. The screen must show both side by side.
- **An opening bank balance can't be overdrawn.** Owner drawings and capital aren't built either.

## Open questions only the shop or an accountant can answer

VAT per product (solar is unverified), moving average as the cost method, hold times and the drawer paid-out limit (`shop_settings`: 24 hours unpaid, 14 days with a deposit, ₦50,000), discount limits, instalment rules, scrap battery rules. Keep these as settings. Don't decide them.
