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
  runningW: number; surgeW: number; dailyWh: number;
  kva: number | null; volts: 12 | 24 | 48;
  lithiumKwh: number; tubular: number; panels: number; panelW: number;
};

const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);
export const clean = (l: Load): Load => ({ ...l, watts: clamp(l.watts, 0, 20000), qty: Math.round(clamp(l.qty, 0, 99)), hours: clamp(l.hours, 0, 24) });

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
  const panels = dailyWh > 0 ? Math.ceil(dailyWh / sunHours / PANEL_LOSS / panelW) : 0;
  return { runningW, surgeW, dailyWh, kva, volts, lithiumKwh, tubular, panels, panelW };
}
