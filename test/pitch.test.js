import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buttonMidi, buttonPitchName, midiToFrequency, parseNoteName } from '../js/pitch.js';

test('parseNoteName reads letter, accidental and octave', () => {
  assert.equal(parseNoteName('C4').midi, 60);
  assert.equal(parseNoteName('D4').midi, 62);
  assert.equal(parseNoteName('Bb3').midi, 58);
  assert.equal(parseNoteName('F#5').midi, 78);
  assert.equal(parseNoteName('C-1').midi, 0);
});

test('parseNoteName rejects invalid names', () => {
  assert.equal(parseNoteName('H4'), null);
  assert.equal(parseNoteName('D'), null);
  assert.equal(parseNoteName('d4'), null);
  assert.equal(parseNoteName('D#b4'), null);
});

test('buttonMidi follows the major scale from Do', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((button) => buttonMidi(60, button)), [60, 62, 64, 65, 67, 69, 71, 72]);
});

test('buttonMidi applies semitone and octave', () => {
  assert.equal(buttonMidi(60, 1, true), 61);
  assert.equal(buttonMidi(60, 1, false, true), 72);
  assert.equal(buttonMidi(60, 1, true, true), 73);
  assert.equal(buttonMidi(60, 8, false, true), 84);
});

test('buttonPitchName spells pitches in the key of Do', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8].map((button) => buttonPitchName('D4', button)),
    ['D', 'E', 'F♯', 'G', 'A', 'B', 'C♯', 'D'],
  );
  assert.equal(buttonPitchName('F4', 4), 'B♭');
  assert.equal(buttonPitchName('Bb3', 1), 'B♭');
  assert.equal(buttonPitchName('C#4', 8), 'C♯');
});

test('midiToFrequency uses A4 = 440 Hz', () => {
  assert.equal(midiToFrequency(69), 440);
  assert.equal(midiToFrequency(81), 880);
});
