import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJudge, durationScore, pressPitch, timingScore } from '../js/judge.js';
import { resolveSong } from '../js/song.js';

// At 60 BPM one beat is one second, so beats and seconds are the same.
function partWith(events) {
  return resolveSong({
    format: 1,
    title: 'Test',
    tempo: 60,
    beatsPerBar: 4,
    parts: [{ name: 'Melody', buttons: 'scale', sound: 'lead', events: [{ at: 0, do: 'C4' }, ...events] }],
  }).parts[0];
}

const plain = { button: 1, sharp: false, octave: false };

test('timingScore is full within 50 ms and falls to 0 at 200 ms', () => {
  assert.equal(timingScore(0), 100);
  assert.equal(timingScore(0.05), 100);
  assert.equal(timingScore(-0.05), 100);
  assert.equal(timingScore(0.125), 50);
  assert.equal(timingScore(-0.125), 50);
  assert.equal(timingScore(0.2), 0);
});

test('durationScore is the share held, with release near the end counting as full', () => {
  // Two beats: up to one beat early counts as held to the end.
  const half = { start: 0, end: 2, lengthBeats: 2 };
  assert.equal(durationScore(half, 0, 1), 100);
  assert.equal(durationScore(half, 0, 0.9), 45);
  assert.equal(durationScore(half, 0, 2.5), 100);
  assert.equal(durationScore(half, 0.1, 0.05), 0);
  // Four beats: still only one beat early.
  const whole = { start: 0, end: 4, lengthBeats: 4 };
  assert.equal(durationScore(whole, 0, 3), 100);
  assert.equal(durationScore(whole, 0, 2.9), 72.5);
});

test('a quarter note needs to be held for half its length', () => {
  const quarter = { start: 0, end: 1, lengthBeats: 1 };
  assert.equal(durationScore(quarter, 0, 0.5), 100);
  assert.equal(durationScore(quarter, 0, 0.4), 40);
});

test('notes shorter than a beat have no duration check', () => {
  const eighth = { start: 0, end: 0.5, lengthBeats: 0.5 };
  assert.equal(durationScore(eighth, 0, 0.01), 100);
});

test('a well-timed press held to the end scores 100', () => {
  const part = partWith([{ at: 1, length: 1, button: 1 }]);
  const judge = createJudge(part.notes, 'advanced');
  const { correct } = judge.press(1, plain);
  judge.release(2);
  assert.equal(correct, true);
  assert.equal(judge.finish(3).score, 100);
});

test('timing and duration are averaged', () => {
  const part = partWith([{ at: 1, length: 1, button: 1 }]);
  const judge = createJudge(part.notes, 'advanced');
  judge.press(1.125, plain);
  judge.release(1.25);
  // Timing 50, duration 12.5.
  assert.equal(judge.states[0].score, 31.25);
});

test('a wrong first press scores 0 and cannot be corrected', () => {
  const part = partWith([{ at: 1, length: 1, button: 3 }]);
  const judge = createJudge(part.notes, 'intermediate');
  assert.equal(judge.press(1, { button: 2, sharp: false, octave: false }).correct, false);
  assert.equal(judge.press(1.05, { button: 3, sharp: false, octave: false }).note, null);
  assert.equal(judge.states[0].result, 'wrong');
  assert.equal(judge.finish(3).score, 0);
});

test('what counts as correct depends on difficulty', () => {
  const events = [{ at: 1, length: 1, button: 4, sharp: true, octave: true }];
  const cases = [
    ['beginner', { button: 7, sharp: false, octave: false }, true],
    ['intermediate', { button: 4, sharp: false, octave: false }, true],
    ['intermediate', { button: 5, sharp: true, octave: true }, false],
    ['advanced', { button: 4, sharp: true, octave: true }, true],
    ['advanced', { button: 4, sharp: false, octave: true }, false],
    ['advanced', { button: 4, sharp: true, octave: false }, false],
  ];
  for (const [difficulty, input, expected] of cases) {
    const judge = createJudge(partWith(events).notes, difficulty);
    assert.equal(judge.press(1, input).correct, expected, `${difficulty} ${JSON.stringify(input)}`);
  }
});

test('a press with no note in range is ignored for scoring', () => {
  const part = partWith([{ at: 1, length: 1, button: 1 }]);
  const judge = createJudge(part.notes, 'advanced');
  assert.equal(judge.press(0.5, plain).note, null);
  judge.release(0.7);
  assert.equal(judge.states[0].result, null);
  judge.press(1, plain);
  judge.release(2);
  assert.equal(judge.finish(3).score, 100);
});

test('a press matches the nearest unjudged note', () => {
  const part = partWith([
    { at: 1, length: 0.25, button: 1 },
    { at: 1.25, length: 0.25, button: 2 },
  ]);
  const judge = createJudge(part.notes, 'intermediate');
  const { note } = judge.press(1.2, { button: 2, sharp: false, octave: false });
  assert.equal(note, part.notes[1]);
});

