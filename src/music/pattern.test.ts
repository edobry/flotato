import { describe, expect, it } from 'vitest';
import { type Pattern, degradeBy, every, fast, late, pure, rev, seq, stack } from './pattern';
import { mini } from './mini';

const query = <T>(p: Pattern<T>, start: number, end: number) =>
  p({ start, end }, undefined).sort((a, b) => a.start - b.start);
const onsets = <T>(p: Pattern<T>, start: number, end: number) => query(p, start, end).map((h) => h.start);
const values = <T>(p: Pattern<T>, start: number, end: number) => query(p, start, end).map((h) => h.value);

describe('pattern core', () => {
  it('pure emits one event per cycle, onset-filtered by the span', () => {
    expect(onsets(pure('a'), 0, 2)).toEqual([0, 1]);
    expect(onsets(pure('a'), 0.5, 1.5)).toEqual([1]);
    expect(onsets(pure('a'), 0.25, 0.75)).toEqual([]);
  });

  it('seq subdivides the cycle equally', () => {
    const p = seq(pure('a'), pure('b'));
    expect(onsets(p, 0, 1)).toEqual([0, 0.5]);
    expect(values(p, 0, 1)).toEqual(['a', 'b']);
    expect(query(p, 0, 1)[1].end).toBeCloseTo(1);
  });

  it('fast and late transform time', () => {
    const p = seq(pure('a'), pure('b'));
    expect(onsets(fast(2, p), 0, 1)).toEqual([0, 0.25, 0.5, 0.75]);
    expect(onsets(late(0.25, p), 0, 1)).toEqual([0.25, 0.75]);
  });

  it('every applies the transform on cycles divisible by n', () => {
    const abc: Pattern<string> = seq(pure('a'), pure('b'), pure('c'));
    const p = every(2, (q) => rev(q), abc);
    expect(values(p, 0, 1)).toEqual(['c', 'b', 'a']);
    expect(values(p, 1, 2)).toEqual(['a', 'b', 'c']);
    expect(onsets(p, 0, 1).map((x) => Math.round(x * 3))).toEqual([0, 1, 2]);
  });

  it('degradeBy is deterministic and respects the bounds', () => {
    const p = fast(16, pure('x'));
    expect(onsets(degradeBy(0, p), 0, 1)).toHaveLength(16);
    expect(onsets(degradeBy(1, p), 0, 1)).toHaveLength(0);
    const a = onsets(degradeBy(0.5, p, 4), 0, 4);
    const b = onsets(degradeBy(0.5, p, 4), 0, 4);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(10);
    expect(a.length).toBeLessThan(54);
  });

  it('stack layers patterns', () => {
    expect(values(stack(pure('a'), seq(pure('b'), pure('c'))), 0, 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('mini-notation', () => {
  it('parses sequences, subsequences, rests and speed', () => {
    const p = mini('a [b c] ~ d*2');
    expect(onsets(p, 0, 1)).toEqual([0, 0.25, 0.375, 0.75, 0.875]);
    expect(values(p, 0, 1)).toEqual(['a', 'b', 'c', 'd', 'd']);
  });

  it('alternates <a b> per cycle', () => {
    const p = mini('<a b>');
    expect(values(p, 0, 1)).toEqual(['a']);
    expect(values(p, 1, 2)).toEqual(['b']);
    expect(values(p, 2, 3)).toEqual(['a']);
  });

  it('stacks with a comma and repeats with !', () => {
    expect(values(mini('a, b c'), 0, 1)).toEqual(['a', 'b', 'c']);
    expect(onsets(mini('a! b'), 0, 1).map((x) => Math.round(x * 3))).toEqual([0, 1, 2]);
  });

  it('rejects malformed input', () => {
    expect(() => mini('a [b')).toThrow();
    expect(() => mini('a*0')).toThrow();
  });
});

describe('scheduler property', () => {
  it('sixteen consecutive 1/16 queries reproduce the whole-cycle query', () => {
    const p = mini('0 [1 2 3] <4 5> 6*3');
    const whole = query(p, 0, 1);
    const pieces: ReturnType<typeof query<string>> = [];
    for (let i = 0; i < 16; i++) pieces.push(...query(p, i / 16, (i + 1) / 16));
    pieces.sort((a, b) => a.start - b.start);
    expect(pieces.map((h) => h.value)).toEqual(whole.map((h) => h.value));
    pieces.forEach((h, i) => expect(h.start).toBeCloseTo(whole[i].start, 9));
    expect(whole).toHaveLength(8);
  });
});
