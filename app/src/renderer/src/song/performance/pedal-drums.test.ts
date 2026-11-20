import { expect, it } from "vitest";
import { pedalDrumMix } from "./pedal-drums";
import { defaultStemMix } from "../stems/mix";
it("mutes original and generated drums without changing the saved mix or other stems", () => {
  const mix = { drums: { ...defaultStemMix(), solo: true }, generated: { ...defaultStemMix(), volume: 0.7 }, bass: defaultStemMix() };
  const tracks = { keys: Object.keys(mix), split: true, info: { generated: { kind: "user" as const, name: "Drums (generated)" } } };
  const muted = pedalDrumMix(mix, tracks, true);
  expect(muted.drums.mute).toBe(true);
  expect(muted.drums.solo).toBe(false);
  expect(muted.generated.mute).toBe(true);
  expect(muted.bass).toBe(mix.bass);
  expect(mix.drums.mute).toBe(false);
  expect(mix.generated.volume).toBe(0.7);
  expect(pedalDrumMix(mix, tracks, false)).toBe(mix);
});
it("does not mute an unsplit full recording as a substitute for a drum stem", () => {
  const mix = { source: defaultStemMix() };
  expect(pedalDrumMix(mix, { keys: ["source"], split: false, info: {} }, true)).toBe(mix);
});

import { beforeEach, vi } from "vitest";
import { migratePedalDrums, PEDAL_DRUMS_KEY, withPedalDrums } from "./pedal-drums";

const updateSettings = vi.fn(async () => undefined);
vi.mock("@/host", () => ({ host: { song: { library: { updateSettings: (...args: unknown[]) => (updateSettings as (...a: unknown[]) => unknown)(...args) } } } }));

const withCues = (extra: Record<string, unknown> = {}) => ({ ":options": JSON.stringify({ rhythmAutomation: { followSong: true }, ...extra }) });

beforeEach(() => {
  localStorage.clear();
  updateSettings.mockClear();
});

it("moves the global switch into songs that have cues and no drums choice", () => {
  const options = JSON.parse(withPedalDrums(withCues({ partChoice: { bass: "generated" } }))!);
  expect(options.partChoice).toEqual({ bass: "generated", drums: "pedal" });
  expect(withPedalDrums(withCues({ partChoice: { drums: "generated" } }))).toBeNull();
  expect(withPedalDrums({ ":options": JSON.stringify({ partChoice: {} }) })).toBeNull();
  expect(withPedalDrums({ ":options": "not json" })).toBeNull();
});

it("migrates once when the switch was on, then removes the key", async () => {
  localStorage.setItem(PEDAL_DRUMS_KEY, "on");
  const withSong = { id: "a", settings: withCues() };
  const plain = { id: "b", settings: { ":options": "{}" } };
  await migratePedalDrums([withSong, plain]);
  expect(updateSettings).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(PEDAL_DRUMS_KEY)).toBeNull();
  await migratePedalDrums([withSong, plain]);
  expect(updateSettings).toHaveBeenCalledTimes(1);
});

it("changes no song when the switch was off, and still removes the key", async () => {
  localStorage.setItem(PEDAL_DRUMS_KEY, "off");
  await migratePedalDrums([{ id: "a", settings: withCues() }]);
  expect(updateSettings).not.toHaveBeenCalled();
  expect(localStorage.getItem(PEDAL_DRUMS_KEY)).toBeNull();
});
