# Power Store: product and build plan

Written 1 Nov 2026. "Power Store" is a working title. Status: the money and stock database is built and tested on a laptop (see `2026-11-01-phase-1-core.md`). There are no screens wired to it yet, nothing is deployed, and no business has been chosen. Day-to-day progress is in `docs/progress.md`.

All naira amounts here are made-up examples, not real prices. Weights and service intervals are typical figures for the business to correct, not facts about their stock.

---

## 1. What industry is this?

**Industry: power and energy equipment distribution.** These are dealers and distributors. Many in the trade also install, but the businesses this is for only sell (owner confirmed, 1 Nov 2026).

The international procurement code (UNSPSC) puts all of it in one place: **Segment 26, Power Generation and Distribution Machinery and Accessories**. That segment has a group literally named "Batteries and generators and kinetic power transmission", and UN tenders file solar equipment under the power generation family in the same segment. I took these codes from procurement lists and did not check the official UNSPSC browser.

| What they sell | Trade name for that category |
|---|---|
| Solar panels, inverters, solar batteries, charge controllers | Solar PV and energy storage |
| Car batteries | Automotive aftermarket |
| Power transmission: bearings, belts, chains, couplings, gear reducers | Mechanical power transmission, part of industrial maintenance supplies |

**"Power transmission" here means bearings, belts and chains** (owner confirmed, 1 Nov 2026), plus related parts such as couplings and gear reducers. Transformers and grid cables are out.

This side behaves differently from solar, so the plan treats them as two kinds of goods in one system. This table is my understanding, to confirm in the shop:

| | Solar and batteries | Bearings, belts, chains |
|---|---|---|
| Who buys | Households, installers, businesses | Factories, workshops, mechanics |
| Why | A planned purchase, often large | Often a stopped machine, so speed comes first |
| How they ask | "What can run my house?" | A part number, the old part, or its size |
| Range | Tens to hundreds of products | Can be thousands of near-identical parts |
| Tracking | Per unit, by serial number | By count or length; usually no serial per unit |
| Warranty | Long, and central to the sale | Often none, since these parts wear out by design |
| Why they return | Batteries age, systems need service | The same part wears out on the same machine |
| Delivery | Heavy and planned | Mostly small and urgent; gear reducers can be heavy |

**Is there really no tool for this?** I could not confirm that. My search results on Nigerian tools were too generic to rely on. My own judgement, unverified: Odoo and Zoho can be configured to do much of the back office, so they are the real alternative. What they will not give out of the box is the sizing, the delivery advice, the warranty record per unit and the reminders, and someone has to pay an implementer to set them up. We win on being simple and built for exactly this trade.

---

## 2. What we are building

**One business's own store and its whole back office, in one system.** Same shape as Nazia Botanics: one owner, one brand, their own site. It is not a platform.

If a second business wants it later, they get their own copy with their own database, settings and branding. No shared accounts between businesses, so no `tenant_id` anywhere.

**The loop the whole product is built around:**

```
Customer's need → Sizing or part search → Quote → Money in → Goods out
      ↑                                                          ↓
  Next sale  ←  Reminder  ←  Warranty record  ←  My System or My Machines
```

Most stores end at "delivered". This one is just getting started there. The reminders are what bring the customer back, and the record of what they own is what makes the reminders accurate.

---

## 3. Why this is not Nazia with more features

Nazia sells a ₦15,000 bottle: pay once, one rider, done. This trade is different in seven ways, and each one shapes the design.

| # | The reality | What it forces |
|---|---|---|
| 1 | The buyer doesn't know what to buy. They know "my fridge and two ACs must run at night". | Sizing, car-fit lookup and part-number search come before browsing |
| 2 | Prices move with the dollar. | Cost held in dollars, one-screen repricing, quotes that expire |
| 3 | Money arrives in pieces, mostly by transfer, often on credit. | Money is tracked separately from the order; a debtors book |
| 4 | Goods are heavy, long, fragile or hazardous. A 200Ah tubular battery is about 60 kg. A 550W panel is about 2.3 m long. | A flat delivery fee is wrong; the tool has to advise the vehicle |
| 5 | Every unit is an individual, with a serial number and warranty. | Tracking per unit, not just a count |
| 6 | Products wear out on a fairly predictable schedule. | Know what each customer owns, and remind them |
| 7 | A stopped factory machine can't wait, and the part it needs looks almost identical to hundreds of others. | Search by number or size, safe substitutes, a fast lane for urgent orders |

**One sale has two separate tracks.** Example: a ₦4,800,000 order. ₦3,000,000 is paid so far. The inverter and panels are delivered. Two batteries are on backorder. A single order status cannot say that, so each order carries **money** and **goods** tracks that move independently.

---

## 4. Real life, and what the tool does

The "real life" column is my understanding, not something I watched. Section 13 is how we check it. Items marked **(P2)**, **(P3)** and so on arrive in that build phase.

### Enquiry and quote

| Real life | What the tool does |
|---|---|
| "What can run my house?" A salesperson estimates from experience | **System calculator (P2):** count appliances and hours of backup, get the right system from real stock at today's price. Counts motor start-up surge, usable battery depth (lead-acid is roughly half of lithium) and sun hours. Ends in buy, save quote, or WhatsApp us. Staff check it before the final price, and the customer can share the parts list with their own installer. It says clearly that it is a guide and that it does not connect to any appliance |
| "Which battery fits my 2012 Camry?" | **Car-fit lookup (P2):** a table the shop owns and edits |
| A customer quotes a part number, written any way | **Part search (P1 for staff, P2 online):** "6205 2RS", "6205-2rs" and "62052RS" all find the same part, in every brand and price level in stock |
| The number has worn off and they only have the old part | **Size search (P1 for staff, P2 online):** measure it and type the size. 25 × 52 × 15 mm finds the 6205 family. Includes a simple how-to-measure guide, or send a photo on WhatsApp and staff identify it |
| The exact part is out of stock | **Substitutes (P1):** marked either "same part, other brand" or "fits but differs, ask us". A sealed bearing and a shielded one are not the same, so only staff can offer the second kind |
| Parts get forgotten: rails, breakers, cable, connectors | **Completeness check (P1 for staff, P2 online):** "You have a 48V inverter and two 12V batteries. It needs four." Works like the shop's best salesperson looking over your shoulder |
| Proforma sent by WhatsApp, price good for a few days | **Quote (P1):** PDF plus link, with an expiry date and versions. The customer accepts and pays the deposit from the link (P2) |
| Haggling, where staff may give away margin | **Discount limits (P1):** within limit is instant. Above it, the owner approves with one tap on their phone. It warns before selling below cost |

