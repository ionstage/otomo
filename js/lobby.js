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

// The player holding `part`, or null. Choosing a part claims it, even
// before a difficulty is chosen.
export function partHolder(lobby, part) {
  return lobby.players.find((number) => lobby.choices[number]?.part === part) ?? null;
}

// Sets a player's part, difficulty or both. Allowed until the song starts,
// so a ready player can change their mind and stays ready. Each part can
// be held by one player only.
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
    const holder = partHolder(lobby, part);
    if (holder !== null && holder !== number) {
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
export function hasChosen(lobby, number) {
  const choice = lobby.choices[number];
  return Number.isInteger(choice?.part) && typeof choice.difficulty === 'string';
}

export function isReady(lobby, number) {
  return lobby.phase === 'parts' && hasChosen(lobby, number);
}

// With more players than parts, a player without a part sits the song out
// once every part is held by someone else. Once the song has started,
// everyone who had not chosen sits it out.
export function sitsOut(lobby, number) {
  if (lobby.phase === 'playing') {
    return !hasChosen(lobby, number);
  }
  if (lobby.phase !== 'parts' || Number.isInteger(lobby.choices[number]?.part)) {
    return false;
  }
  for (let part = 0; part < lobby.partCount; part++) {
    if (partHolder(lobby, part) === null) {
      return false;
    }
  }
  return true;
}

// Every player still in the group is ready or sits the song out.
export function allReady(lobby) {
  return lobby.phase === 'parts'
    && lobby.players.some((number) => isReady(lobby, number))
    && lobby.players.every((number) => isReady(lobby, number) || sitsOut(lobby, number));
}

// The players who play the song, with a part and a difficulty.
export function playing(lobby) {
  return lobby.players.filter((number) => hasChosen(lobby, number));
}

// The parts the players have taken, while choosing and once the song has
// started. None of them is autoplayed.
export function takenParts(lobby) {
  return playing(lobby).map((number) => lobby.choices[number].part).sort((a, b) => a - b);
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
