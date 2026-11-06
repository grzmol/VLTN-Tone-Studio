import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { libraryBatchDeps, stepsFor } from "./library-batch";
import { clearSettingsCache, getSetting, LIBRARY_PREFIX } from "../performance/settings";
import { setSongPlaying } from "../performance/playing-state";
import { useSongLibrary } from "../library";
import { useSong } from "../store";

vi.mock("@/host", () => ({ host: { song: {} } }));
vi.mock("../stems/engine", () => ({ separateStems: vi.fn() }));

beforeEach(() => {
  clearSettingsCache();
  useSongLibrary.setState({ playlistPlaying: false });
});
afterEach(() => {
  setSongPlaying(false);
  clearSettingsCache();
});

it("writes a saved song's tempo and options under that song's key", () => {
  libraryBatchDeps.write("abc", { ":bpm": "98", ":options": '{"tempoSource":"detected"}' });
  expect(getSetting(`${LIBRARY_PREFIX}abc`, ":bpm")).toBe("98");
  expect(getSetting(`${LIBRARY_PREFIX}abc`, ":options")).toBe('{"tempoSource":"detected"}');
});

it("does not write a tempo when the write gives none", () => {
  libraryBatchDeps.write("def", { ":options": "{}" });
  expect(getSetting(`${LIBRARY_PREFIX}def`, ":bpm")).toBe("");
});

it("treats a playing song or a playing playlist as playback, so the batch waits", () => {
  expect(libraryBatchDeps.playing()).toBe(false);
  setSongPlaying(true);
  expect(libraryBatchDeps.playing()).toBe(true);
  setSongPlaying(false);
  useSongLibrary.setState({ playlistPlaying: true });
  expect(libraryBatchDeps.playing()).toBe(true);
});

it("reports a song as open only when it is the one on the Performance screen", () => {
  useSong.setState({ source: { name: "Open.mp3", libraryId: "abc", audio: { sampleRate: 44100, channels: [new Float32Array(1)] } } });
  expect(libraryBatchDeps.isOpen("abc")).toBe(true);
  expect(libraryBatchDeps.isOpen("def")).toBe(false);
  useSong.setState({ source: null });
});

it("runs the steps tempo, chords, key, sections, then the section keys, in that order whatever order they are asked for", () => {
  const names = stepsFor(["sections", "key", "chords", "parts", "tempo", "silence", "loudness"], () => {}, () => null, null).map((step) => step.name);
  expect(names).toEqual(["loudness", "silence", "parts", "tempo", "chords", "key", "sections", "sectionKeys"]);
});
