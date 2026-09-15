// The order a round is read in, on the projector and on a fallen player's
// phone alike: whoever is still in first, in the order they were spread on
// the rim, then the fallen by how long they lasted.

export interface Standing {
  alive: boolean;
  time: number;
}

export function sortStandings<T extends Standing>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    return a.alive ? 0 : b.time - a.time;
  });
}
