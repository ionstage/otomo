import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addScore, createTally, groupScore, leaveTally, tallyComplete } from '../js/scores.js';

test('the group score is the average of the players’ scores', () => {
  let tally = createTally([1, 2, 3]);
  tally = addScore(tally, 1, 90);
  tally = addScore(tally, 2, 60);
  assert.equal(tallyComplete(tally), false);
  tally = addScore(tally, 3, 75);
  assert.equal(tallyComplete(tally), true);
  assert.deepEqual(groupScore(tally), { average: 75, count: 3 });
});

test('a player who quits or disconnects is left out', () => {
  let tally = createTally([1, 2, 3]);
  tally = addScore(tally, 1, 80);
  tally = addScore(tally, 2, 40);
  tally = leaveTally(tally, 2);
  tally = leaveTally(tally, 3);
  assert.equal(tallyComplete(tally), true);
  assert.deepEqual(groupScore(tally), { average: 80, count: 1 });
});

test('only expected players and real numbers count', () => {
  let tally = createTally([1, 2]);
  tally = addScore(tally, 4, 100);
  tally = addScore(tally, 2, 'lots');
  tally = addScore(tally, 2, Number.NaN);
  assert.deepEqual(tally.scores, {});
});

test('without scores there is no group score', () => {
  assert.equal(groupScore(createTally([1])), null);
  assert.equal(tallyComplete(leaveTally(createTally([1]), 1)), true);
});

test('the tally given is not changed', () => {
  const tally = createTally([1, 2]);
  addScore(tally, 1, 50);
  leaveTally(tally, 2);
  assert.deepEqual(tally, { expected: [1, 2], scores: {} });
});
