import { describe, expect, it } from "vitest";
import { DEFAULT_SHAPE, playerShape, shapeFromOptions, storedShape } from "./song-shape";

describe("storedShape", () => {
  it("keeps valid values and falls back for anything else", () => {
    expect(storedShape({ trimStart: 2.5, trimEnd: 120, fadeIn: 1, fadeOut: 3, endBehaviour: "loop" })).toEqual({
      trimStart: 2.5,
      trimEnd: 120,
      fadeIn: 1,
      fadeOut: 3,
      endBehaviour: "loop",
    });
    expect(storedShape({ trimStart: -1, trimEnd: "soon", fadeIn: 40, fadeOut: -2, endBehaviour: "repeat" })).toEqual({
      trimStart: undefined,
      trimEnd: undefined,
      fadeIn: 10,
      fadeOut: 0,
      endBehaviour: "next",
    });
  });
});

describe("shapeFromOptions", () => {
  it("reads the stored JSON and treats broken JSON as the default", () => {
    expect(shapeFromOptions('{"fadeOut":2,"endBehaviour":"stop"}')).toMatchObject({ fadeOut: 2, endBehaviour: "stop" });
    expect(shapeFromOptions("not json")).toBe(DEFAULT_SHAPE);
    expect(shapeFromOptions("")).toEqual(DEFAULT_SHAPE);
  });
});

describe("playerShape", () => {
  it("passes the stored fields on to the player", () => {
    expect(playerShape({ ...DEFAULT_SHAPE, trimEnd: 90 })).toEqual({
      trimStart: undefined,
      trimEnd: 90,
      fadeIn: 0,
      fadeOut: 0,
      endBehaviour: "next",
    });
  });
});
