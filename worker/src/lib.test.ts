import { describe, expect, it } from 'vitest';
import {
  STATS_MAX_ROWS,
  allowOrigin,
  computeStats,
  computeVariantStats,
  encodeStoredDiff,
  median,
  normalizeTag,
  parseBoardQuery,
  parsePref,
  parseRun,
  parseStatsQuery,
  percentile,
  statsQueryKey,
  summarizePrefs,
} from './lib';

const summary = {
  time: 23.41,
  reaction: { median: 0.21, p90: 0.34, n: 11 },
  anticipation: { ratio: 0.36, n: 14 },
  beat: { r: 0.42, phase: 0.08, n: 18 },
  loop: { overshoots: 2, reversals: 5 },
  death: 'overshoot',
};

describe('normalizeTag', () => {
  it('uppercases, strips punctuation, and truncates to three', () => {
    expect(normalizeTag('eug')).toBe('EUG');
    expect(normalizeTag(' e-u.g! ')).toBe('EUG');
    expect(normalizeTag('eugene')).toBe('EUG');
    expect(normalizeTag('a1')).toBe('A1');
  });

  it('replaces empty and blocked tags', () => {
    expect(normalizeTag('')).toBe('???');
    expect(normalizeTag(undefined)).toBe('???');
    expect(normalizeTag('ass')).toBe('???');
  });
});

describe('parseRun', () => {
  it('flattens a full submission into a row', () => {
    const parsed = parseRun({ device: 'd1', tag: 'eug', variant: 'reactivity=0', slot: 'A', build: 'abc', run: summary, tuning: { reactivity: 0 } });
    expect('row' in parsed).toBe(true);
    if (!('row' in parsed)) return;
    expect(parsed.row).toMatchObject({
      device: 'd1',
      tag: 'EUG',
      variant: 'reactivity=0',
      slot: 'A',
      build: 'abc',
      time: 23.41,
      death: 'overshoot',
      reaction_median: 0.21,
      reaction_p90: 0.34,
      reaction_n: 11,
      anticipation: 0.36,
      anticipation_n: 14,
      beat_r: 0.42,
      beat_phase: 0.08,
      beat_n: 18,
      overshoots: 2,
      reversals: 5,
      countin_onsets: null,
      countin_r: null,
      tuning: '{"reactivity":0}',
    });
  });

  it('nulls metrics whose sample count is zero', () => {
    const parsed = parseRun({ device: 'd1', tag: 'x', run: { ...summary, reaction: { median: 0, p90: 0, n: 0 }, beat: { r: 0, phase: 0, n: 0 } } });
    if (!('row' in parsed)) throw new Error(parsed.error);
    expect(parsed.row.reaction_median).toBeNull();
    expect(parsed.row.beat_r).toBeNull();
    expect(parsed.row.variant).toBe('default');
  });

  it('keeps the count-in readiness when present', () => {
    const parsed = parseRun({ device: 'd1', tag: 'x', run: { ...summary, countIn: { onsets: 4, r: 0.7 } } });
    if (!('row' in parsed)) throw new Error(parsed.error);
    expect(parsed.row.countin_onsets).toBe(4);
    expect(parsed.row.countin_r).toBe(0.7);
  });

  it('refuses bodies missing the essentials', () => {
    expect(parseRun(null)).toEqual({ error: 'body must be an object' });
    expect(parseRun({ device: 'd1' })).toEqual({ error: 'run is required' });
    expect(parseRun({ device: 'd1', run: { ...summary, time: 'soon' } })).toEqual({ error: 'run.time must be a number of seconds' });
    expect(parseRun({ device: 'd1', run: { ...summary, death: 'boredom' } })).toEqual({ error: 'run.death must be a death class' });
    expect(parseRun({ run: summary })).toEqual({ error: 'device is required' });
  });

  it('bounds strings and drops oversized tuning', () => {
    const parsed = parseRun({ device: 'x'.repeat(500), tag: 'ok', run: summary, tuning: { pad: 'y'.repeat(5000) } });
    if (!('row' in parsed)) throw new Error(parsed.error);
    expect(parsed.row.device).toHaveLength(64);
    expect(parsed.row.tuning).toBe('{}');
  });
});

