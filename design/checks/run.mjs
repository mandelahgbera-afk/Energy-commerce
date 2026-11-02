// Drives each design screen in headless Chrome: runs its scenario, checks phone overflow and small tap targets, saves screenshots.
// Usage: node run.mjs Category ProductPage ...   (screens need the local preview on :4173)
import { chromium } from "playwright-core";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { scenarios } = await import(pathToFileURL(join(here, "scenarios.mjs")).href);
const names = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
let failed = 0;

// A slow screenshot on this laptop is not a product failure, so it warns and the run carries on.
const shot = async (page, file) => {
  try { await page.screenshot({ path: join(here, "shots", file), fullPage: true, scale: "css", timeout: 60000 }); }
  catch { console.log("  note  screenshot skipped: " + file); }
};

const load = async (ctx, name) => {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (t.includes("{{") || t.includes("404")) return; // the runtime's first pass over unfilled holes, and the favicon
    errors.push("console: " + t);
  });
  await page.goto(`http://127.0.0.1:4173/${name}.dc.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  return { page, errors };
};

for (const name of names) {
  console.log(`\n== ${name}`);
  const results = [];
  const check = (label, ok, detail) => {
    results.push(ok);
    if (!ok) failed++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail !== undefined ? `  [${detail}]` : ""}`);
  };

  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await desk.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  const d = await load(desk, name);
  await shot(d.page, `${name}-desktop.png`, check);
  if (scenarios[name]) {
    try { await scenarios[name](d.page, check); }
    catch (e) { check("scenario finished", false, String(e.message).split(String.fromCharCode(10))[0]); }
  }
  await shot(d.page, `${name}-desktop-after.png`, check);
  check("no script errors on desktop", d.errors.length === 0, d.errors.slice(0, 2).join(" | ") || undefined);
  await desk.close();

  const phone = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p = await load(phone, name);
  const fit = await p.page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const over = [...document.querySelectorAll("body *")]
      .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.right > w + 1 && !e.closest("svg") && !e.closest("[data-scroll]"); })
      .slice(0, 4).map((e) => e.tagName + ":" + (e.textContent || "").trim().slice(0, 24));
    const small = [...document.querySelectorAll("button, input:not([type=range]), select, a")]
      .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.height < 40 && !(e.tagName === "A" && getComputedStyle(e).display === "inline"); })
      .slice(0, 6).map((e) => (e.textContent || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 22) + ":" + Math.round(e.getBoundingClientRect().height));
    return { sw: document.documentElement.scrollWidth, w, over, small };
  });
  check("phone: no sideways scroll", fit.sw <= fit.w && fit.over.length === 0, fit.over.join(", ") || undefined);
  check("phone: tap targets at least 40px", fit.small.length === 0, fit.small.join(", ") || undefined);
  await shot(p.page, `${name}-phone.png`, check);
  check("no script errors on phone", p.errors.length === 0, p.errors.slice(0, 2).join(" | ") || undefined);
  await phone.close();
  console.log(`  ${results.filter(Boolean).length}/${results.length} passed`);
}
await browser.close();
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);
