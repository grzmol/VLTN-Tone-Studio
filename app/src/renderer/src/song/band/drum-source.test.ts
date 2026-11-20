import { describe, expect, it } from "vitest";
import { fallbackReason, isFallback, resolveDrums, withResolvedDrums } from "./drum-source";

describe("resolveDrums", () => {
  it("plays the pedal only with cues and armed", () => {
    expect(resolveDrums({ choice: "pedal", fallback: "generated", hasRhythmCues: true, armed: true })).toEqual({ plays: "pedal", reason: "pedal-ready" });
  });
  it("falls back when the cues are not armed", () => {
    expect(resolveDrums({ choice: "pedal", fallback: "generated", hasRhythmCues: true, armed: false })).toEqual({ plays: "generated", reason: "not-armed" });
  });
  it("falls back when the song has no RC-10R cues, armed or not", () => {
    for (const armed of [true, false]) {
      expect(resolveDrums({ choice: "pedal", fallback: "original", hasRhythmCues: false, armed })).toEqual({ plays: "original", reason: "no-cues" });
    }
  });
  it("leaves every other choice alone whatever the pedal does", () => {
    for (const choice of ["original", "generated", "both"] as const)
      for (const hasRhythmCues of [true, false])
        for (const armed of [true, false]) expect(resolveDrums({ choice, fallback: "generated", hasRhythmCues, armed })).toEqual({ plays: choice, reason: "chosen" });
  });
});

describe("fallback helpers", () => {
  it("knows a fallback from a plain choice", () => {
    const source = resolveDrums({ choice: "pedal", fallback: "generated", hasRhythmCues: true, armed: false });
    expect(isFallback("pedal", source)).toBe(true);
    expect(isFallback("generated", { plays: "generated", reason: "chosen" })).toBe(false);
  });
  it("replaces the drums in the choices", () => {
    expect(withResolvedDrums({ drums: "pedal", bass: "original" }, { plays: "generated", reason: "not-armed" })).toEqual({ drums: "generated", bass: "original" });
  });
  it("says why", () => {
    expect(fallbackReason({ plays: "generated", reason: "not-armed" }, false)).toBe("output disconnected");
    expect(fallbackReason({ plays: "generated", reason: "not-armed" }, true)).toBe("Send cues off");
    expect(fallbackReason({ plays: "pedal", reason: "pedal-ready" }, true)).toBe("");
  });
});

import { drumsChip, settledArmed } from "./drum-source";

describe("settledArmed", () => {
  it("follows the armed state while stopped and holds it while playing", () => {
    expect(settledArmed(true, false, false)).toBe(false);
    expect(settledArmed(true, false, true)).toBe(true);
    expect(settledArmed(false, true, true)).toBe(false);
  });
});

describe("drumsChip", () => {
  it("says RC-10R when the pedal plays", () => {
    expect(drumsChip("pedal", { plays: "pedal", reason: "pedal-ready" }, "")).toMatchObject({ text: "Drums: RC-10R", tone: "ok" });
  });
  it("warns with the reason on a fallback", () => {
    const chip = drumsChip("pedal", { plays: "generated", reason: "not-armed" }, "Send cues off");
    expect(chip).toMatchObject({ text: "Drums: Generated (fallback)", tone: "warn" });
    expect(chip.title).toContain("Send cues off");
    expect(drumsChip("pedal", { plays: "original", reason: "no-cues" }, "x").text).toBe("Drums: Original (fallback)");
  });
  it("is neutral for the other choices", () => {
    for (const [choice, text] of [["original", "Original"], ["generated", "Generated"], ["both", "Both"]] as const)
      expect(drumsChip(choice, { plays: choice, reason: "chosen" }, "")).toMatchObject({ text: `Drums: ${text}`, tone: "neutral" });
  });
});

import { cuesForDrums } from "./drum-source";
import type { Cue } from "../performance/chart";

describe("cuesForDrums", () => {
  const chart: Cue = { time: 1, text: "{midi:pc 1 5}", messages: [[192, 5]] };
  const load: Cue = { time: 0, text: "rhythm load", messages: [[240, 1, 247]], managed: "rhythm", trigger: "load" };
  const rhythm: Cue = { time: 2, text: "rhythm start", messages: [[250]], managed: "rhythm" };
  const cues = [chart, load, rhythm];

  it("sends every cue unchanged, as the same array, while the pedal plays", () => {
    expect(cuesForDrums(cues, "pedal", { plays: "pedal", reason: "pedal-ready" })).toBe(cues);
  });
  it("sends no rhythm cue, load cue included, on a fallback", () => {
    expect(cuesForDrums(cues, "pedal", { plays: "generated", reason: "not-armed" })).toEqual([chart]);
  });
  it("leaves a song that never chose pedal exactly as it is", () => {
    expect(cuesForDrums(cues, "generated", { plays: "generated", reason: "chosen" })).toBe(cues);
  });
});
