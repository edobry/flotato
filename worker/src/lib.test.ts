import { describe, expect, it } from 'vitest';
import { allowOrigin, computeStats, median, normalizeTag, parseBoardQuery, parseRun } from './lib';

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
