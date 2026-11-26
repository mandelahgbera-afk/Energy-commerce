import { test } from 'node:test';
import assert from 'node:assert/strict';
import { size, type Load } from '../lib/solar.ts';

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
