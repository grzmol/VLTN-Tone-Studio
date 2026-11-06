import { describe, expect, it } from "vitest";
import { MARKS_PER_PAGE_MAX, POINTS_PER_STROKE_MAX, emptyAnnotations, readAnnotations, readMark, validateAnnotations, type ChartAnnotations } from "./chart-annotations";

const pen = { kind: "pen" as const, colour: "#111111", width: 0.0025, points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }] };
const note = { kind: "text" as const, colour: "#38bdf8", x: 0.5, y: 0.5, text: "Bridge" };
const document: ChartAnnotations = { version: 1, pages: { "1": [pen, note], "3": [{ ...pen, kind: "highlighter", width: 0.012 }] }, turns: [4, 20.5] };

describe("readAnnotations", () => {
  it("reads a well-formed document back as it was written", () => {
    expect(readAnnotations(JSON.stringify(document))).toEqual({ annotations: document, skipped: 0, unreadable: false });
  });

  it("never throws on text that is not JSON, and gives an empty, unreadable document", () => {
    for (const text of ["", "{", "null", "[]", "42", "\u0000\u0001"]) {
      const read = readAnnotations(text);
      expect(read.unreadable).toBe(true);
      expect(read.annotations).toEqual(emptyAnnotations());
    }
  });

  it("refuses a document of another version", () => {
    expect(readAnnotations(JSON.stringify({ version: 2, pages: {}, turns: [] })).unreadable).toBe(true);
    expect(readAnnotations(JSON.stringify({ pages: {}, turns: [] })).unreadable).toBe(true);
  });

  it("keeps the good marks and turns of a partly damaged file, and counts what it left out", () => {
    const damaged = {
      version: 1,
      pages: {
        "1": [pen, { kind: "pen", colour: "red", width: 0.002, points: [{ x: 0.1, y: 0.1 }] }, note, null, 7],
        "2": "not a list",
        "0": [pen],
        "x": [pen],
      },
      turns: [9, "10", -1, 9, 3, Number.NaN],
    };
    const read = readAnnotations(JSON.stringify(damaged));
    expect(read.unreadable).toBe(false);
    expect(read.annotations.pages).toEqual({ "1": [pen, note] });
    expect(read.annotations.turns).toEqual([3, 9]);
    // Page 1: a bad colour, a null and a number. Pages "2" (not a list), "0" and "x" (bad keys). Turns: "10", -1 and NaN, plus a repeated 9.
    expect(read.skipped).toBe(3 + 3 + 4);
  });

  it("drops a point or a width that is out of range, so a drawn mark is always valid", () => {
    expect(readMark({ ...pen, points: [{ x: 1.2, y: 0.1 }] })).toBeNull();
    expect(readMark({ ...pen, width: 0 })).toBeNull();
    expect(readMark({ ...pen, width: 0.5 })).toBeNull();
    expect(readMark({ ...pen, points: [] })).toBeNull();
    expect(readMark({ ...note, text: "   " })).toBeNull();
    expect(readMark({ ...note, text: "x".repeat(501) })).toBeNull();
    expect(readMark({ ...note, kind: "eraser" })).toBeNull();
  });

  it("caps the number of marks on a page and the points in a stroke", () => {
    const many = Array.from({ length: MARKS_PER_PAGE_MAX + 5 }, () => note);
    expect(readAnnotations(JSON.stringify({ version: 1, pages: { "1": many }, turns: [] })).annotations.pages["1"]).toHaveLength(MARKS_PER_PAGE_MAX);
    const long = { ...pen, points: Array.from({ length: POINTS_PER_STROKE_MAX + 1 }, () => ({ x: 0.1, y: 0.1 })) };
    expect(readMark(long)).toBeNull();
  });
});

describe("validateAnnotations", () => {
  it("accepts a document the reader can read, and refuses a malformed one", () => {
    expect(validateAnnotations(document)).toEqual(document);
    expect(() => validateAnnotations({ ...document, pages: { "1": [{ ...pen, colour: "blue" }] } })).toThrow("Invalid chart annotations");
    expect(() => validateAnnotations("text")).toThrow();
    expect(() => validateAnnotations({ version: 1, pages: {}, turns: [Number.POSITIVE_INFINITY] })).toThrow();
  });
});
