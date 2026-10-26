'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAtQuery, toLocalISO } = require('../src/date-parser');

// Wednesday 28 Oct 2026, mid-afternoon (time of day must not matter)
const NOW = new Date(2026, 9, 28, 15, 30);
const isos = (q, now = NOW) => parseAtQuery(q, now).map(r => r.iso);
const labels = (q, now = NOW) => parseAtQuery(q, now).map(r => r.label);

test('toLocalISO uses local calendar date, zero-padded', () => {
  assert.equal(toLocalISO(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('empty or unknown queries return nothing', () => {
  assert.deepEqual(parseAtQuery('', NOW), []);
  assert.deepEqual(parseAtQuery('   ', NOW), []);
  assert.deepEqual(parseAtQuery('xyz', NOW), []);
});

test('today and tomorrow, with prefixes', () => {
  assert.deepEqual(isos('today'), ['2026-10-28']);
  assert.deepEqual(isos('tom'), ['2026-10-29']);
  assert.deepEqual(labels('to'), ['Today', 'Tomorrow']);
});

test('weekday names and aliases resolve to the next occurrence, never today', () => {
  assert.deepEqual(isos('fri'), ['2026-10-30']);
  assert.deepEqual(isos('fr'), ['2026-10-30']);
  assert.deepEqual(isos('wed'), ['2026-11-04']);   // today is Wednesday: next week
  assert.deepEqual(isos('  FRI  '), ['2026-10-30']);
});

test('"next <day>" lands in the following week', () => {
  assert.deepEqual(isos('next fri'), ['2026-11-06']);
  assert.deepEqual(isos('next mon'), ['2026-11-09']);
  assert.equal(parseAtQuery('next', NOW)[0].label, 'Next Sunday');
});

test('"in N days" with singular/plural labels and bounds', () => {
  assert.deepEqual(parseAtQuery('in 3', NOW).map(r => [r.label, r.iso]), [['In 3 days', '2026-10-31']]);
  assert.equal(labels('in 1 day')[0], 'In 1 day');
  assert.deepEqual(isos('in 0'), []);
  assert.deepEqual(isos('in 400'), []);
  assert.deepEqual(isos('in 5 days'), ['2026-11-02']);
});

test('month + day picks the next occurrence', () => {
  assert.deepEqual(isos('dec 25'), ['2026-12-25']);
  assert.deepEqual(isos('may 5'), ['2027-05-05']);   // already past this year
  assert.deepEqual(isos('sept 9'), ['2027-09-09']);
});

test('an explicit day equal to today stays today', () => {
  assert.deepEqual(isos('oct 28'), ['2026-10-28']);
  assert.deepEqual(isos('oct 27'), ['2027-10-27']);
});

test('a bare month points at the 1st of its next occurrence', () => {
  assert.deepEqual(isos('nov'), ['2026-11-01']);
  assert.deepEqual(isos('oct'), ['2027-10-01']);
});

test('ambiguous month prefixes return every match', () => {
  assert.deepEqual(labels('ma'), ['Mar', 'May']);
});

test('impossible dates are skipped, never shifted into the next month', () => {
  assert.deepEqual(isos('feb 31'), []);
  assert.deepEqual(isos('apr 31'), []);
  assert.deepEqual(isos('feb 30'), []);
});

test('Feb 29 resolves to the next leap year', () => {
  assert.deepEqual(isos('feb 29'), ['2028-02-29']);
});

test('year rollover: January from late December', () => {
  const dec31 = new Date(2026, 11, 31, 23, 59);
  assert.deepEqual(isos('jan 1', dec31), ['2027-01-01']);
  assert.deepEqual(isos('tomorrow', dec31), ['2027-01-01']);
});

test('duplicates collapse and results cap at 6', () => {
  // "tomorrow" is Thursday: typing "t" must not list Thursday twice
  const dates = isos('t');
  assert.equal(new Set(dates).size, dates.length);
  assert.ok(parseAtQuery('m', NOW).length <= 6);
});

test('sublabel is a readable date', () => {
  assert.equal(parseAtQuery('tomorrow', NOW)[0].sublabel, 'Oct 29, 2026');
});
