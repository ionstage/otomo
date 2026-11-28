// The lobby between songs, as the host keeps it: whose turn it is to choose
// the song, the song chosen, and each player's part and difficulty. See
// section 9 of docs/design.md.
//
// Players are numbers, given in the order they joined (see roster.js), so
// the turn passes to the next higher number still in the group, and from
// the highest back to the lowest.
//
// Phases: "song" while the chooser picks a song, "parts" while the players
// pick their parts and difficulties, and "playing" during the song.
//
// Every function returns a new lobby and leaves the one it was given as it
// was. An action that is not allowed returns the lobby unchanged.

export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

export function createLobby(players = [1]) {
  return { players: [...players], chooser: players[0], phase: 'song', song: null, partCount: 0, choices: {} };
}

// The player after `number` in the order of joining, or the first.
export function nextPlayer(players, number) {
  const sorted = [...players].sort((a, b) => a - b);
  return sorted.find((player) => player > number) ?? sorted[0] ?? null;
}

// A player who joins goes to the end of the order. During the parts phase
// they choose too, and are waited for.
export function addLobbyPlayer(lobby, number) {
  if (lobby.players.includes(number)) {
    return lobby;
  }
  const players = [...lobby.players, number];
  return { ...lobby, players, chooser: lobby.chooser ?? number };
}

// A chooser who leaves before choosing passes the turn on.
export function removeLobbyPlayer(lobby, number) {
  if (!lobby.players.includes(number)) {
    return lobby;
  }
  const players = lobby.players.filter((player) => player !== number);
  const choices = { ...lobby.choices };
  delete choices[number];
  let chooser = lobby.chooser;
  if (chooser === number) {
    chooser = nextPlayer(players, number);
  }
  return { ...lobby, players, chooser, choices };
}

export function chooseSong(lobby, number, song, partCount) {
  if (lobby.phase !== 'song' || number !== lobby.chooser || !Number.isInteger(partCount) || partCount < 1) {
    return lobby;
  }
  return { ...lobby, phase: 'parts', song, partCount, choices: {} };
}

// Sets a player's part, difficulty or both. Allowed until the song starts,
// so a ready player can change their mind and stays ready.
export function choose(lobby, number, { part, difficulty } = {}) {
  if (lobby.phase !== 'parts' || !lobby.players.includes(number)) {
    return lobby;
  }
  const current = lobby.choices[number] ?? { part: null, difficulty: null };
  const next = { ...current };
  if (part !== undefined) {
    if (!Number.isInteger(part) || part < 0 || part >= lobby.partCount) {
      return lobby;
    }
    next.part = part;
  }
  if (difficulty !== undefined) {
    if (!DIFFICULTIES.includes(difficulty)) {
      return lobby;
    }
    next.difficulty = difficulty;
  }
  return { ...lobby, choices: { ...lobby.choices, [number]: next } };
}

// A player has chosen both a part and a difficulty.
function hasChosen(lobby, number) {
  const choice = lobby.choices[number];
  return Number.isInteger(choice?.part) && typeof choice.difficulty === 'string';
}

export function isReady(lobby, number) {
  return lobby.phase === 'parts' && hasChosen(lobby, number);
}

// Every player still in the group is ready.
export function allReady(lobby) {
  return lobby.phase === 'parts' && lobby.players.length > 0 && lobby.players.every((number) => isReady(lobby, number));
}

// The parts any player has taken, while choosing and once the song has
// started. None of them is autoplayed.
export function takenParts(lobby) {
  return [...new Set(lobby.players.filter((number) => hasChosen(lobby, number)).map((number) => lobby.choices[number].part))]
    .sort((a, b) => a - b);
}

export function startSong(lobby) {
  return allReady(lobby) ? { ...lobby, phase: 'playing' } : lobby;
}

// After the song, the turn passes to the next player.
export function finishSong(lobby) {
  if (lobby.phase === 'song') {
    return lobby;
  }
  return { ...lobby, phase: 'song', song: null, partCount: 0, choices: {}, chooser: nextPlayer(lobby.players, lobby.chooser) };
}
