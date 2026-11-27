// The players in a group, numbered in the order they joined. The host is
// Player 1. A number is never given out again within a group, so the numbers
// keep showing the order of joining after players leave. See section 9 of
// docs/design.md.

export function createRoster() {
  return { players: [1], next: 2 };
}

// Returns the new roster and the number given to the player.
export function addPlayer(roster) {
  const number = roster.next;
  return { roster: { players: [...roster.players, number], next: number + 1 }, number };
}

export function removePlayer(roster, number) {
  return { ...roster, players: roster.players.filter((player) => player !== number) };
}

export function playerName(number) {
  return `Player ${number}`;
}
