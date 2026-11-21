// Loads and validates song data, and resolves each part's events into notes
// with absolute pitch and time. See section 6 of docs/design.md.

import { buttonMidi, parseNoteName } from './pitch.js';

const OVERLAP_TOLERANCE = 1e-9;

// A beat is a quarter note, and a sixteenth note is the shortest note allowed.
export const SIXTEENTH = 0.25;

// A note starts and ends on the sixteenth-note grid, or both on the triplet
// grid that splits each beat into three. JSON cannot hold a third exactly, so a
// position this close to the grid is moved onto it.
const GRID_TOLERANCE = 1e-3;
const GRID_DIVISIONS = [1 / SIXTEENTH, 3];

export class SongError extends Error {}

function fail(message) {
  throw new SongError(message);
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isOptionalBoolean(value) {
  return value === undefined || typeof value === 'boolean';
}

// The position on the grid with `division` steps per beat, or null if `beat`
// is not on it.
function snap(beat, division) {
  const snapped = Math.round(beat * division) / division;
  return Math.abs(snapped - beat) <= GRID_TOLERANCE ? snapped : null;
}

// The steps per beat of the one grid both ends of a note are on, or null.
// Whole beats are on both grids, and count as the sixteenth-note grid.
function noteDivision(start, end) {
  return GRID_DIVISIONS.find((division) => snap(start, division) !== null && snap(end, division) !== null) ?? null;
}

export function resolveSong(data) {
  if (!isObject(data)) {
    fail('The song must be a JSON object.');
  }
  if (data.format !== 1) {
    fail(`Unsupported song format: ${data.format}.`);
  }
  if (typeof data.title !== 'string' || data.title === '') {
    fail('The song needs a title.');
  }
  if (!isPositiveNumber(data.tempo)) {
    fail('The tempo must be a positive number.');
  }
  if (!Number.isInteger(data.beatsPerBar) || data.beatsPerBar < 1) {
    fail('beatsPerBar must be a positive whole number.');
  }
  if (!Array.isArray(data.parts) || data.parts.length === 0) {
    fail('The song needs at least one part.');
  }
  const secondsPerBeat = 60 / data.tempo;
  const parts = data.parts.map((part, index) => resolvePart(part, index, secondsPerBeat));
  const lastBeat = Math.max(...parts.map((part) => {
    const last = part.notes[part.notes.length - 1];
    return last.startBeat + last.lengthBeats;
  }));
  const lengthBeats = Math.ceil(lastBeat / data.beatsPerBar) * data.beatsPerBar;
  // The roll lays out bars in groups: a 2/4 song pairs its bars so that it
  // looks like a song in 4/4.
  const beatsPerGroup = data.beatsPerBar === 2 ? 4 : data.beatsPerBar;
  return {
    title: data.title,
    composer: typeof data.composer === 'string' ? data.composer : '',
    tempo: data.tempo,
    beatsPerBar: data.beatsPerBar,
    beatsPerGroup,
    secondsPerBeat,
    lengthBeats,
    length: lengthBeats * secondsPerBeat,
    parts,
  };
}

function resolvePart(part, index, secondsPerBeat) {
  if (!isObject(part)) {
    fail(`Part ${index + 1} must be an object.`);
  }
  if (typeof part.name !== 'string' || part.name === '') {
    fail(`Part ${index + 1} needs a name.`);
  }
  const label = `Part "${part.name}"`;
  if (part.buttons !== 'scale') {
    fail(`${label}: unsupported buttons "${part.buttons}".`);
  }
  if (typeof part.sound !== 'string') {
    fail(`${label}: the sound must be a string.`);
  }
  if (!Array.isArray(part.events)) {
    fail(`${label}: events must be a list.`);
  }

  const events = part.events.map((event, order) => {
    if (!isObject(event)) {
      fail(`${label}: event ${order + 1} must be an object.`);
    }
    if (typeof event.at !== 'number' || !Number.isFinite(event.at) || event.at < 0) {
      fail(`${label}: event ${order + 1} needs an "at" of zero or more.`);
    }
    // A Do change is snapped too, so that it lands where the note does.
    const at = GRID_DIVISIONS.map((division) => snap(event.at, division)).find((beat) => beat !== null) ?? event.at;
    return { event, at, order, isDo: 'do' in event };
  });
  // A Do position applies to notes starting on the same beat, whatever the
  // order in the file.
  events.sort((a, b) => a.at - b.at || b.isDo - a.isDo || a.order - b.order);

  const doChanges = [];
  const notes = [];
  let currentDo = null;
  for (const { event, at, isDo } of events) {
    const where = `${label}, beat ${event.at}`;
    if (isDo) {
      if ('button' in event) {
        fail(`${where}: an event cannot set Do and play a note.`);
      }
      const parsed = typeof event.do === 'string' ? parseNoteName(event.do) : null;
      if (!parsed) {
        fail(`${where}: "${event.do}" is not a note name.`);
      }
      currentDo = { beat: at, time: at * secondsPerBeat, name: event.do, midi: parsed.midi };
      doChanges.push(currentDo);
      continue;
    }
    if (!isPositiveNumber(event.length)) {
      fail(`${where}: the note needs a positive length.`);
    }
    const division = noteDivision(event.at, event.at + event.length);
    if (division === null) {
      fail(`${where}: the note must start and end on the sixteenth-note grid, or both on the triplet grid.`);
    }
    const end = snap(event.at + event.length, division);
    const length = end - at;
    if (length < SIXTEENTH - OVERLAP_TOLERANCE) {
      fail(`${where}: the note is shorter than a sixteenth note.`);
    }
    if (!Number.isInteger(event.button) || event.button < 1 || event.button > 8) {
      fail(`${where}: the button must be 1 to 8.`);
    }
    if (!isOptionalBoolean(event.sharp) || !isOptionalBoolean(event.octave)) {
      fail(`${where}: sharp and octave must be true or false.`);
    }
    if (!currentDo) {
      fail(`${where}: the note comes before any Do position.`);
    }
    const previous = notes[notes.length - 1];
    if (previous && at < previous.startBeat + previous.lengthBeats - OVERLAP_TOLERANCE) {
      fail(`${where}: the note overlaps the previous note.`);
    }
    const sharp = event.sharp === true;
    const octave = event.octave === true;
    const midi = buttonMidi(currentDo.midi, event.button, sharp, octave);
    if (midi < 0 || midi > 127) {
      fail(`${where}: the note is out of range.`);
    }
    notes.push({
      startBeat: at,
      lengthBeats: length,
      // The spacing of the note's grid, in beats.
      gridBeats: 1 / division,
      start: at * secondsPerBeat,
      end: end * secondsPerBeat,
      button: event.button,
      sharp,
      octave,
      midi,
      doMidi: currentDo.midi,
    });
  }
  if (notes.length === 0) {
    fail(`${label}: the part has no notes.`);
  }
  return { name: part.name, buttons: part.buttons, sound: part.sound, notes, doChanges };
}

// The Do position in effect at `time` seconds. Before the first change, the
// first change applies.
export function doAt(part, time) {
  let found = part.doChanges[0];
  for (const change of part.doChanges) {
    if (change.time > time) {
      break;
    }
    found = change;
  }
  return found;
}
