import { describe, expect, it } from "vitest";
import { TURN_MIN_GAP_S, addTurn, pageAtTime, removeTurn } from "./page-turns";

describe("pageAtTime", () => {
  it("shows page 1 until the first turn, then one page per turn that has passed", () => {
    const turns = [10, 30, 70];
    expect(pageAtTime(turns, 0)).toBe(1);
    expect(pageAtTime(turns, 9.99)).toBe(1);
    expect(pageAtTime(turns, 10)).toBe(2);
    expect(pageAtTime(turns, 31)).toBe(3);
    expect(pageAtTime(turns, 500)).toBe(4);
  });

  it("stays on page 1 with no turns, and for a position that is not a number", () => {
    expect(pageAtTime([], 120)).toBe(1);
    expect(pageAtTime([10], Number.NaN)).toBe(1);
  });
});

describe("addTurn and removeTurn", () => {
  it("keeps the turns sorted and refuses a turn too close to one already there", () => {
    let turns = addTurn([], 30);
    turns = addTurn(turns, 10);
    turns = addTurn(turns, 10 + TURN_MIN_GAP_S / 2);
    expect(turns).toEqual([10, 30]);
  });

  it("refuses a negative, infinite or missing time", () => {
    expect(addTurn([5], -1)).toEqual([5]);
    expect(addTurn([5], Number.POSITIVE_INFINITY)).toEqual([5]);
  });

  it("removes the turn at an index, and leaves the list alone for an index out of range", () => {
    expect(removeTurn([1, 2, 3], 1)).toEqual([1, 3]);
    expect(removeTurn([1, 2, 3], 9)).toEqual([1, 2, 3]);
  });
});
