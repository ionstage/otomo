import assert from 'node:assert/strict';
import { test } from 'node:test';
import { slideTarget } from '../js/input.js';

// Eight buttons, each 100 wide and side by side, from y 0 to 60.
const rects = Array.from({ length: 8 }, (_, i) => ({
  left: i * 100, right: (i + 1) * 100, top: 0, bottom: 60,
}));

test('a finger staying on its button keeps it', () => {
  assert.equal(slideTarget(3, { x: 250, y: 30 }, rects), 3);
});

test('crossing a boundary switches to the button under the finger', () => {
  // Button 3 spans 200 to 300.
  assert.equal(slideTarget(3, { x: 299, y: 30 }, rects), 3);
  assert.equal(slideTarget(3, { x: 300, y: 30 }, rects), 4);
  assert.equal(slideTarget(3, { x: 200, y: 30 }, rects), 3);
  assert.equal(slideTarget(3, { x: 199, y: 30 }, rects), 2);
  assert.equal(slideTarget(3, { x: 650, y: 30 }, rects), 7);
});

test('leaving the buttons keeps the held button', () => {
  assert.equal(slideTarget(3, { x: 650, y: -10 }, rects), 3);
  assert.equal(slideTarget(3, { x: 650, y: 70 }, rects), 3);
  assert.equal(slideTarget(8, { x: 900, y: 30 }, rects), 8);
});
