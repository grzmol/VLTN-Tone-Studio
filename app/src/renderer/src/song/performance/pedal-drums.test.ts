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
