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
