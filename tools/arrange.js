// Chooses a part's scale position and how each note is played, following
// "Scale position" in section 2 of docs/design.md. Pure, so it can be tested.

import { buttonMidi, buttonPitchName, parseNoteName, scalePosition } from '../js/pitch.js';

export const WEIGHTS = { octaveHold: 2, sharp: 2, wideJump: 1, octaveNote: 0.4 };

// Consecutive notes this many buttons apart or more are a wide jump.
export const WIDE_JUMP = 5;

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const EPSILON = 1e-9;

// Every way to play `midi` at `position`, as { button, sharp, octave }.
export function ways(position, midi) {
  const found = [];
  for (const octave of [false, true]) {
    for (const sharp of [false, true]) {
      for (let button = 1; button <= 8; button++) {
        if (buttonMidi(position, button, sharp, octave) === midi) {
          found.push({ button, sharp, octave });
        }
      }
    }
  }
  return found;
}

// The counts each cost is made of. The octave modifier is pressed once for a
// run of consecutive notes that need it, since it can be held through them.
export function measure(notes) {
  const counts = { octaveHolds: 0, octaveNotes: 0, sharps: 0, wideJumps: 0 };
  notes.forEach((note, index) => {
    const previous = notes[index - 1];
    if (note.octave) {
      counts.octaveNotes++;
      if (!previous?.octave) {
        counts.octaveHolds++;
      }
    }
    if (note.sharp) {
      counts.sharps++;
    }
    if (previous && Math.abs(note.button - previous.button) >= WIDE_JUMP) {
      counts.wideJumps++;
    }
  });
  return counts;
}

export function cost(counts, weights = WEIGHTS) {
  return (
    weights.octaveHold * counts.octaveHolds +
    weights.sharp * counts.sharps +
    weights.wideJump * counts.wideJumps +
    weights.octaveNote * counts.octaveNotes
  );
}

// What playing `note` adds to the cost, after `previous` (undefined for the
// first note). It matches `cost(measure(notes))` summed note by note.
function noteCost(previous, note, weights) {
  return (
    (note.octave && !previous?.octave ? weights.octaveHold : 0) +
    (note.sharp ? weights.sharp : 0) +
    (previous && Math.abs(note.button - previous.button) >= WIDE_JUMP ? weights.wideJump : 0) +
    (note.octave ? weights.octaveNote : 0)
  );
}

// The cheapest way to play the pitches `midis` in order at `position`, or null
// if one cannot be reached. Each note's cost depends only on the note before
// it, so the cheapest plan ending in each way of playing the latest note is
// enough to keep.
export function planNotes(position, midis, weights = WEIGHTS) {
  let plans = [{ cost: 0, notes: [] }];
  for (const midi of midis) {
    const options = ways(position, midi);
    if (options.length === 0) {
      return null;
    }
    plans = options.map((way) => {
      let best = null;
      for (const plan of plans) {
        const total = plan.cost + noteCost(plan.notes[plan.notes.length - 1], way, weights);
        if (!best || total < best.cost - EPSILON) {
          best = { cost: total, notes: plan.notes.concat(way) };
        }
      }
      return best;
    });
  }
  return plans.reduce((best, plan) => (plan.cost < best.cost - EPSILON ? plan : best));
}

// A note name such as "F#3" for `midi`, spelled as in the scale of `doLetter`.
function spell(doLetter, step, midi) {
  const pitch = buttonPitchName(scalePosition(`${doLetter}4`), step + 1);
  const ascii = pitch.replace(/♯/g, '#').replace(/♭/g, 'b');
  const plain = parseNoteName(`${ascii}4`);
  return `${ascii}${4 + (midi - plain.midi) / 12}`;
}

// Arranges a part in the major scale of `doLetter` (such as "D" or "Bb") with
// no shifts. Returns the `do` event, the notes as { button, sharp, octave },
// the counts and the total cost. Throws if a note cannot be reached without a
// shift: shifts are placed by hand, at phrase boundaries.
export function arrangePart(midis, doLetter, weights = WEIGHTS) {
  const tonic = parseNoteName(`${doLetter}4`);
  if (!tonic) {
    throw new Error(`"${doLetter}" is not a note name.`);
  }
  const lowest = Math.min(...midis);
  const candidates = [];
  // Button 1 is at or below the lowest note, and less than an octave and a
  // step below it, or the lowest note would need the octave modifier.
  for (let midi = lowest - 13; midi <= lowest; midi++) {
    const step = MAJOR.indexOf((((midi - tonic.midi) % 12) + 12) % 12);
    if (step < 0) {
      continue;
    }
    const button1 = spell(doLetter, step, midi);
    // Do is named in the octave that lies on buttons 1 to 8.
    let doMidi = tonic.midi;
    while (doMidi < midi) {
      doMidi += 12;
    }
    while (doMidi - 12 >= midi) {
      doMidi -= 12;
    }
    const doName = `${doLetter}${4 + (doMidi - tonic.midi) / 12}`;
    const position = scalePosition(doName, button1);
    const plan = planNotes(position, midis, weights);
    if (plan) {
      candidates.push({ midi, step, doName, button1, plan });
    }
  }
  if (candidates.length === 0) {
    throw new Error('The part cannot be played without a shift.');
  }
  const lowestCost = Math.min(...candidates.map((candidate) => candidate.plan.cost));
  const tied = candidates.filter((candidate) => candidate.plan.cost < lowestCost + EPSILON);
  // On a tie, Do goes on button 1, otherwise the highest tied note.
  const chosen = tied.find((candidate) => candidate.step === 0) ?? tied.reduce((a, b) => (b.midi > a.midi ? b : a));
  const doEvent = chosen.step === 0 ? { do: chosen.doName } : { do: chosen.doName, button1: chosen.button1 };
  return {
    doEvent,
    notes: chosen.plan.notes,
    counts: measure(chosen.plan.notes),
    cost: chosen.plan.cost,
    tied: tied.map((candidate) => candidate.button1),
  };
}
