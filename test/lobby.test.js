import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addLobbyPlayer,
  allReady,
  choose,
  chooseSong,
  createLobby,
  finishSong,
  isReady,
  nextPlayer,
  partHolder,
  playing,
  removeLobbyPlayer,
  sitsOut,
  startSong,
  takenParts,
} from '../js/lobby.js';

function lobbyOf(...players) {
  return players.slice(1).reduce(addLobbyPlayer, createLobby([players[0]]));
}

test('the host chooses the first song', () => {
  const lobby = lobbyOf(1, 2, 3);
  assert.equal(lobby.chooser, 1);
  assert.equal(lobby.phase, 'song');
});

test('only the chooser can choose the song', () => {
  const lobby = lobbyOf(1, 2);
  assert.equal(chooseSong(lobby, 2, 'ode.json', 3), lobby);
  const chosen = chooseSong(lobby, 1, 'ode.json', 3);
  assert.equal(chosen.phase, 'parts');
  assert.equal(chosen.song, 'ode.json');
  assert.equal(chooseSong(chosen, 1, 'other.json', 3), chosen);
});

test('choosing a part and a difficulty marks a player ready', () => {
  let lobby = chooseSong(lobbyOf(1, 2), 1, 'ode.json', 3);
  lobby = choose(lobby, 2, { part: 1 });
  assert.equal(isReady(lobby, 2), false);
  lobby = choose(lobby, 2, { difficulty: 'beginner' });
  assert.equal(isReady(lobby, 2), true);
  assert.equal(allReady(lobby), false);
  lobby = choose(lobby, 1, { part: 0, difficulty: 'advanced' });
  assert.equal(allReady(lobby), true);
});

test('a ready player can change their choice and stays ready', () => {
  let lobby = chooseSong(lobbyOf(1), 1, 'ode.json', 3);
  lobby = choose(lobby, 1, { part: 0, difficulty: 'beginner' });
  lobby = choose(lobby, 1, { part: 2 });
  assert.equal(isReady(lobby, 1), true);
  assert.deepEqual(lobby.choices[1], { part: 2, difficulty: 'beginner' });
});

test('choices that are not allowed change nothing', () => {
  const song = lobbyOf(1, 2);
  assert.equal(choose(song, 1, { part: 0 }), song);
  const parts = chooseSong(song, 1, 'ode.json', 2);
  assert.equal(choose(parts, 1, { part: 2 }), parts);
  assert.equal(choose(parts, 1, { part: -1 }), parts);
  assert.equal(choose(parts, 1, { difficulty: 'expert' }), parts);
  assert.equal(choose(parts, 7, { part: 0 }), parts);
});

test('each part can be held by one player only', () => {
  let lobby = chooseSong(lobbyOf(1, 2, 3), 1, 'ode.json', 3);
  lobby = choose(lobby, 1, { part: 2, difficulty: 'beginner' });
  const refused = choose(lobby, 2, { part: 2, difficulty: 'advanced' });
  assert.equal(refused, lobby);
  lobby = choose(lobby, 2, { part: 0, difficulty: 'advanced' });
  assert.equal(partHolder(lobby, 2), 1);
  assert.equal(partHolder(lobby, 0), 2);
  assert.equal(partHolder(lobby, 1), null);
  assert.deepEqual(takenParts(lobby), [0, 2]);
});

test('choosing a part claims it before a difficulty is chosen', () => {
  let lobby = chooseSong(lobbyOf(1, 2), 1, 'ode.json', 3);
  lobby = choose(lobby, 1, { part: 1 });
  assert.equal(choose(lobby, 2, { part: 1 }), lobby);
});

test('a part comes free when its player switches to another', () => {
  let lobby = chooseSong(lobbyOf(1, 2), 1, 'ode.json', 2);
  lobby = choose(lobby, 1, { part: 0, difficulty: 'beginner' });
  lobby = choose(lobby, 1, { part: 1 });
  lobby = choose(lobby, 2, { part: 0, difficulty: 'beginner' });
  assert.deepEqual(lobby.choices[2], { part: 0, difficulty: 'beginner' });
});

test('with more players than parts, a player left without one sits out', () => {
  let lobby = chooseSong(lobbyOf(1, 2, 3), 1, 'ode.json', 2);
  lobby = choose(lobby, 1, { part: 0, difficulty: 'beginner' });
  assert.equal(sitsOut(lobby, 3), false);
  lobby = choose(lobby, 2, { part: 1 });
  assert.equal(sitsOut(lobby, 3), true);
  assert.equal(sitsOut(lobby, 2), false);
  // Player 2 holds a part without a difficulty, so is still waited for.
  assert.equal(allReady(lobby), false);
  lobby = choose(lobby, 2, { difficulty: 'advanced' });
  assert.equal(allReady(lobby), true);
  lobby = startSong(lobby);
  assert.deepEqual(playing(lobby), [1, 2]);
  assert.equal(sitsOut(lobby, 3), true);
});