describe('parseBoardQuery', () => {
  it('defaults and clamps', () => {
    expect(parseBoardQuery(new URLSearchParams(''))).toEqual({ limit: 10, hours: 12 });
    expect(parseBoardQuery(new URLSearchParams('limit=500&hours=99999'))).toEqual({ limit: 50, hours: 720 });
    expect(parseBoardQuery(new URLSearchParams('limit=0&hours=-3'))).toEqual({ limit: 10, hours: 12 });
    expect(parseBoardQuery(new URLSearchParams('limit=0.5&hours=abc'))).toEqual({ limit: 1, hours: 12 });
  });
});

describe('stats', () => {
  it('median handles odd, even, and empty', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('computes the room from rows', () => {
    const rows = [
      { device: 'a', time: 10, death: 'late', reaction_median: 0.3, beat_r: 0.2 },
      { device: 'a', time: 20, death: 'freeze', reaction_median: 0.2, beat_r: null },
      { device: 'b', time: 15, death: 'late', reaction_median: null, beat_r: 0.6 },
    ];
    expect(computeStats(rows)).toEqual({
      runs: 3,
      devices: 2,
      best: 20,
      reactionMedian: 0.25,
      beatR: 0.4,
      deaths: { jitter: 0, overshoot: 0, 'wrong way': 0, freeze: 1, late: 2 },
    });
  });
});

describe('percentile', () => {
  it('interpolates between order statistics', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5], 0.9)).toBe(4.6);
    expect(percentile([10, 20], 0.9)).toBe(19);
    expect(percentile([7], 0.9)).toBe(7);
    expect(percentile([5, 1], 0)).toBe(1);
    expect(percentile([5, 1], 1)).toBe(5);
    expect(percentile([], 0.9)).toBeNull();
  });
});

describe('parseStatsQuery', () => {
  it('defaults to the board window with no filter or marker', () => {
    expect(parseStatsQuery(new URLSearchParams(''))).toEqual({ hours: 12, variant: null, since: null });
    expect(parseStatsQuery(new URLSearchParams('hours=99999&variant=reactivity%3D0'))).toEqual({ hours: 720, variant: 'reactivity=0', since: null });
  });

  it('reads a since marker as a timestamp or a build id, and lets it replace the window', () => {
    expect(parseStatsQuery(new URLSearchParams('since=1757900000000'))).toEqual({ hours: null, variant: null, since: { kind: 'timestamp', at: 1757900000000 } });
    expect(parseStatsQuery(new URLSearchParams('since=9178ffc'))).toEqual({ hours: null, variant: null, since: { kind: 'build', build: '9178ffc' } });
    expect(parseStatsQuery(new URLSearchParams('since=9178ffc&hours=3'))).toEqual({ hours: 3, variant: null, since: { kind: 'build', build: '9178ffc' } });
    expect(parseStatsQuery(new URLSearchParams('since=%20'))).toEqual({ hours: 12, variant: null, since: null });
    expect(parseStatsQuery(new URLSearchParams('since=' + 'x'.repeat(100))).since).toEqual({ kind: 'build', build: 'x'.repeat(64) });
  });

  it('keys the cache by values', () => {
    expect(statsQueryKey(parseStatsQuery(new URLSearchParams('')))).toBe('12||');
    expect(statsQueryKey(parseStatsQuery(new URLSearchParams('since=9178ffc&variant=x')))).toBe('|x|b9178ffc');
    expect(statsQueryKey(parseStatsQuery(new URLSearchParams('since=1757900000000&hours=2')))).toBe('2||t1757900000000');
    expect(statsQueryKey({ since: null, variant: null, hours: 12 })).toBe(statsQueryKey({ hours: 12, variant: null, since: null }));
  });
});

