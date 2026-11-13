import { describe, expect, it } from "vitest";
import { barRoles, FILL_RANGE, overlay, shapeFill } from "./drum-phrases";
import { CLOSED_HAT, KICK, OPEN_HAT, SNARE } from "./note";
import type { DrumHit } from "./styles/types";
import { isPhraseEnd, phraseBars } from "./bass-phrases";

const endsOf = (bars: number, key: "phraseEnd" | "pairEnd" | "sectionEnd") =>
  barRoles(bars)
    .filter((role) => role[key])
    .map((role) => role.bar);

describe("barRoles", () => {
  it("plays phrases of two bars in a section of two bars", () => {
    expect(endsOf(2, "phraseEnd")).toEqual([1]);
    expect(endsOf(2, "sectionEnd")).toEqual([1]);
    expect(endsOf(2, "pairEnd")).toEqual([]);
  });

  it("closes a section of three bars after two, and again at its end", () => {
    expect(endsOf(3, "phraseEnd")).toEqual([1, 2]);
    expect(endsOf(3, "sectionEnd")).toEqual([2]);
    expect(barRoles(3).map((role) => role.phrase)).toEqual([0, 0, 1]);
  });

  it("takes phrases of four bars in a section of four", () => {
    expect(endsOf(4, "phraseEnd")).toEqual([3]);
    expect(endsOf(4, "pairEnd")).toEqual([]);
  });

  it("ends a short last phrase at the section's end", () => {
    expect(endsOf(7, "phraseEnd")).toEqual([3, 6]);
    expect(endsOf(7, "sectionEnd")).toEqual([6]);
    expect(endsOf(7, "pairEnd")).toEqual([]);
  });

  it("marks bars 4 and 8 of a section of eight", () => {
    expect(endsOf(8, "phraseEnd")).toEqual([3, 7]);
    expect(endsOf(8, "pairEnd")).toEqual([7]);
    expect(barRoles(8).map((role) => role.inPhrase)).toEqual([0, 1, 2, 3, 0, 1, 2, 3]);
  });

  it("marks the end of every second phrase in a section of sixteen", () => {
    expect(endsOf(16, "phraseEnd")).toEqual([3, 7, 11, 15]);
    expect(endsOf(16, "pairEnd")).toEqual([7, 15]);
    const roles = barRoles(16);
    expect(roles.filter((role) => role.sectionStart).map((role) => role.bar)).toEqual([0]);
    expect(roles[15].phrase).toBe(3);
  });

  it("agrees with the bass about where a phrase ends", () => {
    for (const bars of [1, 2, 3, 4, 5, 7, 8, 12, 16]) {
      expect(barRoles(bars).map((role) => role.phraseEnd)).toEqual(Array.from({ length: bars }, (_, bar) => isPhraseEnd(bar, bars)));
      for (const role of barRoles(bars)) expect(role.inPhrase).toBeLessThan(phraseBars(bars));
    }
  });
});

describe("overlay", () => {
  const groove: DrumHit[] = [
    { step: 0, pitch: KICK, velocity: 90 },
    { step: 12, pitch: SNARE, velocity: 90 },
    { step: 12, pitch: CLOSED_HAT, velocity: 86 },
    { step: 14, pitch: CLOSED_HAT, velocity: 86 },
  ];

  it("keeps the groove before the patch's first step", () => {
    const result = overlay(groove, [{ step: 14, pitch: OPEN_HAT, velocity: 86 }], 12);
    expect(result.filter((hit) => hit.step < 12)).toEqual([groove[0]]);
  });

  it("lets a hat on a step take the place of the hat there, and keeps the rest of the beat", () => {
    const result = overlay(groove, [{ step: 14, pitch: OPEN_HAT, velocity: 86 }], 12);
    expect(result).toContainEqual(groove[1]);
    expect(result).toContainEqual(groove[2]);
    expect(result).not.toContainEqual(groove[3]);
    expect(result).toContainEqual({ step: 14, pitch: OPEN_HAT, velocity: 86 });
  });

  it("drops a groove voice the patch plays again", () => {
    const result = overlay(groove, [{ step: 12, pitch: SNARE, velocity: 100 }], 12);
    expect(result.filter((hit) => hit.pitch === SNARE)).toEqual([{ step: 12, pitch: SNARE, velocity: 100 }]);
  });
});

describe("shapeFill", () => {
  const flat = (steps: number[]): DrumHit[] => steps.map((step) => ({ step, pitch: SNARE, velocity: 90 }));

  it("makes a flat fill rise, ending on at least the accent", () => {
    const shaped = shapeFill(flat([12, 13, 14, 15]), 108);
    const velocities = shaped.map((hit) => hit.velocity);
    expect(velocities).toEqual([...velocities].sort((a, b) => a - b));
    expect(Math.max(...velocities) - Math.min(...velocities)).toBeGreaterThanOrEqual(FILL_RANGE);
    expect(velocities[3]).toBeGreaterThanOrEqual(108);
  });

  it("leaves a short fill and a fill that already rises as written", () => {
    expect(shapeFill(flat([14, 15]), 108)).toEqual(flat([14, 15]));
    const rising = flat([12, 13, 14, 15]).map((hit, i) => ({ ...hit, velocity: 60 + i * 15 }));
    expect(shapeFill(rising, 108)).toEqual(rising);
  });

  it("does not scale ghost notes", () => {
    const hits: DrumHit[] = [...flat([12, 13, 14, 15]), { step: 13, pitch: SNARE, velocity: 38, ghost: true }];
    expect(shapeFill(hits, 108)[4].velocity).toBe(38);
  });
});
