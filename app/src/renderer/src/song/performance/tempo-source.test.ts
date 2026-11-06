import { describe, expect, it } from "vitest";
import { readTempoSource } from "./tempo-source";

describe("readTempoSource", () => {
  it("reads a recorded source", () => {
    expect(readTempoSource({ tempoSource: "manual" })).toBe("manual");
    expect(readTempoSource({ tempoSource: "chart" })).toBe("chart");
  });

  it("treats anything else as no source", () => {
    expect(readTempoSource({})).toBeNull();
    expect(readTempoSource({ tempoSource: "guess" })).toBeNull();
    expect(readTempoSource({ tempoSource: 120 })).toBeNull();
    expect(readTempoSource(null)).toBeNull();
    expect(readTempoSource("manual")).toBeNull();
  });
});
