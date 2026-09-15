// The order a round is read in, on the projector and on a fallen player's
// phone alike: whoever is still in first, in the order they were spread on
// the rim, then the fallen by how long they lasted, place breaking a tie.

export interface Standing {
  alive: boolean;
  time: number;
  /** Finishing place once dead (1 = last survivor); 0 while alive. */
  place?: number;
}

export function sortStandings<T extends Standing>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.alive) return 0;
    return b.time - a.time || (a.place ?? 0) - (b.place ?? 0);
  });
}
