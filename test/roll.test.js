import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bounce, rowLayout, rowSpace, scrollRows, squash } from '../js/roll.js';

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

test('with a title, scroll starts earlier at the same pace', () => {
  // A title half a row tall: the view starts on it and moves from halfway
  // through the first row, so it reaches the first row with the line at
  // the second.
  assert.equal(scrollRows(0, 8, 0.5), -0.5);
  assert.equal(scrollRows(4, 8, 0.5), -0.5);
  assert.equal(scrollRows(6, 8, 0.5), -0.25);
  assert.equal(scrollRows(8, 8, 0.5), 0);
  assert.equal(scrollRows(12, 8, 0.5), 0.5);
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

test('the triangles are closest to the line exactly on each beat', () => {
  assert.equal(bounce(0), 0);
  assert.equal(bounce(3), 0);
  assert.equal(bounce(-4), 0);
});

test('the triangles are furthest from the line halfway between beats', () => {
  assert.equal(bounce(0.5), 1);
  assert.equal(bounce(-2.5), 1);
  assert.equal(bounce(1.25), 0.75);
});

test('the bounce is the same through the count-in as in the song', () => {
  assert.equal(bounce(-3.75), bounce(0.25));
});

test('the display area reaches past the modifier marks on every screen', () => {
  // The marks reach 26 px above the head.
  assert.equal(rowSpace(false).reach, 40);
  assert.equal(rowSpace(true).reach, 30);
});

test('rows are 16 px apart on every screen', () => {
  assert.equal(rowSpace(false).gap, 16);
  assert.equal(rowSpace(true).gap, 16);
});

test('short screens keep less space above the first row', () => {
  assert.equal(rowSpace(false).top, 40);
  assert.equal(rowSpace(true).top, 24);
});

test('on short screens a row keeps its narrowest width', () => {
  assert.deepEqual(rowLayout(884, 4, true), { scale: 1, beatWidth: 178, width: 712 });
  assert.deepEqual(rowLayout(566, 4, true), { scale: 0.75, beatWidth: 133.5, width: 534 });
});

test('the triangles squash fully as they touch on the beat', () => {
  assert.equal(squash(0), 1);
  assert.equal(squash(-2), 1);
});

test('the triangles are back in shape for the middle of the bounce', () => {
  assert.equal(squash(0.5), 0);
  assert.equal(squash(0.25), 0);
  assert.ok(squash(0.05) > 0 && squash(0.05) < 1);
});
