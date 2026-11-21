import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { SongError, doAt, resolveSong } from '../js/song.js';

function songWith(events, overrides = {}) {
  return {
    format: 1,
    title: 'Test',
    tempo: 120,
    beatsPerBar: 4,
    parts: [{ name: 'Melody', buttons: 'scale', sound: 'lead', events }],
    ...overrides,
  };
}

function readSong(file) {
  return JSON.parse(readFileSync(new URL(`../songs/${file}`, import.meta.url), 'utf8'));
}

test('resolveSong converts beats to seconds and pitches to MIDI', () => {
  const song = resolveSong(songWith([
    { at: 0, do: 'D4' },
    { at: 0, length: 1, button: 3 },
    { at: 2, length: 0.5, button: 4, sharp: true, octave: true },
  ]));
  const [first, second] = song.parts[0].notes;
  assert.equal(song.secondsPerBeat, 0.5);
  assert.deepEqual([first.start, first.end, first.midi], [0, 0.5, 66]);
  assert.deepEqual([second.start, second.end, second.midi], [1, 1.25, 80]);
  assert.equal(second.doMidi, 62);
});

test('resolveSong rounds the length up to a whole bar', () => {
  const song = resolveSong(songWith([{ at: 0, do: 'C4' }, { at: 4, length: 1, button: 1 }]));
  assert.equal(song.lengthBeats, 8);
  assert.equal(song.length, 4);
});

test('resolveSong pairs 2/4 bars into groups of four beats', () => {
  const events = [{ at: 0, do: 'C4' }, { at: 0, length: 1, button: 1 }];
  assert.equal(resolveSong(songWith(events, { beatsPerBar: 2 })).beatsPerGroup, 4);
  assert.equal(resolveSong(songWith(events, { beatsPerBar: 3 })).beatsPerGroup, 3);
  assert.equal(resolveSong(songWith(events)).beatsPerGroup, 4);
});

test('a Do change applies to a note on the same beat, whatever the order', () => {
  const song = resolveSong(songWith([
    { at: 0, do: 'C4' },
    { at: 4, length: 1, button: 1 },
    { at: 4, do: 'C3' },
  ]));
  assert.equal(song.parts[0].notes[0].midi, 48);
});

test('doAt returns the Do position in effect', () => {
  const song = resolveSong(songWith([
    { at: 0, do: 'C4' },
    { at: 0, length: 1, button: 1 },
    { at: 4, do: 'G3' },
    { at: 4, length: 1, button: 1 },
  ]));
  const part = song.parts[0];
  assert.equal(doAt(part, -1).name, 'C4');
  assert.equal(doAt(part, 1.9).name, 'C4');
  assert.equal(doAt(part, 2).name, 'G3');
});

test('a sixteenth note is the shortest note allowed', () => {
  const song = resolveSong(songWith([{ at: 0, do: 'C4' }, { at: 0, length: 0.25, button: 1 }]));
  assert.equal(song.parts[0].notes[0].lengthBeats, 0.25);
});

test('notes may sit on the triplet grid, snapped to exact thirds', () => {
  const song = resolveSong(songWith([
    { at: 0, do: 'C4' },
    { at: 0, length: 0.333, button: 1 },
    { at: 0.333, length: 0.334, button: 2 },
    { at: 0.6667, length: 0.3333, button: 3 },
    { at: 1, length: 0.6667, button: 4 },
    { at: 1.6667, length: 0.3333, button: 5 },
    { at: 2, length: 0.75, button: 6 },
  ]));
  const notes = song.parts[0].notes;
  assert.deepEqual(notes.map((note) => note.startBeat), [0, 1 / 3, 2 / 3, 1, 5 / 3, 2]);
  assert.deepEqual(notes.map((note) => note.startBeat + note.lengthBeats), [1 / 3, 2 / 3, 1, 5 / 3, 2, 2.75]);
  assert.equal(notes[1].end, (2 / 3) * song.secondsPerBeat);
  assert.deepEqual(notes.map((note) => note.gridBeats), [1 / 3, 1 / 3, 1 / 3, 1 / 3, 1 / 3, 0.25]);
});

