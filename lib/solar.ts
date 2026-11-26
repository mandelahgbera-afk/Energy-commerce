// Solar sizing for the counter: what a customer runs goes in; the inverter, batteries and panels
// come out. Installer rules of thumb, not a design. The shop checks the site before it quotes.
// Watts and hours, never money, so plain numbers are fine here.
export type Load = { name: string; watts: number; qty: number; hours: number; motor?: boolean };

// Typical Nigerian home and shop loads. A motor (fridge, freezer, pump, AC) pulls about three
// times its running power for a moment as it starts.
export const presets: Load[] = [
  { name: 'LED bulb', watts: 10, qty: 6, hours: 6 },
  { name: 'Ceiling fan', watts: 75, qty: 2, hours: 8 },
  { name: 'Standing fan', watts: 55, qty: 1, hours: 8 },
  { name: 'TV, 43 inch LED', watts: 80, qty: 1, hours: 6 },
  { name: 'Decoder and router', watts: 30, qty: 1, hours: 8 },
  { name: 'Laptop', watts: 65, qty: 1, hours: 6 },
  { name: 'Desktop and monitor', watts: 200, qty: 1, hours: 6 },
  { name: 'Phone charging', watts: 10, qty: 3, hours: 3 },
  { name: 'Fridge', watts: 150, qty: 1, hours: 10, motor: true },
  { name: 'Deep freezer', watts: 200, qty: 1, hours: 12, motor: true },
  { name: 'Pumping machine, 1 HP', watts: 750, qty: 1, hours: 1, motor: true },
  { name: 'Air conditioner, 1 HP', watts: 900, qty: 1, hours: 6, motor: true },
  { name: 'Air conditioner, 1.5 HP', watts: 1300, qty: 1, hours: 6, motor: true },
  { name: 'Washing machine', watts: 500, qty: 1, hours: 1, motor: true },
  { name: 'Pressing iron', watts: 1000, qty: 1, hours: 0.5 },
  { name: 'Microwave', watts: 1000, qty: 1, hours: 0.3 },
];

export const inverterSizes = [1, 1.5, 2.5, 3.5, 5, 7.5, 10, 15, 20, 30];
const PF = 0.8; // inverter power factor: 1 kVA runs about 800 W
const MARGIN = 1.25; // never run an inverter flat out
const SURGE = 2; // most inverters take twice their rating for a few seconds
const EFF = 0.9; // inverter losses on the way out of the battery
const LITHIUM_DOD = 0.9;
const TUBULAR_DOD = 0.5; // lead-acid lasts if it is only ever half emptied
const TUBULAR_WH = 12 * 220;
const PANEL_LOSS = 0.75; // heat, dust, wiring and the charge controller

export type Plan = {
  runningW: number; surgeW: number; dailyWh: number; storeWh: number;
  kva: number | null; volts: 12 | 24 | 48;
  lithiumKwh: number; tubular: number; tubularAh: number; panels: number; panelW: number;
};

const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);
export const clean = (l: Load): Load => ({ ...l, watts: clamp(l.watts, 0, 20000), qty: Math.round(clamp(l.qty, 0, 99)), hours: clamp(l.hours, 0, 24) });

/** Panels of `panelW` that fill `dailyWh` on `sunHours` of sun, after losses. */
export const panelsFor = (dailyWh: number, panelW: number, sunHours = 4.5) => (dailyWh > 0 && panelW > 0 ? Math.ceil(dailyWh / sunHours / PANEL_LOSS / panelW) : 0);

export function size(loads: Load[], { backupDays = 1, sunHours = 4.5, panelW = 550 } = {}): Plan | null {
  const ls = loads.map(clean).filter((l) => l.watts > 0 && l.qty > 0);
  if (!ls.length) return null;
  const runningW = ls.reduce((s, l) => s + l.watts * l.qty, 0);
  const surgeW = ls.reduce((s, l) => s + l.watts * l.qty * (l.motor ? 3 : 1), 0);
  const dailyWh = ls.reduce((s, l) => s + l.watts * l.qty * l.hours, 0);
  const needKva = Math.max(runningW * MARGIN, surgeW / SURGE) / PF / 1000;
  const kva = inverterSizes.find((s) => s >= needKva - 1e-9) ?? null;
  const volts = (kva ?? 99) <= 1.5 ? 12 : (kva ?? 99) <= 3.5 ? 24 : 48;
  const storeWh = (dailyWh * backupDays) / EFF;
  const lithiumKwh = Math.ceil(storeWh / LITHIUM_DOD / 100) / 10;
  const series = volts / 12;
  const tubular = storeWh > 0 ? Math.ceil(storeWh / TUBULAR_DOD / (TUBULAR_WH * series)) * series : 0;
  const panels = panelsFor(dailyWh, panelW, sunHours);
  return { runningW, surgeW, dailyWh, storeWh, kva, volts, lithiumKwh, tubular, tubularAh: 220, panels, panelW };
}

