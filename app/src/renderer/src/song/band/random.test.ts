import { describe, expect, it } from "vitest";
import { createRandom } from "./random";

function draw(seed: number, count: number): number[] {
  const random = createRandom(seed);
  return Array.from({ length: count }, () => random.next());
}

describe("createRandom", () => {
  it("gives the same sequence for the same seed", () => {
    expect(draw(42, 100)).toEqual(draw(42, 100));
  });

  it("gives a different sequence for a different seed", () => {
    expect(draw(42, 20)).not.toEqual(draw(43, 20));
  });

  it("returns numbers in [0, 1)", () => {
    for (const value of draw(7, 10000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("keeps int inside [0, n)", () => {
    const random = createRandom(9);
    for (let i = 0; i < 2000; i++) {
      const value = random.int(5);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(5);
    }
  });

  it("reaches every value of int", () => {
    const random = createRandom(3);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(random.int(4));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("picks items deterministically from an array", () => {
    const items = ["a", "b", "c", "d"];
    const first = createRandom(11);
    const second = createRandom(11);
    const picks = Array.from({ length: 50 }, () => first.pick(items));
    expect(picks).toEqual(Array.from({ length: 50 }, () => second.pick(items)));
    expect(new Set(picks).size).toBeGreaterThan(1);
  });

  it("refuses an empty pick or a non-positive bound", () => {
    const random = createRandom(1);
    expect(() => random.pick([])).toThrow(RangeError);
    expect(() => random.int(0)).toThrow(RangeError);
  });
});
