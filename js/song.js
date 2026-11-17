// Loads and validates song data, and resolves each part's events into notes
// with absolute pitch and time. See section 6 of docs/design.md.

import { buttonMidi, parseNoteName } from './pitch.js';

const OVERLAP_TOLERANCE = 1e-9;

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
  return {
    title: data.title,
    composer: typeof data.composer === 'string' ? data.composer : '',
    tempo: data.tempo,
    beatsPerBar: data.beatsPerBar,
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
    return { event, order, isDo: 'do' in event };
  });
  // A Do position applies to notes starting on the same beat, whatever the
  // order in the file.
  events.sort((a, b) => a.event.at - b.event.at || b.isDo - a.isDo || a.order - b.order);

  const doChanges = [];
  const notes = [];
  let currentDo = null;
  for (const { event, isDo } of events) {
    const where = `${label}, beat ${event.at}`;
    if (isDo) {
      if ('button' in event) {
        fail(`${where}: an event cannot set Do and play a note.`);
      }
      const parsed = typeof event.do === 'string' ? parseNoteName(event.do) : null;
      if (!parsed) {
        fail(`${where}: "${event.do}" is not a note name.`);
      }
      currentDo = { beat: event.at, time: event.at * secondsPerBeat, name: event.do, midi: parsed.midi };
      doChanges.push(currentDo);
      continue;
    }
    if (!isPositiveNumber(event.length)) {
      fail(`${where}: the note needs a positive length.`);
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
    if (previous && event.at < previous.startBeat + previous.lengthBeats - OVERLAP_TOLERANCE) {
      fail(`${where}: the note overlaps the previous note.`);
    }
    const sharp = event.sharp === true;
    const octave = event.octave === true;
    const midi = buttonMidi(currentDo.midi, event.button, sharp, octave);
    if (midi < 0 || midi > 127) {
      fail(`${where}: the note is out of range.`);
    }
    notes.push({
      startBeat: event.at,
      lengthBeats: event.length,
      start: event.at * secondsPerBeat,
      end: (event.at + event.length) * secondsPerBeat,
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
