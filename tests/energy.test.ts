import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageWords, stageColour, num, chartPoints, plot, poly, monthCount, dayText, hoursText } from '../lib/energy.ts';

test('every verdict stage has plain words and a calm colour', () => {
  assert.equal(stageWords('new'), 'Young battery');
  assert.equal(stageWords('mid'), 'Settled');
  assert.equal(stageWords('ageing'), 'Ageing');
  assert.equal(stageWords('due'), 'Due for a check');
  assert.equal(stageWords('covered'), 'Under warranty');
  assert.equal(stageWords('uncovered'), 'Out of warranty');
  assert.equal(stageWords('something new'), 'Unknown');
  assert.equal(stageColour('new'), '#0F8F6B');
  assert.equal(stageColour('due'), '#D97A0B');
});

test('readings read numbers whether Supabase sent them as strings or numbers', () => {
  assert.equal(num(6.5), 6.5);
  assert.equal(num('6.5'), 6.5);
  assert.equal(num(null), null);
  assert.equal(num(undefined), null);
  assert.equal(num(''), null);
});

test('a chart only draws readings that have the figure, oldest first', () => {
  const readings = [
    { taken_on: '2026-11-10', backup_hours: 8, voltage_mv: null, charge_pct: null, energy_kwh: null, felt: null },
    { taken_on: '2026-11-05', backup_hours: null, voltage_mv: null, charge_pct: 80, energy_kwh: null, felt: null },
    { taken_on: '2026-11-01', backup_hours: '6', voltage_mv: null, charge_pct: '75', energy_kwh: null, felt: null },
    { taken_on: '2026-11-12', backup_hours: null, voltage_mv: null, charge_pct: null, energy_kwh: null, felt: 'weaker' },
  ];
  const hours = chartPoints(readings, 'hours');
  assert.deepEqual(hours.map((r) => r.value), [6, 8]);
  assert.equal(hours[0].taken_on, '2026-11-01');
  const charge = chartPoints(readings, 'charge');
  assert.deepEqual(charge.map((r) => r.value), [75, 80]);
  assert.equal(chartPoints([], 'hours').length, 0);
});

test('the plot spans the figures, keeps one point in the middle, and never divides by zero', () => {
  const one = plot([{ value: 6.5 }], 320, 120);
  assert.equal(one.pts.length, 1);
  assert.equal(one.pts[0].x, 160);
  assert.equal(one.min, 0);
  assert.equal(one.max, 6.5);
  assert.ok(one.pts[0].y < 120);
  const flat = plot([{ value: 5 }, { value: 5 }], 320, 120);
  assert.equal(flat.pts[0].y, flat.pts[1].y, 'a flat series stays flat');
  assert.equal(plot([], 320, 120).pts.length, 0);
});

test('a polyline path starts with M and joins every point', () => {
  assert.equal(poly([]), '');
  const p = poly([{ x: 0, y: 10 }, { x: 100, y: 20 }, { x: 200, y: 5 }]);
  assert.equal(p, 'M0.0,10.0 L100.0,20.0 L200.0,5.0');
});

test('months and days read in plain words', () => {
  assert.equal(monthCount(1), '1 month');
  assert.equal(monthCount('13'), '13 months');
  assert.equal(monthCount(0), '0 months');
  assert.equal(monthCount(null), '');
  assert.equal(dayText('2026-11-19'), '19 Nov');
  assert.equal(dayText('2026-01-03'), '3 Jan');
  // a warranty's end a year on must not read as already past
  assert.equal(dayText('2027-08-14', true), '14 Aug 2027');
  assert.equal(hoursText(6.5), '6.5');
  assert.equal(hoursText('8'), '8');
  assert.equal(hoursText(null), '');
});
