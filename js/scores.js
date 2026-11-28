// The group score after a song with several devices, as the host tallies
// it: the average of the song scores of the players who played to the end.
// A player who quits the song or loses their connection is left out. See
// section 9 of docs/design.md.
//
// Every function returns a new tally and leaves the one it was given as it
// was.

// A tally waiting for the scores of `players`, the numbers of the players
// who started the song.
export function createTally(players) {
  return { expected: [...players], scores: {} };
}

export function addScore(tally, number, score) {
  if (!tally.expected.includes(number) || typeof score !== 'number' || !Number.isFinite(score)) {
    return tally;
  }
  return { ...tally, scores: { ...tally.scores, [number]: score } };
}

// A player who will not send a score.
export function leaveTally(tally, number) {
  if (!tally.expected.includes(number)) {
    return tally;
  }
  const scores = { ...tally.scores };
  delete scores[number];
  return { expected: tally.expected.filter((player) => player !== number), scores };
}

// Every player still expected has sent a score.
export function tallyComplete(tally) {
  return tally.expected.every((number) => number in tally.scores);
}

// The average of the scores and how many there are, or null without any.
export function groupScore(tally) {
  const scores = Object.values(tally.scores);
  if (scores.length === 0) {
    return null;
  }
  return { average: scores.reduce((sum, score) => sum + score, 0) / scores.length, count: scores.length };
}