describe('computeVariantStats', () => {
  const row = (over: Partial<Parameters<typeof computeVariantStats>[0][number]>) => ({
    variant: 'default',
    slot: '',
    device: 'a',
    time: 10,
    death: 'late' as const,
    reaction_median: null,
    reaction_p90: null,
    anticipation: null,
    beat_r: null,
    countin_onsets: null,
    countin_r: null,
    ...over,
  });

  it('groups five runs under two variants into two rows sorted by runs', () => {
    const rows = [
      row({ variant: 'default', device: 'a', time: 10, death: 'late', reaction_median: 0.3, reaction_p90: 0.5, beat_r: 0.25, anticipation: 0.4 }),
      row({ variant: 'reactivity=0', device: 'b', time: 30, death: 'freeze', reaction_median: 0.2, reaction_p90: 0.4, beat_r: 0.6, countin_onsets: 4, countin_r: 0.8 }),
      row({ variant: 'default', device: 'a', time: 20, death: 'overshoot', reaction_median: 0.1, reaction_p90: 0.3, beat_r: 0.5, anticipation: 0.6 }),
      row({ variant: 'default', device: 'c', time: 40, death: 'late', reaction_median: 0.5, reaction_p90: 0.7 }),
      row({ variant: 'reactivity=0', device: 'b', time: 50, death: 'late', countin_onsets: 2, countin_r: 0.2 }),
    ];
    const groups = computeVariantStats(rows);
    expect(groups.map((g) => [g.variant, g.runs, g.devices])).toEqual([
      ['default', 3, 2],
      ['reactivity=0', 2, 1],
    ]);
    expect(groups[0]).toMatchObject({
      slot: '',
      time: { median: 20, p90: 36, best: 40 },
      reaction: { median: 0.3, p90: 0.5 },
      beatR: 0.375,
      anticipation: 0.5,
      countIn: { onsets: null, r: null },
      deaths: { jitter: 0, overshoot: 1, 'wrong way': 0, freeze: 0, late: 2 },
    });
    expect(groups[1]).toMatchObject({
      time: { median: 40, p90: 48, best: 50 },
      reaction: { median: 0.2, p90: 0.4 },
      beatR: 0.6,
      anticipation: null,
      countIn: { onsets: 3, r: 0.5 },
      deaths: { freeze: 1, late: 1 },
    });
  });

  it('keeps slots apart within a variant and orders ties by name', () => {
    const rows = [row({ variant: 'v', slot: 'B' }), row({ variant: 'v', slot: 'A' }), row({ variant: 'u', slot: '' })];
    expect(computeVariantStats(rows).map((g) => [g.variant, g.slot, g.runs])).toEqual([
      ['u', '', 1],
      ['v', 'A', 1],
      ['v', 'B', 1],
    ]);
    expect(computeVariantStats([])).toEqual([]);
    expect(STATS_MAX_ROWS).toBeGreaterThan(0);
  });
});

