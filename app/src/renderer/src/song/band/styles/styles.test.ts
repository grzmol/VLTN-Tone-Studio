import { describe, expect, it } from "vitest";
import { DRUM_PITCHES } from "../note";
import { ENERGIES, STYLE_IDS, type DrumPattern, type Style } from "./types";
import { STYLES, findStyle } from "./index";

const styles = STYLE_IDS.map((id) => STYLES[id]);

/** Every pattern a style holds: grooves at each energy, then the fills. */
function patternsOf(style: Style): { label: string; pattern: DrumPattern }[] {
  const grooves = ENERGIES.flatMap((energy) => style.grooves[energy].map((groove) => ({ label: `${energy} ${groove.name}`, pattern: groove })));
  const fills = [
    ...style.fills.half.map((pattern, i) => ({ label: `half fill ${i}`, pattern })),
    ...style.fills.bar.map((pattern, i) => ({ label: `bar fill ${i}`, pattern })),
  ];
  return [...grooves, ...fills];
}

describe("style data", () => {
  it.each(styles.map((style) => [style.id, style] as const))("%s validates", (_id, style) => {
    const stepsPerBar = style.meter.beatsPerBar * style.meter.stepsPerBeat;
    for (const { label, pattern } of patternsOf(style)) {
      expect(pattern.steps, label).toBe(stepsPerBar);
      for (const hit of pattern.hits) {
        expect(Number.isInteger(hit.step) && hit.step >= 0 && hit.step < pattern.steps, `${label}: step ${hit.step}`).toBe(true);
        expect(DRUM_PITCHES, `${label}: pitch ${hit.pitch}`).toContain(hit.pitch);
        expect(Number.isInteger(hit.velocity) && hit.velocity >= 1 && hit.velocity <= 127, `${label}: velocity ${hit.velocity}`).toBe(true);
        if (hit.ghost) expect(hit.velocity, `${label}: ghost velocity`).toBeGreaterThanOrEqual(30);
        if (hit.ghost) expect(hit.velocity, `${label}: ghost velocity`).toBeLessThanOrEqual(45);
      }
    }
  });

  it.each(styles.map((style) => [style.id, style] as const))("%s has at least two grooves per energy and two fills of each size", (_id, style) => {
    for (const energy of ENERGIES) expect(style.grooves[energy].length, `energy ${energy}`).toBeGreaterThanOrEqual(2);
    expect(style.fills.half.length).toBeGreaterThanOrEqual(2);
    expect(style.fills.bar.length).toBeGreaterThanOrEqual(2);
  });

  it.each(styles.map((style) => [style.id, style] as const))("%s has lean and busy hits at every energy from 2 to 5", (_id, style) => {
    for (const energy of ENERGIES.filter((level) => level >= 2)) {
      const hits = style.grooves[energy].flatMap((groove) => groove.hits);
      expect(
        hits.some((hit) => hit.tier === "lean"),
        `energy ${energy} lean`,
      ).toBe(true);
      expect(
        hits.some((hit) => hit.tier === "busy"),
        `energy ${energy} busy`,
      ).toBe(true);
    }
  });

  it.each(styles.map((style) => [style.id, style] as const))("%s keeps half fills in their second half", (_id, style) => {
    const middle = (style.meter.beatsPerBar * style.meter.stepsPerBeat) / 2;
    for (const [i, fill] of style.fills.half.entries()) {
      expect(fill.hits.length, `half fill ${i} has hits`).toBeGreaterThan(0);
      for (const hit of fill.hits) expect(hit.step, `half fill ${i}`).toBeGreaterThanOrEqual(middle);
    }
  });

  it.each(styles.map((style) => [style.id, style] as const))("%s has bass rhythms for every energy", (_id, style) => {
    const stepsPerBar = style.meter.beatsPerBar * style.meter.stepsPerBeat;
    for (const energy of ENERGIES) {
      const variations = style.bass.rhythms[energy];
      expect(variations.length, `energy ${energy}`).toBeGreaterThan(0);
      for (const steps of variations) {
        for (const step of steps) expect(step >= 0 && step < stepsPerBar && Number.isInteger(step)).toBe(true);
      }
    }
  });

  it.each(styles.map((style) => [style.id, style] as const))("%s plays sparser at energy 1 than at energy 5", (_id, style) => {
    const average = (energy: 1 | 5) => {
      const grooves = style.grooves[energy];
      return grooves.reduce((sum, groove) => sum + groove.hits.length, 0) / grooves.length;
    };
    expect(average(1)).toBeLessThan(average(5));
  });

  it("gives every style a unique id and name", () => {
    expect(new Set(styles.map((style) => style.id)).size).toBe(STYLE_IDS.length);
    expect(new Set(styles.map((style) => style.name)).size).toBe(STYLE_IDS.length);
  });

  it("uses 3 steps per beat for six-eight, on two beats to the bar", () => {
    const sixEight = findStyle("six-eight");
    expect(sixEight?.meter).toEqual({ beatsPerBar: 2, stepsPerBeat: 3 });
  });

  it("uses a triplet grid for shuffle", () => {
    expect(findStyle("shuffle")?.meter.stepsPerBeat).toBe(3);
  });

  it("uses a sixteenth grid for funk", () => {
    expect(findStyle("funk")?.meter.stepsPerBeat).toBe(4);
  });

  it("finds a style by id, and nothing for an unknown id", () => {
    expect(findStyle("rock")?.name).toBe("Rock");
    expect(findStyle("half-time")?.id).toBe("half-time");
    expect(findStyle("polka")).toBeUndefined();
    expect(findStyle("constructor")).toBeUndefined();
  });
});
