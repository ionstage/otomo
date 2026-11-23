import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buttonMidi, buttonPitchName, midiToFrequency, parseNoteName, scalePosition } from '../js/pitch.js';

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
  const c = scalePosition('C4');
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((button) => buttonMidi(c, button)), [60, 62, 64, 65, 67, 69, 71, 72]);
});

test('buttonMidi starts the scale from the note on button 1', () => {
  // Do on D, button 1 on the Sol below it.
  const sol = scalePosition('D4', 'A3');
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((button) => buttonMidi(sol, button)), [57, 59, 61, 62, 64, 66, 67, 69]);
  // A minor: Do on C, button 1 on La.
  const la = scalePosition('C4', 'A3');
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map((button) => buttonMidi(la, button)), [57, 59, 60, 62, 64, 65, 67, 69]);
  // The octave of Do does not matter, only its note.
  assert.deepEqual(scalePosition('D2', 'A3'), { ...sol, doName: 'D2' });
});

test('buttonMidi applies semitone and octave', () => {
  const c = scalePosition('C4');
  assert.equal(buttonMidi(c, 1, true), 61);
  assert.equal(buttonMidi(c, 1, false, true), 72);
  assert.equal(buttonMidi(c, 1, true, true), 73);
  assert.equal(buttonMidi(c, 8, false, true), 84);
  assert.equal(buttonMidi(scalePosition('C4', 'A3'), 5, true), 65);
});

test('scalePosition rejects a button 1 outside the scale', () => {
  assert.equal(scalePosition('C4', 'F#3'), null);
  assert.equal(scalePosition('D4', 'F3'), null);
  assert.equal(scalePosition('H4'), null);
  assert.equal(scalePosition('C4', 'X3'), null);
  assert.equal(scalePosition('D4', 'Gb3').step, 2);
});

test('buttonPitchName spells pitches in the key of Do', () => {
  const name = (doName, button1, button) => buttonPitchName(scalePosition(doName, button1), button);
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8].map((button) => name('D4', 'D4', button)),
    ['D', 'E', 'F♯', 'G', 'A', 'B', 'C♯', 'D'],
  );
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8].map((button) => name('D4', 'A3', button)),
    ['A', 'B', 'C♯', 'D', 'E', 'F♯', 'G', 'A'],
  );
  assert.equal(name('F4', 'F4', 4), 'B♭');
  assert.equal(name('Bb3', 'Bb3', 1), 'B♭');
  assert.equal(name('C#4', 'C#4', 8), 'C♯');
  assert.equal(name('Bb3', 'F3', 4), 'B♭');
});

test('midiToFrequency uses A4 = 440 Hz', () => {
  assert.equal(midiToFrequency(69), 440);
  assert.equal(midiToFrequency(81), 880);
});
