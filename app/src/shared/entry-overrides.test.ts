import { expect, it } from "vitest";
import { isEntryOverride, normaliseOverride, overridesFor, withOverride } from "./entry-overrides";

it("accepts a known override and refuses anything else", () => {
  expect(isEntryOverride({ autoplay: false, endBehaviour: "loop" })).toBe(true);
  expect(isEntryOverride({})).toBe(true);
  expect(isEntryOverride({ endBehaviour: "repeat" })).toBe(false);
  expect(isEntryOverride({ autoplay: "no" })).toBe(false);
  expect(isEntryOverride({ speed: 1 })).toBe(false);
  expect(isEntryOverride("stop")).toBe(false);
  expect(isEntryOverride(null)).toBe(false);
});

it("stores only what differs from the song, and nothing at all when nothing does", () => {
  expect(normaliseOverride({ autoplay: true })).toBeNull();
  expect(normaliseOverride({ autoplay: false, endBehaviour: "stop" })).toEqual({ autoplay: false, endBehaviour: "stop" });
  expect(normaliseOverride({ endBehaviour: undefined })).toBeNull();
  expect(normaliseOverride(null)).toBeNull();
});

it("lines overrides up with entries, with null for an entry that has none", () => {
  expect(overridesFor(3)).toEqual([null, null, null]);
  expect(overridesFor(3, [{ endBehaviour: "loop" }])).toEqual([{ endBehaviour: "loop" }, null, null]);
});

it("sets one entry's override and leaves the others alone", () => {
  expect(withOverride([null, null, null], 1, { endBehaviour: "stop" })).toEqual([null, { endBehaviour: "stop" }, null]);
  expect(withOverride([{ autoplay: false }, null], 0, null)).toEqual([null, null]);
});
