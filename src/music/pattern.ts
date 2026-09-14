// Tidal-style patterns.
//
// A pattern is a pure function from a time span (in cycles; one cycle is one
// 4/4 bar) to the events whose ONSET falls inside that span. Time is a plain
// number of cycles. A context value is threaded through every query untouched,
// so patterns can be parameterized by live game state at query time without
// any global mutation. The query model is kept isomorphic to Strudel's so a
// later swap is mechanical.

export interface Span {
  start: number;
  end: number;
}

export interface Hap<T> {
  start: number;
  end: number;
  value: T;
}

export type Pattern<T, C = unknown> = (span: Span, ctx: C) => Hap<T>[];

const EPS = 1e-7;

/** Half-open membership with a float tolerance: onset in [start, end). */
export function inSpan(onset: number, span: Span): boolean {
  return onset >= span.start - EPS && onset < span.end - EPS;
}

export function silence<C = unknown>(): Pattern<never, C> {
  return () => [];
}

/** One event per cycle, lasting the whole cycle. */
export function pure<T, C = unknown>(value: T): Pattern<T, C> {
  return (span) => {
    const out: Hap<T>[] = [];
    for (let c = Math.floor(span.start + EPS); c < span.end - EPS; c++) {
      if (inSpan(c, span)) out.push({ start: c, end: c + 1, value });
    }
    return out;
  };
}

export function stack<T, C>(...pats: Pattern<T, C>[]): Pattern<T, C> {
  return (span, ctx) => {
    const out: Hap<T>[] = [];
    for (const p of pats) out.push(...p(span, ctx));
    return out;
  };
}

export function fast<T, C>(factor: number, p: Pattern<T, C>): Pattern<T, C> {
  if (!(factor > 0)) return silence();
  if (factor === 1) return p;
  return (span, ctx) =>
    p({ start: span.start * factor, end: span.end * factor }, ctx).map((h) => ({
      start: h.start / factor,
      end: h.end / factor,
      value: h.value,
    }));
}

export function slow<T, C>(factor: number, p: Pattern<T, C>): Pattern<T, C> {
  return fast(1 / factor, p);
}

export function late<T, C>(offset: number, p: Pattern<T, C>): Pattern<T, C> {
  if (offset === 0) return p;
  return (span, ctx) =>
    p({ start: span.start - offset, end: span.end - offset }, ctx).map((h) => ({
      start: h.start + offset,
      end: h.end + offset,
      value: h.value,
    }));
}

export function early<T, C>(offset: number, p: Pattern<T, C>): Pattern<T, C> {
  return late(-offset, p);
}

/** Split a span at integer cycle boundaries. */
export function splitCycles(span: Span): Array<{ cycle: number; span: Span }> {
  const parts: Array<{ cycle: number; span: Span }> = [];
  let s = span.start;
  while (s < span.end - EPS) {
    const cycle = Math.floor(s + EPS);
    const e = Math.min(span.end, cycle + 1);
    parts.push({ cycle, span: { start: s, end: e } });
    s = e;
  }
  return parts;
}

/** Choose a pattern per cycle. */
export function perCycle<T, C>(choose: (cycle: number, ctx: C) => Pattern<T, C>): Pattern<T, C> {
  return (span, ctx) => {
    const out: Hap<T>[] = [];
    for (const part of splitCycles(span)) out.push(...choose(part.cycle, ctx)(part.span, ctx));
    return out;
  };
}

/** Apply f to p on every nth cycle (cycle 0 counts). */
export function every<T, C>(
  n: number,
  f: (p: Pattern<T, C>) => Pattern<T, C>,
  p: Pattern<T, C>,
): Pattern<T, C> {
  if (!(n > 0)) return p;
  const fp = f(p);
  return perCycle((cycle) => (((cycle % n) + n) % n === 0 ? fp : p));
}

