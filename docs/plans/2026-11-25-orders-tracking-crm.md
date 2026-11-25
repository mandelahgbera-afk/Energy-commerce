# Order tracking, a small CRM and the shop's own map

25 Nov 2026. The owner asked for this: "a proper order tracking system, with little CRM in it and MapLibre custom map and all... for now doesn't even need Flutterwave payments etc, all must work. If we get a good buyer that wants auto transactions we then add Flutterwave or Paystack. Ensure what you add, and how, is backed by research."

## What gets built

| Piece | Who uses it | What it does |
|---|---|---|
| **Orders board** `/orders` | Owner, counter, dispatcher, accountant | Every open order with one plain stage, the customer, the money and the delivery. Book a delivery: address, landmark, contact, date, time of day, and a pin on the map. Send the tracking link by WhatsApp |
| **Customers** (a tab on `/orders`) | Same | Find a customer; see orders, spend, what they owe; log a call, WhatsApp, visit or note; set a follow-up with a due date. "Due today" sits on top |
| **Give to a rider** (on `/stock`) | Storekeeper, dispatcher | For a booked delivery the pack list's button becomes "Give to a rider": pick the rider, scan the serials, done. No sale is booked yet |
| **Rider** `/rider` | Driver | Today's drops: who, where, the landmark, call, directions in Google Maps, the items. Confirm with the customer's 4-digit code, or record why it failed |
| **Tracking page** `/track?r=…` | The customer, from the private link | The stages, the date, the rider's name, the rider's last position on the map with "seen X min ago", the 4-digit code to give the rider, the items and what is still to pay. The customer can drop their own pin |

## Facts from the code (checked 25 Nov 2026)

- Today the stock room's "Hand over" calls `deliver_order` (`app/stock/page.tsx:334`), which books the sale at once through `i_deliver` (latest version `supabase/migrations/20261102000200_pos.sql:65`). Right at the counter. Wrong for a rider: goods on a bike are not delivered, and plan section 7 books revenue at delivery.
- `i_deliver` takes a serial only if it is `in_stock` at the order's shop (`pos.sql:125`). Nothing stops the counter selling a battery that is on a bike.
- The books check compares each serial product's shelf count with its `in_stock` units (`20261102000600_review_fixes.sql:158`). So a unit on a bike must stay `in_stock` until it is delivered. A new status would break the books.
- `expire_holds()` puts an order's goods back on sale when its hold runs out (`20261101000300_selling.sql:806`). A hold must never run out while the goods are out.
- `cancel_order` lets an unpaid credit order be cancelled while its goods are still on the shelf (`selling.sql:780`). While out with a rider it must be refused.
- Drivers cannot read `orders` (`20261101000400_security.sql:81`), so the receipt link token never reaches a rider's screen.
- `payment_method` already has `gateway`. Nothing uses it yet.

## Decisions, and the evidence for each

