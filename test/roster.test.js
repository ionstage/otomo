import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addPlayer, createRoster, playerName, removePlayer } from '../js/roster.js';

test('the host is Player 1 and players are numbered as they join', () => {
  let roster = createRoster();
  assert.deepEqual(roster.players, [1]);
  let number;
  ({ roster, number } = addPlayer(roster));
  assert.equal(number, 2);
  ({ roster, number } = addPlayer(roster));
  assert.equal(number, 3);
  assert.deepEqual(roster.players, [1, 2, 3]);
});

test('a number is not given out again after a player leaves', () => {
  let { roster } = addPlayer(addPlayer(createRoster()).roster);
  roster = removePlayer(roster, 2);
  assert.deepEqual(roster.players, [1, 3]);
  const { roster: next, number } = addPlayer(roster);
  assert.equal(number, 4);
  assert.deepEqual(next.players, [1, 3, 4]);
});

test('removing a player leaves the roster it came from unchanged', () => {
  const { roster } = addPlayer(createRoster());
  removePlayer(roster, 2);
  assert.deepEqual(roster.players, [1, 2]);
});

test('players are named by number', () => {
  assert.equal(playerName(3), 'Player 3');
});
