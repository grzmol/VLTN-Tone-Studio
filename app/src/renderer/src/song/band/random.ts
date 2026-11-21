// A small seeded random number generator (mulberry32). The generated parts draw every variation, fill and dropped note from one of
// these, so the same seed always gives the same notes. Math.random is never used: a song has to regenerate the same way every time.

export interface Random {
  /** A number in [0, 1). */
  next(): number;
  /** An integer in [0, n). */
  int(n: number): number;
  /** One item from a non-empty array. */
  pick<T>(items: readonly T[]): T;
}

/** Creates a generator from a seed. Seeds are taken modulo 2^32, so any integer works. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (n: number): number => {
    if (!(n > 0)) throw new RangeError(`int needs a positive bound, got ${n}`);
    return Math.floor(next() * n);
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new RangeError("pick needs a non-empty array");
    return items[int(items.length)];
  };

  return { next, int, pick };
}
