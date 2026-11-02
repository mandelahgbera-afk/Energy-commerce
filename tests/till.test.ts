import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cashNotes, countedKobo, noteKobo, noteCount } from '../lib/till.ts';
import { formatNaira } from '../lib/money.ts';

test('a drawer of notes becomes kobo, not naira', () => {
  assert.equal(countedKobo({ 1000: '243' }), 24300000n);
  assert.equal(formatNaira(countedKobo({ 1000: '243' })), '₦243,000.00');
  assert.equal(countedKobo({ 1000: '2', 500: '1', 50: '3', 5: '1' }), 265500n);
});

test('every note in circulation can be counted, down to ₦5', () => {
  assert.deepEqual([...cashNotes], [1000, 500, 200, 100, 50, 20, 10, 5]);
  assert.equal(noteKobo(5, '1'), 500n);
});

test('typed counts are digits only, and an empty box is zero', () => {
  assert.equal(noteCount(''), 0n);
  assert.equal(noteCount(undefined), 0n);
  assert.equal(noteCount('1,2'), 12n);
  assert.equal(noteCount('1234567'), 12345n);
  assert.equal(countedKobo({}), 0n);
});
