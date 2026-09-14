import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../music/engine';
import { createObserver, type Observer, type ObserverConfig } from './observer';

const DT = 1 / 60;

/** Scripts a run frame by frame. Lane danger for the player's sector is copied into `danger` before each frame. */
function sim(config: Partial<ObserverConfig> = {}) {
  const obs: Observer = createObserver(config);
  const s: Snapshot = { t: 0, danger: 0, pressure: 0, sector: 0, lanes: [0, 0, 0, 0, 0, 0], rotDir: 0, camSpin: 0, playing: true };
  let beat = -1;
  obs.start();
  const api = {
    s,
    obs,
    /** Advance n frames; `each` mutates the snapshot before frame i. */
    run(n: number, each?: (i: number) => void) {
      for (let i = 0; i < n; i++) {
        s.t += DT;
        each?.(i);
        s.danger = s.lanes[s.sector];
        obs.frame(s, beat);
      }
      return api;
    },
    /** A wall reaches the player in `sector` over `seconds`: its lane danger ramps 0 to 1. */
    approach(sector: number, seconds: number) {
      const n = Math.round(seconds / DT);
      return api.run(n, (i) => {
        s.lanes[sector] = Math.min(1, (i + 1) / n);
      });
    },
    beat(b: number) {
      beat = b;
      return api;
    },
    die: () => obs.die(),
  };
  return api;
}

describe('reaction latency', () => {
  it('measures a wall-caused onset to the first input, within a frame', () => {
    const g = sim();
    g.approach(0, 0.2); // onset on the first frame of the approach
    g.run(1, () => {
      g.s.rotDir = 1;
    });
    g.run(1, () => {
      g.s.sector = 1; // escaped into a clear lane
    });
    const r = g.die();
    expect(r.reaction.n).toBe(1);
    expect(r.reaction.median).toBeCloseTo(0.2, 1);
    expect(Math.abs(r.reaction.median - 0.2)).toBeLessThanOrEqual(DT + 1e-9);
  });

  it('does not measure episodes the player was already moving through', () => {
    const g = sim();
    g.run(1, () => {
      g.s.rotDir = 1;
    });
    g.approach(0, 0.3);
    expect(g.die().reaction.n).toBe(0);
  });

  it('ignores self-caused onsets', () => {
    const g = sim();
    g.s.lanes[1] = 0.7;
    g.run(3);
    g.run(1, () => {
      g.s.rotDir = 1;
    });
    g.run(1, () => {
      g.s.sector = 1;
    });
    g.run(1, () => {
      g.s.rotDir = 0;
    });
    g.run(1, () => {
      g.s.rotDir = -1;
    });
    expect(g.die().reaction.n).toBe(0);
  });

  it('respects a raised onset threshold', () => {
    const g = sim({ dangerOnset: 0.5 });
    g.approach(0, 0.6); // crosses 0.5 at 0.3s
    g.run(1, () => {
      g.s.rotDir = -1;
    });
    const r = g.die();
    expect(r.reaction.n).toBe(1);
    expect(r.reaction.median).toBeCloseTo(0.3, 1);
  });
});

describe('anticipation ratio', () => {
  it('is 1 when every input onset happens in a clear lane', () => {
    const g = sim();
    for (let k = 0; k < 3; k++) {
      g.run(5, () => {
        g.s.rotDir = 1;
      });
      g.run(5, () => {
        g.s.rotDir = 0;
      });
    }
    const r = g.die();
    expect(r.anticipation).toEqual({ ratio: 1, n: 3 });
  });

  it('is 0 when every input onset happens under threat', () => {
    const g = sim();
    g.approach(0, 0.1);
    g.run(3, () => {
      g.s.rotDir = 1;
    });
    g.run(3, () => {
      g.s.rotDir = 0;
    });
    g.run(3, () => {
      g.s.rotDir = -1;
    });
    const r = g.die();
    expect(r.anticipation).toEqual({ ratio: 0, n: 2 });
  });
});

describe('beat entrainment', () => {
  const press = (g: ReturnType<typeof sim>, phase: number) => {
    g.beat(phase);
    g.run(2, () => {
      g.s.rotDir = 1;
    });
    g.run(2, () => {
      g.s.rotDir = 0;
    });
  };

  it('is phase-locked when every onset lands at the same phase', () => {
    const g = sim();
    for (let k = 0; k < 8; k++) press(g, 0.25);
    const r = g.die();
    expect(r.beat.n).toBe(8);
    expect(r.beat.r).toBeGreaterThan(0.95);
    expect(Math.abs(r.beat.phase - 0.25)).toBeLessThan(0.02);
  });

  it('is near zero for onsets spread across the beat', () => {
    const g = sim();
    for (let k = 0; k < 8; k++) press(g, (k % 4) / 4);
    expect(g.die().beat.r).toBeLessThan(0.2);
  });

  it('reports a phase just before the beat as negative', () => {
    const g = sim();
    for (let k = 0; k < 4; k++) press(g, 0.95);
    expect(g.die().beat.phase).toBeCloseTo(-0.05, 2);
  });

  it('skips onsets while the Transport is not running', () => {
    const g = sim();
    press(g, -1);
    press(g, 0.5);
    expect(g.die().beat.n).toBe(1);
  });
});

