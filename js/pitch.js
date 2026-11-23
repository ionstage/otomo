// Note names, MIDI numbers and the movable major scale.

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

// Semitones above Do for each step of the major scale.
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

// Semitones above Do for a scale step counted from Do, which may go past Ti.
function stepSemitones(step) {
  return 12 * Math.floor(step / 7) + MAJOR[step % 7];
}

// Parses a name such as "D4", "Bb3" or "F#5". Returns null if it is invalid.
export function parseNoteName(name) {
  const match = /^([A-G])(#|b)?(-?\d+)$/.exec(name);
  if (!match) {
    return null;
  }
  const [, letter, accidental, octaveText] = match;
  const letterIndex = LETTERS.indexOf(letter);
  const alter = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  const octave = Number(octaveText);
  const midi = (octave + 1) * 12 + LETTER_SEMITONES[letterIndex] + alter;
  return { letterIndex, alter, octave, midi };
}

// A scale position: the major scale of Do, with the note `button1Name` of it on
// button 1. `step` is that note's step above Do, from 0 (Do) to 6 (Ti). Returns
// null if a name is invalid or `button1Name` is not in the scale.
export function scalePosition(doName, button1Name = doName) {
  const tonic = parseNoteName(doName);
  const first = parseNoteName(button1Name);
  if (!tonic || !first) {
    return null;
  }
  const step = MAJOR.indexOf((((first.midi - tonic.midi) % 12) + 12) % 12);
  if (step < 0) {
    return null;
  }
  return { doName, button1Name, step, button1Midi: first.midi };
}

export function buttonMidi(position, button, sharp = false, octave = false) {
  const { step, button1Midi } = position;
  return button1Midi + stepSemitones(step + button - 1) - MAJOR[step] + (sharp ? 1 : 0) + (octave ? 12 : 0);
}

// The pitch name, without octave, that a button plays at `position`. The
// spelling follows the key, so Do = D gives F♯ for Mi, not G♭.
export function buttonPitchName(position, button) {
  const tonic = parseNoteName(position.doName);
  const step = position.step + button - 1;
  const letterIndex = (tonic.letterIndex + step) % 7;
  const semitone = LETTER_SEMITONES[tonic.letterIndex] + tonic.alter + stepSemitones(step);
  let alter = (((semitone - LETTER_SEMITONES[letterIndex]) % 12) + 12) % 12;
  if (alter > 6) {
    alter -= 12;
  }
  return LETTERS[letterIndex] + (alter > 0 ? '♯'.repeat(alter) : '♭'.repeat(-alter));
}

export function midiToFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}
