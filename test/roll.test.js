import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scrollRows } from '../js/roll.js';

test('scroll keeps the first row at the top', () => {
  assert.equal(scrollRows(0, 8), 0);
  assert.equal(scrollRows(4, 8), 0);
  assert.equal(scrollRows(8, 8), 0);
});

test('scroll moves one row per row of music after the first', () => {
  assert.equal(scrollRows(12, 8), 0.5);
  assert.equal(scrollRows(16, 8), 1);
  assert.equal(scrollRows(20, 8), 1.5);
});

test('scroll ends with the last row at the top', () => {
  // A song of three rows ends at beat 24.
  assert.equal(scrollRows(24, 8), 2);
});
