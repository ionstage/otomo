import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buttonMidi, scalePosition } from '../js/pitch.js';
import { resolveSong } from '../js/song.js';
import { WEIGHTS, arrangePart, cost, measure, planNotes, ways } from '../tools/arrange.js';
import { arrangeSong, formatSong } from '../tools/arrange-songs.js';

const note = (button, sharp = false, octave = false) => ({ button, sharp, octave });
const label = ({ button, sharp, octave }) => `${button}${sharp ? '♯' : ''}${octave ? '↑' : ''}`;

function songFile(file) {
  return readFileSync(new URL(`../songs/${file}`, import.meta.url), 'utf8');
}

function songFiles() {
  return JSON.parse(songFile('index.json'));
}

test('ways lists every way to play a pitch', () => {
  const g = scalePosition('C5', 'G4');
  // G5 is button 8, or button 1 with the octave modifier.
  assert.deepEqual(ways(g, 79).map(label), ['8', '1↑']);
  assert.deepEqual(ways(g, 80).map(label), ['8♯', '1♯↑']);
  // F5 is button 7, or E5 with the semitone modifier.
  assert.deepEqual(ways(g, 77).map(label), ['7', '6♯']);
  assert.deepEqual(ways(g, 40), []);
});

test('measure counts one octave press for a run held through', () => {
  const counts = measure([note(3, false, true), note(2, false, true), note(5), note(1, true, true), note(2, false, true)]);
  assert.deepEqual(counts, { octaveHolds: 2, octaveNotes: 4, sharps: 1, wideJumps: 0 });
});

test('a wide jump is five or more buttons', () => {
  assert.equal(measure([note(1), note(5), note(1)]).wideJumps, 0);
  assert.equal(measure([note(1), note(6), note(2), note(8), note(3)]).wideJumps, 3);
});

test('cost weighs the counts', () => {
  const counts = { octaveHolds: 1, octaveNotes: 5, sharps: 2, wideJumps: 3 };
  assert.equal(cost(counts), 2 + 2 * 2 + 3 + 5 * 0.4);
  assert.equal(cost(counts, { ...WEIGHTS, wideJump: 0 }), 2 + 2 * 2 + 5 * 0.4);
});

test('planNotes holds the octave modifier through button 1 in place of button 8', () => {
  // Bar 4 of Rondo alla Turca: 3↑ 2↑ 8♯ 2↑ is played as 3↑ 2↑ 1♯↑ 2↑.
  const g = scalePosition('C5', 'G4');
  const midis = [3, 2, 1, 2].map((button, i) => buttonMidi(g, button, i === 2, true));
  assert.deepEqual(planNotes(g, midis).notes.map(label), ['3↑', '2↑', '1♯↑', '2↑']);
  // Without octave notes around it, button 8 stays as it is.
  const plain = [7, 8, 7].map((button) => buttonMidi(g, button));
  assert.deepEqual(planNotes(g, plain).notes.map(label), ['7', '8', '7']);
});

test('planNotes avoids a wide jump when it is cheaper', () => {
  const g = scalePosition('C4');
  // 2 → 8 → 2 has two wide jumps; 2 → 1↑ → 2 has none but costs an octave press.
  const midis = [62, 72, 62];
  assert.deepEqual(planNotes(g, midis).notes.map(label), ['2', '8', '2']);
  assert.deepEqual(planNotes(g, midis, { ...WEIGHTS, wideJump: 3 }).notes.map(label), ['2', '1↑', '2']);
});

test('planNotes returns its cost, and null for an unreachable note', () => {
  const g = scalePosition('C5', 'G4');
  const midis = [67, 79, 81, 69, 92, 68];
  const plan = planNotes(g, midis);
  assert.deepEqual(plan.notes.map((way) => buttonMidi(g, way.button, way.sharp, way.octave)), midis);
  assert.ok(Math.abs(plan.cost - cost(measure(plan.notes))) < 1e-9);
  assert.equal(planNotes(g, [66]), null);
  assert.equal(planNotes(g, [94]), null);
});

test('arrangePart puts the lowest note of a one-octave part on button 1', () => {
  // The Ode to Joy melody runs from the Sol below Do to the Sol above.
  const arranged = arrangePart([66, 67, 69, 62, 57, 64, 69], 'D');
  assert.deepEqual(arranged.doEvent, { do: 'D4', button1: 'A3' });
  assert.deepEqual(arranged.notes.map(label), ['6', '7', '8', '4', '1', '5', '8']);
  assert.equal(arranged.cost, 0);
});

test('arrangePart puts Do on button 1 on a tie', () => {
  const arranged = arrangePart([62, 64, 66, 69], 'D');
  assert.deepEqual(arranged.tied, ['A3', 'B3', 'C#4', 'D4']);
  assert.deepEqual(arranged.doEvent, { do: 'D4' });
});

test('arrangePart spells button 1 in the key', () => {
  assert.deepEqual(arrangePart([65, 67, 70, 72], 'Bb').doEvent, { do: 'Bb4', button1: 'F4' });
  // F♯4 to E5 needs no octave press from E4 or F♯4, and the higher wins.
  const fSharp = arrangePart([66, 71, 76], 'D');
  assert.deepEqual(fSharp.tied, ['E4', 'F#4']);
  assert.deepEqual(fSharp.doEvent, { do: 'D5', button1: 'F#4' });
});

test('arrangePart throws when a part needs a shift', () => {
  assert.throws(() => arrangePart([48, 72, 74], 'C'), /without a shift/);
  assert.throws(() => arrangePart([60], 'H'), /not a note name/);
});

test('arrangeSong keeps every note of the songs', () => {
  for (const file of songFiles()) {
    const data = JSON.parse(songFile(file));
    const before = resolveSong(data).parts.map((part) => part.notes.map((n) => [n.start, n.end, n.midi]));
    arrangeSong(data);
    const after = resolveSong(data).parts.map((part) => part.notes.map((n) => [n.start, n.end, n.midi]));
    assert.deepEqual(after, before, file);
  }
});

test('arrangeSong leaves a part with shifts alone', () => {
  const events = [{ at: 0, do: 'C4' }, { at: 0, length: 1, button: 8 }, { at: 1, do: 'C5' }, { at: 1, length: 1, button: 1 }];
  const data = {
    format: 1,
    title: 'Test',
    tempo: 120,
    beatsPerBar: 4,
    parts: [{ name: 'Melody', buttons: 'scale', sound: 'lead', events: structuredClone(events) }],
  };
  const [part] = arrangeSong(data);
  assert.equal(part.skipped, 'it has shifts');
  assert.deepEqual(data.parts[0].events, events);
});

test('formatSong writes the songs as they are stored', () => {
  for (const file of songFiles()) {
    const text = songFile(file);
    assert.equal(formatSong(JSON.parse(text)), text, file);
  }
});
