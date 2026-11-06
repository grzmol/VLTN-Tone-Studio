import { MARKS_PER_PAGE_MAX, TEXT_NOTE_MAX, type ChartAnnotations, type Mark, type Point } from "@shared/chart-annotations";

/*
 * Edits to a PDF chart's annotations (pure). Each edit returns a new document, so the reader can keep the last saved one and compare. A page
 * that is full, or a number out of range, leaves the document as it was. Drawing and saving are the reader's job.
 */

export type AnnotationTool = "pen" | "highlighter" | "text" | "none";

/** The colours a performer picks from. Each is a `#rrggbb` value the file accepts. */
export const ANNOTATION_COLOURS = ["#111111", "#facc15", "#38bdf8", "#f87171", "#4ade80"] as const;
/** Pen and highlighter widths, as a share of the page height. The highlighter is wider and sits under the text. */
export const PEN_WIDTH = 0.0025;
export const HIGHLIGHTER_WIDTH = 0.012;

/** The marks on a page, in the order they were drawn. */
export function marksOn(annotations: ChartAnnotations, page: number): Mark[] {
  return annotations.pages[String(page)] ?? [];
}

/** Adds a mark to a page. A full page keeps its marks. */
export function addMark(annotations: ChartAnnotations, page: number, mark: Mark): ChartAnnotations {
  const marks = marksOn(annotations, page);
  if (marks.length >= MARKS_PER_PAGE_MAX) return annotations;
  return { ...annotations, pages: { ...annotations.pages, [String(page)]: [...marks, mark] } };
}

/** Removes the last mark on a page, the one most recently drawn. */
export function undoMark(annotations: ChartAnnotations, page: number): ChartAnnotations {
  const marks = marksOn(annotations, page);
  if (!marks.length) return annotations;
  return withPage(annotations, page, marks.slice(0, -1));
}

/** Removes every mark on a page. The other pages are kept. */
export function clearPage(annotations: ChartAnnotations, page: number): ChartAnnotations {
  if (!marksOn(annotations, page).length) return annotations;
  return withPage(annotations, page, []);
}

function withPage(annotations: ChartAnnotations, page: number, marks: Mark[]): ChartAnnotations {
  const pages = { ...annotations.pages };
  if (marks.length) pages[String(page)] = marks;
  else delete pages[String(page)];
  return { ...annotations, pages };
}

/** A point clamped into the page, so a stroke that runs off the edge still has valid coordinates. */
export function clampPoint(x: number, y: number): Point {
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

/** The mark a tool makes from its points. The text tool is handled by the reader's note box, so it has no stroke. */
export function strokeMark(tool: "pen" | "highlighter", colour: string, points: Point[]): Mark | null {
  if (!points.length) return null;
  return { kind: tool, colour, width: tool === "pen" ? PEN_WIDTH : HIGHLIGHTER_WIDTH, points };
}

/** A text note at a point, or null when the text is blank. The text is trimmed and capped by the file format. */
export function textMark(colour: string, x: number, y: number, text: string): Mark | null {
  const trimmed = text.trim().slice(0, TEXT_NOTE_MAX);
  if (!trimmed) return null;
  const at = clampPoint(x, y);
  return { kind: "text", colour, x: at.x, y: at.y, text: trimmed };
}

