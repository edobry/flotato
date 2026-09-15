import { describe, expect, it } from 'vitest';
import { createInput } from './input';

describe('press-order input', () => {
  it('last press wins and release hands back to what is still held', () => {
    const inp = createInput();
    inp.press('p1', -1);
    expect(inp.direction()).toBe(-1);
    inp.press('p2', 1);
    expect(inp.direction()).toBe(1);
    inp.release('p2');
    expect(inp.direction()).toBe(-1);
    inp.release('p1');
    expect(inp.direction()).toBe(0);
  });

  it('releasing the older press keeps the newer one', () => {
    const inp = createInput();
    inp.press('p1', -1);
    inp.press('p2', 1);
    inp.release('p1');
    expect(inp.direction()).toBe(1);
  });

  it('two pointers on one side survive one lifting', () => {
    const inp = createInput();
    inp.press('p1', 1);
    inp.press('p2', 1);
    inp.release('p1');
    expect(inp.direction()).toBe(1);
    inp.release('p2');
    expect(inp.direction()).toBe(0);
  });

  it('keys behave like pointers, and auto-repeat does not reorder', () => {
    const inp = createInput();
    inp.press('kKeyA', -1);
    inp.press('kKeyD', 1);
    inp.press('kKeyA', -1); // held-key repeat
    expect(inp.direction()).toBe(1);
    inp.release('kKeyD');
    expect(inp.direction()).toBe(-1);
  });

  it('releasing an unknown id and clearing are safe', () => {
    const inp = createInput();
    inp.release('nope');
    expect(inp.direction()).toBe(0);
    inp.press('p1', -1);
    inp.clear();
    expect(inp.direction()).toBe(0);
  });
});