| # | Decision | Evidence |
|---|---|---|
| 1 | **Tracking lives on the shop's own page, opened from the receipt link. No account, no app.** | Baymard: order tracking is the most used self-service feature, and people want the delivery date, who is bringing it and each step, on the store's own page ([self-service research](https://baymard.com/research/self-service), [what a tracking page needs](https://baymard.com/guidelines/913-info-to-include-on-order-tracking-pages), [keep it on your site](https://baymard.com/blog/integrate-tracking-info)). Plan section 5: buying never needs an account |
| 2 | **One stage at a time, in plain words**: Placed → Paid → On the way → Delivered (pickup: Placed → Paid → Collected). A failed try shows its reason and the new date. Never "processing" | Same Baymard guideline: vague states make people call. Every stage is worked out from the money and goods records, so it can't disagree with them |
| 3 | **The sale is booked at the door, not when the goods leave.** Giving goods to a rider holds them: their count stays held for the order, each serial is locked to the order, the hold never runs out and the order can't be cancelled while they are out. A failed try puts them back on the shelf, still held for the customer | Plan section 7 (revenue at delivery) and the facts above |
| 4 | **The customer's 4-digit code confirms the drop.** Five wrong tries lock it. A dispatcher or the owner can confirm without the code, with a written reason the owner sees. No code is ever shown to staff | Evidence that codes cut false "delivered" claims is from vendors only ([iCarry](https://www.icarry.in/pages/blog/otp-verified-delivery-ecommerce.html), [eGrow](https://www.egrow.com/en/blog/shopify-cod-driver-otp-2026)), and a hard code gate causes failed drops when the customer can't find it. So the code is the normal path, with a logged way round. Plan section 4 asks for "customer's code" |
| 5 | **Addresses are words plus a landmark, a phone number and a pin.** No address search | Nigerian deliveries run on landmarks, phone calls and GPS pins ([NPR](https://www.npr.org/sections/goatsandsoda/2016/04/01/469980392/neither-rain-nor-snow-nor-lack-of-address-will-stop-these-deliverymen), [Quartz](https://qz.com/africa/1046438/google-maps-what3words-can-help-nigerias-konga-jumia-uber-and-taxify-reach-more-customers), [DHL Nigeria](https://www.dhl.com/discover/en-ng/e-commerce-advice/e-commerce-sector-guides/optimizing-nigerian-e-commerce-delivery)). The free OpenStreetMap search allows one request a second and forbids search-as-you-type ([Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/)) |
| 6 | **The map is MapLibre GL with OpenFreeMap tiles, recoloured to the shop's look, loaded only on the screens that show a map.** The style address is one setting (`NEXT_PUBLIC_MAP_STYLE`) | MapLibre is open source (BSD-3) and needs no key ([npm](https://npmjs.com/package/maplibre-gl)). OpenFreeMap is free with no key, given as is, with no promise of uptime and the right to stop without notice; its credit line must show, and its terms don't mention commercial use either way ([terms](https://openfreemap.org/tos/), [quick start](https://openfreemap.org/quick_start/)). So nothing depends on the map: every screen still works in words, and the style can be moved to a self-hosted copy ([source](https://www.github.com/hyperknot/openfreemap)) or a paid host by changing one setting. About 268 KB gzipped, so it loads only when a map is on screen |
| 7 | **The rider's position is the last point only, sent while the drop screen is open, shown as "seen X min ago", and wiped when the drop closes.** No trail is kept | A web page can't track in the background reliably once the phone locks ([Wake Lock and geolocation notes](https://reference.codeproject.com/dom/geolocation/navigator.requestwakelock)). Saying when it was last seen is honest. Keeping only the last point is the least personal data the feature needs |
| 8 | **Directions open Google Maps with the pin.** | Google's Maps URLs need no key and no account ([Maps URLs](https://developers.google.com/maps/documentation/urls/get-started)). Riders already use it |
| 9 | **Staff send the tracking link by WhatsApp click-to-chat, pre-written.** | Owner's decision, 1 Nov 2026 (plan section 9): no WhatsApp API. Telling people before they ask is widely said to cut "where is my order?" calls, but the figures are vendor figures and hard to verify ([Ship24](https://www.ship24.com/blog/why-common-wismo-statistics-are-hard-to-verify)). We build it because it is cheap and obviously useful, not because of a number |
| 10 | **The CRM is small on purpose**: notes and follow-ups on the customer record the shop already keeps, inside the screen staff already use. No pipeline, no stages, no scoring | Sales staff abandon CRMs mainly because they are slow and hard to use ([Nutshell survey](https://www.nutshell.com/blog/reasons-why-sales-reps-quit-their-crms), vendor survey). Plan section 6: the counter sees "customer history" |
| 11 | **No payment gateway now.** Cash, card on the shop's POS, and bank transfer confirmed by a second person keep working exactly as they do | Owner, 25 Nov 2026. See "Adding a gateway later" |

## Who sees what (unchanged from plan section 6)

- Counter, dispatcher, accountant: the board and customers, with phone numbers and money owed. Never cost or profit.
- Storekeeper: the pack list with "Give to a rider". The rider's name and the area, never a phone number or money.
- Driver: only their own drops while they are out: name, contact phone, address, landmark, pin, items and serials. No prices, no other riders.
- Customer with the link: their own order, the rider's first name, the code, the rider's last position while out.

## Adding a gateway later (not built)

When a buyer wants payments taken automatically, add Paystack or Flutterwave behind one small piece:

1. A route `app/api/pay/webhook/route.ts` reads the raw body and checks the signature (Paystack: HMAC SHA-512 of the raw body with the secret key, header `x-paystack-signature`; [Paystack webhooks](https://paystack.com/docs/v2/developer-tools/integration/webhooks)). Flutterwave: the `verif-hash` header against the shop's secret hash.
2. It then asks the provider's verify endpoint for the same reference, and only trusts that answer.
3. It calls one database function, `i_gateway_paid(reference, order, amount)`, run as the service role, which records a `gateway` payment once per reference (the reference is the client key) and posts it like a confirmed transfer.

Nothing else changes: the board, tracking, delivery and the books already treat a confirmed payment the same whatever its method.

## Not in this pass

- Pay on delivery and the rider's cash (plan 3.4). Until then a drop needs the order paid, or on approved credit, before it leaves.
- Photo proof (needs the R2 account). Delivery fee rules and vehicle advice (plan 3.1). Trips with several stops (plan 3.2); the rider sees their drops in date order.

## Chances (my estimates)

| Claim | Chance | If wrong |
|---|---|---|
| Riders use the code at most doors | 70% | The owner sees the overrides and their reasons, and can make the code optional |
| OpenFreeMap stays up and free through the first year | 80% | Change `NEXT_PUBLIC_MAP_STYLE`; the screens work without a map meanwhile |
| A goods-on-the-bike double sale is impossible through any screen | 95% | Rule scenes below cover the counter, transfer, cancel, hold expiry and the stock room |
| Customers drop a pin when asked over WhatsApp | 50% | The rider calls, as today |

## Pre-mortem: it failed. Why?

- **A rider marks a drop done without going.** The code is only on the customer's page; overrides need a dispatcher and a reason; the event log names who did it.
- **A battery is sold twice.** Covered by decision 3 and its scenes.
- **The map breaks the page or its weight.** It loads only when shown, and a failed map leaves the words.
- **Riders' phones die from position sharing.** Positions are sent at most every 30 seconds, and only while the drop screen is open.
- **The counter treats the CRM as extra work.** Logging a call is one tap from the customer, and follow-ups show where they already look.

## Steps

| Step | Done when |
|---|---|
| 1. Migration `20261125000000_tracking_crm.sql` | Rule scenes pass on PGlite and real Postgres, races still pass, books agree after every scene |
| 2. Error words for every new error name | `scripts/check-errors.mjs` passes |
| 3. `/orders` board and customers | Book, send link, note, follow-up, all tried in the browser |
| 4. Stock room "Give to a rider", `/rider`, `/track` with the map | A full drop in the browser: book, pin, give to rider, code, delivered, books agree |
| 5. e2e steps, progress note, plan sections 8 and 9 updated | e2e passes except the unrelated energy work in progress |
