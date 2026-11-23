// Matches presses to notes and scores them. See section 5 of docs/design.md.
// All times are in seconds from the start of the song.

import { buttonMidi } from './pitch.js';

export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

export const MATCH_WINDOW = 0.2;
export const PERFECT_WINDOW = 0.05;
// A modifier changed this soon after a note press still counts for it, so the
// note and its modifiers can be pressed together in any order.
export const LATE_MODIFIER_WINDOW = 0.06;

// Extra time before an unpressed note counts as missed, so that a press
// handled slightly after a frame has passed the window is still matched.
const MISS_GRACE = 0.1;

export function timingScore(offset) {
  const distance = Math.abs(offset);
  if (distance <= PERFECT_WINDOW) {
    return 100;
  }
  if (distance >= MATCH_WINDOW) {
    return 0;
  }
  return (100 * (MATCH_WINDOW - distance)) / (MATCH_WINDOW - PERFECT_WINDOW);
}

// Whether a release counts as holding to the end. The player needs a moment to
// release before pressing again, a slightly shorter note can sound natural, and
// some sounds ring on after the button is released. Notes shorter than a beat
// have no duration check. Longer notes may be released early by up to half
// their length or one beat, whichever is less.
export function heldToEnd(note, releaseTime) {
  if (note.lengthBeats < 1) {
    return true;
  }
  const length = note.end - note.start;
  const beat = length / note.lengthBeats;
  return note.end - releaseTime <= Math.min(length / 2, beat);
}

export function durationScore(note, pressTime, releaseTime) {
  if (heldToEnd(note, releaseTime)) {
    return 100;
  }
  const held = (releaseTime - pressTime) / (note.end - note.start);
  return Math.min(100, Math.max(0, held * 100));
}

// Buttons 1 and 8 are the same note of the scale an octave apart.
function sameScaleNote(a, b) {
  return (a - b) % 7 === 0;
}

export function isCorrect(note, input, difficulty) {
  switch (difficulty) {
    case 'beginner':
      return true;
    case 'intermediate':
      return sameScaleNote(input.button, note.button);
    default:
      // Any way of playing the written pitch, such as 1↑ for 8, or 3♯ for 4.
      return buttonMidi(note.position, input.button, input.sharp, input.octave) === note.midi;
  }
}

// Each state is { result, pressTime, releaseTime, score }, where result is
// null until judged, then 'correct', 'wrong' or 'missed'.
export function createJudge(notes, difficulty) {
  const states = notes.map(() => ({ result: null, pressTime: null, releaseTime: null, timing: 0, score: null }));
  let held = null;
  let heldInput = null;
  let missCursor = 0;

  function release(time) {
    if (held === null) {
      return;
    }
    const state = states[held];
    state.releaseTime = time;
    if (state.result === 'correct') {
      state.score = (state.timing + durationScore(notes[held], state.pressTime, time)) / 2;
    }
    held = null;
    heldInput = null;
  }

  function press(time, input) {
    release(time);
    let best = -1;
    let bestDistance = Infinity;
    notes.forEach((note, index) => {
      const distance = Math.abs(note.start - time);
      if (states[index].result === null && distance <= MATCH_WINDOW && distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    if (best < 0) {
      return { note: null, correct: false };
    }
    const note = notes[best];
    const state = states[best];
    const correct = isCorrect(note, input, difficulty);
    state.pressTime = time;
    if (correct) {
      state.result = 'correct';
      state.timing = timingScore(time - note.start);
    } else {
      state.result = 'wrong';
      state.score = 0;
    }
    held = best;
    heldInput = input;
    return { note, correct };
  }

  // Judges the held note again with the modifiers changed at `time`, if that
  // is within LATE_MODIFIER_WINDOW of its press. `changed` says whether the
  // result went between correct and wrong.
  function amend(time, modifiers) {
    if (held === null || time - states[held].pressTime > LATE_MODIFIER_WINDOW) {
      return { note: null, correct: false, changed: false };
    }
    const note = notes[held];
    const state = states[held];
    heldInput = { ...heldInput, sharp: modifiers.sharp, octave: modifiers.octave };
    const correct = isCorrect(note, heldInput, difficulty);
    if (correct === (state.result === 'correct')) {
      return { note, correct, changed: false };
    }
    if (correct) {
      state.result = 'correct';
      state.timing = timingScore(state.pressTime - note.start);
      state.score = null;
    } else {
      state.result = 'wrong';
      state.timing = 0;
      state.score = 0;
    }
    return { note, correct, changed: true };
  }

  function update(time) {
    while (missCursor < notes.length && notes[missCursor].start + MATCH_WINDOW + MISS_GRACE < time) {
      const state = states[missCursor];
      if (state.result === null) {
        state.result = 'missed';
        state.score = 0;
      }
      missCursor++;
    }
  }

  function finish(time) {
    release(time);
    for (const state of states) {
      if (state.result === null) {
        state.result = 'missed';
        state.score = 0;
      }
    }
    const total = states.reduce((sum, state) => sum + state.score, 0);
    return { score: total / states.length };
  }

  return { states, press, amend, release, update, finish };
}

// The pitch a press sounds, following section 3 of docs/design.md. The
// reference is the matched note, or the note starting nearest in time. Its
// scale position is used, so a slightly early press across a change still
// sounds in the right octave.
export function pressPitch(part, difficulty, input, matchedNote, time) {
  const reference = matchedNote ?? nearestNote(part.notes, time);
  switch (difficulty) {
    case 'beginner':
      return reference.midi;
    case 'intermediate':
      // The right note of the scale, including 1 for 8 or 8 for 1, sounds the
      // written pitch. Any other button gets the written octave modifier.
      if (sameScaleNote(input.button, reference.button)) {
        return reference.midi;
      }
      return buttonMidi(reference.position, input.button, false, reference.octave);
    default:
      return buttonMidi(reference.position, input.button, input.sharp, input.octave);
  }
}

function nearestNote(notes, time) {
  let nearest = notes[0];
  for (const note of notes) {
    if (Math.abs(note.start - time) < Math.abs(nearest.start - time)) {
      nearest = note;
    }
  }
  return nearest;
}
