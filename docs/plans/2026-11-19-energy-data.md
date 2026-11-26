# Energy data: customer health record, graphs and readings

Written 19 Nov 2026. Research and plan only — nothing built until the owner approves.
Status: awaiting the owner's yes. The subject: "help users manage, see and visualize their
energy data." Turns out the plan already drew the customer graphs; the open engineering
question is the **data source**.

## Facts (checked today)

- The plan already designed the customer-facing energy graphs: "A day on this system",
  "Against a generator", "Warranty left", "Is your battery healthy?" (`docs/plans/
  2026-11-01-power-store-plan.md:547-558`). Graphs must be **hand-built, no chart library**
  (`:545`), sizing and the day graph share one usage pattern with ~15% reserve (`:560`),
  and the battery-age curve must come from the shop's own figures, not the demo's (`:560`).
- The plan deliberately excluded **inverter-monitoring integrations** (`:323`). Re-opening
  that is a plan-section-9 decision, so it needs the owner.
- Never imply appliance control (`AGENTS.md`). Monitoring is fine, control is not.
- Schema already carries the seeds: `warranty_months` on products (`supabase/migrations/
  20261101000200_stock.sql:19`), `made_on` on lots and serial units (`:80,97`),
  `warranty_ends_on` set at sale (`20261101000300_selling.sql:514`), `battery_life_months`
  (default 24) in settings and a batteries-due list in `owner_today`
  (`20261102000700_owner_today.sql:7,146`). A customer can already open their own order by
  `receipt_token` (`selling.sql:1170`, granted to anon, `security.sql:100`).
- Nothing exists yet for after-sale equipment or readings ("Not built yet",
  `.opencode/skills/power-database/SKILL.md:119`; skeleton reserves the area,
  plan `:365`). The battery charge check has no tracking (`docs/progress.md:53`).
- The shop sells but does **not** install (plan `:11`), so the shop can deploy no hardware.
  Any hardware path means the customer or their installer fits it.

## The need: who asks what

| Who | Question | Data that answers it |
|---|---|---|
| Customer | Is my system healthy? Will it last the night? When does my battery need replacing? Did I get what I paid for? | What they own + a health curve from readings over time |
| Shop | Whose battery is ageing out? Who should sales call? Which products fail in the field? | The same readings, aggregated (already the "batteries due" idea) |
| Installer | Baseline at set-up, so later faults are provable | Set-up readings against later ones |

## The data source: five options, cheapest and safest first

| # | Option | How it works | Cost and risk | Verdict |
|---|---|---|---|---|
| A | Customer self-reports | Two questions through their receipt link: "how many hours did backup last?" "still as strong as new?" | Free. Sparse and sometimes guessed — but it is exactly the plan's own health check (`:133-144`) made into a history | **Build first** |
| B | Staff/installer readings at touchpoints | At sale, set-up, service or warranty test: voltage, state of charge %, kWh, backup hours, from the unit's own display | Free. Trustworthy, rare. Creates the baseline every later reading compares against | **Build first** |
| C | Vendor-neutral WiFi energy meter (IAMMETER-class) | One CT-clamp meter on any system; open API (cloud.iammeter.com/doc/open) | Hardware ~tens of USD, needs an installer to fit it, third-party cloud | **Later, optional** |
| D | Inverter cloud APIs | Deye has DeyeCloud OpenAPI (AppID/AppSecret); Growatt has regional open APIs; Sunsynk a cloud API. Felicity, SRNE, MUST, Luminous — the Nigerian volume brands — are app-locked or community-only | Real telemetry, but only for a few brands, needs the customer's own app account, a support surface per brand, and re-opening the plan's deliberate exclusion | **Only if the shop's real sales concentrate on one clean-API brand, and you say yes** |
| E | Local Modbus/datalogger at the site | Hardware at the customer's home | The shop doesn't install; conflicts with "sell only" | **No** |

Outside facts (web, 19 Nov 2026): Nigeria's hybrid field is Deye, Sunsynk, Growatt, Felicity,
Luminous, SRNE, Huawei, Victron, MUST, PRAG, Sako, Cworth, SMS (solarinverter.ng and srnesolar
round-ups). Growatt's and Deye's APIs are the only clean cloud paths; the rest ride community
integrations, which are not a business foundation.

## Assumptions (probabilities are my judgement)

| Assumption | Chance | Cheapest probe |
|---|---|---|
| Customers answer the two questions at least sometimes | 50% | Ask 5 recent customers on the shop day |
| Most of the shop's sales are one or two inverter brands | 40% | Ask the shop what they sell most |
| The health curve can come from shop experience / one battery expert | 70% | Ask the shop owner and their best technician |
| A customer can read voltage or % off their own display | 60% | Try it with 5 customers' photos |

## Pre-mortem: if this failed a month from now

1. Nobody enters readings, the graphs stay empty → the page must be useful with zero readings
   (warranty countdown, reorder, what they own) and staff ask for one reading at service/sale.
2. Customers read "energy data" as a live monitoring app and are let down next to the brand
   apps → honest wording everywhere: "your health record", never live, never appliance control.
3. The battery-health maths says nonsense for one brand → every verdict shows its basis, the
   curve lives in settings (`battery_life_months` pattern), and a scene checks the maths.

## Steps (each ends in a runnable proof)

| # | Step | Depends on | Files | Proof it worked | If it fails |
|---|---|---|---|---|---|
| 1 | Energy record core: `equipment_units` created automatically from delivered serials at sale; `energy_readings` (append-only, corrected by a new reading); `my_equipment()`, `add_reading()` (keyed, role-checked), `health_verdict()` using the settings curve. RLS + grants, no cost anywhere near it | Owner yes | New migration after `20261103000100_import.sql`, scenes in `sim/edge.mjs` | `node check.mjs` green plus named scenes: reading permissions, retry-safe, append-only, verdict maths | Fix the maths or the policy; stop |
| 2 | Customer page at `/my` (receipt link or login): what they own, warranty timeline, enter a reading, health curve and backup-hours trend — hand-built SVG per the kit, calm wording | 1 | `app/my/`, tests | `npm run build`, e2e scene: open receipt link, add a reading, curve moves, no sideways scroll at 375px | Fix the screen; stop |
| 3 | Staff side: one reading at set-up/sale/service; owner sees batteries due against their real curve | 1, shop figures | extend `owner_today` | Scenes + e2e | Ask the shop; stop |
| 4 | Live feed (option C or D) | Owner re-decides plan 9; shop-day facts | new migration + worker | Its own scenes and a staging trial with one real site | Drop it; the record still works |

## Done means

- A customer with zero readings still sees a useful page (what they own, warranty left).
- One reading at set-up plus one later makes the health verdict, and every verdict shows why.
- All money/stock rules untouched; `node check.mjs --full` green; counter sees no cost anywhere.
- The plan's deliberate exclusion of inverter control stays: nothing here switches anything.

## Needs the owner's yes now

- Steps 1–3 as one approved item (plan section 9 unchanged; nothing paid, no accounts).
- Whether to even research step 4, or drop it until the shop day answers the brand question.

## Open, recorded, not guessed

- The real battery-age curve and charge-check thresholds (shop day, expert).
- Whether installers will record set-up readings (shop day).