test('a player sitting out can take a part that comes free before the start', () => {
  let lobby = chooseSong(lobbyOf(1, 2), 1, 'ode.json', 1);
  lobby = choose(lobby, 1, { part: 0, difficulty: 'beginner' });
  lobby = choose(lobby, 2, { difficulty: 'beginner' });
  assert.equal(sitsOut(lobby, 2), true);
  lobby = removeLobbyPlayer(lobby, 1);
  assert.equal(sitsOut(lobby, 2), false);
  lobby = choose(lobby, 2, { part: 0 });
  assert.equal(isReady(lobby, 2), true);
});

test('the song does not start with nobody ready', () => {
  const lobby = chooseSong(lobbyOf(1), 1, 'ode.json', 1);
  assert.equal(allReady(lobby), false);
});

test('the taken parts are still known once the song has started', () => {
  let lobby = chooseSong(lobbyOf(1, 2), 1, 'ode.json', 3);
  lobby = choose(lobby, 1, { part: 0, difficulty: 'beginner' });
  lobby = choose(lobby, 2, { part: 2, difficulty: 'beginner' });
  lobby = startSong(lobby);
  assert.equal(lobby.phase, 'playing');
  assert.deepEqual(takenParts(lobby), [0, 2]);
});

test('the song starts only when everyone is ready', () => {
  let lobby = chooseSong(lobbyOf(1, 2), 1, 'ode.json', 2);
  lobby = choose(lobby, 1, { part: 0, difficulty: 'beginner' });
  assert.equal(startSong(lobby), lobby);
  lobby = choose(lobby, 2, { part: 1, difficulty: 'beginner' });
  assert.equal(startSong(lobby).phase, 'playing');
});

test('a player who leaves is no longer waited for', () => {
  let lobby = chooseSong(lobbyOf(1, 2), 1, 'ode.json', 2);
  lobby = choose(lobby, 1, { part: 0, difficulty: 'beginner' });
  lobby = removeLobbyPlayer(lobby, 2);
  assert.equal(allReady(lobby), true);
});

test('a player who joins while others choose parts is waited for', () => {
  let lobby = chooseSong(lobbyOf(1), 1, 'ode.json', 2);
  lobby = choose(lobby, 1, { part: 0, difficulty: 'beginner' });
  lobby = addLobbyPlayer(lobby, 2);
  assert.equal(allReady(lobby), false);
});

test('after each song the turn passes in the order of joining', () => {
  let lobby = lobbyOf(1, 2, 3);
  const turns = [];
  for (let i = 0; i < 4; i++) {
    turns.push(lobby.chooser);
    lobby = finishSong(chooseSong(lobby, lobby.chooser, 'ode.json', 1));
  }
  assert.deepEqual(turns, [1, 2, 3, 1]);
  assert.equal(lobby.phase, 'song');
  assert.deepEqual(lobby.choices, {});
});

test('anyone who has left is skipped, and anyone who joins goes to the end', () => {
  let lobby = lobbyOf(1, 2, 3);
  lobby = finishSong(chooseSong(lobby, 1, 'ode.json', 1));
  assert.equal(lobby.chooser, 2);
  lobby = removeLobbyPlayer(lobby, 3);
  lobby = addLobbyPlayer(lobby, 4);
  lobby = finishSong(chooseSong(lobby, 2, 'ode.json', 1));
  assert.equal(lobby.chooser, 4);
  lobby = finishSong(chooseSong(lobby, 4, 'ode.json', 1));
  assert.equal(lobby.chooser, 1);
});

test('a chooser who leaves before choosing passes the turn on', () => {
  let lobby = finishSong(chooseSong(lobbyOf(1, 2, 3), 1, 'ode.json', 1));
  assert.equal(lobby.chooser, 2);
  lobby = removeLobbyPlayer(lobby, 2);
  assert.equal(lobby.chooser, 3);
  lobby = removeLobbyPlayer(lobby, 3);
  assert.equal(lobby.chooser, 1);
});

test('the turn after the last player goes back to the first', () => {
  assert.equal(nextPlayer([1, 3, 5], 5), 1);
  assert.equal(nextPlayer([1, 3, 5], 2), 3);
  assert.equal(nextPlayer([], 1), null);
});

test('the lobby given is not changed', () => {
  const lobby = lobbyOf(1, 2);
  const parts = chooseSong(lobby, 1, 'ode.json', 2);
  choose(parts, 1, { part: 0, difficulty: 'beginner' });
  removeLobbyPlayer(parts, 2);
  assert.deepEqual(parts.players, [1, 2]);
  assert.deepEqual(parts.choices, {});
  assert.equal(lobby.phase, 'song');
});
