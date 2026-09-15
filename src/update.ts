// The service worker and when a new build takes over. The worker precaches the
// single-player shell and its chunks; a new deploy installs beside the old one
// and waits. Reloading into it mid-run would cost the run, so it is applied
// while the title screen is up, or once the page is hidden between runs; a
// tab that never gets either keeps the old build until it is next opened.

import { registerSW } from 'virtual:pwa-register';

export type UpdatePhase = 'start' | 'playing' | 'over';

const UPDATE_CHECK_MS = 60 * 60 * 1000;

let phase: UpdatePhase = 'start';
let apply: (() => void) | null = null;

function applyIf(ok: boolean): void {
  if (!apply || !ok) return;
  const f = apply;
  apply = null;
  f();
}

/** The game reports its phase so an update never lands on a run. */
export function reportPhase(p: UpdatePhase): void {
  phase = p;
}

/** Registers the worker, once, from the main entry. */
export function watchForUpdates(): void {
  if (!('serviceWorker' in navigator)) return;
  const update = registerSW({
    onNeedRefresh() {
      apply = () => update(true);
      applyIf(phase === 'start');
    },
    onRegisteredSW(_url, registration) {
      if (registration) setInterval(() => registration.update(), UPDATE_CHECK_MS);
    },
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') applyIf(phase !== 'playing');
  });
}
