import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_EVENT_AGE, eventTime, keyControl, modifierTarget, slideTarget } from '../js/input.js';

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

test('number keys play buttons 1 to 8', () => {
  assert.deepEqual(keyControl('Digit1'), { type: 'note', button: 1 });
  assert.deepEqual(keyControl('Digit8'), { type: 'note', button: 8 });
  assert.equal(keyControl('Digit9'), null);
});

test('C raises a semitone and V an octave', () => {
  assert.deepEqual(keyControl('KeyC'), { type: 'modifier', sharp: true, octave: false });
  assert.deepEqual(keyControl('KeyV'), { type: 'modifier', sharp: false, octave: true });
  for (const code of ['KeyZ', 'KeyX', 'Comma', 'Period']) {
    assert.equal(keyControl(code), null);
  }
});

// The modifiers span 0 to 800 across, below the note buttons. The zone that
// holds both is one note button wide, 350 to 450.
const modifierRect = { left: 0, right: 800, top: 60, bottom: 120 };
const none = { sharp: false, octave: false };
const sharp = { sharp: true, octave: false };
const octave = { sharp: false, octave: true };
const both = { sharp: true, octave: true };

test('the left modifier is semitone and the right octave', () => {
  assert.deepEqual(modifierTarget(none, { x: 10, y: 90 }, modifierRect), sharp);
  assert.deepEqual(modifierTarget(none, { x: 349, y: 90 }, modifierRect), sharp);
  assert.deepEqual(modifierTarget(none, { x: 451, y: 90 }, modifierRect), octave);
  assert.deepEqual(modifierTarget(none, { x: 799, y: 119 }, modifierRect), octave);
});

test('the zone at the shared edge holds both modifiers', () => {
  assert.deepEqual(modifierTarget(none, { x: 351, y: 90 }, modifierRect), both);
  assert.deepEqual(modifierTarget(none, { x: 400, y: 90 }, modifierRect), both);
  assert.deepEqual(modifierTarget(none, { x: 449, y: 90 }, modifierRect), both);
});

test('a finger leaving the modifiers keeps what it held', () => {
  assert.deepEqual(modifierTarget(both, { x: 100, y: 30 }, modifierRect), both);
  assert.deepEqual(modifierTarget(sharp, { x: 900, y: 90 }, modifierRect), sharp);
});

test('a recent event time stamp is used', () => {
  assert.equal(eventTime(1000, 1012), 1000);
  assert.equal(eventTime(1000, 1000), 1000);
  assert.equal(eventTime(1000, 1000 + MAX_EVENT_AGE), 1000);
});

test('an old event time stamp gives way to the handling time', () => {
  assert.equal(eventTime(1000, 1001 + MAX_EVENT_AGE), 1001 + MAX_EVENT_AGE);
  assert.equal(eventTime(1000, 3000), 3000);
});

test('a time stamp from the future gives way to the handling time', () => {
  assert.equal(eventTime(1010, 1000), 1000);
});

// Touches logged on an iPad in Safari while a finger held the octave button.
// Each is [time stamp, handled at]. The first is the octave press; the next
// three were given its time stamp again, though they came later.
test('copied time stamps from Safari on iPad give way to the handling time', () => {
  const touches = [[38018, 38029], [38018, 38298], [38018, 38762], [38018, 38880], [39331, 39346]];
  assert.deepEqual(touches.map(([stamp, now]) => eventTime(stamp, now)), [38018, 38298, 38762, 38880, 39331]);
});
