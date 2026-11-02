import { test } from 'node:test';
import assert from 'node:assert/strict';
import { koboToNaira, nairaToKobo, formatNaira } from '../lib/money.ts';

test('kobo becomes a decimal string, never a float', () => {
  assert.equal(koboToNaira(150050), '1500.50');
  assert.equal(koboToNaira(0), '0.00');
  assert.equal(koboToNaira(5), '0.05');
  assert.equal(koboToNaira(-150050), '-1500.50');
  assert.equal(koboToNaira(150050n), '1500.50');
  assert.equal(koboToNaira('123456789'), '1234567.89');
});

test('typed naira becomes kobo with string maths', () => {
  assert.equal(nairaToKobo('1,500.50'), 150050n);
  assert.equal(nairaToKobo('₦1500.5'), 150050n);
  assert.equal(nairaToKobo('1500'), 150000n);
  assert.equal(nairaToKobo('0.07'), 7n);
  assert.equal(nairaToKobo('1,000'), 100000n);
  assert.equal(nairaToKobo(''), 0n);
  assert.equal(nairaToKobo('-12.34'), -1234n);
});

test('nonsense naira is refused, not guessed', () => {
  for (const bad of ['abc', '1.234', '1,2,3', '12-', '.', '1.2.3']) {
    assert.throws(() => nairaToKobo(bad), /bad_naira/, bad);
  }
});

test('naira is shown grouped and signed', () => {
  assert.equal(formatNaira(150050), '₦1,500.50');
  assert.equal(formatNaira(10000000000n), '₦100,000,000.00');
  assert.equal(formatNaira(-50), '-₦0.50');
  assert.equal(formatNaira(7), '₦0.07');
});