### Pricing

| Real life | What the tool does |
|---|---|
| The dollar moves, and someone reprices by hand or forgets | **(P1)** Owner enters the new rate and sees: "142 products go up, 3 now fall below your margin." One tap applies it. Open quotes keep their price until they expire |
| Different prices for walk-ins, installers and big buyers | **Price lists (P1):** retail, installer, trade, project. Each customer sees only their own |

### Money

| Real life | What the tool does |
|---|---|
| Large sums come by transfer. Bank limits mean it arrives over several days, sometimes from a relative or a company | **Payments stay separate from orders (P1):** one payment can cover several invoices, one invoice can take many payments, and any overpayment becomes credit |
| **Fake credit alerts** | **(P1)** A payment counts only when the gateway confirms it or a named finance person ticks it against the bank. Goods don't leave on a screenshot. An owner override is possible and is logged |
| The debt notebook | **Who owes us (P1):** age of each debt, credit limits, a statement sent by WhatsApp link |
| Install now, pay in parts | **Instalment plans (P2):** schedule, reminders, overdue list. Run by the shop itself; no outside lender in this version |
| Cash, POS and transfer all mixed up by evening | **Daily cash-up (P1):** each till is counted against what the system expects. Any shortage is recorded and shown to the owner |

### Stock

| Real life | What the tool does |
|---|---|
| Stock sits in the shop, the warehouse, a van, or away for repair | **Locations (P1):** nothing is ever "edited". Every change is a recorded move with who and why, so missing stock can be traced |
| Serial numbers exist but aren't recorded | **(P1)** Scanned or typed at receiving and at sale, per unit. Chain and cable go by the metre or box, bearings and belts by count, so tracking is set per product |
| Lead-acid batteries lose charge on the shelf; old stock gets forgotten | **(P1)** The picker is told which unit to take, oldest first. "Charge check due" tasks appear for shelf stock. A dead-stock list shows what isn't moving |
| Theft and "miscounts" | **Blind counts (P1):** the counter doesn't see the expected number, and differences need owner approval |
| Counterfeits are a real problem in this market | **Public serial check (P2):** type a serial and see "sold by us, warranty until March 2028". No customer details shown. Bearings and belts usually have no serial per unit, so the shop records the supplier and lot instead, and the invoice shows them |

### Delivery and dispatch (P3)

| Real life | What the tool does |
|---|---|
| Someone guesses which vehicle | **Delivery advice** from weight, size, fragility, hazard and distance. One car battery nearby: bike. Two tubular batteries and an inverter: van and two people, batteries upright. Twelve panels: long-bed vehicle, strapped on edge. It shows its reason and cost. The dispatcher can override, and we keep the reason so the rules improve |
| A factory calls: "the machine is down" | **Machine-down lane:** marks the order urgent, finds the part or a substitute, and puts it at the top of the packer's list and the dispatch board. Usually a bike, right away. The shop can set an urgent fee |
| Heavy items can't take a flat fee | Instant fee when the rules are certain, otherwise "we'll confirm before you pay" |
| Goods to another state go through a motor park or courier | **Waybill record:** driver, phone, photo of the waybill, pick-up code. Courier integration comes later if volume justifies it |
| Customer collects, or sends a driver | Name, phone and pick-up code recorded before release |
| Part delivery, several drops, failed trips | Dispatch board, trips with stops, part delivery, failed reason. Unsold goods return to stock as a recorded move |
| "Did it arrive?" arguments | Customer's code plus photo (already built in Nazia), and a waybill listing the serials |
| Driver collects cash | Each driver has a running cash balance until handed in. Fuel and trip costs are logged, so we can see delivery cost against what was charged |

### After the sale (P4)

| Real life | What the tool does |
|---|---|
| Customers lose receipts, and warranty becomes an argument | **My System page:** every unit, serial, sale date, warranty countdown and who installed it, if known. Created automatically at sale, including for walk-in customers. They receive a link |
| A factory buys the same belts every few months, and someone reads the numbers off the machine each time | **My Machines page:** staff or the customer list each machine and its parts, such as "Line 2: 3 × A42 belts, 2 × 6205-2RS bearings". Reorder that machine's parts in one tap |
| Nobody reminds anyone until it fails | **Reminders** (rules the shop sets): water check on flooded batteries, panel cleaning before harmattan, car battery check after about 18 months, warranty ending in 30 days, belt or bearing change at an interval the customer sets |
| "My backup used to last 8 hours" | **Health check:** a 2-question message. If backup has dropped a lot, it offers a bring-in test or a replacement with trade-in value already deducted |
| Sales staff have nobody to call | **Call list:** "27 customers' batteries reach replacement age in the next 3 months." The same numbers feed reorder planning |
| Warranty claims live in WhatsApp chats, and the shop never saw how the unit was fitted | **Claim flow:** fault report, who installed it, photos of the set-up, test, decision with reason, loan unit if needed, claim back to the supplier, with stock and money updated automatically |
| The customer has the goods and asks "who will fit this?" | **Installer list:** independent installers the shop trusts, with a WhatsApp link and the parts list to share. The shop doesn't run the job or handle money for it |
| Old batteries are traded in | **Trade-in:** credit to the customer, scrap stock recorded, sale to the recycler recorded |

### Buying (P5)

| Real life | What the tool does |
|---|---|
| Container in dollars, then clearing and haulage | Purchase order, goods received, and **true cost per unit** with shipping and clearing shared across items. Before this phase, the owner enters cost directly |
| "Do we need to order?" | Reorder advice from sales speed, supplier lead time, open quotes and the coming replacement wave |
| Paying suppliers late or twice | **Who we owe:** supplier bills and payments |

---

## 5. Customers

**Buying never requires an account.** Every sale, even a walk-in cash sale, records a phone number. When that person opens the private link on their receipt, or signs in by email, their orders and equipment are already there. Asking people to register up front mostly fails, so we build the record first and invite them after.

| Kind | Gets |
|---|---|
| **Guest** | Order tracking link, serial check, warranty by serial |
| **Personal account** | My System, reminders, one-tap reorder, statements, instalments, longer price hold on quotes |
| **Installer or mechanic** (approved by the shop) | Trade prices, credit limit, quotes for their own clients, buying a parts list per job |
| **Factory, business, estate, NGO** | Several users and sites, My Machines, purchase order upload, VAT invoices, credit terms, statement of account |

