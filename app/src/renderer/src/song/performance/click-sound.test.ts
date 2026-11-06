import { expect, it } from "vitest";
import { clickAccent, clickNote, clickNotes, ownClickSounds, parseClickSound, parseCountInSound, resolveClickSounds, resolveCountInSound } from "./click-sound";

it("reads unknown or missing sounds as the click, and a missing count-in sound as the metronome's", () => {
  expect(parseClickSound(undefined)).toBe("click");
  expect(parseClickSound("cowbell")).toBe("click");
  expect(parseClickSound("sticks")).toBe("sticks");
  expect(parseCountInSound(7)).toBe("same");
  expect(parseCountInSound("ride")).toBe("ride");
});

it("makes the count-in follow the metronome's sound when it is 'same'", () => {
  expect(resolveCountInSound("same", "hihat")).toBe("hihat");
  expect(resolveCountInSound("sticks", "hihat")).toBe("sticks");
});

it("picks drum notes: kick on the downbeat and hat elsewhere for kick-hat, none for the click", () => {
  expect(clickNote("click", true)).toBeNull();
  expect(clickNote("sticks", false)).toBe(37);
  expect(clickNote("hihat", true)).toBe(42);
  expect(clickNote("ride", true)).toBe(51);
  expect(clickNote("kick-hat", true)).toBe(36);
  expect(clickNote("kick-hat", false)).toBe(42);
  expect(clickNotes("kick-hat")).toEqual([36, 42]);
  expect(clickNotes("click")).toEqual([]);
});

it("accents the downbeat fully and the other beats at 0.65, except kick-hat which changes sample", () => {
  expect(clickAccent("sticks", true)).toBe(1);
  expect(clickAccent("sticks", false)).toBe(0.65);
  expect(clickAccent("kick-hat", false)).toBe(1);
});

it("uses a song's own sounds over the defaults, and ignores bad saved values", () => {
  const defaults = { sound: "hihat", countInSound: "same" } as const;
  expect(resolveClickSounds(ownClickSounds({}), defaults)).toEqual(defaults);
  expect(resolveClickSounds(ownClickSounds({ metronomeSound: "ride", countInSound: "sticks" }), defaults)).toEqual({ sound: "ride", countInSound: "sticks" });
  expect(ownClickSounds({ metronomeSound: "nope", countInSound: 3 })).toEqual({ sound: "", countInSound: "" });
});
