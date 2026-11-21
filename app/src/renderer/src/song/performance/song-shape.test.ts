import { describe, expect, it } from "vitest";
import { DEFAULT_SHAPE, playerShape, playerShapeFromOptions, shapeFromOptions, startSilence, storedShape } from "./song-shape";

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

describe("playerShapeFromOptions", () => {
  const withSilence = (extra: object = {}) => JSON.stringify({ analysis: { silence: { start: 1.5, end: 200 } }, ...extra });

  it("skips the silence the analysis found at the start when the song has no trim start", () => {
    expect(playerShapeFromOptions(withSilence()).trimStart).toBe(1.5);
  });

  it("keeps the song's own trim start, and plays from the very start at 0", () => {
    expect(playerShapeFromOptions(withSilence({ trimStart: 0.4 })).trimStart).toBe(0.4);
    expect(playerShapeFromOptions(withSilence({ trimStart: 0 })).trimStart).toBe(0);
  });

  it("plays from the start when the analysis found no silence there, or nothing was analysed", () => {
    expect(playerShapeFromOptions(JSON.stringify({ analysis: { silence: { start: 0, end: 200 } } })).trimStart).toBeUndefined();
    expect(playerShapeFromOptions("{}").trimStart).toBeUndefined();
    expect(playerShapeFromOptions("not json").trimStart).toBeUndefined();
  });

  it("does not trim the end by default", () => {
    expect(playerShapeFromOptions(withSilence()).trimEnd).toBeUndefined();
  });
});

describe("startSilence", () => {
  it("reads only a finite, positive start", () => {
    expect(startSilence({ analysis: { silence: { start: 2 } } })).toBe(2);
    expect(startSilence({ analysis: { silence: { start: -1 } } })).toBeUndefined();
    expect(startSilence({ analysis: "bad" })).toBeUndefined();
  });
});
