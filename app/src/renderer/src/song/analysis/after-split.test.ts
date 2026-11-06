import { describe, expect, it } from "vitest";
import { AFTER_SPLIT_STEPS, defaultAfterSplit, parseAfterSplit } from "./after-split";


describe("parseAfterSplit", () => {
  it("is every step on when nothing is saved", () => {
    expect(parseAfterSplit(null, null)).toEqual({ steps: defaultAfterSplit(), language: "auto" });
    expect(Object.values(defaultAfterSplit()).every(Boolean)).toBe(true);
  });

  it("takes the old analysis lyrics option when no choice is saved yet", () => {
    expect(parseAfterSplit(null, false).steps.lyrics).toBe(false);
    expect(parseAfterSplit(null, true).steps.lyrics).toBe(true);
  });

  it("reads a saved choice, and keeps the steps it does not name on", () => {
    const { steps } = parseAfterSplit(JSON.stringify({ lyrics: false, key: false }), true);
    expect(steps.lyrics).toBe(false);
    expect(steps.key).toBe(false);
    expect(steps.tempo).toBe(true);
  });

  it("reads a damaged or unknown choice as the defaults", () => {
    expect(parseAfterSplit("not json", null)).toEqual({ steps: defaultAfterSplit(), language: "auto" });
    expect(parseAfterSplit(JSON.stringify({ lyrics: "no" }), null).steps.lyrics).toBe(true);
  });

  it("lists every step once, with a label", () => {
    const ids = AFTER_SPLIT_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(AFTER_SPLIT_STEPS.every((step) => step.label.length > 0)).toBe(true);
  });

  it("reads the lyrics language, and an unknown one as automatic", () => {
    expect(parseAfterSplit(JSON.stringify({ language: "german" }), null).language).toBe("german");
    expect(parseAfterSplit(JSON.stringify({ language: "klingon" }), null).language).toBe("auto");
  });
});
