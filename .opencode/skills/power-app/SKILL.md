---
name: power-app
description: Conventions for Power Store's Next.js app. Load before writing routes, server actions, data calls, forms, auth, or anything that connects a screen to the database. Covers the stack, how the app talks to the database functions, retries, money handling and error wording.
---

# The Power Store app

**Stack:** Next.js 16, React 19, Tailwind 4, TypeScript, zod, zustand, motion. Same as Nazia. Supabase for data and auth. Nothing else without the owner's yes.

**Read `node_modules/next/dist/docs` before using a Next API.** This version differs from what you may remember (`proxy.ts`, async params). Don't guess.

## How the app talks to the database

The app is a thin layer. The rules are in Postgres, and the tests prove them there.

- Call `supabase.rpc('counter_sale', {...})`, logged in as the real user, so `auth.uid()` and row-level security apply. **Reads** may select from tables the role can see. **Writes** are always functions.
- The service-role key never reaches the browser, and is only for scheduled jobs (`expire_holds`, `i_books_check`).
- Never re-check or re-calculate a rule in the app as if that made it safe. Validate input with zod for good error messages, then let the database decide.
- Never repeat cost in a component or response that counter staff can receive.

## Retries: one tap, one key

Every write function takes `p_key`. Create the key **when the person taps**, keep it until a success comes back, and reuse it on every retry:

```ts
const key = crypto.randomUUID(); // once per tap, stored with the pending action
await supabase.rpc('counter_sale', { p_key: key, p_location, p_lines, p_method });
```

Shop networks drop. A retry with the same key changes nothing, and that is the whole point. A new key on retry would sell the goods twice. Disable the button while waiting, and show what happened in words.

## Money and dates

- Money travels as integer kobo. Format it in exactly one helper (`formatNaira(150050)` gives `₦1,500.50`). Parse typed naira into kobo in exactly one helper, using string maths, not floats. Test both, including `0.07`, `1,000`, and an empty box.
- Supabase returns `bigint` as a number or a string depending on the path. Convert in one place, and never let it become a float through division.
- Quantities are refused with more than 3 decimals, so `0.1 + 0.2` from JavaScript fails with `bad_qty`. Keep metre quantities as typed strings or round to 3 places in one helper, and never send a computed float.
- The shop's day is Africa/Lagos. The database's `shop_today()` decides dates, so don't send "today" from a phone, whose clock may be wrong.

## Errors

Functions raise short names such as `insufficient_stock: BAT-200`, `payment_required: 5000 short`, `over_credit_limit`, `not_allowed`, `till_not_open`. Keep one table turning these into plain words, with what to do next:

| Raised | Staff sees |
|---|---|
| `insufficient_stock` | Only 1 left on the shelf. Reduce the quantity or take a deposit for the rest. |
| `payment_required` | ₦50,000 is still owed before these goods can leave. |
| `over_credit_limit` | This would take Musa over their credit limit. Ask the owner to approve. |
| `till_not_open` | Open your till first. |
| `key_reused` | This looks like a different action on an old request. Refresh and try again. |

Never show a raw database error, and never pass a Postgres `details` field to the browser: a raw error can quote a whole table row. Log it to Sentry and show a calm message saying whether the action happened.

## Reuse

Nazia (`C:\Users\hp\Downloads\Naziawebapp\naziaa`) has working patterns for the driver app, delivery code, maps, and a webhook that re-verifies with Flutterwave before acting. Ask the owner before reading it. Plan section 10 lists what to reuse and what must not be copied, including Nazia's `integer` kobo, single order status and edited stock numbers.

## Security on every route

Rate limits (Upstash) and Turnstile on public forms come in from day one, once the owner has approved those accounts. Public pages only ever use `availability`, `check_serial`, `receipt_by_token` and active products.
