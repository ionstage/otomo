import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rowLayout, scrollRows } from '../js/roll.js';

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

// At full scale a sixteenth note is 44.5 px wide, so the narrowest row of
// four beats is 712 px and the widest 890 px. The canvas has 16 px margins.
test('a row of four beats grows to 1.25 times its narrowest width', () => {
  assert.deepEqual(rowLayout(1600, 4), { scale: 1, beatWidth: 222.5, width: 890 });
  assert.deepEqual(rowLayout(832, 4), { scale: 1, beatWidth: 200, width: 800 });
});

test('a row of three beats is three quarters as wide as one of four', () => {
  assert.deepEqual(rowLayout(1600, 3), { scale: 1, beatWidth: 222.5, width: 667.5 });
});

test('a row that does not fit is scaled down, but not below 0.75', () => {
  assert.deepEqual(rowLayout(566, 4), { scale: 0.75, beatWidth: 133.5, width: 534 });
  assert.deepEqual(rowLayout(432, 4), { scale: 0.75, beatWidth: 100, width: 400 });
});
