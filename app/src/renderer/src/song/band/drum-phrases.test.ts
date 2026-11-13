import { describe, expect, it } from "vitest";
import { barRoles } from "./drum-phrases";
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
