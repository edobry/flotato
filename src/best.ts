// The device's best survival time. One number in localStorage, so it outlives
// a reload; the tune sheet's reset leaves it alone and has its own control.

export const BEST_KEY = 'flotato.best';

/** The stored best in seconds, or 0 when there is none or it is unreadable. */
export function loadBest(): number {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    if (raw === null) return 0;
    const t = Number(raw);
    return Number.isFinite(t) && t > 0 ? t : 0;
  } catch {
    return 0;
  }
}

export function saveBest(t: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(t));
  } catch {
    /* storage unavailable */
  }
}

export function clearBest(): void {
  try {
    localStorage.removeItem(BEST_KEY);
  } catch {
    /* storage unavailable */
  }
}