test('unpressed notes are missed once their window has passed', () => {
  const part = partWith([
    { at: 1, length: 1, button: 1 },
    { at: 2, length: 1, button: 1 },
  ]);
  const judge = createJudge(part.notes, 'advanced');
  judge.update(1.25);
  assert.equal(judge.states[0].result, null);
  judge.update(1.4);
  assert.equal(judge.states[0].result, 'missed');
  judge.press(2, plain);
  assert.equal(judge.finish(4).score, 50);
});

test('a new press ends the held note', () => {
  const part = partWith([{ at: 1, length: 1, button: 1 }]);
  const judge = createJudge(part.notes, 'advanced');
  judge.press(1, plain);
  judge.press(1.4, { button: 2, sharp: false, octave: false });
  assert.equal(judge.states[0].releaseTime, 1.4);
  assert.equal(judge.states[0].score, 70);
});

test('pressing the next note slightly early keeps full duration', () => {
  const part = partWith([
    { at: 1, length: 1, button: 1 },
    { at: 2, length: 1, button: 2 },
  ]);
  const judge = createJudge(part.notes, 'advanced');
  judge.press(1, plain);
  judge.press(1.8, { button: 2, sharp: false, octave: false });
  judge.release(3);
  assert.equal(judge.states[0].score, 100);
});

test('pressPitch follows the rules for each difficulty', () => {
  const part = partWith([
    { at: 1, length: 1, button: 4, sharp: true, octave: true },
    { at: 4, do: 'C3' },
    { at: 4, length: 1, button: 2 },
  ]);
  const [raised, low] = part.notes;
  const two = { button: 2, sharp: false, octave: false };
  // Beginner always sounds the written note.
  assert.equal(pressPitch(part, 'beginner', two, raised, 1), raised.midi);
  // Intermediate uses the written octave, and the semitone only on the right button.
  assert.equal(pressPitch(part, 'intermediate', two, raised, 1), 74);
  assert.equal(pressPitch(part, 'intermediate', { button: 4, sharp: false, octave: false }, raised, 1), 78);
  // Advanced sounds exactly what is pressed.
  assert.equal(pressPitch(part, 'advanced', { button: 2, sharp: true, octave: false }, raised, 1), 63);
  // Without a matched note, the nearest note's scale position applies.
  assert.equal(pressPitch(part, 'advanced', two, null, 3.9), 50);
  assert.equal(pressPitch(part, 'intermediate', two, null, 3.9), low.midi);
});

test('modifiers pressed just after the note still count for it', () => {
  const part = partWith([{ at: 1, length: 1, button: 4, sharp: true, octave: true }]);
  const judge = createJudge(part.notes, 'advanced');
  assert.equal(judge.press(1.02, { button: 4, sharp: false, octave: false }).correct, false);
  assert.deepEqual(judge.amend(1.04, { sharp: true, octave: false }), {
    note: part.notes[0], correct: false, changed: false,
  });
  const { correct, changed } = judge.amend(1.07, { sharp: true, octave: true });
  assert.equal(correct, true);
  assert.equal(changed, true);
  judge.release(2);
  // Timing is from the note press, not the modifier.
  assert.equal(judge.finish(3).score, 100);
});

test('a modifier released just after the note also counts', () => {
  const part = partWith([{ at: 1, length: 1, button: 4 }]);
  const judge = createJudge(part.notes, 'advanced');
  assert.equal(judge.press(1, { button: 4, sharp: true, octave: false }).correct, false);
  assert.equal(judge.amend(1.03, { sharp: false, octave: false }).correct, true);
  assert.equal(judge.states[0].result, 'correct');
});

test('modifiers changed after the late window do not change the result', () => {
  const part = partWith([{ at: 1, length: 1, button: 4, sharp: true }]);
  const judge = createJudge(part.notes, 'advanced');
  judge.press(1, { button: 4, sharp: false, octave: false });
  assert.equal(judge.amend(1.07, { sharp: true, octave: false }).changed, false);
  assert.equal(judge.states[0].result, 'wrong');
  // Nor once the note is released.
  const other = createJudge(part.notes, 'advanced');
  other.press(1, { button: 4, sharp: false, octave: false });
  other.release(1.01);
  assert.equal(other.amend(1.02, { sharp: true, octave: false }).changed, false);
});

test('late modifiers cannot correct a wrong note button', () => {
  const part = partWith([{ at: 1, length: 1, button: 4, sharp: true }]);
  const judge = createJudge(part.notes, 'advanced');
  judge.press(1, { button: 3, sharp: false, octave: false });
  assert.equal(judge.amend(1.02, { sharp: true, octave: false }).correct, false);
  assert.equal(judge.states[0].result, 'wrong');
});
