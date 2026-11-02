# Plan: POS settlement

Item from `docs/progress.md`: "POS settlement. Card payments wait to be matched to the bank line like transfers do, without slowing the counter: goods still leave, and unmatched POS shows on the owner's list."

Closes the known gap in `power-database`: "POS is trusted on entry. A counter can record `pos` and goods leave with no second person."

## Facts, checked today

- `i_take_payment` applies every method except transfer instantly — `20261101000300_selling.sql:445`. A transfer stays pending until `confirm_payment` matches a bank line.
- `i_apply_payment` posts cash for cash, bank for everything else — `selling.sql:396-398`.
- `confirm_payment` / `reject_payment` are method-agnostic (pending status, bank line capacity, `cannot_confirm_own_payment`, owner may vouch without a line) — `selling.sql:646-690`.
- Delivery refuses a non-credit order beyond its confirmed money (`payment_required`) — `selling.sql:540-541`.
- `counter_sale` delivers immediately for non-transfer methods; transfer waits (`awaiting_transfer`) — `selling.sql:617-622`.
- `close_month` blocks while any payment is pending, worded "a transfer is waiting" — `selling.sql:1137`.
- `owner_exceptions.old_transfers` lists pending payments older than 4 hours — `selling.sql:1156-1157`.
- The item's own words fix the one business question: "goods still leave" — a customer tapping a card at the counter walks out with the goods, and the books say they owe until the bank line proves the money.

## Design (follows the transfer model exactly, plus one allowance)

1. `i_take_payment` (create or replace): only cash applies immediately. A card tap stays `pending`, and is judged against what other pending card taps on the order leave uncovered, so a double tap can't over-cover the order.
2. `i_deliver` (create or replace): a non-credit order may deliver when its pending card taps cover the shortfall. The books stay honest: the goods leave against `customers_owe`, and the card confirm later posts `bank` and clears the debt. A fake tap stays a debt the owner can see, never money.
3. `counter_sale` unchanged: goods leave, state stays `done` — the counter is not slowed.
4. `close_month` wording: "a payment is waiting to be confirmed" (covers both kinds). `owner_exceptions` rows gain `method` so the owner can tell a card from a transfer.
5. No new tables, no new public functions, no new roles. Refunds and reversals keep working on confirmed money only; a pending tap is rejected, not reversed.

## What the second reader changed

The reviewer proved one real regression and confirmed the rest of the design; both are handled:

1. **Cash on top of a waiting card tap double-charged the customer.** The cash overpay check read only confirmed money, so after a pending card tap the counter could take full cash too, and the later confirm made the order overpaid. Fixed: the cash check now subtracts waiting card taps exactly like the card check does. A declined tap is never recorded in the first place, so nothing real is slowed. Scene proves the refusal and the uncovered-cash top-up.
2. **Millisecond truncation made fresh counts look stale on real Postgres.** The caller's clock reports milliseconds but `created_at` has microseconds, so a posting landing 0.4ms before a count could be seen as after it. Fixed: anything within the same millisecond as the count is treated as before it. This showed up only on real Postgres, which is why the gate runs both.
3. Confirmed by design: after a rejected tap, the delivered-but-unpaid order shows in `debtors()` (like a bounced transfer), not on the owner list; a retry of a rejected tap returns its id with status `rejected` for the app to read.

## Pre-mortem: likely failures and their guards

- **A fake tap still walks goods out** — by the owner's own decision, goods leave; the guard is the unmatched-card line on the owner list plus the customer debt in the books. Scene proves no money is created.
- **The counter gets slowed** — delivery must accept the pending tap; scene proves `state = 'done'` and goods leave.
- **Two taps over-cover one order** — the pending-sum check; scene proves the refusal.
- **A confirm racing a reject** — existing row-lock pattern (`orders` → `payments` → `bank_lines`); race scene proves one bank line is matched exactly once.

## Steps

| # | Step | Files | Proof it worked | If it fails |
|---|---|---|---|---|
| 1 | New migration `20261102000200_pos.sql`: create or replace `i_take_payment`, `i_deliver`, `close_month`, `owner_exceptions` | the new migration | `node check.mjs` still green | fix SQL, rerun |
| 2 | edge.mjs: `pay` helper defaults to cash (money that is money); confirm the card before the two reversal scenes and the receipt scene; month-close message assertion updated; 4 new scenes (goods leave + bank line later, fake tap refused + own-tap rule, unmatched card on owner list + month block, double tap + retry) | `sim/edge.mjs` | new scenes pass, `node check.mjs` green | fix scene or function, rerun |
| 3 | race.mjs: ten card payments race one bank line — only what the line covers is confirmed | `sim/race.mjs` | `node check.mjs --full` green | fix locks, rerun |
| 4 | Reviewer, tick `docs/progress.md`, commit on `build` | docs | plain report to the owner | — |

## Done means

`node check.mjs --full` green; a card tap hands over goods but is not money until a second person matches the bank line; a fake tap stays a visible debt; the counter's day does not slow down.
