# Plan: catalogue search and substitutes

Item from `docs/progress.md`: "Catalogue search and substitutes. Normalised part numbers, size fields, `pg_trgm`, and "same part" against "fits but differs". Proof: "6205 2rs" and 25 × 52 × 15 both find the part, tested on made-up data for now. Plan step 1.2. The real price list import waits for the shop."

The plan's own words (`2026-11-01-power-store-plan.md:86`): "6205 2RS", "6205-2rs" and "62052RS" all find the same part, in every brand and price level in stock.

## Probing first — what it changed

**Probed:** can both test engines load `pg_trgm`? `sim/probe-trgm.mjs` ran `create extension pg_trgm` on PGlite and on the embedded Postgres.
**Result:** embedded Postgres (and therefore Supabase) can; **PGlite cannot**. Since every fast test run loads the schema through PGlite, a migration that creates the extension would kill the cheap loop.

**Decision:** ship a dependency-free trigram similarity in pure SQL — the same algorithm (`shared trigrams / total trigrams`), defined in the migration, so PGlite and real Postgres behave identically. No GIN index yet: a few thousand catalogue rows scan instantly. When the real price list makes it slow, one later migration swaps in `create extension pg_trgm` and a GIN index. Recorded here so it stays a known swap, not a surprise.

## Facts, checked today

- `products` has `sku`, `name`, `price_kobo`, `vat_rate_bp`, `low_stock_at` (`20261101000200_stock.sql`), and can gain columns through a new migration (only the five locked files are frozen).
- `availability()` computes in/low/out from stock_balances (`20261101000300_selling.sql:1186-1193`) — search mirrors it, and never returns counts (blind counting survives).
- New tables need their own RLS; new public functions need explicit grants and a place in the allow-list and refusal tests.

## Design

1. **Normalised part numbers:** `products.part_number` (as printed on the box) and `part_number_norm` (`i_norm_part`: uppercase, letters and digits only — "6205 2RS", "6205-2rs", "62052RS" all become `62052RS`), set by owner-only `save_part_details`, which also stores sizes.
2. **Sizes:** `product_sizes` (bore, outside, width in mm — bearings, pulleys, gears; belts come with the real import later). One row per product, no RLS leak to the public.
3. **`search_parts(query)`** (counter, storekeeper, dispatcher, accountant) ranks four ways and keeps the best per product: exact part (`match = 'part'`), part-number prefix (`'part'`), exact sizes from 3+ numbers in the query (`'size'` — the "fits but differs" arm when the number differs), trigram similarity > 0.35 (`'similar'`). Returns sku, name, part number, price, sizes, in/low/out state — never a count, never cost.
4. **"Same part" vs "fits but differs":** a part-number query returns the exact part first and same-size different-number parts marked `size`, so the counter can offer a substitute at a glance. A size query returns everything that fits.
5. **Staff-only for now** (plan P1). The public catalogue with request-a-quote is a later item.

## What the second reader found

Four real findings, all fixed with scenes:

1. **The result limit could crowd the exact part out.** The limit applied after sorting by product id, so with many substitutes the exact match (a high id) vanished from its own search. Fixed: dedupe to each product's best match first, then sort by match priority and limit. Scene proves it with 25 substitutes.
2. **Correcting one size wiped the others.** The upsert overwrote all three columns. Fixed: only the sizes given change; the rest keep their values. Scene proves it.
3. **Search showed stock bands for draft/archived products**, which `availability()` never does. Fixed: every arm requires `status = 'active'`. Scene proves an archived part vanishes.
4. **The similarity missed pg_trgm's space padding**, so a bare "205" pulled in 6205 products. Fixed: two leading and one trailing space, exactly as pg_trgm documents; a loose number now finds nothing. Scene proves it.

## Pre-mortem: likely failures and their guards

- **"6205 2rs" finds nothing** → normalisation must strip and uppercase identically at write and read time; scenes prove all three writings hit the same row.
- **A storekeeper learns a stock figure** → search returns only in/low/out; scene asserts no quantity anywhere in the result.
- **A typo hides a part** → trigram arm; scene proves "6205 2rx" still finds it.
- **Two engines disagree** → the similarity is pure SQL with no extension, so PGlite and Postgres run the same code.

## Steps

| # | Step | Files | Proof it worked | If it fails |
|---|---|---|---|---|
| 1 | New migration `20261102000400_search.sql`: products columns + index, `product_sizes` + RLS, `i_norm_part`, `part_similarity`, `save_part_details`, `search_parts`, grants | the new migration | `node check.mjs` still green | fix SQL, rerun |
| 2 | edge.mjs: allow-list + refusal rows; scenes for the three writings of "6205 2RS", size search by "25x52x15" and "25 52 15", fits-but-differs vs same part, prefix, typo via similarity, blind result, bad query/limit, roles | `sim/edge.mjs` | new scenes pass, `node check.mjs` green | fix scene or function, rerun |
| 3 | `node check.mjs --full`, reviewer, tick `docs/progress.md`, commit on `build` | docs | plain report to the owner | — |

## Done means

`node check.mjs --full` green; "6205 2rs" and 25 × 52 × 15 both find the same part on made-up data, with same-part told apart from fits-but-differs, and no count or cost ever shown.