/** Squeeze each cycle of p into [from, to) of each cycle; silence elsewhere. */
export function compress<T, C>(from: number, to: number, p: Pattern<T, C>): Pattern<T, C> {
  const w = to - from;
  if (!(w > 0)) return silence();
  return (span, ctx) => {
    const out: Hap<T>[] = [];
    for (const { cycle, span: sub } of splitCycles(span)) {
      const a = Math.max(sub.start, cycle + from);
      const b = Math.min(sub.end, cycle + to);
      if (b - a <= EPS) continue;
      const inner = {
        start: cycle + (a - cycle - from) / w,
        end: cycle + (b - cycle - from) / w,
      };
      for (const h of p(inner, ctx)) {
        const start = cycle + from + (h.start - cycle) * w;
        const end = cycle + from + (h.end - cycle) * w;
        if (inSpan(start, { start: a, end: b })) out.push({ start, end, value: h.value });
      }
    }
    return out;
  };
}

/** Subdivide each cycle equally among the given patterns (Tidal's fastcat). */
export function seq<T, C>(...pats: Pattern<T, C>[]): Pattern<T, C> {
  const n = pats.length;
  if (n === 0) return silence();
  if (n === 1) return pats[0];
  return stack(...pats.map((p, i) => compress(i / n, (i + 1) / n, p)));
}

/** One pattern per cycle in turn (the <a b c> alternation). */
export function cat<T, C>(...pats: Pattern<T, C>[]): Pattern<T, C> {
  const n = pats.length;
  if (n === 0) return silence();
  if (n === 1) return pats[0];
  return perCycle((cycle) => pats[((cycle % n) + n) % n]);
}

/** Reverse each cycle. */
export function rev<T, C>(p: Pattern<T, C>): Pattern<T, C> {
  return (span, ctx) => {
    const out: Hap<T>[] = [];
    for (const { cycle, span: sub } of splitCycles(span)) {
      const mirror = 2 * cycle + 1;
      for (const h of p({ start: cycle, end: cycle + 1 }, ctx)) {
        const start = mirror - h.end;
        const end = mirror - h.start;
        if (inSpan(start, sub)) out.push({ start, end, value: h.value });
      }
    }
    return out;
  };
}

export function fmap<A, B, C>(
  p: Pattern<A, C>,
  fn: (value: A, hap: Hap<A>, ctx: C) => B,
): Pattern<B, C> {
  return (span, ctx) =>
    p(span, ctx).map((h) => ({ start: h.start, end: h.end, value: fn(h.value, h, ctx) }));
}

export function filterHaps<T, C>(
  p: Pattern<T, C>,
  keep: (hap: Hap<T>, ctx: C) => boolean,
): Pattern<T, C> {
  return (span, ctx) => p(span, ctx).filter((h) => keep(h, ctx));
}

/** Pick a pattern from the context at query time. */
export function withCtx<T, C>(choose: (ctx: C) => Pattern<T, C>): Pattern<T, C> {
  return (span, ctx) => choose(ctx)(span, ctx);
}

/** Deterministic pseudo-random in [0, 1) from an onset and a seed. */
export function hashRand(x: number, seed = 0): number {
  const v = Math.sin(x * 12.9898 + seed * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

type Prob<C> = number | ((ctx: C) => number);
const probOf = <C>(prob: Prob<C>, ctx: C) => (typeof prob === 'function' ? prob(ctx) : prob);

/** Drop each event with the given probability, deterministically per onset. */
export function degradeBy<T, C>(prob: Prob<C>, p: Pattern<T, C>, seed = 0): Pattern<T, C> {
  return filterHaps(p, (h, ctx) => hashRand(h.start, seed) >= probOf(prob, ctx));
}

/** The complement of degradeBy with the same seed. */
export function unDegradeBy<T, C>(prob: Prob<C>, p: Pattern<T, C>, seed = 0): Pattern<T, C> {
  return filterHaps(p, (h, ctx) => hashRand(h.start, seed) < probOf(prob, ctx));
}

/** Apply f to a random subset of events. */
export function sometimesBy<T, C>(
  prob: Prob<C>,
  f: (p: Pattern<T, C>) => Pattern<T, C>,
  p: Pattern<T, C>,
  seed = 0,
): Pattern<T, C> {
  return stack(degradeBy(prob, p, seed), f(unDegradeBy(prob, p, seed)));
}

/** Layer a transformed, time-shifted copy over the original. */
export function off<T, C>(
  offset: number,
  f: (p: Pattern<T, C>) => Pattern<T, C>,
  p: Pattern<T, C>,
): Pattern<T, C> {
  return stack(p, late(offset, f(p)));
}
