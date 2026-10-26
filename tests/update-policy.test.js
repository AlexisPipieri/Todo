'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldCheck, CHECK_INTERVAL_MS } = require('../src/update-policy');

const T = 1_700_000_000_000;

test('checks when it has never checked', () => {
  assert.equal(shouldCheck({ now: T, lastCheck: null, ready: null }), true);
});

test('does not re-check within the interval', () => {
  assert.equal(shouldCheck({ now: T + CHECK_INTERVAL_MS - 1, lastCheck: T, ready: null }), false);
});

test('checks again once the interval has passed', () => {
  assert.equal(shouldCheck({ now: T + CHECK_INTERVAL_MS, lastCheck: T, ready: null }), true);
});

test('never checks while an update is already downloaded', () => {
  assert.equal(shouldCheck({ now: T + 10 * CHECK_INTERVAL_MS, lastCheck: T, ready: '1.0.5' }), false);
  assert.equal(shouldCheck({ now: T, lastCheck: null, ready: '1.0.5' }), false);
});

test('a clock that moved backwards does not block checks', () => {
  assert.equal(shouldCheck({ now: T - 5000, lastCheck: T, ready: null }), true);
});

test('the default interval is one day', () => {
  assert.equal(CHECK_INTERVAL_MS, 86_400_000);
});
