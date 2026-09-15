import { describe, expect, it } from 'vitest';
import { DEFAULT_TUNING } from '../music/tuning';
import { appendRun, groupRuns, type RunRecord } from './runlog';

const rec = (time: number, diff = 'default', at = 0): RunRecord => ({ at, time, diff, slot: '', tuning: DEFAULT_TUNING });

describe('run log', () => {
  it('keeps the newest records up to the cap', () => {
    let runs: RunRecord[] = [];
    for (let i = 0; i < 305; i++) runs = appendRun(runs, rec(i, 'default', i));
    expect(runs.length).toBe(300);
    expect(runs[0].at).toBe(5);
    expect(runs[299].at).toBe(304);
  });

  it('groups by diff with n, median and best, in first-seen order', () => {
    const runs = [rec(10, 'a'), rec(4, 'b'), rec(30, 'a'), rec(20, 'a'), rec(6, 'b')];
    expect(groupRuns(runs)).toEqual([
      { diff: 'a', n: 3, median: 20, best: 30 },
      { diff: 'b', n: 2, median: 5, best: 6 },
    ]);
    expect(groupRuns([])).toEqual([]);
  });
});
