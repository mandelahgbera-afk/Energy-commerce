const btn = (page, name) => page.getByRole("button", { name, exact: true });
const text = (page) => page.evaluate(() => document.body.innerText);

export const scenarios = {
  async Category(page, check) {
    const names = () => page.$$eval("article a span:nth-child(2)", (e) => e.map((x) => x.textContent));
    check("starts with 8 batteries", (await names()).length === 8);
    await btn(page, "Lithium").click();
    check("Lithium filter leaves 4", (await names()).length === 4);
    await btn(page, "48 V").click();
    check("48 V narrows to 3", (await names()).length === 3);
    await btn(page, "Clear filters").click();
    await page.locator("#sort").selectOption("low");
    check("price sort puts cheapest first", (await names())[0] === "100Ah gel battery");
    await page.locator("#sort").selectOption("pop");
    await page.getByRole("switch", { name: "In stock only" }).click();
    check("in stock hides the out-of-stock one", !(await names()).includes("15 kWh lithium battery"));
    await page.getByRole("switch", { name: "In stock only" }).click();
    await page.locator("#load").fill("1.1");
    check("backup hours follow the load", (await text(page)).includes("About 4 hours"));
    await page.getByRole("button", { name: "Add to bag" }).first().click();
    await page.waitForTimeout(700);
    check("add confirms and bag count rises", (await page.locator("nav a span").first().textContent()) === "3");
    await page.locator("article").nth(0).getByRole("button", { name: "Compare" }).click();
    check("tray asks for one more", (await text(page)).includes("Pick one more"));
    await page.locator("article").nth(1).getByRole("button", { name: "Compare" }).click();
    await page.locator("div.glass").last().getByRole("button", { name: "Compare" }).click();
    await page.waitForTimeout(400);
    check("compare sheet opens", await page.getByRole("dialog").isVisible());
    check("sheet gives a verdict", /costs least over its life/.test(await text(page)));
    await page.screenshot({ path: new URL("./shots/Category-compare.png", import.meta.url).pathname.slice(1) });
    await page.keyboard.press("Escape");
    check("Escape closes it", (await page.getByRole("dialog").count()) === 0);
  },
  async CarFinder(page, check) {
    await page.locator("#car").fill("2012 camry");
    check("typed '2012 camry' finds the car", (await text(page)).includes("Fits your 2012 Toyota Camry"));
    check("shows the size", (await text(page)).includes("24F"));
    const signs = await page.$eval("[role=img][aria-label^='Battery seen']", (e) => e.innerText);
    check("battery drawing shows plus, minus and size", signs.includes("+") && signs.includes("−") && signs.includes("Size 24F"), signs.replace(/\n/g, " "));
    await page.locator("#car").fill("toyota corolla 2015");
    check("any order works", (await text(page)).includes("Fits your 2015 Toyota Corolla"));
    await page.locator("#car").fill("nonsense car");
    check("unknown car gets a way forward", (await text(page)).includes("could not place that car"));
    await page.locator("#car").fill("");
    await btn(page, "Honda").click();
    await btn(page, "Accord").click();
    await btn(page, "2014").click();
    check("tap path reaches a result", (await text(page)).includes("Fits your 2014 Honda Accord"));
    check("trade-in comes off the total", (await text(page)).includes("₦70,000"));
    await page.getByRole("switch", { name: /Trade in/ }).click();
    check("removing trade-in restores price", (await page.locator("div.glass").last().textContent()).includes("₦78,000"));
    await page.getByRole("radio", { name: /Premium/ }).click();
    check("choosing premium updates the total", (await page.locator("div.glass").last().textContent()).includes("₦104,000"));
    await page.getByRole("button", { name: "Add to bag" }).click();
    await page.waitForTimeout(120);
    check("add confirms", (await btn(page, "Added to bag").count()) === 1);
  },
  async MeasurePart(page, check) {
    check("asks to set screen size first", (await text(page)).includes("First, set your screen size"));
    const box = () => page.$eval("section[aria-labelledby=cal] div div", (e) => e.getBoundingClientRect().width);
    const w0 = await box();
    await page.getByRole("button", { name: "Make the box wider" }).click();
    check("box grows when adjusted", (await box()) > w0);
    await btn(page, "It matches my card").click();
    await page.waitForTimeout(200);
    check("starts at 6205 size", (await text(page)).includes("6205 family"));
    await page.getByRole("button", { name: "Hole one millimetre less" }).click();
    for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Hole one millimetre less" }).click();
    check("moving away finds 6304 instead", (await text(page)).includes("6304 family"));
    const stage = page.locator("section[aria-label='Measure a bearing'] > div").first();
    const b = await stage.boundingBox();
    const cx = b.x + b.width / 2, cy = b.y + 170;
    await page.mouse.move(cx + 52 / 2 * 5.47, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 62 / 2 * 5.47, cy, { steps: 4 });
    await page.mouse.up();
    const od = await page.evaluate(() => document.body.innerText.match(/Outside[\s\S]{0,12}?(\d+) mm/)?.[1]);
    check("dragging the outer ring changes the size", Number(od) >= 60, od + " mm");
    await btn(page, "Chain").click();
    await btn(page, "10B").click();
    check("chain shows its pitch", (await text(page)).includes("15.875 mm between rollers"));
    await btn(page, "Belt").click();
    check("belt estimate reads A42", (await text(page)).includes("A42"));
    await page.getByRole("button", { name: "Wider" }).click();
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Wider" }).click();
    check("wider belt moves to section B", (await text(page)).includes("B42"));
    await page.reload();
    await page.waitForTimeout(900);
    check("remembers screen size next time", !(await text(page)).includes("First, set your screen size"));
  },
  async Counter(page, check) {
    const scan = page.locator("#scan");
    check("cursor starts in the scan box", await scan.evaluate((e) => document.activeElement === e));
    // The simplest real sale: scan, scan, Cash, Exact, Complete.
    const started = Date.now();
    let actions = 0;
    await scan.fill("62052rs"); await page.keyboard.press("Enter"); actions++;
    check("scanner style Enter adds the item", (await text(page)).includes("₦4,800"));
    check("cursor returns for the next scan", await scan.evaluate((e) => document.activeElement === e));
    await scan.fill("A42"); await page.keyboard.press("Enter"); actions++;
    check("adding the same part twice raises quantity", await (async () => { await scan.fill("A42"); await page.keyboard.press("Enter"); return (await text(page)).includes("₦6,400"); })());
    check("cost price is never on the page", !/cost/i.test(await text(page)));
    check("needs a payment method first", (await text(page)).includes("Choose how they are paying"));
    await btn(page, "Cash").click(); actions++;
    await btn(page, "Exact").click(); actions++;
    await btn(page, "Complete sale").click(); actions++;
    check("sale completes", (await text(page)).includes("Sale complete"));
    check("simple sale takes 5 actions", actions === 5, actions + " actions, " + ((Date.now() - started) / 1000).toFixed(1) + " s under test");
    check("receipt lists the items", (await text(page)).includes("2 × A42 V-belt"));
    await btn(page, "New sale").click();
    check("new sale is empty and ready", (await text(page)).includes("Scan the first item") && await scan.evaluate((e) => document.activeElement === e));
    // Serial numbers, known customers, discount limits.
    await scan.fill("TB200"); await page.keyboard.press("Enter");
    await btn(page, "Cash").click();
    check("battery cannot sell without a serial", (await text(page)).includes("Pick the serial number"));
    await btn(page, "TB-200-88121").click();
    check("serial clears the block", !(await text(page)).includes("Pick the serial number"));
    check("Credit is off for strangers", await btn(page, "Credit").isDisabled());
    await page.locator("#ph").fill("08031234567");
    check("known phone finds the customer", (await text(page)).includes("Bello Stores"));
    check("trade price applies", (await text(page)).includes("₦392,000"));
    await btn(page, "Credit").click();
    check("credit shows what is left", (await text(page)).includes("Credit left after this: ₦858,000"));
    await page.locator("#disc").fill("3");
    check("3% is within the limit", (await text(page)).includes("Within your limit"));
    await page.locator("#disc").fill("9");
    check("9% is blocked", (await text(page)).includes("above your limit") && await btn(page, "Complete sale").isDisabled());
    await btn(page, "Ask the owner for 9%").click();
    check("request goes to the owner", (await text(page)).includes("Waiting for the owner"));
    await page.waitForTimeout(1700);
    check("approval unblocks the sale", (await text(page)).includes("Approved by the owner") && await btn(page, "Complete sale").isEnabled());
    await btn(page, "Transfer").click();
    check("transfer warns against screenshots", (await text(page)).includes("A screenshot does not count"));
    await btn(page, "Send to finance, hold goods").click();
    check("transfer holds the goods", (await text(page)).includes("Waiting on the bank"));
    // Till close: blind count.
    await btn(page, "Close the till").click();
    check("system total is hidden before the count", !(await text(page)).includes("₦248,000"));
    await page.getByRole("textbox", { name: "Number of ₦1000 notes" }).fill("243");
    check("typing the note count adds up", (await text(page)).includes("₦243,000"));
    await btn(page, "This is my count").click();
    check("shortage is shown only after counting", (await text(page)).includes("₦5,000 short") && (await text(page)).includes("₦248,000"));
    check("count is locked afterwards", await page.getByRole("button", { name: "One more ₦1000 note", exact: true }).isDisabled());
  },
  async StockRoom(page, check) {
    const rs = page.locator("#rs");
    await rs.fill("tb-200-90411"); await page.keyboard.press("Enter");
    check("scanning adds the unit", (await text(page)).includes("TB-200-90411 received"));
    await rs.fill("TB-200-90411"); await page.keyboard.press("Enter");
    check("scanning twice is refused", (await text(page)).includes("was already scanned") && (await text(page)).includes("1 of 4 scanned"));
    await rs.fill("BAD-123"); await page.keyboard.press("Enter");
    check("a stranger unit is refused", (await text(page)).includes("not on this delivery"));
    await page.getByRole("textbox", { name: "Quantity received of 6205-2RS bearing" }).fill("100");
    check("typed counts update progress", (await text(page)).includes("101 of 304 items received"));
    await page.getByRole("textbox", { name: "Quantity received of 6 mm solar cable" }).fill("250");
    check("over-delivery is flagged", (await text(page)).includes("250 m received, 200 m ordered"));
    await page.getByRole("button", { name: "Report damage" }).first().click();
    check("damage goes on a claim", (await text(page)).includes("supplier claim"));
    await page.getByRole("button", { name: /Finish, with/ }).click();
    check("finish keeps short lines open", (await text(page)).includes("Short lines stay open"));
    await btn(page, "Mark as checked").click();
    check("charge check can be cleared", (await text(page)).includes("Next check for these in 90 days"));

    await btn(page, "Pack").click();
    const ps = page.locator("#ps");
    await ps.fill("TB-200-90411"); await page.keyboard.press("Enter");
    check("newer unit warns: oldest first", (await text(page)).includes("Take TB-200-88121 first"));
    await ps.fill("NOPE"); await page.keyboard.press("Enter");
    check("wrong unit is refused", (await text(page)).includes("not on this order"));
    await ps.fill("TB-200-88121"); await page.keyboard.press("Enter");
    check("correct unit is picked", (await text(page)).includes("1 of 3 picked"));
    await ps.fill("INV-5K-20441"); await page.keyboard.press("Enter");
    await btn(page, "Picked").click();
    check("all picked means ready for the van", (await text(page)).includes("Ready for the van"));

    await btn(page, "Count").click();
    check("expected numbers are hidden", !/\b48\b/.test(await text(page)));
    check("cannot finish with blanks", await page.getByRole("button", { name: "Count every line first" }).isDisabled());
    for (const [n, v] of [["Count of 6205-2RS bearing", "46"], ["Count of 6204-2RS bearing", "8"], ["Count of A42 V-belt", "15"], ["Count of A44 V-belt", "9"]]) await page.getByRole("textbox", { name: n }).fill(v);
    await btn(page, "Finish the count").click();
    check("difference shows with its value", (await text(page)).includes("2 missing, worth ₦9,600"));
    check("owner must approve before stock changes", (await text(page)).includes("Stock does not change until then"));
  },
  async Dispatch(page, check) {
    const box = (n) => page.getByRole("checkbox", { name: new RegExp("Order " + n) });
    const firstTitle = await page.locator("[role=checkbox]").first().innerText();
    check("urgent order sits at the top", firstTitle.includes("2221") && firstTitle.includes("Machine stopped"));
    await box(2221).click();
    check("one small order is advised a bike", (await text(page)).includes("Use the bike."));
    await box(2214).click();
    check("adding panels moves advice to a van with 2 people", (await text(page)).includes("Use the van, with 2 people."));
    check("gives the reason", (await text(page)).includes("535 kg in total, longest item 2.4 m"));
    await page.getByRole("radio", { name: /^Car/ }).click();
    check("too heavy is refused", (await text(page)).includes("Too heavy for the car") && await page.getByRole("button", { name: /Start trip/ }).isDisabled());
    await page.getByRole("radio", { name: /^Truck/ }).click();
    check("overriding asks why", (await text(page)).includes("Not the advised vehicle"));
    check("needs a reason before starting", (await text(page)).includes("Say why"));
    await page.getByRole("radio", { name: /^Van/ }).click();
    await page.getByRole("radio", { name: /Ade/ }).click();
    check("wrong driver for the vehicle is refused", (await text(page)).includes("Ade does not drive the van"));
    await page.getByRole("radio", { name: /Musa/ }).click();
    await page.getByRole("button", { name: "Move Lekki Phase 1 earlier" }).click();
    check("stops can be reordered", (await page.locator("ol li").first().innerText()).includes("Lekki Phase 1"));
    await page.getByRole("button", { name: "Start trip with 2 stops" }).click();
    check("trip goes on the road", (await text(page)).includes("Musa, van, 2 stops"));
    check("orders leave the waiting list", (await box(2214).count()) === 0);
    await box(2216).click();
    await page.getByRole("radio", { name: /^Van/ }).click();
    await page.getByRole("radio", { name: /^Car/ }).click();
    check("a driver on a trip cannot be picked", await page.getByRole("radio", { name: /Musa/ }).isDisabled());
    await btn(page, "Preview next delivery").click();
    await btn(page, "Preview next delivery").click();
    check("trip completes", (await text(page)).includes("All delivered, with code and photo"));
    check("driver cash is visible", (await text(page)).includes("Holding ₦180,000"));
    await btn(page, "Received").first().click();
    check("handing in cash is recorded", (await text(page)).includes("Handed in. Recorded in the books"));
  },
  async DriverApp(page, check) {
    const key = (d) => page.getByRole("button", { name: "Digit " + d, exact: true });
    const enter = async (code) => { for (const d of code) await key(d).click(); };
    check("first stop is clear", (await text(page)).includes("Lekki Phase 1") && (await text(page)).includes("Batteries stay upright"));
    await btn(page, "I have arrived").click();
    await enter("111111");
    check("wrong code is refused", (await text(page)).includes("That code is wrong"));
    await enter("222222"); await enter("333333");
    check("three wrong codes tell them to call", (await text(page)).includes("Call the office"));
    await enter("482913");
    check("right code passes", (await text(page)).includes("Code is correct"));
    check("cannot finish without a photo", await btn(page, "Delivered").isDisabled());
    await btn(page, "Take a photo of the goods").click();
    await btn(page, "Delivered").click();
    await page.waitForTimeout(500);
    check("delivered screen plays its animation", (await page.locator("div[aria-hidden=true] svg").count()) >= 1);
    await btn(page, "Next stop").click();
    check("moves to the next stop", (await text(page)).includes("Surulere") && (await text(page)).includes("Stop 2 of 3"));
    await btn(page, "I have arrived").click();
    await enter("482913");
    await btn(page, "Take a photo of the goods").click();
    check("cash stop cannot finish until cash is ticked", (await text(page)).includes("once you have the cash") && await btn(page, "Delivered").isDisabled());
    await page.getByRole("checkbox", { name: /collected ₦75,000/ }).click();
    await btn(page, "Delivered").click();
    await btn(page, "Next stop").click();
    await btn(page, "I cannot deliver this").click();
    check("failed delivery needs a reason", await btn(page, "Keep it on the van, next stop").isDisabled());
    await btn(page, "Customer not home").click();
    await btn(page, "Keep it on the van, next stop").click();
    await page.waitForTimeout(200);
    check("trip summary counts it right", (await text(page)).includes("2 of 3") && (await text(page)).includes("₦255,000"), (await text(page)).match(/Cash to hand in\s*([^\n]+)/)?.[1]);
    await page.locator("#fuel").fill("6500");
    await btn(page, "Add receipt").click();
    await btn(page, "Close the trip").click();
    check("trip closes", (await text(page)).includes("Trip closed. Hand in the cash."));
  },
  async Books(page, check) {
    const line = () => page.locator("nav + div > div[aria-live=polite]").innerText();
    const naira = (t) => Number(t.replace(/[^0-9−-]/g, "").replace("−", "-"));
    const sidesEqual = async () => {
      const m = (await line()).match(/Own (₦[\d,]+) = owe (₦[\d,]+) \+ owner (₦[\d,]+)/);
      if (!m) return false;
      return naira(m[1]) === naira(m[2]) + naira(m[3]);
    };
    check("books balance at the start", (await line()).includes("The books balance") && await sidesEqual(), await line());
    const t = await text(page);
    check("profit is worked out from the entries", t.includes("₦5,195,400"), t.match(/₦[\d,]+\s*\n\s*Profit after all costs/)?.[0]?.replace(/\s+/g, " "));
    check("a deposit is shown as owed, not profit", t.includes("A deposit is money we owe in goods"));

    await btn(page, "Entries").click();
    check("no accounting words until asked", !/debit|credit\b/i.test((await text(page)).replace(/Accountant view/g, "")));
    await page.getByRole("switch", { name: "Accountant view" }).click();
    check("accountant view shows debits and credits", (await text(page)).includes("Debit") && (await text(page)).includes("Credit"));
    await page.locator("#f").fill("rent");
    check("search narrows entries", (await page.getByRole("button", { name: "Reverse" }).count()) === 1);
    await page.getByRole("button", { name: "Reverse" }).click();
    check("reversing asks why", (await text(page)).includes("Why are you reversing this?"));
    check("there is no delete or edit", (await page.getByRole("button", { name: /delete|edit/i }).count()) === 0);
    await btn(page, "Wrong amount").click();
    check("reversal adds a new entry, keeps the old", (await text(page)).includes("Reversal of: Shop rent") && (await text(page)).includes("Reversed: Wrong amount"));
    check("books still balance after a reversal", (await line()).includes("The books balance") && await sidesEqual());
    await page.locator("#f").fill("");
    await btn(page, "Month").click();
    check("profit rises by the reversed rent", (await text(page)).includes("₦6,045,400"));

    await btn(page, "Bank").click();
    check("fake alert is caught", (await text(page)).includes("This may be a fake alert"));
    const before = await page.locator("[aria-live=polite]").nth(1).innerText();
    check("difference is shown", before !== "₦0", before);
    await btn(page, "Reverse it, and hold their goods").click();
    await btn(page, "Eze Motors, invoice 1033").click();
    await btn(page, "Record as bank charges").click();
    await page.waitForTimeout(200);
    const after = await text(page);
    check("rent reversal is the only difference left", after.includes("₦850,000"), after.match(/Difference\s*\n?\s*([^\n]+)/)?.[1]);
    check("books still balance after matching", (await line()).includes("The books balance") && await sidesEqual());

    await btn(page, "Close").click();
    check("cannot close with a bank difference", await page.getByRole("button", { name: "Finish the items above first" }).isDisabled());
    await page.getByRole("button", { name: "Export for the accountant" }).click();
    check("export can still be prepared", (await btn(page, "Export ready for the accountant").count()) === 1);
    await btn(page, "Entries").click();
    await page.locator("#f").fill("Reversal of: Shop rent");
    check("a reversal cannot itself be reversed", (await page.getByRole("button", { name: "Reverse" }).count()) === 0);
    // A clean month, all the way to closed.
    await page.reload();
    await page.waitForTimeout(900);
    await btn(page, "Bank").click();
    await btn(page, "Reverse it, and hold their goods").click();
    await btn(page, "Eze Motors, invoice 1033").click();
    await btn(page, "Record as bank charges").click();
    await page.waitForTimeout(200);
    check("bank matches exactly once all is resolved", (await page.evaluate(() => document.body.innerText.match(/Difference\s*\n?\s*([^\n]+)/)?.[1])) === "₦0");
    check("resolved items leave the list", !(await text(page)).includes("Needs you"));
    await btn(page, "Close").click();
    await btn(page, "Close October").click();
    check("month closes", (await text(page)).includes("October is closed"));
    await btn(page, "Entries").click();
    check("closed month can no longer be reversed", (await page.getByRole("button", { name: "Reverse" }).count()) === 0);
    check("books balance when closed", (await line()).includes("The books balance") && await sidesEqual());
  },
  async SizeCalculator(page, check) {
    const line = () => page.evaluate(() => document.body.innerText.match(/With the grid off[^\n]+/)?.[0] || "");
    const more = (n) => page.getByRole("button", { name: "One more: " + n, exact: true }).click();
    check("sizing and day graph agree by default", !(await line()).includes("runs out"), await line());
    for (const h of ["4 hours", "12 hours", "24 hours", "8 hours"]) { await btn(page, h).click(); check("no run-out at " + h, !(await line()).includes("runs out"), await line()); }
    await more("Freezer"); await more("Air conditioner, 1 HP");
    check("adding a freezer and AC still lasts", !(await line()).includes("runs out"), await line());
    check("keeps a reserve", Number((await line()).match(/lowest at (\d+)%/)?.[1]) >= 5, await line());
    await page.locator("#fuel").fill("400000");
    check("payback follows fuel spend", /Pays for itself/.test(await text(page)));
    await page.locator("#fuel").fill("40000");
    check("low fuel spend says it plainly", (await text(page)).includes("Does not pay back within 5 years"));
    for (let i = 0; i < 12; i++) await more("Air conditioner, 1 HP");
    check("oversized load goes to an engineer", (await text(page)).includes("This needs a larger set-up"));
  },
  async OwnerToday(page, check) {
    check("call list button leads to the call list", (await page.getByRole("link", { name: "Open call list" }).getAttribute("href")) === "CallList.dc.html");
    await btn(page, "It is in the bank").click();
    await page.waitForTimeout(900);
    check("confirming money updates today's total", (await text(page)).includes("₦4,380,000"));
    check("the count of things drops", (await page.locator("h1").innerText()).includes("3 things"));
    await page.locator("#fx").fill("1750");
    check("dollar what-if finds affected products", /\d+ products/.test(await text(page)));
    await page.getByRole("button", { name: /^Reprice/ }).click();
    check("repricing clears them", (await text(page)).includes("You are fine at this rate"));
    await btn(page, "View as table").first().click();
    check("graph has a table view", (await page.locator("table").count()) >= 1);
  },
  async BagCheckout(page, check) {
    check("catches the missing batteries", (await text(page)).includes("it needs 2 more"));
    await page.getByRole("button", { name: /Add 2 more/ }).click();
    await page.getByRole("button", { name: /Add rails/ }).click();
    check("completed set says so", (await text(page)).includes("Your set is complete"));
    await btn(page, "Continue to delivery").click();
    check("advises the van from the weight", (await text(page)).includes("534 kg"));
    await btn(page, "Continue to payment").click();
    await btn(page, "I have sent it").click();
    check("waits for the bank", (await text(page)).includes("A screenshot alone does not count"));
    await page.waitForTimeout(2000);
    check("half paid after one transfer", (await text(page)).includes("left"));
  },
  async MyAccount(page, check) {
    await page.locator("#hrs").fill("3");
    check("battery verdict reacts", (await text(page)).includes("much lower than usual"));
    await btn(page, "My machines").click();
    await page.getByRole("button", { name: "Changed it today" }).first().click();
    check("marking a part changed resets it", (await text(page)).includes("Changed today"));
    await btn(page, "Orders").click();
    await btn(page, "Preview the next step").click();
    await page.waitForTimeout(500);
    check("delivered plays and confirms", (await text(page)).includes("Delivered and signed for"));
  },
  async Kit(page, check) {
    await page.locator("#ps").fill("62052rs");
    check("part search understands spelling", (await text(page)).includes("6205-2RS"));
    await page.locator("#ps").fill("zzz");
    await page.waitForTimeout(300);
    check("no match shows the empty state", (await text(page)).includes("No match for that"));
    await btn(page, "Check").click();
    await page.waitForTimeout(1300);
    check("real serial reads genuine", (await text(page)).includes("Genuine. Sold by Power Store"));
  },
  async CallList(page, check) {
    await page.context().route("**/wa.me/**", (r) => r.abort());
    page.context().on("page", (p) => { if (p !== page) p.close().catch(() => {}); });
    const wa = page.getByRole("link", { name: "Open WhatsApp" });
    const href = () => wa.getAttribute("href");
    check("starts with 0 of 8 done", (await text(page)).includes("0 of 8 done"));
    check("highest value comes first", (await page.locator("#who").innerText()) === "Adeyemi Electricals");
    const first = await href();
    check("link goes to the customer's number", first.startsWith("https://wa.me/2348021110042?text="), first.slice(0, 40));
    check("message is written into the link", decodeURIComponent(first.split("text=")[1]).startsWith("Hello Adeyemi Electricals"));
    check("every message lets them stop", decodeURIComponent(first.split("text=")[1]).includes("Reply STOP"));
    await page.locator("#msg").fill("Hello, a changed message");
    check("editing changes what gets sent", decodeURIComponent((await href()).split("text=")[1]) === "Hello, a changed message");
    check("call button uses the same number", (await page.getByRole("link", { name: "Call", exact: true }).getAttribute("href")) === "tel:+2348021110042");
    await wa.click();
    await page.waitForTimeout(200);
    check("asks if it really was sent", (await text(page)).includes("Did you send it?"));
    check("opening alone does not count as done", (await text(page)).includes("0 of 8 done"));
    await btn(page, "No, not sent").click();
    check("not sent goes back to the message", await page.locator("#msg").isVisible());
    check("the edit is kept", (await page.locator("#msg").inputValue()) === "Hello, a changed message");
    await wa.click();
    await page.waitForTimeout(150);
    await btn(page, "Yes, sent. Next.").click();
    check("sent counts and moves to the next person", (await text(page)).includes("1 of 8 done") && (await page.locator("#who").innerText()) === "Kano Plastics");
    await btn(page, "Undo").click();
    check("undo brings them back", (await text(page)).includes("0 of 8 done") && (await page.locator("#who").innerText()) === "Adeyemi Electricals");
    await page.waitForTimeout(150);
    await btn(page, "Yes, sent. Next.").click();
    await btn(page, "Skip today").click();
    check("skipping moves them to tomorrow", (await text(page)).includes("Kano Plastics moved to tomorrow"));
    await btn(page, "Service 3").click();
    check("filter shows only that group", (await page.locator("#who").innerText()) === "Eze Motors");
    await btn(page, "All 6").click();
    await page.getByRole("button", { name: /^Lekki Estates/ }).click();
    check("anyone in Up next can be opened", (await page.locator("#who").innerText()) === "Lekki Estates");
    const reply = page.getByRole("group", { name: "What Adeyemi Electricals said" });
    await reply.getByRole("button", { name: "Wants it" }).click();
    check("a yes offers the sale", (await page.getByRole("link", { name: "Start the sale" }).getAttribute("href")) === "Counter.dc.html");
    // Work through the rest, counting taps per customer.
    let guard = 0;
    while ((await wa.count()) > 0 && guard++ < 10) {
      await wa.click();
      await page.waitForTimeout(80);
      await btn(page, "Yes, sent. Next.").click();
    }
    await page.waitForTimeout(500);
    check("finishing shows the done state", (await text(page)).includes("Today's list is done") && (await text(page)).includes("8 of 8 done"));
    check("done state plays its animation", (await page.locator("div[aria-hidden=true] svg").count()) >= 1);
    const stop = page.getByRole("group", { name: "What Kano Plastics said" });
    check("skipped customer has no reply buttons", (await stop.count()) === 0);
    await page.getByRole("group", { name: "What Grace Hospital said" }).getByRole("button", { name: "Stop reminders" }).click();
    check("stop is honoured", (await text(page)).includes("They will not get reminders again"));
  },
  async Main(page, check) {
    const opts = () => page.$$eval("[role=option]", (e) => e.map((x) => x.innerText.split("\n")[0]));
    await page.locator("#q").fill("62052rs");
    check("search understands any spelling", (await opts())[0] === "6205-2RS bearing", (await opts())[0]);
    await page.locator("#q").fill("25 52 15");
    check("search finds by size", (await opts()).length === 2, (await opts()).join(", "));
    await page.locator("#q").fill("lithium");
    check("search finds by word", (await opts())[0] === "5 kWh lithium battery");
    await page.locator("#q").fill("camry");
    check("a car points to the finder", (await opts())[0] === "Car battery finder");
    await page.locator("#q").fill("zzzz");
    check("no match still offers a way on", (await text(page)).includes("No match for that") && (await text(page)).includes("Measure an old part"));
    await page.locator("#q").fill("6205");
    await page.keyboard.press("ArrowDown");
    check("arrow keys move the selection", (await page.$$eval("[role=option]", (e) => e.findIndex((x) => x.getAttribute("aria-selected") === "true"))) === 1);
    await page.keyboard.press("Escape");
    check("Escape closes results", (await page.locator("[role=option]").count()) === 0);
    await page.locator("#q").fill("lithium");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    check("Enter opens the top result", page.url().includes("ProductPage"), page.url().split("/").pop());
  },
  async Urgent(page, check) {
    await btn(page, "6205-2RS").click();
    check("known part shows what can be sent", (await text(page)).includes("What we can send now"));
    check("the safer substitute is flagged", (await text(page)).includes("Fits, but check it suits this machine"));
    await page.locator("#p").fill("6205 2rs");
    check("any spelling of the part works", (await page.getByRole("radio").count()) >= 2);
    await page.getByRole("radio", { name: /Ikeja workshop/ }).click();
    check("site changes the delivery fee", (await text(page)).includes("₦3,500"));
    await page.getByRole("radio", { name: /6205-ZZ/ }).click();
    check("substitute needs a phone confirmation", (await btn(page, "Send it. Confirm the fit by phone.").count()) === 1);
    await page.getByRole("radio", { name: /6205-2RS/ }).click();
    await btn(page, "Send it now").click();
    await page.waitForTimeout(250);
    check("moves to the live view", (await text(page)).includes("Your part is moving"));
    const clock = () => page.$eval("[role=timer] span", (e) => e.textContent);
    const c1 = await clock();
    await page.waitForTimeout(2100);
    check("the clock really counts down", (await clock()) !== c1, c1 + " then " + (await clock()));
    await btn(page, "Preview the next step").click();
    check("rider stage reads correctly", (await text(page)).includes("On its way to Ikeja workshop"));
    await btn(page, "Preview the next step").click();
    check("delivered stage reads correctly", (await text(page)).includes("Delivered to Ikeja workshop"));
    await btn(page, "Start again").click();
    await page.locator("#p").fill("6305 2rs");
    check("no exact match warns plainly", (await text(page)).includes("no exact match in stock"));
    await page.locator("#p").fill("zzzz");
    check("unknown part offers the counter", (await text(page)).includes("Call the counter and we will find"));
  },
  async PasteList(page, check) {
    const rows = () => page.$$eval("section[aria-label='What we found'] > div", (e) => e.map((x) => x.innerText.replace(/\n/g, " | ")));
    const r = await rows();
    check("reads all six lines", r.length === 6, r.length);
    check("understands '6205-2rs x 20'", r[0].includes("6205-2RS") && r[0].includes("20 × ₦4,800"), r[0]);
    check("understands 'A42 - 6'", r[1].includes("A42") && r[1].includes("6 × ₦3,200"), r[1]);
    check("understands 'bearing 6204 2rs 10' and sees the shortage", r[2].includes("6204-2RS") && r[2].includes("8 in stock, 2 more"), r[2]);
    check("asks which seal for a bare 6205", r[3].includes("Which seal"), r[3]);
    check("understands '10B chain 5m'", r[4].includes("10B-1") && r[4].includes("5 m"), r[4]);
    check("unknown part is kept, not dropped", r[5].includes("XYZ-991") && r[5].includes("call you"), r[5]);
    check("summary counts each kind", (await text(page)).includes("4 lines priced, 1 to choose, 1 to check"));
    await btn(page, "6205-ZZ").click();
    check("choosing a seal prices it", (await text(page)).includes("5 lines priced, 1 to check"));
    await page.locator("#list").fill("");
    check("empty list explains itself", (await text(page)).includes("appears here as you type"));
    await btn(page, "Use Line 2's parts").click();
    check("machine list loads", (await rows()).length === 2);
    await page.getByRole("button", { name: "Add all to bag" }).click();
    check("add confirms", (await btn(page, "Added to bag").count()) === 1);
  },
  async ProductPage(page, check) {
    const hours = () => page.$$eval("section[aria-labelledby=runs] b", (e) => e.map((x) => x.textContent));
    const one = await hours();
    check("runtime bars show for 2 units first", one.length === 6);
    await btn(page, "1 unit").click();
    const single = await hours();
    await btn(page, "3 units").click();
    const three = await hours();
    check("more units means longer runtime", parseInt(three[0]) !== parseInt(single[0]) || three[0] !== single[0], single[0] + " to " + three[0]);
    await page.getByRole("button", { name: "About the handles" }).click();
    check("handle note opens", (await text(page)).includes("Carry handles"));
    await page.getByRole("button", { name: "About the status lights" }).click();
    check("note swaps to status lights", (await text(page)).includes("Four lit means full"));
    await page.getByRole("button", { name: "One more" }).click();
    await page.waitForTimeout(500);
    check("price rolls to two units", (await text(page)).includes("₦3,900,000"));
    await page.getByRole("button", { name: /Lekki/ }).click();
    check("branch can be chosen", (await page.getByRole("button", { name: /Lekki/ }).getAttribute("aria-pressed")) === "true");
    await page.getByRole("button", { name: "Add to bag" }).click();
    await page.waitForTimeout(700);
    check("add confirms and bag rises by 2", (await page.locator("nav a span").first().textContent()) === "4");
  },
};