Since these shops don't install, installers are probably among their most valuable customers, because each one can bring repeat buyers. To confirm in the shop.

Better prices and free checks for higher 12-month spend can be added later. No points system: it adds complexity, and it creates a debt on the books.

---

## 6. Who uses it

One focused mini-app per role, the approach that worked on Nazia and Gleey. All are installable web apps, no app store.

| Role | Sees | Must never see or do |
|---|---|---|
| **Owner** | "What needs me today", approvals, money, exceptions, everything | |
| **Counter or sales** | Sell, quote, take payment, customer history | Cost, profit; delete a sale |
| **Storekeeper** | Receive, pick, count, transfer | Money |
| **Dispatcher** | Board, advice, trips | Cost, profit |
| **Driver** | Today's trips, proof, cash | Other drivers |
| **Tester** (if they have one) | Returned units, test results for warranty claims | Cost, profit |
| **Accountant** | Books, reports, exports | Changing stock |

**The rules that keep it easy:**
- The first screen answers "what needs me?", not a dashboard of charts.
- A counter sale takes under 30 seconds on a cheap Android, measured.
- Plain words: "who owes us", never "accounts receivable". Accounting words appear only in the accountant's view.
- Nothing is deleted. Mistakes are reversed with a reason.
- Excel in and out wherever a list exists.
- Practice mode with fake data for training staff (Nazia already has the idea: `components/admin/practice-data.tsx`).
- Clean, smooth, semi-glassy and smart, as a serious business should look (section 15). The counter favours speed over decoration, with speed proven on low-end phones.

---

## 7. The ledger

Real double-entry bookkeeping underneath, invisible unless you ask to see it. Staff just do their work, and each action writes its own balanced entries.

**Example.** On Monday a customer pays a ₦2,000,000 deposit. That is not a sale yet: the bank goes up and "goods we owe customers" goes up by the same amount. On Thursday the goods are delivered: that ₦2,000,000 becomes a sale, the cost of those goods leaves stock, and the profit appears on Thursday. The owner never sees a deposit mistaken for profit.

| Event | Handled automatically |
|---|---|
| Sale, deposit, delivery, refund, credit note, trade-in | Yes |
| Supplier bill and payment, shipping and clearing | Yes (P5; direct cost entry before that) |
| Expenses (with receipt photo), owner withdrawals, moving cash to bank | Yes |
| Stock write-off, warranty replacement, count difference | Yes, after approval |
| Driver cash, till shortage or overage | Yes |

**Owner's view:** money in and out today by channel, who owes us, who we owe, stock value, this month's profit.
**Accountant's view:** profit and loss, balance sheet, VAT summary, full export (full set in P5).

**Rules that can't be broken, enforced in the database:**
- Every transaction balances, or it is refused.
- Entries are never edited, only reversed.
- A closed month stays closed.
- Invoice numbers run in order with no gaps.
- Two people for risky actions: refunds, write-offs, credit limit increases, large manual payments.
- One true set of books.

Out of scope: payroll (salaries are recorded as an expense) and filing taxes.

---

## 8. Decisions already made

| Decision | Why |
|---|---|
| One business per deployment, no tenant code | You said this is not a platform. It also removes a whole class of data-leak risk |
| **Back office ships first, the store second** | The store can only tell the truth about stock and price if the back office already does. A quick catalogue with "request a quote" can go live with Phase 1 |
| Two tracks per order: money and goods | See the ₦4,800,000 example in section 3 |
| No jobs, crews or site surveys in the system | These businesses only sell (owner, 1 Nov 2026). Installers are customers, so they get good accounts instead |
| Money and stock are both append-only records | That is how theft and errors get traced |
| All money stored as `bigint` kobo | See section 10; Nazia's `integer` tops out at ₦21.4M |
| Customers are identified by phone, email optional | Many trade customers don't use email |
| Serial tracking and warranty are set per product, not forced on everything | Bearings and belts usually have no serial per unit, and scanning each one would make the counter unusable |
| Moving average cost per product | Simple, and an accepted accounting method. To confirm with the accountant |
| Sell in naira only, hold cost in dollars or naira | Matches the trade; multi-currency selling isn't needed |
| Installable web apps, no native apps | One codebase, and it already worked for Nazia's rider app |
| Flutterwave first, behind one payment interface | Nazia's working webhook is reusable. It can change if the probe fails (section 12) |

---

## 9. Stack

Only what this project is proven to need.

| Need | Choice | Note |
|---|---|---|
| App | Next.js 16, React 19, Tailwind 4, TypeScript, zod, zustand, motion | Same as Nazia. Read `node_modules/next/dist/docs` before using Next APIs (`proxy.ts`, async params) |
| Data | Supabase Postgres, Auth, Storage, Realtime | Money and stock rules live in database functions with row locks, not in the app |
| Hosting | Vercel Pro ($20/month), Supabase Free to start | The owner's budget decision, 1 Nov 2026. Vercel's Hobby plan bans commercial use, so Pro is needed. See "Running costs" below for what keeps Supabase Free safe |
| Backups | Our own encrypted database dump every 6 hours, to Cloudflare R2 | Supabase Free has no automatic backups, so this is required, not optional. Gleey's `sim/db-backup.mjs` is the pattern. A restore must be tested before go-live |
| Photos and files | Cloudflare R2 (10 GB free, no download fees) | Delivery, damage, receipt and product photos, compressed. Keeps them out of Supabase's 1 GB |
| Payments | Flutterwave, plus recorded manual transfers, POS and cash | Paystack is the fallback |
| Messages | Resend email, plus WhatsApp click-to-chat links that staff tap and send | Owner's decision, 1 Nov 2026: no WhatsApp Cloud API for now. See "Reminders without the API" below |
| Maps | Mapbox | Reuse Nazia's pin and live rider maps |
| Documents | `@react-pdf/renderer` for A4 quotes, invoices and waybills; browser print for receipts | Printer probe in Phase 0 |
| Scanning | USB scanner (types like a keyboard), phone camera (`BarcodeDetector`, with a zxing fallback) | Probe in Phase 0 |
| Search | Postgres `pg_trgm`, normalised part numbers, indexed size fields | No search service needed unless the range proves far larger than expected; test on their real list |
| Jobs | Vercel Cron plus an outbox table | Gleey's `notification_outbox` and its guard stop test data from messaging real people |
| Protection | Upstash rate limits, Turnstile on public forms | Wired from day one |
| Monitoring | Sentry, PostHog | Wired from day one. Nazia left these unfinished |
| Tests | PGlite edge tests, real Postgres race tests, Playwright e2e | Gleey's `sim/` setup. Run `node ~/.claude/tools/dev-clean.mjs --yes` afterwards, per the laptop rule |

