# Power Store progress

Read at the start of every session. Update at the end. Keep it short. Long history belongs in `git log`.

## Where things stand

**Built and tested, on a laptop only:** the money and stock database in `supabase/migrations/`. It covers:

- staff roles, customers and suppliers
- double-entry ledger, month close and reversals
- stock with serial numbers, holds, blind counts and exact stock value
- orders with separate money and goods tracks: deposits, part payment, part delivery, credit, discount approvals, VAT
- transfers confirmed against bank lines, tills, refunds and opening balances
- row-level security on every table, and role checks on every function

**Tests:** 118 rule scenes on two databases, 19 race scenes, and a 90-day simulation in which the books agreed every day. A second reader's attack found 15 serious bugs in the first version. All are fixed, with scenes.

**Not built:** any app or real screen (`design/screens/` holds approved prototypes only). Quotes, returns, deliveries, reminders, buying.

**Nothing is deployed.** No accounts exist. The shop visit (plan Phase 0) hasn't happened and is still required before go-live.

## Next items, in order: one per session

Database first, because these need no accounts and the core can't handle a return without them.

- [x] **Returns and credit notes.** `return_goods`: full and part returns reverse sale, VAT and the original cost exactly; a returned serial goes back to a shelf, repair or scrap and can be sold again; a credit note (doc CN) records what the customer is owed, paid out through `refund_order`. Retry-safe, counter and accountant only. Proof: 101 rule scenes (92 old + 9 new) on PGlite and real Postgres, 15 race scenes (13 old + 2 new). A second reader found 3 serial and lock holes, all fixed with scenes. Open: cash back stays accountant-only; owner to confirm counters may authorise returns.
- [x] **Owner's money and the safe.** `owner_money_in` / `owner_money_out`: the owner puts money in or takes it out against `owner_money` (equity), never a running cost, never through a till, reversible. Blind safe counts: a counter or accountant counts, the owner decides, and the difference lands in a new `safe_differences` account; a stale count (money moved or a till opened since it was taken, judged from the caller's counted-at time) is refused, and two old counts can't take the same loss twice. `cash_position()` shows ledger cash = tills + safe. Close-month waits for an undecided safe count. Proof: 110 rule scenes (101 old + 9 new) on PGlite and real Postgres, 17 race scenes (15 old + 2 new). A second reader found 4 holes (a payment racing the approval created cash, staleness measured from tap-in time, a submit slipping past month close, tills opening mid-approval) — all fixed with locks and counted-at, with scenes. Open: whether a monthly safe count is mandatory; a wrong count is fixed by recounting, not reversal (same as stock and till counts).
- [x] **POS settlement.** A card tap at the counter now hands over the goods but stays pending like a transfer, until a second person matches it against a bank line: goods still leave, the counter is not slowed, and a fake tap stays a customer debt that shows on the owner's list, never money. Cash on top of a waiting card tap is refused, so a customer can't be charged twice; delivery counts waiting taps toward the covered amount. Proof: 114 rule scenes (110 old + 4 new) on PGlite and real Postgres, 18 race scenes (17 old + 1 new). A second reader found 1 hole (cash double-charge) and a millisecond false-staleness on real Postgres — both fixed with scenes. Open: after a rejected tap, the unpaid delivered order shows in debtors, like a bounced transfer.
- [x] **Quotes.** A quote is a promise on paper: no money moves and no stock is held until accepted. Each version is its own record with its own Q number; only the latest unexpired version can be accepted, and acceptance becomes an ordinary order at the quoted price — even after prices change — with the discount rules judged against the current list, so a big drop waits for the owner like any other. Trade prices and VAT rounding match orders exactly. Proof: 118 rule scenes (114 old + 4 new) on PGlite and real Postgres, 19 race scenes (18 old + 1 new). A second reader's ten attacks found no break. Open: the discount limit judged at acceptance is the accepter's; approval at quote time is a shop decision.
- [ ] **Catalogue search and substitutes.** Normalised part numbers, size fields, `pg_trgm`, and "same part" against "fits but differs". Proof: "6205 2rs" and 25 × 52 × 15 both find the part, tested on made-up data for now. Plan step 1.2. The real price list import waits for the shop.
- [ ] **Backup and restore, local proof.** Dump the database, restore into a blank one, and check the numbers match, including `i_books_check()`. Follow the plan's section 9. The upload to R2 needs an account later, so stop there. The pattern is in Gleey's `sim/db-backup.mjs`: ask the owner before reading it.
- [ ] **App skeleton.** Next.js in this folder, design tokens from the prototypes, one tested helper each for money and quantities, and the error-words table. **Stop and ask the owner** which login to test with: local Supabase in Docker (free, heavy on this laptop) or a free staging project (needs their account).
- [ ] **Component kit.** Port `design/screens/Kit.dc.html` to React. Show the owner one or two screens before building many.
- [ ] **Counter sale and till.** Scan, scan, Cash, Exact, Complete in 5 actions. A blind till close. A retry never records twice. Plan step 1.5.
- [ ] **Owner's today screen.** What needs them, using `owner_exceptions`, with approvals. Plan step 1.7.
- [ ] **Stock room.** Receive, pack with oldest-first picks, blind count.
- [ ] **Books.** Month report, ledger, bank matching, month close, with the graphs from plan section 15.
- [ ] **Public catalogue with request a quote.** Plan step 1.8, without go-live.

After these, stop. Everything left needs the owner and a real shop.

## Waiting on the owner

- Which shop to spend a day in (plan Phase 0). Prefer one that gives credit.
- An hour with an accountant: VAT per product, deposits, cost method.
- Yes for Vercel Pro ($20 a month) and a domain, when it's time.
- Settings to confirm with the shop: hold times, discount limits, the ₦50,000 drawer limit, whether storekeepers should see shelf numbers.

## Log

Newest first. One or two lines per item: what now works, the test result, anything left open.

- 2 Nov 2026 (OpenCode): quotes built and reviewed. 118 rules + 19 races green; the reviewer's ten attacks found no break. Left open: discount limit judged at acceptance is the accepter's; quote-time approval is a shop decision.
- 2 Nov 2026 (OpenCode): POS settlement built and reviewed. 114 rules + 18 races green; reviewer's cash double-charge hole and a millisecond false-staleness on real Postgres fixed with scenes. Left open: a rejected tap's unpaid delivery shows in debtors.
- 2 Nov 2026 (OpenCode): owner's money and the safe built and reviewed. 110 rules + 17 races green; reviewer's 4 holes (races, counted-at, month close, tills) fixed with scenes. Left open: monthly safe count not yet mandatory; wrong counts fixed by recounting.
- 2 Nov 2026 (OpenCode): returns and credit notes built and reviewed. 101 rules + 15 races green; reviewer's 3 holes fixed with scenes. Left open: refund cash-out stays accountant-only.
- 1 Nov 2026 (Claude): core built, attacked and fixed. Handed to OpenCode.
