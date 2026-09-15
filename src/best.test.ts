import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BEST_KEY, clearBest, loadBest, saveBest } from './best';

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

describe('best time storage', () => {
  beforeEach(() => vi.stubGlobal('localStorage', fakeStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('is 0 when nothing is stored', () => {
    expect(loadBest()).toBe(0);
  });

  it('round-trips a time', () => {
    saveBest(12.345);
    expect(localStorage.getItem(BEST_KEY)).toBe('12.345');
    expect(loadBest()).toBe(12.345);
  });

  it('treats garbage, negatives and non-finite values as no best', () => {
    for (const raw of ['', 'abc', '-3', 'NaN', 'Infinity', '{}']) {
      localStorage.setItem(BEST_KEY, raw);
      expect(loadBest(), raw).toBe(0);
    }
  });

  it('refuses to store what would read back as no best', () => {
    saveBest(3);
    for (const t of [0, -1, NaN, Infinity]) saveBest(t);
    expect(loadBest()).toBe(3);
  });

  it('clears', () => {
    saveBest(4);
    clearBest();
    expect(loadBest()).toBe(0);
  });

  it('survives a missing localStorage', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadBest()).toBe(0);
    expect(() => saveBest(1)).not.toThrow();
    expect(() => clearBest()).not.toThrow();
  });
});
