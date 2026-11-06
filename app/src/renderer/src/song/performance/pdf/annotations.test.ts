import { describe, expect, it } from "vitest";
import { MARKS_PER_PAGE_MAX, emptyAnnotations, readAnnotations, validateAnnotations, type ChartAnnotations, type Mark } from "@shared/chart-annotations";
import { HIGHLIGHTER_WIDTH, PEN_WIDTH, addMark, clampPoint, clearPage, marksOn, strokeMark, textMark, undoMark } from "./annotations";

const note = (text: string): Mark => ({ kind: "text", colour: "#111111", x: 0.2, y: 0.2, text });

describe("annotation edits", () => {
  it("adds marks to a page and keeps the other pages", () => {
    let doc: ChartAnnotations = addMark(emptyAnnotations(), 1, note("one"));
    doc = addMark(doc, 2, note("two"));
    doc = addMark(doc, 1, note("three"));
    expect(marksOn(doc, 1).map((m) => (m.kind === "text" ? m.text : ""))).toEqual(["one", "three"]);
    expect(marksOn(doc, 2)).toHaveLength(1);
    expect(marksOn(doc, 7)).toEqual([]);
  });

  it("undoes the last mark on a page, and clears a page without touching the others", () => {
    let doc = addMark(addMark(emptyAnnotations(), 1, note("a")), 1, note("b"));
    doc = addMark(doc, 2, note("c"));
    doc = undoMark(doc, 1);
    expect(marksOn(doc, 1)).toHaveLength(1);
    doc = clearPage(doc, 1);
    expect(doc.pages["1"]).toBeUndefined();
    expect(marksOn(doc, 2)).toHaveLength(1);
  });

  it("returns the same document when there is nothing to undo or clear", () => {
    const doc = emptyAnnotations();
    expect(undoMark(doc, 1)).toBe(doc);
    expect(clearPage(doc, 1)).toBe(doc);
  });

  it("refuses a mark on a full page, so the file stays within its limit", () => {
    let doc = emptyAnnotations();
    for (let i = 0; i < MARKS_PER_PAGE_MAX; i++) doc = addMark(doc, 1, note("x"));
    expect(addMark(doc, 1, note("one more"))).toBe(doc);
  });

  it("makes stroke and text marks the file accepts", () => {
    const pen = strokeMark("pen", "#111111", [clampPoint(0.1, 0.1), clampPoint(0.6, 2)]);
    expect(pen).toMatchObject({ kind: "pen", width: PEN_WIDTH, points: [{ x: 0.1, y: 0.1 }, { x: 0.6, y: 1 }] });
    expect(strokeMark("highlighter", "#facc15", [clampPoint(0, 0)])).toMatchObject({ width: HIGHLIGHTER_WIDTH });
    expect(strokeMark("pen", "#111111", [])).toBeNull();
    expect(textMark("#38bdf8", 0.3, 0.4, "   ")).toBeNull();
    expect(textMark("#38bdf8", 0.3, 0.4, "  Bridge  ")).toEqual({ kind: "text", colour: "#38bdf8", x: 0.3, y: 0.4, text: "Bridge" });
  });

  it("round-trips an edited document through the file format", () => {
    let doc = addMark(emptyAnnotations(), 1, strokeMark("pen", "#111111", [clampPoint(0.1, 0.1), clampPoint(0.2, 0.3)]) as Mark);
    doc = addMark(doc, 1, textMark("#f87171", 0.5, 0.5, "Stop") as Mark);
    doc = { ...doc, turns: [12] };
    expect(validateAnnotations(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    expect(readAnnotations(JSON.stringify(doc)).skipped).toBe(0);
  });
});