// The public sizer fits the plan to the shop's own list, read from the product names ("5 kVA 48 V
// hybrid inverter", "550 W mono solar panel", "200Ah tubular battery"): the smallest inverter that is
// big enough sets the kVA and the bank's voltage, the biggest tubular battery sets the Ah, and the
// biggest panel sets the watts. The sizes on screen, the note and the matched set then all come from
// the same numbers. The counter still checks it in the quote.
export type Offer = { product: string; name: string; unit: string; price: number | string };
export type SetLine = Offer & { qty: number };
const read = (re: RegExp, s: string) => { const m = s.match(re); return m ? Number(m[1]) : null; };
const byName = (items: Offer[], kind: RegExp, size: RegExp) =>
  items.flatMap((i) => { const n = kind.test(i.name) ? read(size, i.name) : null; return n ? [{ i, n, v: read(/(\d+)\s*v\b/i, i.name) }] : []; }).sort((a, b) => a.n - b.n);
const invertersOn = (items: Offer[]) => byName(items, /inverter/i, /(\d+(?:\.\d+)?)\s*kva/i);
const lithiumOn = (items: Offer[]) => byName(items, /lithium/i, /(\d+(?:\.\d+)?)\s*kwh/i);
const tubularOn = (items: Offer[]) => byName(items, /tubular/i, /(\d+)\s*ah\b/i);
const panelsOn = (items: Offer[]) => byName(items, /panel/i, /(\d+)\s*w\b/i);
/** The biggest panel on the list, in watts. */
export const panelSize = (items: Offer[]) => panelsOn(items).pop()?.n ?? null;

/** The plan in this shop's goods: the inverter it will get, that inverter's voltage, its tubular Ah and panel watts. */
export function fitToShelf(plan: Plan, items: Offer[], sunHours = 4.5): Plan {
  const inverter = plan.kva ? invertersOn(items).find((x) => x.n >= plan.kva! - 1e-9) : undefined;
  const v = inverter?.v;
  const volts = v === 12 || v === 24 || v === 48 ? v : plan.volts;
  const tubularAh = tubularOn(items).pop()?.n ?? plan.tubularAh;
  const series = volts / 12;
  const tubular = plan.storeWh > 0 ? Math.ceil(plan.storeWh / TUBULAR_DOD / (12 * tubularAh * series)) * series : 0;
  const panelW = panelSize(items) ?? plan.panelW;
  return { ...plan, kva: inverter?.n ?? plan.kva, volts, tubularAh, tubular, panelW, panels: panelsFor(plan.dailyWh, panelW, sunHours) };
}

export function matchSet(plan: Plan, items: Offer[], sunHours = 4.5): SetLine[] {
  if (!plan.kva) return [];
  const p = fitToShelf(plan, items, sunHours);
  const out: SetLine[] = [];
  const inverter = invertersOn(items).find((x) => x.n >= p.kva! - 1e-9);
  if (inverter) out.push({ ...inverter.i, qty: 1 });
  const lithium = lithiumOn(items).filter((x) => !x.v || x.v === p.volts);
  const tubular = tubularOn(items).pop();
  if (p.storeWh > 0 && lithium.length) {
    const fit = lithium.find((x) => x.n >= p.lithiumKwh) ?? lithium[lithium.length - 1];
    out.push({ ...fit.i, qty: Math.ceil(p.lithiumKwh / fit.n - 1e-9) });
  } else if (tubular) out.push({ ...tubular.i, qty: p.tubular });
  const panel = panelsOn(items).pop();
  if (panel) out.push({ ...panel.i, qty: p.panels });
  return out.filter((l) => l.qty > 0);
}
