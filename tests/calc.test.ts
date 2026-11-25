import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fresh, press, display, type Calc } from '../lib/calc.ts';

const run = (keys: string[], s: Calc = fresh) => keys.reduce(press, s);
const out = (...keys: string[]) => display(run(keys));

test('decimals are exact, never floats', () => {
  assert.equal(out('0', '.', '1', '+', '0', '.', '2', '='), '0.3');
  assert.equal(out('1', '0', '÷', '3', '='), '3.333333');
  assert.equal(out('2', '÷', '3', '='), '0.666667');
});

test('works like a phone calculator, one step at a time', () => {
  assert.equal(out('2', '+', '3', '×', '4', '='), '20');
  assert.equal(out('1', '2', '0', '0', '0', '0', '0', '×', '3', '='), '3,600,000');
  assert.equal(out('5', '−', '8', '='), '-3');
  assert.equal(out('9', '=', '4', '+', '1', '='), '5', 'a digit after = starts a new sum');
  assert.equal(out('0', '0', '7'), '7');
  assert.equal(out('1', '2', '⌫'), '1');
});

test('percent and VAT give the shop answers', () => {
  assert.equal(out('2', '0', '0', '+', '1', '0', '%', '='), '220');
  assert.equal(out('1', '0', '%'), '0.1');
  assert.equal(out('1', '0', '0', '0', 'vat+'), '1,075');
  assert.equal(out('1', '0', '7', '5', 'vat-'), '1,000');
});

test('dividing by zero says so, and any key starts again', () => {
  assert.equal(out('5', '÷', '0', '='), 'Can\u2019t do that');
  assert.equal(out('5', '÷', '0', '=', '7'), '7');
  assert.equal(out('5', '÷', '0', '=', 'C'), '0');
});
