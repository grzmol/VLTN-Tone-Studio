import { expect, it } from "vitest";
import type { LibrarySong } from "@shared/song-library";
import { runningSeconds } from "./running-time";

const song = (duration: number, options?: Record<string, unknown>): LibrarySong => ({
  id: "11111111-1111-1111-1111-111111111111",
  title: "Song",
  artist: "",
  sourceName: "",
  duration,
  audio: [],
  settings: options ? { ":options": JSON.stringify(options) } : {},
  updated: "",
});

it("is the full length of a song with no trim and no speed change", () => {
  expect(runningSeconds(song(200))).toBe(200);
});

it("is the trimmed length, not the file length", () => {
  expect(runningSeconds(song(200, { trimStart: 10, trimEnd: 110 }))).toBe(100);
  expect(runningSeconds(song(200, { trimStart: 30 }))).toBe(170);
  expect(runningSeconds(song(200, { trimEnd: 60 }))).toBe(60);
});

it("divides the trimmed length by the saved speed", () => {
  expect(runningSeconds(song(200, { trimStart: 10, trimEnd: 110, speed: 0.5 }))).toBe(200);
  expect(runningSeconds(song(200, { speed: 1.25 }))).toBe(160);
});

it("counts a trim that runs past the end as nothing, and never a negative time", () => {
  expect(runningSeconds(song(200, { trimStart: 150, trimEnd: 100 }))).toBe(0);
});

it("reads a song whose options are broken as its full length", () => {
  expect(runningSeconds({ ...song(90), settings: { ":options": "{not json" } })).toBe(90);
});
