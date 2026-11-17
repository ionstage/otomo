// Note names, MIDI numbers and the movable-Do scale.

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_SEMITONES = [0, 2, 4, 5, 7, 9, 11];

// Semitones above Do for buttons 1 to 8.
export const SCALE_OFFSETS = [0, 2, 4, 5, 7, 9, 11, 12];

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

export function buttonMidi(doMidi, button, sharp = false, octave = false) {
  return doMidi + SCALE_OFFSETS[button - 1] + (sharp ? 1 : 0) + (octave ? 12 : 0);
}

// The pitch name, without octave, that a button plays when Do is `doName`.
// The spelling follows the key, so Do = D gives F♯ for button 3, not G♭.
export function buttonPitchName(doName, button) {
  const tonic = parseNoteName(doName);
  const letterIndex = (tonic.letterIndex + button - 1) % 7;
  const semitone = LETTER_SEMITONES[tonic.letterIndex] + tonic.alter + SCALE_OFFSETS[button - 1];
  let alter = (((semitone - LETTER_SEMITONES[letterIndex]) % 12) + 12) % 12;
  if (alter > 6) {
    alter -= 12;
  }
  return LETTERS[letterIndex] + (alter > 0 ? '♯'.repeat(alter) : '♭'.repeat(-alter));
}

export function midiToFrequency(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}
