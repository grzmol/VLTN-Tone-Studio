import { afterEach, expect, it } from "vitest";
import { readCrossfade, writeCrossfade } from "./crossfade";

afterEach(() => localStorage.clear());

it("remembers the crossfade length, kept between 0 and 10 seconds", () => {
  expect(readCrossfade()).toBe(0);
  writeCrossfade(3.5);
  expect(readCrossfade()).toBe(3.5);
  writeCrossfade(40);
  expect(readCrossfade()).toBe(10);
});

it("reads as no crossfade when the stored value is not a number", () => {
  localStorage.setItem("vltn.performance.crossfade.v1", "soon");
  expect(readCrossfade()).toBe(0);
});