test('a note between whole beats is on the sixteenth-note grid', () => {
  const song = resolveSong(songWith([{ at: 0, do: 'C4' }, { at: 1, length: 2, button: 1 }]));
  assert.equal(song.parts[0].notes[0].gridBeats, 0.25);
});

test('a Do change snaps to the triplet grid with its note', () => {
  const song = resolveSong(songWith([
    { at: 0, do: 'C4' },
    { at: 0, length: 1, button: 1 },
    { at: 1.3334, do: 'C3' },
    { at: 1.3333, length: 1, button: 1 },
  ]));
  assert.equal(song.parts[0].notes[1].midi, 48);
});

test('notes must start and end on one grid, sixteenth-note or triplet', () => {
  const offGrid = [
    // A start between grid positions.
    { at: 0.1, length: 1, button: 1 },
    // An end between grid positions.
    { at: 0, length: 0.3, button: 1 },
    // Sixteenth-note triplets.
    { at: 1 / 6, length: 1 / 6, button: 1 },
    // A third written with too few decimals.
    { at: 0.33, length: 0.67, button: 1 },
    // From the sixteenth-note grid to the triplet grid, and back.
    { at: 0.25, length: 5 / 12, button: 1 },
    { at: 1 / 3, length: 5 / 12, button: 1 },
    { at: 0.5, length: 1 / 6, button: 1 },
  ];
  for (const note of offGrid) {
    assert.throws(() => resolveSong(songWith([{ at: 0, do: 'C4' }, note])), SongError, JSON.stringify(note));
  }
});

test('resolveSong rejects invalid songs', () => {
  const invalid = [
    songWith([{ at: 0, length: 1, button: 1 }]),
    songWith([{ at: 0, do: 'C4' }, { at: 0, length: 2, button: 1 }, { at: 1, length: 1, button: 2 }]),
    songWith([{ at: 0, do: 'C4' }, { at: 0, length: 1, button: 9 }]),
    songWith([{ at: 0, do: 'C4' }, { at: 0, length: 0, button: 1 }]),
    songWith([{ at: 0, do: 'C4' }, { at: 0, length: 0.2, button: 1 }]),
    songWith([{ at: 0, do: 'H4' }, { at: 0, length: 1, button: 1 }]),
    songWith([{ at: 0, do: 'C4' }]),
    songWith([{ at: 0, do: 'C4' }, { at: 0, length: 1, button: 1 }], { format: 2 }),
    songWith([{ at: 0, do: 'C4' }, { at: 0, length: 1, button: 1 }], { tempo: 0 }),
    { ...songWith([]), parts: [{ name: 'Drums', buttons: 'percussion', sound: 'lead', events: [] }] },
  ];
  for (const data of invalid) {
    assert.throws(() => resolveSong(data), SongError);
  }
});

test('every song in the index is valid', () => {
  const files = readSong('index.json');
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.doesNotThrow(() => resolveSong(readSong(file)), file);
  }
});

test('Ode to Joy has the expected melody', () => {
  const song = resolveSong(readSong('ode-to-joy.json'));
  assert.deepEqual(song.parts.map((part) => part.name), ['Melody', 'Harmony', 'Bass']);
  const melody = song.parts[0].notes.map((note) => note.midi);
  // F♯ F♯ G A | A G F♯ E | D D E F♯ | F♯ E E
  assert.deepEqual(melody.slice(0, 15), [66, 66, 67, 69, 69, 67, 66, 64, 62, 62, 64, 66, 66, 64, 64]);
  // The lowest note is the A below Do.
  assert.equal(Math.min(...melody), 57);
  assert.equal(song.lengthBeats, 64);
  for (const part of song.parts) {
    const last = part.notes[part.notes.length - 1];
    assert.equal(last.startBeat + last.lengthBeats, 64, part.name);
  }
});
