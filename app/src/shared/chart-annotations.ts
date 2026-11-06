/*
 * The annotations on a song's PDF chart: pen and highlighter strokes, text notes, and the song times at which the page turns.
 *
 * They are stored as JSON next to the PDF, in page coordinates from 0 to 1 across the page, so they fit any zoom. The PDF itself is never
 * changed. The main process checks a document before it writes it (`validateAnnotations`). The reader does the opposite: a file it cannot
 * read gives back what it can, and never stops the PDF from showing (`readAnnotations`).
 */

export const ANNOTATIONS_VERSION = 1 as const;
export const PAGES_MAX = 2000;
export const MARKS_PER_PAGE_MAX = 2000;
export const POINTS_PER_STROKE_MAX = 5000;
export const TEXT_NOTE_MAX = 500;
export const TURNS_MAX = 500;
/** A turn is a song time in seconds. A song longer than a day is not a song. */
const TIME_MAX = 86400;
/** Stroke widths are a share of the page height. */
export const STROKE_WIDTH = { min: 0.001, max: 0.02 } as const;

export interface Point {
  x: number;
  y: number;
}
export interface StrokeMark {
  kind: "pen" | "highlighter";
  colour: string;
  width: number;
  points: Point[];
}
export interface TextMark {
  kind: "text";
  colour: string;
  x: number;
  y: number;
  text: string;
}
export type Mark = StrokeMark | TextMark;
export interface ChartAnnotations {
  version: typeof ANNOTATIONS_VERSION;
  /** The marks on each page, keyed by the page number as text ("1" is the first page). */
  pages: Record<string, Mark[]>;
  /** Song times, in seconds, at which the next page starts. Sorted, with no repeats. */
  turns: number[];
}

export function emptyAnnotations(): ChartAnnotations {
  return { version: ANNOTATIONS_VERSION, pages: {}, turns: [] };
}

const COLOUR = /^#[0-9a-fA-F]{6}$/;
const PAGE_KEY = /^[1-9]\d{0,3}$/;
const unit = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

function readPoint(value: unknown): Point | null {
  if (!isObject(value) || !unit(value.x) || !unit(value.y)) return null;
  return { x: value.x, y: value.y };
}

/** One mark, or null when it is malformed. Every field is checked, so a mark that is returned can be drawn. */
export function readMark(value: unknown): Mark | null {
  if (!isObject(value) || typeof value.colour !== "string" || !COLOUR.test(value.colour)) return null;
  if (value.kind === "text") {
    if (!unit(value.x) || !unit(value.y) || typeof value.text !== "string") return null;
    if (!value.text.trim() || value.text.length > TEXT_NOTE_MAX) return null;
    return { kind: "text", colour: value.colour, x: value.x, y: value.y, text: value.text };
  }
  if (value.kind !== "pen" && value.kind !== "highlighter") return null;
  if (typeof value.width !== "number" || !(value.width >= STROKE_WIDTH.min && value.width <= STROKE_WIDTH.max)) return null;
  if (!Array.isArray(value.points) || !value.points.length || value.points.length > POINTS_PER_STROKE_MAX) return null;
  const points: Point[] = [];
  for (const raw of value.points) {
    const point = readPoint(raw);
    if (!point) return null;
    points.push(point);
  }
  return { kind: value.kind, colour: value.colour, width: value.width, points };
}

/** The result of reading a document: what could be read, how many marks or turns were left out, and whether the whole file was unreadable. */
export interface ReadAnnotations {
  annotations: ChartAnnotations;
  skipped: number;
  unreadable: boolean;
}

function sanitise(value: unknown): ReadAnnotations {
  if (!isObject(value) || value.version !== ANNOTATIONS_VERSION || !isObject(value.pages) || !Array.isArray(value.turns)) {
    return { annotations: emptyAnnotations(), skipped: 0, unreadable: true };
  }
  let skipped = 0;
  const pages: Record<string, Mark[]> = {};
  const keys = Object.keys(value.pages);
  if (keys.length > PAGES_MAX) skipped += keys.length - PAGES_MAX;
  for (const key of keys.slice(0, PAGES_MAX)) {
    const list = value.pages[key];
    if (!PAGE_KEY.test(key) || !Array.isArray(list)) {
      skipped += 1;
      continue;
    }
    const marks: Mark[] = [];
    for (const raw of list) {
      const mark = readMark(raw);
      if (mark && marks.length < MARKS_PER_PAGE_MAX) marks.push(mark);
      else skipped += 1;
    }
    if (marks.length) pages[key] = marks;
  }
  const turns: number[] = [];
  for (const raw of value.turns) {
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= TIME_MAX && turns.length < TURNS_MAX) turns.push(raw);
    else skipped += 1;
  }
  turns.sort((a, b) => a - b);
  const unique = turns.filter((time, i) => i === 0 || time !== turns[i - 1]);
  skipped += turns.length - unique.length;
  return { annotations: { version: ANNOTATIONS_VERSION, pages, turns: unique }, skipped, unreadable: false };
}

/**
 * Reads an annotation document from its JSON text. It never throws: text that is not JSON, or a document of another version, comes back as
 * an empty document marked `unreadable`, and a malformed mark or turn is left out and counted in `skipped`.
 */
export function readAnnotations(text: string): ReadAnnotations {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { annotations: emptyAnnotations(), skipped: 0, unreadable: true };
  }
  return sanitise(value);
}

/** Checks a document before it is written. Throws when anything in it is malformed, since the app is the only writer. */
export function validateAnnotations(value: unknown): ChartAnnotations {
  const result = sanitise(value);
  if (result.unreadable || result.skipped) throw new Error("Invalid chart annotations.");
  return result.annotations;
}