describe('parsePref', () => {
  it('reads a verdict row', () => {
    expect(parsePref({ device: 'd1', build: 'abc', step: 'tempo-up', verdict: 'B', base: { bpmFloor: 140, bpmCeil: 150 } })).toEqual({
      row: { device: 'd1', build: 'abc', step: 'tempo-up', verdict: 'B', base: '{"bpmFloor":140,"bpmCeil":150}', final: null },
    });
  });

  it('reads a finished-walk row', () => {
    expect(parsePref({ device: 'd1', final: {} })).toEqual({ row: { device: 'd1', build: '', step: null, verdict: null, base: null, final: '{}' } });
  });

  it('refuses what is neither, and mixes', () => {
    expect(parsePref(null)).toEqual({ error: 'body must be an object' });
    expect(parsePref({ step: 'x', verdict: 'A', base: {} })).toEqual({ error: 'device is required' });
    expect(parsePref({ device: 'd1' })).toEqual({ error: 'step or final is required' });
    expect(parsePref({ device: 'd1', step: 'x', verdict: 'C', base: {} })).toEqual({ error: 'verdict must be A, B, same or skip' });
    expect(parsePref({ device: 'd1', step: 'x', verdict: 'A', base: 'nope' })).toEqual({ error: 'base must be an object' });
    expect(parsePref({ device: 'd1', step: 'x', verdict: 'A', base: {}, final: {} })).toEqual({ error: 'final and step are exclusive' });
  });

  it('bounds strings and empties oversized diffs', () => {
    const parsed = parsePref({ device: 'x'.repeat(500), step: 's'.repeat(500), verdict: 'skip', base: { pad: 'y'.repeat(5000) } });
    if (!('row' in parsed)) throw new Error(parsed.error);
    expect(parsed.row.device).toHaveLength(64);
    expect(parsed.row.step).toHaveLength(64);
    expect(parsed.row.base).toBe('{}');
  });

  it('keeps only primitive diff values', () => {
    const parsed = parsePref({ device: 'd1', final: { scale: 'wholeTone', pump: 0, drums: false, nested: { a: 1 }, list: [1], gone: null } });
    if (!('row' in parsed)) throw new Error(parsed.error);
    expect(parsed.row.final).toBe('{"scale":"wholeTone","pump":0,"drums":false}');
  });
});

describe('prefs summary', () => {
  it('encodes stored diffs as tune strings with sorted keys', () => {
    expect(encodeStoredDiff('{"scale":"wholeTone","bpmFloor":140}')).toBe('bpmFloor=140,scale=wholeTone');
    expect(encodeStoredDiff('{}')).toBe('default');
    expect(encodeStoredDiff(null)).toBe('default');
    expect(encodeStoredDiff('not json')).toBe('default');
  });

  it('counts three verdicts on three steps once each, and ranks finals', () => {
    const rows = [
      { step: 'register', verdict: 'A', final: null },
      { step: 'tempo-up', verdict: 'B', final: null },
      { step: 'tempo-up-2', verdict: 'same', final: null },
      { step: 'tempo-up', verdict: 'skip', final: null },
      { step: null, verdict: null, final: '{"bpmFloor":140,"bpmCeil":150}' },
      { step: null, verdict: null, final: '{"bpmCeil":150,"bpmFloor":140}' },
      { step: null, verdict: null, final: '{}' },
      { step: 'ghost', verdict: 'maybe', final: null },
    ];
    expect(summarizePrefs(rows)).toEqual({
      verdicts: 4,
      walks: 3,
      steps: [
        { id: 'tempo-up', A: 0, B: 1, same: 0, skip: 1, n: 2 },
        { id: 'register', A: 1, B: 0, same: 0, skip: 0, n: 1 },
        { id: 'tempo-up-2', A: 0, B: 0, same: 1, skip: 0, n: 1 },
      ],
      finals: [
        { diff: 'bpmCeil=150,bpmFloor=140', n: 2 },
        { diff: 'default', n: 1 },
      ],
    });
    expect(summarizePrefs([])).toEqual({ verdicts: 0, walks: 0, steps: [], finals: [] });
  });
});

describe('allowOrigin', () => {
  const site = 'https://edobry.github.io';
  it('admits the site and local dev servers only', () => {
    expect(allowOrigin(site, site)).toBe(site);
    expect(allowOrigin('http://localhost:5173', site)).toBe('http://localhost:5173');
    expect(allowOrigin('http://192.168.1.4:5174', site)).toBe('http://192.168.1.4:5174');
    expect(allowOrigin('https://evil.example', site)).toBeNull();
    expect(allowOrigin('http://localhost.evil.example', site)).toBeNull();
    expect(allowOrigin(null, site)).toBeNull();
  });
});
