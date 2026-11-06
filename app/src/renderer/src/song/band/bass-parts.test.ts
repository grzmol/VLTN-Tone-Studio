import { describe, expect, it } from "vitest";
import { autoBass, partForBassMode, pedalSteps, pulseSteps, ringSteps } from "./bass-parts";

describe("autoBass", () => {
  it("starts an intro on a pedal for two bars, then rings", () => {
    expect(autoBass("Intro", 2, false, "groove")).toEqual({ part: "ring", lead: { part: "pedal", bars: 2 }, rampLoud: false, octave: 0 });
  });

  it("rings a verse at busy 2 or below, and pulses it from busy 3", () => {
    expect(autoBass("Verse", 2, false, "groove").part).toBe("ring");
    expect(autoBass("Verse", 1, false, "groove").part).toBe("ring");
    expect(autoBass("Verse", 3, false, "groove").part).toBe("pulse");
  });

  it("pulses a pre-chorus and ramps its loud level over its last two bars", () => {
    expect(autoBass("Pre-Chorus", 3, false, "groove")).toEqual({ part: "pulse", rampLoud: true, octave: 0 });
    expect(autoBass("pre chorus", 3, false, "groove").rampLoud).toBe(true);
    expect(autoBass("PreChorus", 3, false, "groove").rampLoud).toBe(true);
  });

  it("grooves a chorus, and plays it melodic from busy 4", () => {
    expect(autoBass("Chorus", 3, false, "pulse").part).toBe("groove");
    expect(autoBass("CHORUS", 4, false, "pulse").part).toBe("melodic");
    expect(autoBass("Chorus", 5, false, "pulse").part).toBe("melodic");
  });

  it("plays a bridge melodic an octave up, or rings it when the chorus is a groove", () => {
    expect(autoBass("Bridge", 3, false, "groove")).toEqual({ part: "melodic", rampLoud: false, octave: 1 });
    expect(autoBass("bridge", 3, true, "groove")).toEqual({ part: "ring", rampLoud: false, octave: 1 });
  });

  it("grooves a solo, and rings an outro", () => {
    expect(autoBass("Solo", 4, false, "ring").part).toBe("groove");
    expect(autoBass("Outro", 2, false, "groove").part).toBe("ring");
  });

  it("falls back to the given part for a name it does not know", () => {
    expect(autoBass("Breakdown", 3, false, "walking")).toEqual({ part: "walking", rampLoud: false, octave: 0 });
  });
});

describe("partForBassMode", () => {
  it("maps the old song-wide bass modes to parts", () => {
    expect(partForBassMode("roots")).toBe("pulse");
    expect(partForBassMode("fifths")).toBe("groove");
    expect(partForBassMode("octaves")).toBe("groove");
    expect(partForBassMode("melodic")).toBe("melodic");
    expect(partForBassMode("walking")).toBe("walking");
  });
});

describe("ringSteps and pulseSteps", () => {
  // Sixteen steps a bar, four a beat, as the rock style lays them out.
  it("rings one note at busy 1 and 2, and two half notes from busy 3", () => {
    expect(ringSteps(2, 16, 0)).toEqual([{ step: 0, role: "root" }]);
    expect(ringSteps(3, 16, 0).map((entry) => entry.step)).toEqual([0, 8]);
  });

  it("adds a passing fifth on every second bar from busy 4", () => {
    expect(ringSteps(4, 16, 0).map((entry) => entry.role)).toEqual(["root", "root"]);
    expect(ringSteps(4, 16, 1)).toEqual([
      { step: 0, role: "root" },
      { step: 8, role: "root" },
      { step: 6, role: "fifth" },
    ]);
  });

  it("pulses quarter notes at busy 1 and 2, and eighth notes from busy 3", () => {
    expect(pulseSteps(2, 16, 4).map((entry) => entry.step)).toEqual([0, 4, 8, 12]);
    expect(pulseSteps(3, 16, 4).map((entry) => entry.step)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
  });

  it("holds the pedal on the downbeat only", () => {
    expect(pedalSteps()).toEqual([{ step: 0, role: "root" }]);
  });
});
