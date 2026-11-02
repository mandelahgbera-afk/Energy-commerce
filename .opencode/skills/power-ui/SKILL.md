---
name: power-ui
description: The look, feel and wording of Power Store. Load before building or changing any screen, component, graph, animation or customer-facing text. The owner rejected a game-like first design, so this holds what they approved, the working screens to follow, and rules found in testing.
---

# Power Store look and feel

**The look: clean, smooth, semi-glassy and smart.** Soft cool neutrals, frosted panels over real product images, one calm blue for actions, Geist and Geist Mono.

The buyers are households spending millions and factories with stopped machines. They must trust the shop. The owner rejected the first direction with "the UI/UX looks like a game... this is a serious business". So: **no poster type, characters, playful metaphors, power-cut gimmicks or breaker-switch themes.** Unique means smart function shown calmly: real stock, today's price, clear checks.

Sizing is a plain calculator. Never write "what must stay on", and never use toggles that could read as controlling appliances. Nothing here controls anyone's devices.

## Follow the approved screens

`design/screens/*.dc.html` holds 19 working screens. They are the source for layout, flow and behaviour. Open only the one for your item, because they are large. Sample prices and names are not real.

Store: Main, Category, ProductPage, PartPage, SizeCalculator, CarFinder, MeasurePart, PasteList, Urgent, BagCheckout, MyAccount. Parts: Kit. Staff: OwnerToday, Counter, StockRoom, Dispatch, DriverApp, Books, CallList.

The format is `x-dc` markup with `DCLogic`, `renderVals`, `sc-for` and `sc-if`. Port the structure and behaviour into React components. Don't copy the runtime. `design/checks/scenarios.mjs` lists what each screen must do, so turn the relevant checks into tests for the real screen. A new screen or a change of look needs the owner's yes on one or two screens before you build many.

## Feel

- **Every action answers back.** Buttons confirm, numbers count up, parts of the screen move smoothly when something changes.
- Respect the phone's reduced-motion setting everywhere.
- Use CSS and browser animation for everyday feedback, because they cost almost nothing to load.
- **Lottie only for four moments:** payment confirmed, unit genuine, delivered, empty bag. The files are our own, in `design/lottie/`. Load the `lottie_light` player only when one of those moments happens.
- Decoration that makes a phone slower is wrong. Budget for a low-end Android on 4G.

## Graphs

Hand-built, with no chart library. **Every graph must let someone do something, not just look.** Plan section 15 lists all ten, with the question each one answers and what you can do in it.

- One axis only. Never two scales on one chart.
- Hover and keyboard reading, plain words beside it, and a table view on the main ones.
- A legend when there are two or more series. Colour is never the only signal. Text stays in text colours, not the series colour.
- Validated colours: blue `#1B5CF0`, amber `#D97A0B`, green `#0F8F6B`. Debt-age ramp: `#86A9F7`, `#5585F3`, `#1B5CF0`, `#0F3A9E`. Don't invent new chart colours.
- Thin marks, rounded data ends, quiet grid lines.
- Dark mode, if built, gets its own checked colours, not a flip.

## Rules found in testing

- **Tap targets at least 44px.** Tests caught a 23px logo link, a 30px debt band and 36px checkout steps.
- **Count by typing, not tapping.** Closing a till with ₦243,000 in ₦1,000 notes took 243 taps until it became a typed box.
- **Blind counts.** Till and shelf counts hide the expected number until submitted, and the database enforces it too.
- **A simple counter sale takes 5 actions:** scan, scan, Cash, Exact, Complete. The cursor returns to the scan box by itself. Protect this number as features arrive.
- **Sizing and the day graph share one usage pattern** (evening peak, about 15% reserve). When they differed, the calculator promised 8 hours while the graph ran out at midnight. The real pattern must come from the shop's figures.
- **Books are calculated, never typed.** Every total on screen comes from the database.
- In SVG `<text>` and in flex items, use one whole computed string per element. Mixing literal text and values split or dropped words in the prototype.

## Words

Plain, calm, and specific: "₦50,000 is still owed before these goods can leave", not "Payment validation failed". Say what happened and what to do next. Name things the way a Nigerian shopkeeper would: "Who owes us", "Goods we owe customers", not "Accounts receivable". Prices show their time ("today's price"), because dollar moves change them.

## Before calling a screen done

Run it. Look at it at phone width (375px) and desktop, check there is no sideways scroll, click through the real flow, try the failed and empty states, and check keyboard use. Say what you couldn't test, such as real phones, scanners and printers.
