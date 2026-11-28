import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autoplayShare } from '../js/mix.js';

test('alone, autoplay is at its full level', () => {
  assert.equal(autoplayShare(1), 1);
});

test('autoplay is divided by the square root of the number of devices', () => {
  assert.equal(autoplayShare(4), 0.5);
  assert.ok(Math.abs(autoplayShare(2) - Math.SQRT1_2) < 1e-12);
});

test('no devices counts as one', () => {
  assert.equal(autoplayShare(0), 1);
});
