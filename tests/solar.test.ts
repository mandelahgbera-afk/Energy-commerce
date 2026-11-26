import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitToShelf, matchSet, panelSize, size, type Load, type Plan } from '../lib/solar.ts';

const flat: Load[] = [
  { name: 'LED bulb', watts: 10, qty: 10, hours: 6 },
  { name: 'Ceiling fan', watts: 75, qty: 2, hours: 8 },
  { name: 'TV', watts: 60, qty: 1, hours: 5 },
];

test('a small flat: lights, fans and a TV', () => {
  const p = size(flat)!;
  assert.equal(p.runningW, 310);
  assert.equal(p.dailyWh, 2100);
  assert.equal(p.kva, 1); // 310 W x 1.25 / 0.8 = 484 VA
  assert.equal(p.volts, 12);
  assert.equal(p.lithiumKwh, 2.6); // 2100 / 0.9 / 0.9 = 2593 Wh
  assert.equal(p.tubular, 2); // 2333 / 0.5 = 4667 Wh, 2640 Wh each
  assert.equal(p.panels, 2); // 2100 / 4.5 / 0.75 = 622 W of 550 W panels
});

test('a pumping machine is sized by its start, and the bank fills whole 24 V strings', () => {
  const p = size([...flat, { name: 'Pump', watts: 750, qty: 1, hours: 1, motor: true }])!;
  assert.equal(p.runningW, 1060);
  assert.equal(p.surgeW, 2560);
  assert.equal(p.kva, 2.5); // max(1325, 1280) / 0.8 = 1656 VA
  assert.equal(p.volts, 24);
  assert.equal(p.tubular % 2, 0);
  assert.equal(p.tubular, 4);
});

test('nothing sensible in means no plan, and wild numbers are held in range', () => {
  assert.equal(size([]), null);
  assert.equal(size([{ name: 'x', watts: 0, qty: 3, hours: 5 }]), null);
  const p = size([{ name: 'x', watts: 100, qty: 1, hours: 99 }])!;
  assert.equal(p.dailyWh, 2400);
  assert.equal(size([{ name: 'x', watts: Number.NaN, qty: 1, hours: 1 }]), null);
});

test('more backup days, more battery; too big for any inverter says so', () => {
  assert.ok(size(flat, { backupDays: 2 })!.lithiumKwh > size(flat)!.lithiumKwh);
  assert.equal(size([{ name: 'Factory', watts: 20000, qty: 99, hours: 1 }])!.kva, null);
});

// Named the way the demo shop names them, with a charge controller and a car battery as decoys.
const shelf = [
  ['INV-3K', '3 kVA 24 V hybrid inverter'], ['INV-5K', '5 kVA 48 V hybrid inverter'], ['INV-10K', '10 kVA 48 V hybrid inverter'],
  ['CC-60', '60 A MPPT charge controller'], ['LI-5K', '5 kWh 48 V lithium battery'], ['LI-10K', '10 kWh 48 V lithium battery'],
  ['TB-200', '200Ah tubular battery'], ['TB-220', '220 Ah tubular battery'], ['CB-75', 'Car battery, 75 Ah'],
  ['SP-450M', '450 W mono solar panel'], ['SP-550M', '550 W mono solar panel'], ['SP-600B', '600 W bifacial solar panel'],
].map(([product, name]) => ({ product, name, unit: 'each', price: 100 }));
const picks = (lines: { product: string; qty: number }[]) => Object.fromEntries(lines.map((l) => [l.product, l.qty]));

test('a small flat gets the smallest inverter, tubular batteries at its 24 V, and the biggest panel', () => {
  // 1 kVA is enough, but the smallest on the list is 3 kVA at 24 V, and no lithium is 24 V.
  assert.deepEqual(picks(matchSet(size(flat)!, shelf)), { 'INV-3K': 1, 'TB-220': 2, 'SP-600B': 2 });
});

test('an air conditioner needs the 5 kVA at 48 V, so the bank is 48 V lithium', () => {
  const p = size([...flat, { name: 'AC', watts: 1300, qty: 1, hours: 6, motor: true }])!;
  assert.equal(p.kva, 3.5);
  assert.equal(p.lithiumKwh, 12.3); // 9900 Wh / 0.9 / 0.9
  assert.deepEqual(picks(matchSet(p, shelf)), { 'INV-5K': 1, 'LI-10K': 2, 'SP-600B': 5 });
});

test('what the shop does not stock is left out, and a system too big for one inverter matches nothing', () => {
  assert.deepEqual(picks(matchSet(size(flat)!, shelf.filter((i) => /panel/i.test(i.name)))), { 'SP-600B': 2 });
  assert.deepEqual(matchSet(size([{ name: 'Factory', watts: 20000, qty: 99, hours: 1 }])!, shelf), []);
});

test("sized with the shop's own biggest panel, the sizes and the matched set count the same panels", () => {
  const w = panelSize(shelf)!;
  assert.equal(w, 600);
  const homes: Load[][] = [flat, [...flat, { name: 'AC', watts: 1300, qty: 1, hours: 6, motor: true }]];
  for (const loads of homes) {
    const p: Plan = size(loads, { panelW: w })!;
    assert.equal(p.panelW, 600);
    assert.equal(picks(matchSet(p, shelf))['SP-600B'], p.panels);
  }
  assert.equal(panelSize(shelf.filter((i) => !/panel/i.test(i.name))), null);
});

test("fitted to the shop, the plan's battery count is the set's: a 48 V inverter means 48 V strings", () => {
  const noLithium = shelf.filter((i) => !/lithium/i.test(i.name));
  const raw = size([...flat, { name: 'AC', watts: 1300, qty: 1, hours: 6, motor: true }])!;
  assert.deepEqual([raw.kva, raw.volts, raw.tubular], [3.5, 24, 10]); // unfitted: 24 V strings of 220 Ah
  const p = fitToShelf(raw, noLithium);
  assert.deepEqual([p.kva, p.volts, p.tubularAh, p.tubular, p.panelW, p.panels], [5, 48, 220, 12, 600, 5]);
  assert.deepEqual(picks(matchSet(p, noLithium)), { 'INV-5K': 1, 'TB-220': 12, 'SP-600B': 5 });
  // Only 200 Ah on the shelf: the plan counts 200 Ah batteries, as the set does.
  const only200 = noLithium.filter((i) => i.product !== 'TB-220');
  const q = fitToShelf(size(flat)!, only200);
  assert.equal(q.tubularAh, 200);
  assert.equal(picks(matchSet(q, only200))['TB-200'], q.tubular);
  // Fitting twice changes nothing, so the set matched from a fitted plan is the same set.
  assert.deepEqual(fitToShelf(p, noLithium), p);
});
