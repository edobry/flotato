import { describe, expect, it } from 'vitest';
import { sortStandings } from './standings';

describe('sortStandings', () => {
  it('puts survivors first in their given order, then the fallen by time', () => {
    const rows = [
      { id: 'a', alive: false, time: 12.5 },
      { id: 'b', alive: true, time: 30 },
      { id: 'c', alive: false, time: 20.25 },
      { id: 'd', alive: true, time: 30 },
    ];
    expect(sortStandings(rows).map((r) => r.id)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('breaks a tie on time by place', () => {
    const rows = [
      { id: 'a', alive: false, time: 3.42, place: 2 },
      { id: 'b', alive: false, time: 3.42, place: 1 },
    ];
    expect(sortStandings(rows).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('leaves the input untouched', () => {
    const rows = [
      { id: 'a', alive: false, time: 1 },
      { id: 'b', alive: false, time: 2 },
    ];
    sortStandings(rows);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
