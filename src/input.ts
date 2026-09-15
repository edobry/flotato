// Press-order input: the most recent press still held decides the direction,
// and releasing it hands control back to whatever is still held. Pointers and
// keys share the model, one id each, so two thumbs and A/D behave alike and a
// reversal (press the other side while holding this one) is immediate.

export type Side = -1 | 1;

interface Held {
  id: string;
  side: Side;
}

export interface Input {
  /** Register a press. A repeat for an id already held (key auto-repeat) keeps its place. */
  press(id: string, side: Side): void;
  release(id: string): void;
  /** Drop everything held: focus loss, pointer cancel, page hidden. */
  clear(): void;
  /** -1 left, +1 right, 0 when nothing is held. Cheap enough to call every frame. */
  direction(): -1 | 0 | 1;
}

export function createInput(): Input {
  const held: Held[] = [];
  return {
    press(id, side) {
      for (let i = 0; i < held.length; i++) if (held[i].id === id) return;
      held.push({ id, side });
    },
    release(id) {
      for (let i = 0; i < held.length; i++) {
        if (held[i].id === id) {
          held.splice(i, 1);
          return;
        }
      }
    },
    clear() {
      held.length = 0;
    },
    direction() {
      return held.length ? held[held.length - 1].side : 0;
    },
  };
}