describe('loop character', () => {
  it('counts direct reversals and reversals through zero within the gap', () => {
    const g = sim();
    g.run(2, () => {
      g.s.rotDir = 1;
    });
    g.run(2, () => {
      g.s.rotDir = -1; // direct
    });
    g.run(2, () => {
      g.s.rotDir = 0;
    });
    g.run(2, () => {
      g.s.rotDir = 1; // through zero, 2 frames later
    });
    g.run(30, () => {
      g.s.rotDir = 0;
    });
    g.run(2, () => {
      g.s.rotDir = -1; // through zero, half a second later: not a reversal
    });
    expect(g.die().loop.reversals).toBe(2);
  });

  it('counts an overshoot: through the gap into a wall, then back', () => {
    const g = sim();
    g.s.lanes[2] = 0.6;
    g.run(2, () => {
      g.s.rotDir = 1;
    });
    g.run(1, () => {
      g.s.sector = 1; // the gap
    });
    g.run(1, () => {
      g.s.sector = 2; // past it, into a wall
    });
    g.run(1, () => {
      g.s.rotDir = -1; // and back
    });
    g.run(1, () => {
      g.s.sector = 1;
    });
    const r = g.die();
    expect(r.loop.overshoots).toBe(1);
  });
});

describe('death class', () => {
  it('freeze: a wall arrives and the player never moves', () => {
    const g = sim();
    g.approach(0, 1);
    expect(g.die().death).toBe('freeze');
  });

  it('late: the player moved after onset but is still in the lane', () => {
    const g = sim();
    g.approach(0, 0.5);
    g.run(10, () => {
      g.s.rotDir = 1;
    });
    expect(g.die().death).toBe('late');
  });

  it('wrong way: the last input went the long way round to a clear lane', () => {
    const g = sim();
    g.s.lanes = [0, 0.5, 0.5, 0.5, 0.5, 0];
    g.approach(0, 0.5); // clear lane is one step at -1, five steps at +1
    g.run(1, () => {
      g.s.rotDir = 1;
    });
    g.run(1, () => {
      g.s.sector = 1;
    });
    g.run(3);
    expect(g.die().death).toBe('wrong way');
  });

  it('overshoot: rotated out of a clear lane into the killing wall', () => {
    const g = sim();
    g.s.lanes[1] = 0.9;
    g.run(5);
    g.run(1, () => {
      g.s.rotDir = 1;
    });
    g.run(1, () => {
      g.s.sector = 1;
    });
    g.run(5);
    expect(g.die().death).toBe('overshoot');
  });

  it('jitter: two reversals in the final window', () => {
    const g = sim();
    g.approach(0, 0.5);
    g.run(2, () => {
      g.s.rotDir = 1;
    });
    g.run(2, () => {
      g.s.rotDir = -1;
    });
    g.run(2, () => {
      g.s.rotDir = 1;
    });
    expect(g.die().death).toBe('jitter');
  });

  it('jitter outranks overshoot', () => {
    const g = sim();
    g.s.lanes[1] = 0.9;
    g.run(2, () => {
      g.s.rotDir = 1;
    });
    g.run(1, () => {
      g.s.rotDir = -1;
    });
    g.run(1, () => {
      g.s.rotDir = 1;
    });
    g.run(1, () => {
      g.s.sector = 1;
    });
    expect(g.die().death).toBe('jitter');
  });
});

describe('lifecycle', () => {
  it('start resets everything from the previous run', () => {
    const g = sim();
    g.approach(0, 0.3);
    g.run(2, () => {
      g.s.rotDir = 1;
    });
    g.die();
    g.obs.start();
    g.s.t = 0;
    g.s.lanes = [0, 0, 0, 0, 0, 0];
    g.s.rotDir = 0;
    g.run(3);
    const r = g.die();
    expect(r.reaction.n).toBe(0);
    expect(r.anticipation.n).toBe(0);
    expect(r.loop).toEqual({ overshoots: 0, reversals: 0 });
    expect(r.time).toBeCloseTo(3 * DT, 6);
  });

  it('frames before start are ignored', () => {
    const obs = createObserver();
    const s: Snapshot = { t: 1, danger: 1, pressure: 1, sector: 0, lanes: [1, 0, 0, 0, 0, 0], rotDir: 1, camSpin: 0, playing: true };
    obs.frame(s, 0.5);
    obs.start();
    expect(obs.die().anticipation.n).toBe(0);
  });
});
