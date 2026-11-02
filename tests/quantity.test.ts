import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toQty, roundQty } from '../lib/quantity.ts';

test('typed quantities pass through, normalised', () => {
  assert.equal(toQty('2.5'), '2.5');
  assert.equal(toQty('2.50'), '2.5');
  assert.equal(toQty('0.125'), '0.125');
  assert.equal(toQty('3'), '3');
  assert.equal(toQty('2.413'), '2.413');
});

test('quantities the database refuses are refused here first', () => {
  for (const bad of ['0.1234', '-1', '0', 'abc', '', '1e3', '0.30000000000000004']) {
    assert.throws(() => toQty(bad), /bad_qty/, bad);
  }
});

test('a computed float is rounded in exactly one place', () => {
  assert.equal(roundQty(0.1 + 0.2), '0.3');
  assert.equal(roundQty(2.4130000000000003), '2.413');
  assert.equal(roundQty(1), '1');
  assert.throws(() => roundQty(Number.NaN), /bad_qty/);
  assert.throws(() => roundQty(0), /bad_qty/);
});