**Running costs (owner's budget decision, 1 Nov 2026): free wherever quality survives it.** Limits checked 1 Nov 2026 on each vendor's site, except Mapbox, Sentry and PostHog, which were not rechecked. Upstash's figure comes from its blog and third-party sites.

| Service | Pays | What the free plan gives |
|---|---|---|
| Domain | Yearly fee | |
| Vercel Pro | $20/month, includes $20 of usage | |
| Supabase | Free | 500 MB database, 1 GB files, 5 GB uncached data out a month, 2 projects, no backups, pauses after a week of low activity |
| Resend | Free | 3,000 emails a month, 100 a day, resets midnight UTC, 3 domains |
| Cloudflare R2 | Free | 10 GB, no download fees |
| Upstash | Free | 500,000 commands a month |
| Mapbox, Sentry, PostHog, Turnstile | Free | Limits not rechecked today |
| WhatsApp | Free for now | Click-to-chat links only. The Cloud API is on hold by the owner's decision, and would cost about $0.0067 per reminder (third-party figure) |
| Flutterwave | Per transaction | Only when the shop earns |

**How long Supabase Free lasts.** Measured on 1 Nov 2026 by simulating 90 days of a shop on real Postgres (`sim/simulate.mjs`): **6.6 KB per sale at 30 sales a day, 5.8 KB at 100.** That covers lines, stock moves, ledger entries, payments and audit history. The catalogue of 1,540 products with opening stock came to 12.8 MB, including Postgres's own system tables.

Plan on **10 KB per sale**, not the measured figure, because deliveries, reminders, returns and warranty claims aren't built yet and will add to it. Supabase's own auth and storage tables also aren't measured, so I'm keeping my earlier 60 MB estimate for the starting size until a real project can be checked. Upgrading at 400 MB leaves about 340 MB to fill.

| Sales a day | Grows by (10 KB per sale) | Reaches 400 MB in about | At today's measured rate |
|---|---|---|---|
| 15 | 4.4 MB a month | 6 years | 9 to 10 years |
| 30 | 8.8 MB a month | 3 years | 5 years |
| 100 | 29 MB a month | 12 months | 18 months |
| 300 | 88 MB a month | 4 months | 6 months |

Photos go to R2, so they don't count here. Re-measure with `node simulate.mjs 30 90` whenever the schema grows.

**Move to Supabase Pro ($25/month) when any of these happens:** the database reaches 400 MB; data out passes 4 GB in a month; the shop drops its paper records and relies on this alone; or a lost few hours of records would cost more than $25 a month.

**What Free gives up, even with our backups:** up to 6 hours of records could be lost in a disaster, restoring is manual, and there is no vendor support. If a quiet week pauses the project, the store stays down until someone restores it, so a daily check must keep it active and alert us if it pauses.

**Free-tier rules for the build:**
- Each shop gets its own Supabase account in the shop's name, so it owns its data and has its own 2 free projects. Production and staging use both.
- Photos go to R2, never into Supabase.
- Pages cache on Vercel so browsing doesn't hit the database each time.
- Reminder emails go through the outbox and spread across days to stay under 100 a day, leaving room for order emails.
- Supabase login emails go through Resend, since its built-in email is for testing only (from memory; confirm in step 1.1).

**Reminders without the API (owner's decision, 1 Nov 2026).** Nothing goes out on WhatsApp by itself, so reminders work like this:

| Channel | How it works | Who it reaches |
|---|---|---|
| Email | Automatic, through Resend | Only customers who gave an email |
| My System and My Machines pages | What's due always shows there | Customers who open their link |
| Staff call list | Who is due today. One tap opens WhatsApp with the message written, and staff press send | Everyone with a phone number, at the cost of one tap each |

- **Staff do the sending, about 3 taps per customer:** Open WhatsApp, send, then "Yes, sent". 27 customers due means about 81 taps, from the shop's own WhatsApp. The system can't see WhatsApp, so a reminder only counts as done when staff say it was sent.
- **Highest value first, capped at 30 a day.** Quotes and instalments come first, then replacements, then service. The rest wait for tomorrow. 30 is my judgement, not a WhatsApp rule, so the owner can change it.
- **Keep it personal, to protect the shop's number.** Sending many similar messages from one WhatsApp number can get it flagged. I did not check WhatsApp's exact limits, so each message is written for that customer, every one offers "Reply STOP", staff can edit it, and "Stop reminders" takes the customer off for good. Ask at the sale whether they want reminders, and have a lawyer confirm the wording under Nigeria's data protection law.
- **Replies set the next step.** Wants it opens a sale, Not now reminds again in 3 months, Already done updates their record, Wrong number goes back to the counter.
- **Customers with an email** get theirs automatically and only join the list if they haven't replied in a week.
- **Customers sign in by email or their receipt link.** Confirming a phone by code needs a paid SMS or WhatsApp service, so it waits. Each receipt carries a private link to that customer's orders and equipment.
- **Delivery codes** appear on the receipt and order page, go by email if given, and staff can send them with one tap.
- **Revisit the Cloud API** if staff are sending more than about 30 reminders a day, or if the call list is regularly left undone.

**Deliberately not used:** separate backend, native apps, Redis as a data store, a search service, a queue service, AI features, lender integrations, inverter-monitoring integrations. Any of these can be added if real use asks for it.

---

## 10. What we reuse, and what we must not copy

**Reuse:**

| From | What | Where |
|---|---|---|
| Nazia | State machine enforced in the database | `supabase/migrations/20261006000000_init.sql:307` (`order_transition_allowed`), `:321` (`advance_order`) |
| Nazia | Delivery code proof | `init.sql:248`, checked at `:337` |
| Nazia | Webhook that re-verifies with Flutterwave before acting | `src/app/api/webhooks/flutterwave/route.ts` |
| Nazia | Rider app, live map, swipe board, role-based admin | `src/components/rider/`, `src/components/orders/live-rider-map.tsx`, `src/components/admin/order-board.tsx` |
| Gleey | Balanced ledger: three tables, plus a trigger that refuses any unbalanced transaction | `supabase/migrations/20261015000000_core.sql:277-317` |
| Gleey | Outbox with test-data guard | `core.sql:451`, `:463` |
| Gleey | Edge and race test setup | `sim/edge.mjs`, `sim/race.mjs`, `sim/testpg.mjs`. Gotcha: write `$n::text::jsonb` in race tests |
| Gleey | Planning standard | `.claude/skills/gleey-plan/SKILL.md`, which this plan follows |

**Do not copy from Nazia. Each of these breaks in this trade:**

| In Nazia | Why it breaks here |
|---|---|
| Money columns are `integer` kobo (`init.sql:67`, `:228-231`) | Maximum is ₦21,474,836. A commercial solar order can exceed that. Use `bigint`, like Gleey |
| Order quantity limited to 1–50 (`init.sql:270`) | A project order can be 200 panels or 500 m of cable, and quantities can be fractional |
| `customers.email` is required and unique (`init.sql:196`) | Customers are phone-first |
| One order status (`init.sql:13`) | Needs separate money and goods tracks |
| Stock is a number that gets edited (`20261006000100_stock.sql`) | No trail, so theft can't be traced |
| Stock is taken only after payment, and a shortage is just logged (`stock.sql`) | We can't oversell a ₦3M battery bank. Stock must be reserved at deposit, with a time limit |
| Only the first batch is remembered when an item spans batches (`stock.sql`, the `coalesce(batch_id, …)` update) | Loses which unit went where. Here every unit is tracked |
| Flat delivery fee per zone (`init.sql:159`) | Weight and size decide the vehicle and the fee |

---

## 11. Skeleton: tables by area

- **People:** staff profiles and roles, customers (phone-first), customer sites, suppliers, trusted installers
- **Catalogue:** product families (each with its own fields per trade), products, units, kits, compatibility rules, car fitments, part sizes, part equivalents (same part, or fits but differs), warranty terms (including none), price lists, exchange rates, price changes
- **Stock:** locations, `stock_movements` (append-only), balances, serial units, date-coded lots, reservations, counts
- **Selling:** quotes and versions, orders and lines, invoices, credit notes, returns, trade-ins, approvals
- **Money:** payments, payment allocations, instalment plans, credit limits, `ledger_accounts`, `ledger_txns`, `ledger_entries`, tills and cash-ups, expenses, bank lines, closed periods, document numbers
- **Delivery:** vehicles, drivers, delivery rules, shipments, trips and stops, proofs, driver cash, outside waybills
- **After-sale:** customer equipment, customer machines and their parts, service rules, what's due, reminders, warranty claims, loan units, complaints
- **Buying:** purchase orders, goods received, landed costs, supplier bills and payments, supplier claims
- **System:** audit log, outbox, settings

Row-level security on every table. Staff-only columns such as cost are never readable by counter staff or customers.

---

## 12. Facts, assumptions and probes

**Checked:**
- Standard VAT is 7.5% under the Nigeria Tax Act, in force since 1 Jan 2026.
- E-invoicing (NRS Merchant Buyer Solution) is being phased in by size. Large taxpayers (₦5bn+) had until 31 Jul 2026. Dates for medium (₦1bn–₦5bn) are inconsistent across sources. Under ₦1bn joins later, with full adoption targeted for January 2028. So we keep the required invoice fields ready and add the connection only when the business's tier requires it.
- Flutterwave and Paystack both offer virtual accounts with a webhook on each transfer. Flutterwave's one-time accounts expire. Paystack's dedicated accounts need customer consent and personal details, default to 1,000 accounts, and cost 1% capped at ₦300.
- Counterfeit and substandard solar goods are an active problem, including enforcement action at Alaba in June 2026.

**Weakly sourced, recheck before relying on them:**
- Local card fees of about 1.5% + ₦100, capped at ₦2,000. Most of those sources sell integration work, and one conflicts on the cap.
- WhatsApp utility messages for Nigeria at about $0.0067 each and marketing at $0.0516, from 1 Oct 2026 (third-party copy of Meta's rate card).
- WhatsApp verification: a new, unverified business can reportedly message up to 250 different customers in 24 hours. Sources disagree on what it takes to go above that, and Meta's own current page should be checked before relying on it. Verification, if ever needed, is reported at 1 to 5 business days, on the shop's own papers.

**Not settled:**
- **VAT on solar equipment.** An older order exempted renewable components, but a 2026 policy brief is still asking for a waiver. So VAT is set per product and the accountant confirms.
- **Whether charging interest on instalments triggers consumer-lending rules, and any rules on storing or handling scrap batteries.** I did not check these. Ask a lawyer before offering them.

**Assumptions (all probabilities are my judgement, not measured):**

| Assumption | Chance | Cheapest test |
|---|---|---|
| The business is in Nigeria and sells in naira | 90% | You confirm |
| Bank transfer is the main route for large sums | 85% | Count last month's receipts |
| Staff will actually record everything on a busy day | **50%** | Timed trial at the counter before building further |
| Flutterwave one-time accounts handle paying short, over, late and twice | 50% | Test-mode script. If not: an account per customer, or Paystack |
| Browser printing works on their printer | 60% | Try it on their hardware |
| Phones can read the serial barcodes on real units | 65% | Scan 20 real units |
| Calculator output matches what their best salesperson would recommend | 60% | Size 10 real enquiries both ways; need 8 within one size |
| Installers will order through an account, not only by WhatsApp | 60% | Ask 3 of their installers on the shop day. WhatsApp orders go into the same system either way |
| Delivery advice matches a dispatcher's judgement | 70% | Run 30 past deliveries; need 25 |
| Staff keep up with the reminder call list | 50% | Count how many are sent against how many are due, in the first month |
| Customers will sign up if we ask up front | 40% | Already designed around this: the record comes first |
| They have a usable list of their bearing, belt and chain range | 40% | Ask on the shop day. If not, import what sells most first and add the rest as parts get sold |
| Search by number or size finds the right part | 80% | 30 real requests from the counter; need 28 |
| Factories will order these parts online without calling | 50% | Track after launch. Phone and WhatsApp orders go into the same system either way |

**If this failed a month from now, the likely reasons are:**
1. **Staff go back to the notebook when the shop is busy.** Counter speed is a measured requirement. Nothing leaves without a system waybill. The owner's reports come only from the system. Two weeks side by side at go-live.
2. **Opening numbers are wrong and the owner stops trusting it.** A proper go-live count and a debt review with the owner, sign-off, then a fixed starting date.
3. **We build everything and the shop uses nothing.** Each phase must be in real daily use before the next one starts.

---

## 13. Build steps

Time estimates are my judgement, about 14 weeks in all. **Each gate is real use in the shop, not a finished feature list.** Every database change runs the full edge and race tests. Migrations go first, then code.

**Order changed on 1 Nov 2026.** This plan said no code before the shop visit. The owner said "proceed" without naming a shop, so the parts that are the same for any shop are being built first, on a laptop, with no accounts or spending. **Phase 0 is still required before go-live**, and it can still change catalogue fields, limits, settings and screens. Build work continues in OpenCode with DeepSeek V4 Pro (`docs/opencode-handover.md`), one item at a time from `docs/progress.md`.

### Phase 0: Shop truth, about 1 week, required before go-live

| # | Step | Proof it worked | If it fails |
|---|---|---|---|
| 0.1 | **You** spend a full day in one shop, using the checklist below | Filled checklist, photos of real invoice, waybill, debt book, price list | That shop says no: try another. Prefer one that gives credit, since that is the hardest case |
| 0.2 | Flutterwave test-mode probe: short, over, late, twice | Written result per case | Per-customer accounts, or Paystack |
| 0.3 | Printer and serial scanning probes on their hardware | Result table | A4 PDF first; a small print helper on the counter PC |
| 0.4 | 10 real enquiries through a spreadsheet version of the calculator, compared with their best salesperson | 8 of 10 within one size | Fix the maths, or the calculator only collects the load and a person quotes |
| 0.5 | One hour with an accountant: VAT per product, deposits, cost method, e-invoice tier | Written answers | Keep it configurable and flag it |
| 0.6 | Update this plan with what changed | Plan edited, changes listed | |

**Shop checklist:**
1. Follow one sale from first enquiry to money banked, and photograph every piece of paper.
2. Share of walk-in, WhatsApp, phone and site sales.
3. How prices are set, how often they change, who can give discounts.
4. Last month's receipts by cash, POS and transfer.
5. Who owes money now, where it is written, how they chase it.
6. Terms given to installers.
7. Who fits what they sell? Do they recommend installers, and does any money change hands?
8. What vehicles? Who drives? How is fuel and cash handled?
9. How do goods reach other states?
10. Are serials recorded anywhere? How is a warranty proved today?
11. Warranty claims in the last 3 months. What do suppliers really honour? Who tests a returned unit, and how do they decide whether the product or the fitting was at fault?
12. Trade-ins: what price, who buys the scrap?
13. Last stock count. What goes missing, and where is stock kept?
14. How they buy: dollars, clearing, haulage. Do they know true cost per unit?
15. Phones, printers, internet and power at the shop.
16. **What cost them the most money in the last 6 months?**
17. Who will really be typing, and on what phone?
18. How many different bearings, belts and chains do they stock? Is there a list?
19. What happens when a factory calls with a stopped machine? How fast, at what price?
20. When the exact part isn't in stock, who decides a substitute is safe?

### Phase 1: Run the shop, about 4 weeks

| # | Step | Proof it worked | If it fails |
|---|---|---|---|
| 1.1 | Repo, staging and production, CI, test setup, encrypted backups every 6 hours to R2, daily check that alerts if the project pauses. **Needs your yes: Vercel Pro and domain** | Empty migration passes, deploy works, **a backup restores into a blank database and the numbers match** | Do not go live until a restore works |
| 1.2 | Catalogue by trade, units, price lists, Excel import, dollar repricing, part and size search, substitutes | Their real price list imports; a rate change previews correctly; 28 of 30 real part requests are found | Fix import against their file; improve how part numbers are cleaned up |
| 1.3 | Stock: locations, moves, serials, lots, reservations, counts | Balance always equals sum of moves; a serial is in exactly one place; 20 sellers race for the last unit and one wins | Stop; do not build on top |
| 1.4 | Ledger and automatic postings | Every event balances; reversals and closed months tested; simulated 90 days sums to zero; **measure real database size per sale and correct the running-costs table** | Stop; do not build on top |
| 1.5 | Counter sale, quote, invoice, receipt | Under 30 seconds on a cheap Android; a retry on bad network never double-records | Cut steps until it passes |
| 1.6 | Payments, part-payment, debtors, cash-up, expenses, approvals | Replay one month of their paper invoices; debtors match their book, with differences explained | Find out whether the bug is ours or the book's |
| 1.7 | Owner's "what needs me" screen, exceptions, audit, roles | Security test: counter login cannot read cost in any way | Fix before go-live |
| 1.8 | Public catalogue with "request a quote"; go-live count, opening balances, training | **Owner signs off after 2 weeks side by side. Needs the business's yes** | Stay side by side; fix what they found |

**Status, 1 Nov 2026.** Steps 1.3 and 1.4 are done at database level, and so is the database side of 1.5 (counter sale, invoice and receipt numbers), 1.6 and 1.7. Their proofs are in `2026-11-01-phase-1-core.md`, except those needing a real shop: replaying paper invoices, and timing a sale on a cheap Android. Quotes aren't built, nor are any screens.

### Phase 2: Store and accounts, about 3 weeks

| # | Step | Proof it worked |
|---|---|---|
| 2.1 | Full store with live stock and price, part and size search, car-fit lookup | "6205 2rs" and 25 × 52 × 15 both find the part; speed budget met on a low-end Android over 4G |
| 2.2 | System calculator | Same 10 enquiries pass; quick-tap tested on phones |
| 2.3 | Cart, completeness check, guest checkout, online quote acceptance, deposits | Deposit reserves stock; expired reservation releases it |
| 2.4 | Online payments | Duplicate webhook records once; short and over payments behave; forged webhook refused |
| 2.5 | Accounts by email or receipt link, past orders attached by phone number, installer and business types, instalment plans | Customer A can't see customer B; trade prices only after approval |
| 2.6 | Public serial check | No personal data shown; rate limited |

**Gate:** real online orders flowing through the same stock and books.

### Phase 3: Delivery and dispatch, about 2 weeks

| # | Step | Proof it worked |
|---|---|---|
| 3.1 | Weights and sizes, rules, advice, fee, machine-down lane | 25 of 30 past deliveries match the dispatcher; a timed urgent order beats their current time |
| 3.2 | Dispatch board, trips, part delivery, waybills with serials | A full week of real deliveries on the board |
| 3.3 | Driver app, reusing Nazia's | Code plus photo proof on real trips; failed trip returns stock correctly |
| 3.4 | Driver cash, motor park and courier waybills, cost against fee | A week of driver cash matches what was handed in |

**Gate:** nothing leaves the store without a system waybill.

### Phase 4: Warranty and reminders, about 2 weeks

| # | Step | Proof it worked |
|---|---|---|
| 4.1 | Customer equipment, My System and My Machines pages, installer list | Created automatically from a walk-in sale; customer opens it from the receipt link; a real factory's machine list reorders in one tap |
| 4.2 | Warranty claims, loan units, supplier claims | Replay of real past claims, with stock and books correct |
| 4.3 | Reminder rules, outbox, email reminders, staff call list with one-tap WhatsApp messages | Test data can never message anyone; opt-out stops everything; first reminder leads to a real conversation |
| 4.4 | Trade-ins and scrap | A real trade-in followed through to the scrap sale |

**Gate:** a reminder has produced a real sale.

### Phase 5: Buying and full books, about 2–3 weeks

| # | Step | Proof it worked |
|---|---|---|
| 5.1 | Purchase orders, goods received, true landed cost, supplier balances | One real shipment costed; owner agrees with per-unit figures |
| 5.2 | Reorder advice | Owner agrees with next order, or the reasons get built in |
| 5.3 | Bank statement import and matching | One month matched, with differences explained |
| 5.4 | Full reports, accountant export, e-invoice fields ready | **Accountant accepts one month-end from the system** |

### Done means

- The shop runs a full month with no notebook, and the accountant accepts its month-end.
- Stock, books and debtors tests all pass, with the numbers reported as they are.
- A reminder has produced a real sale.
- A second business can be set up from settings and data import alone, within a day.
- The owner has a plain guide listing every system that exists: what it does, who meets it, why it's there, how it's built.

---

## 14. Practical note

Claude's memory for this project is tied to this folder's path. If "New folder" gets renamed, move or mention it so the memory follows.

---

## 15. Look, flow and premium features

**Look (owner, 1 Nov 2026):** clean, smooth, semi-glassy and smart. Soft cool neutrals, frosted panels over real product images, one calm blue for actions, Geist type. A first "power cut" poster direction was rejected as looking like a game, so no gimmicks, characters or playful metaphors. Unique means smart function shown calmly. Nineteen working screens are on the [design canvas](https://claude.ai/artifact/AGKnE2jVvPXYXXSioFLHoC). Copies are in `design/screens/`, and their automated checks are in `design/checks/`.

- **Store:** home with live search, category with compare, product page, part page, system calculator, car battery finder, measure on screen, order from a list, machine stopped, bag and part payment, customer account.
- **Running the shop:** owner's today, counter sale and till close, stock room (receive, pack, count), dispatch board, driver app, books and ledger, reminder call list.
- **Parts:** the component kit.

Prices, stock and names there are samples, the maths is a demo, and product pictures are drawn stand-ins until real photos arrive. All 283 checks passed on 1 Nov 2026 across the 19 screens, in headless Chrome at desktop and phone sizes. They prove the screens behave; they do not prove the design suits real staff or customers.

**Feel (owner, 1 Nov 2026):** microinteractions, custom components, custom working graphs, and Lottie where it earns its place, for both the owner and the customer.

- **Every action answers back:** buttons confirm, numbers count up, parts of the screen move smoothly when something changes. All of it respects the phone's reduced-motion setting.
- **Motion tools:** CSS and the browser's own animation tools for everyday feedback, because they cost almost nothing in page weight. Lottie only for four moments: payment confirmed, unit genuine, delivered, empty bag.
- **Lottie files are our own:** generated by `design/lottie/make-lotties.mjs`, about 2 to 4 KB each, so the style matches and nothing is licensed from anyone. No official LottieFiles connector exists, only community ones that fetch other people's animations. The `lottie_light` player (MIT) is about 47 KB compressed, so load it only when one of those moments happens.
- **Graphs are hand-built, with no chart library.** Each has hover and keyboard reading, plain words beside it, and a table view on the main ones. Colours passed the colour-blind validator: blue `#1B5CF0`, amber `#D97A0B`, green `#0F8F6B`; debt-age ramp `#86A9F7`, `#5585F3`, `#1B5CF0`, `#0F3A9E`.

| Graph | Who | The question it answers | What you can do in it |
|---|---|---|---|
| Money in and out | Owner | Am I making or losing cash? | Change period, read any day, view as table |
| Who owes us, by age | Owner | Who do I chase first? | Tap a band, remind a customer |
| If the dollar moves | Owner | What breaks if the rate changes? | Drag the rate, reprice what falls under the floor |
| What is running out | Owner | What must I order now? | Compare stock with supplier wait, add to order |
| Who is due a new battery | Owner | Who should sales call? | Tap a month, open the call list |
| A day on this system | Customer | Will it last the night? | Changes with appliances and hours |
| Against a generator | Customer | When does it pay for itself? | Drag monthly fuel spend |
| Warranty left | Customer | What is still covered? | Tap a row for serial numbers |
| Is your battery healthy? | Customer | Is this normal for its age? | Say how long it lasts, get a verdict and a free test |
| Part wear on My Machines | Customer | What is due on this machine? | Mark a part changed, reorder all |

**Rule found in testing:** sizing and the day graph must use the same usage pattern. When sizing assumed flat usage, it promised 8 hours while the graph showed the battery running out at midnight. They now share one evening-peak pattern and keep about 15% in reserve. The real engine must keep this rule, and its usage pattern and battery-age curve must come from the shop's own figures, not the demo's.

**More rules found in testing, for the real build:**

- **Count by typing, not tapping.** Closing a till with ₦243,000 in ₦1,000 notes took 243 taps until the note count became a typed box. Any count that can be large needs a typed field.
- **Blind counts everywhere money or stock is counted.** The till and the shelf count both hide the expected number until the count is submitted.
- **A simple counter sale takes 5 actions:** scan, scan, Cash, Exact, Complete. The cursor returns to the scan box by itself. That count is the one to protect as features are added. The 30-second target still has to be timed with real staff in a real shop.
- **The bank match is what catches fake alerts:** a transfer recorded from a screenshot shows as "in our books, not in the bank".
- **Books are derived, never typed.** The design's profit, balance sheet and bank difference are all calculated from the entries. Reversing or matching an entry changes everything at once, and the sides must still balance. The real ledger must work the same way.

**Not drawn yet:** storefront pages such as About and Contact, staff logins and roles, supplier orders and landed cost (Phase 5), warranty claim handling on the staff side, reports beyond the month view. **Not tested yet:** real phones, a real barcode scanner or printer, real product photos, real customers, real staff, a real owner.

**Flow: the standard steps everyone already knows, with more value at each one.**

| Step | What everyone expects | What we add |
|---|---|---|
| Home | Banner, categories | Three finders on the first screen: system, car battery, part |
| Search | Results list | Any spelling of a part number, search by size |
| Category | Filter grid | Plain-language specs, stock by branch, price with its time |
| Product | Photos, specs | Measured drawing, brand levels, substitutes with warnings |
| Bag | Item list | Completeness check, delivery advice with vehicle and reason |
| Checkout | Pay once | Part payment with live balance, transfer account per order, send to someone else to pay |
| Tracking | Status steps | Waybill with serials, delivery code and photo, live rider |
| Account | Order list | My System, My Machines, warranty by serial, reminders, statements, reorder |

**Unique designs, in order of how much they set this store apart:**

| Design | Why it matters | Status |
|---|---|---|
| System calculator with the answer always in view | Most stores make you phone for this | Drawn |
| Measured drawings made from each part's own sizes | Thousands of parts get a clean picture with no photo shoot | Drawn |
| Measure on screen: lay the old bearing on the phone | Solves "the number has worn off" | Drawn and working, with card-size set-up. Accuracy still needs testing on real phones with real parts |
| Bag check that catches missing parts | Replaces the experienced salesperson's eye | Drawn and working |
| Delivery advice with vehicle and reason | Nobody else tells you this | Drawn and working |
| Part-payment balance on one page | Matches how big orders are really paid | Drawn and working |
| Warranty check by serial, and warranty timeline | Answers fake goods and lost receipts | Drawn and working |
| Stopped-machine lane | Speed when it costs a factory money | Drawn and working |
| Owner's "needs you today" screen | The owner decides in seconds | Drawn and working |

**Premium features proposed on top of the plan (not yet agreed):**
- Paste a parts list ("6205-2RS x 20, A42 x 6") and get a priced bag. For factories. P2. Drawn and working.
- Send a quote to someone else to pay, such as a company's accounts team or family abroad. P2. Button drawn.
- Save and share a bag or quote. P2.
- Ask an engineer, with what you were viewing already attached. P2. Button drawn.
- Compare in plain terms, such as hours of backup and cost per year of life. P2. Drawn and working.
- Back-in-stock alerts. P4.
- Reviews only from verified buyers, tied to the order. P4.
- QR code on the box that opens that unit's warranty page and setup guide. P4.
- Roof fit: place panels to scale on a satellite view of your roof. After P5, if there is demand.

---

## Sources

- UNSPSC: [NASA SEWP scope](https://www.sewp.nasa.gov/documents/Website_UNSPSC_Scope%20121025.pdf), [University of Nebraska list](https://nebraska.edu/-/media/projects/unca/offices-policies/business-and-finance-office/procure-to-pay/ariba-quick-reference-guides/master-unspsc-list.pdf), UN tenders [1](https://www.ungm.org/Public/Notice/296781), [2](https://www.ungm.org/Public/Notice/313723)
- Power transmission in distribution: [Agilix](https://www.goagilix.com/solutions/power-transmission/), [Hayley Group](https://hayley-group.co.uk/products/power-transmission), [PTDA members](https://www.inddist.com/associations/news/13774499/ptda-welcomes-8-new-distributor-and-supplier-members)
- E-invoicing: [Nairametrics](https://nairametrics.com/2026/07/19/nrs-sets-july-31-deadline-for-large-taxpayers-e-invoicing-adoption/), [The Guardian](https://guardian.ng/?p=2886050), [Forvis Mazars](https://www.forvismazars.com/ng/en/content/download/1284297/file/3070150), [TechCabal](https://techcabal.com/2026/04/16/all-you-need-to-know-about-e-invoicing-in-nigeria/)
- VAT: [Forvis Mazars](https://www.forvismazars.com/ng/en/services/tax/nigeria-s-tax-reform-in-focus/2025-nta-vat-key-business-changes), [Nairametrics on CPPE](https://nairametrics.com/2026/04/20/cppe-asks-fg-to-cut-solar-import-duties-to-5-grant-vat-waiver/), [IEA on the older order](https://www.iea.org/policies/25949)
- Payments: [Paystack virtual accounts](https://paystack.com/docs/payments/dedicated-virtual-accounts/), [Paystack support](https://support.paystack.com/en/articles/2124866), [Flutterwave virtual accounts](https://developer.flutterwave.com/v3.0/docs/ngn-virtual-accounts), [fee calculator](https://afrotools.com/tools/payment-fee-calculator/), [Kolonell comparison](https://kolonell.com/en/blog/paystack-vs-flutterwave-transaction-fees-nigeria-2026)
- WhatsApp: [ChatMaxima Nigeria rates](https://chatmaxima.com/whatsapp-api-pricing/nigeria/), [Meta pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing), [Bird on verification](https://docs.bird.com/applications/enable-channels/whatsapp/whatsapp-business-verification), [Meta limits, reproduced](https://support.chatarchitect.com/books/meta-whatsapp/chapter/messaging-limits/export/pdf), [Zoko without verification](https://www.zoko.io/post/use-whatsapp-api-without-business-verification)
- Lottie: [community LottieFiles MCP server](https://github.com/junmer/mcp-server-lottiefiles), [dotLottie players](https://docs.lottiefiles.com/en/runtimes)
- Running costs: [Supabase pricing](https://supabase.com/pricing), [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase), [Supabase egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress), [Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits), [Resend free domains](https://resend.com/changelog/three-domains-on-the-free-tier), [Vercel pricing](https://vercel.com/pricing), [Vercel fair use](https://vercel.com/docs/limits/fair-use-guidelines), [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Upstash](https://upstash.com/blog/upstash-vs-aws-elasticache-serverless-redis-pricing-and-performance-2026)
- Market: [The Guardian on fake solar goods](https://guardian.ng/?p=2629088), [Oriental News on Alaba](https://orientalnewsng.com/nigeria-goes-tough-on-perpetrators-of-substandard-solar-battery-circulation/), [Luminous payment plan](https://marketingedge.com.ng/luminous-inverters-offers-affordable-flexible-payment-plan/), [POWMR battery guide](https://af.powmr.com/blogs/news/guide-to-inverter-batteries-in-nigeria) (vendor)
