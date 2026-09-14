// A subset of Tidal mini-notation, parsed into patterns of strings.
//
//   a b c        sequence, equal subdivision of the cycle
//   [a b]        subsequence (nested subdivision)
//   <a b c>      alternation: one per cycle
//   ~            rest
//   a*2  a/2     speed up / slow down a step
//   a?           drop the step half the time (deterministic per onset)
//   a!           repeat the step once more
//   a, b         stack (inside brackets or at the top level)

import { type Pattern, cat, degradeBy, fast, pure, seq, silence, slow, stack } from './pattern';

const WORD = /[A-Za-z0-9_#.-]/;
const DIGIT = /[0-9.]/;

class Parser {
  private readonly src: string;
  private i = 0;

  constructor(src: string) {
    this.src = src;
  }

  parseStack(): Pattern<string> {
    const parts = [this.parseSequence()];
    while (this.peek() === ',') {
      this.i++;
      parts.push(this.parseSequence());
    }
    return parts.length === 1 ? parts[0] : stack(...parts);
  }

  expectEnd(): void {
    this.ws();
    if (!this.atEnd()) this.fail(`unexpected '${this.peek()}'`);
  }

  private parseSequence(): Pattern<string> {
    const steps: Pattern<string>[] = [];
    this.ws();
    while (!this.atEnd() && !']>,'.includes(this.peek())) {
      const { pat, repeat } = this.parseTerm();
      for (let k = 0; k < repeat; k++) steps.push(pat);
      this.ws();
    }
    return seq(...steps);
  }

  private parseTerm(): { pat: Pattern<string>; repeat: number } {
    let pat = this.parseAtom();
    let repeat = 1;
    for (;;) {
      const c = this.peek();
      if (c === '*') {
        this.i++;
        pat = fast(this.parseNumber(), pat);
      } else if (c === '/') {
        this.i++;
        pat = slow(this.parseNumber(), pat);
      } else if (c === '?') {
        this.i++;
        pat = degradeBy(0.5, pat, this.i);
      } else if (c === '!') {
        this.i++;
        repeat++;
      } else {
        break;
      }
    }
    return { pat, repeat };
  }

  private parseAtom(): Pattern<string> {
    const c = this.peek();
    if (c === '[') {
      this.i++;
      const p = this.parseStack();
      this.expect(']');
      return p;
    }
    if (c === '<') {
      this.i++;
      const items: Pattern<string>[] = [];
      this.ws();
      while (!this.atEnd() && this.peek() !== '>') {
        const { pat, repeat } = this.parseTerm();
        for (let k = 0; k < repeat; k++) items.push(pat);
        this.ws();
      }
      this.expect('>');
      return cat(...items);
    }
    if (c === '~') {
      this.i++;
      return silence();
    }
    return pure(this.parseWord());
  }

  private parseWord(): string {
    const start = this.i;
    while (!this.atEnd() && WORD.test(this.peek())) this.i++;
    if (start === this.i) this.fail(`unexpected '${this.peek()}'`);
    return this.src.slice(start, this.i);
  }

  private parseNumber(): number {
    const start = this.i;
    while (!this.atEnd() && DIGIT.test(this.peek())) this.i++;
    const n = Number(this.src.slice(start, this.i));
    if (!(n > 0)) this.fail('expected a positive number');
    return n;
  }

  private expect(ch: string): void {
    this.ws();
    if (this.peek() !== ch) this.fail(`expected '${ch}'`);
    this.i++;
  }

  private ws(): void {
    while (!this.atEnd() && /\s/.test(this.peek())) this.i++;
  }

  private peek(): string {
    return this.src[this.i] ?? '';
  }

  private atEnd(): boolean {
    return this.i >= this.src.length;
  }

  private fail(msg: string): never {
    throw new Error(`mini: ${msg} at ${this.i} in "${this.src}"`);
  }
}

export function mini<C = unknown>(src: string): Pattern<string, C> {
  const parser = new Parser(src);
  const pat = parser.parseStack();
  parser.expectEnd();
  return pat;
}
