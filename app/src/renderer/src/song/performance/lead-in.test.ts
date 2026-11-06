import { beforeEach, expect, it } from "vitest";
import { clampLeadIn, ownLeadIn, readLeadInDefaults, resolveLeadIn, saveLeadInDefaults, songCountIn } from "./lead-in";

beforeEach(() => localStorage.clear());

it("uses a song's own value and falls back to the global default when the song has none", () => {
  const defaults = { countInBars: 1, preRollBeats: 4, startDelay: 2 };
  expect(resolveLeadIn({ countInBars: "", preRollBeats: 0, startDelay: "" }, defaults)).toEqual({ countInBars: 1, preRollBeats: 0, startDelay: 2 });
});

it("keeps an empty own value empty and clamps a stored number to its range", () => {
  expect(ownLeadIn("countInBars", "")).toBe("");
  expect(ownLeadIn("countInBars", undefined)).toBe("");
  expect(ownLeadIn("countInBars", 7)).toBe(2);
  expect(ownLeadIn("startDelay", 12)).toBe(10);
  expect(clampLeadIn("preRollBeats", -3, 0)).toBe(0);
  expect(clampLeadIn("preRollBeats", "x", 5)).toBe(5);
});

it("saves the global defaults and reads them back, ignoring corrupt or out-of-range values", () => {
  expect(readLeadInDefaults()).toEqual({ countInBars: 0, preRollBeats: 0, startDelay: 0 });
  saveLeadInDefaults({ countInBars: 2, preRollBeats: 8, startDelay: 3 });
  expect(readLeadInDefaults()).toEqual({ countInBars: 2, preRollBeats: 8, startDelay: 3 });
  localStorage.setItem("vltn.performance.leadin.v1:options", JSON.stringify({ countInBars: 9, startDelay: "soon" }));
  expect(readLeadInDefaults()).toEqual({ countInBars: 2, preRollBeats: 0, startDelay: 0 });
  localStorage.setItem("vltn.performance.leadin.v1:options", "{not json");
  expect(readLeadInDefaults()).toEqual({ countInBars: 0, preRollBeats: 0, startDelay: 0 });
});

it("reads a playlist song's own tempo, beats and count-in, and falls back to the defaults it lacks", () => {
  const defaults = { countInBars: 2, preRollBeats: 0, startDelay: 0 };
  const own = { ":bpm": "96", ":options": JSON.stringify({ beats: 3, countInBars: 1 }) };
  expect(songCountIn(own, defaults)).toEqual({ bpm: 96, countInBars: 1, beatsPerBar: 3 });
  expect(songCountIn({ ":bpm": "96", ":options": JSON.stringify({ countInBars: "" }) }, defaults)).toEqual({ bpm: 96, countInBars: 2, beatsPerBar: 4 });
  expect(songCountIn({}, defaults)).toEqual({ bpm: 120, countInBars: 2, beatsPerBar: 4 });
});

it("ignores a song's BPM outside 30–300 and options that are not valid JSON", () => {
  const defaults = { countInBars: 0, preRollBeats: 0, startDelay: 0 };
  expect(songCountIn({ ":bpm": "400" }, defaults).bpm).toBe(120);
  expect(songCountIn({ ":bpm": "0" }, defaults).bpm).toBe(120);
  expect(songCountIn({ ":bpm": "abc", ":options": "{not json" }, defaults)).toEqual({ bpm: 120, countInBars: 0, beatsPerBar: 4 });
  expect(songCountIn({ ":options": "null" }, defaults)).toEqual({ bpm: 120, countInBars: 0, beatsPerBar: 4 });
});
