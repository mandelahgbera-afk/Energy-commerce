import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineTotalKobo, discountedUnitPrice, saleTotals, saleBlocker, qtyToThousandths } from '../lib/sale-math.ts';

test('line totals match the database rounding exactly', () => {
  assert.equal(lineTotalKobo(3333n, '2.5'), 8333n); // the belt scene in the database
  assert.equal(lineTotalKobo(1000000n, '1'), 1000000n);
  assert.equal(lineTotalKobo(1000000n, '0.125'), 125000n);
  assert.equal(lineTotalKobo(9500n, '2.5'), 23750n);
  assert.equal(qtyToThousandths('2.413'), 2413n);
});

test('a discount asks for the same unit price the database would', () => {
  assert.equal(discountedUnitPrice(1000000n, 5), 950000n);
  assert.equal(discountedUnitPrice(1000000n, 9), 910000n);
  assert.equal(discountedUnitPrice(3333n, 3), 3233n); // round(3333 * .97)
});

test('totals add up and a discount lands on the total once', () => {
  const lines = [
    { productId: 'a', name: 'belt', sku: 'B', unitPriceKobo: 3333n, qty: '2.5', needsSerials: false, serials: [] },
    { productId: 'b', name: 'bearing', sku: 'C', unitPriceKobo: 480000n, qty: '2', needsSerials: false, serials: [] },
  ];
  const t = saleTotals(lines, 3);
  assert.equal(t.subtotalKobo, 968333n);
  assert.equal(t.discountKobo, 29050n);
  assert.equal(t.totalKobo, 939283n);
  assert.equal(t.unitPrices[0], 3233n);
});

test('the blocker list follows the order the database refuses', () => {
  const line = { productId: 'a', name: 'battery', sku: 'B', unitPriceKobo: 100000n, qty: '1', needsSerials: true, serials: [] };
  const belt = { ...line, name: 'belt', needsSerials: false };
  assert.deepEqual(saleBlocker([], null, null, 0, 5), { kind: 'empty' });
  assert.deepEqual(saleBlocker([line], null, null, 0, 5), { kind: 'serial', line: 'battery' });
  assert.deepEqual(saleBlocker([{ ...line, serials: ['X'] }], null, null, 9, 5), { kind: 'discount', limitPct: 5, askedPct: 9 });
  assert.deepEqual(saleBlocker([belt], null, null, 3, 5), { kind: 'method' });
  assert.deepEqual(saleBlocker([belt], 'Cash', null, 0, 5, false), { kind: 'till' });
  assert.deepEqual(saleBlocker([belt], 'Cash', null, 0, 5), { kind: 'tender' });
  assert.equal(saleBlocker([belt], 'Cash', 0n, 0, 5), null);
});
