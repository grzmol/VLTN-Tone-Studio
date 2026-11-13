import { describe, expect, it } from "vitest";
import { FILL_CHOICES, fillChoiceOf, fillOfChoice, styleChoices } from "./band-labels";

describe("styleChoices", () => {
  it("lists the styles written for the song's meter first and marks the others", () => {
    const threeBeats = styleChoices(3);
    expect(threeBeats[0]).toEqual({ id: "three-four", label: "3/4" });
    expect(threeBeats.find((choice) => choice.id === "rock")?.label).toBe("Rock (4/4)");
    expect(threeBeats.find((choice) => choice.id === "six-eight")?.label).toBe("6/8 (6/8)");
  });

  it("lists the four-beat styles first for a 4/4 song, and everything unmarked when the meter is unknown", () => {
    expect(styleChoices(4)[0].id).toBe("rock");
    expect(styleChoices(4).find((choice) => choice.id === "three-four")?.label).toBe("3/4 (3/4)");
    expect(styleChoices().every((choice) => !choice.label.includes("("))).toBe(true);
  });
});

describe("the Fill menu", () => {
  it("reads a section's fill as a choice, and the old on and off too", () => {
    expect(([true, false, 0, 1, 2, 3] as const).map((fill) => fillChoiceOf(fill))).toEqual(["auto", "none", "none", "short", "half", "whole"]);
  });

  it("saves Auto as true and every other choice as its size, and reads its own saves back", () => {
    expect(FILL_CHOICES.map((choice) => fillOfChoice(choice))).toEqual([true, 0, 1, 2, 3]);
    for (const choice of FILL_CHOICES) expect(fillChoiceOf(fillOfChoice(choice))).toBe(choice);
  });
});
