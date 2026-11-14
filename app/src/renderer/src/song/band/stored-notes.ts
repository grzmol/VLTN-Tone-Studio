// The notes of the last Generate, kept in the song's options so the Band dialog can draw them again when the song is reopened. A note is
// stored as a tuple to keep a five-minute song near 60 KB of JSON. Reads are defensive: anything malformed gives no notes.

import type { NoteEvent } from "./note";

/** [time in ms, pitch, velocity, duration in ms, flags]. Flags: bit 0 is a dead note, bit 1 is a slide. */
export type StoredNote = [number, number, number, number, number];

export const FLAG_DEAD = 1;
export const FLAG_SLIDE = 2;
/** The most notes of one part that are kept, so a damaged entry cannot grow without limit. */
export const MAX_STORED_NOTES = 20000;

/** The notes of one Generate, with the rules and seed they were made with. */
export interface BandNotes {
  engine: number;
  seed: number;
  drums: StoredNote[];
  bass: StoredNote[];
}

/** A slide's distance is not kept: the part view only draws that a note slides. */
const SLIDE_SEMITONES = 1;

/** The stored form of notes, rounded to the millisecond. */
export function toStoredNotes(notes: readonly NoteEvent[]): StoredNote[] {
  return notes.map((note) => [
    Math.round(note.time * 1000),
    note.pitch,
    Math.round(note.velocity),
    Math.round(note.duration * 1000),
    (note.dead ? FLAG_DEAD : 0) | (note.slideFrom !== undefined ? FLAG_SLIDE : 0),
  ]);
}

/** The notes of stored tuples, in song seconds. */
export function fromStoredNotes(stored: readonly StoredNote[]): NoteEvent[] {
  return stored.map(([time, pitch, velocity, duration, flags]) => {
    const note: NoteEvent = { time: time / 1000, pitch, velocity, duration: duration / 1000 };
    if (flags & FLAG_SLIDE) note.slideFrom = SLIDE_SEMITONES;
    if (flags & FLAG_DEAD) note.dead = true;
    return note;
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function isStoredNote(value: unknown): value is StoredNote {
  return (
    Array.isArray(value) &&
    value.length === 5 &&
    value.every(isNumber) &&
    value[0] >= 0 &&
    Number.isInteger(value[1]) &&
    value[1] >= 0 &&
    value[1] <= 127 &&
    value[2] >= 1 &&
    value[2] <= 127 &&
    value[3] >= 0 &&
    Number.isInteger(value[4]) &&
    value[4] >= 0 &&
    value[4] <= FLAG_DEAD + FLAG_SLIDE
  );
}

function parseList(value: unknown): StoredNote[] | null {
  if (!Array.isArray(value) || value.length > MAX_STORED_NOTES) return null;
  return value.every(isStoredNote) ? value : null;
}

/** Reads saved notes. A missing, damaged or oversized entry gives none. */
export function parseBandNotes(value: unknown): BandNotes | null {
  if (!isRecord(value) || !isNumber(value.engine) || !isNumber(value.seed)) return null;
  const drums = parseList(value.drums);
  const bass = parseList(value.bass);
  if (!drums || !bass) return null;
  return { engine: value.engine, seed: value.seed, drums, bass };
}

/** The entry to save for a Generate's notes. */
export function bandNotesOf(notes: { drums: readonly NoteEvent[]; bass: readonly NoteEvent[] }, engine: number, seed: number): BandNotes {
  return { engine, seed, drums: toStoredNotes(notes.drums), bass: toStoredNotes(notes.bass) };
}

/**
 * The entry after a Generate. A part that was generated has its new notes; a part that was not (Back to generated renders one part alone)
 * keeps what was saved for it, and a part turned off has none.
 */
export function updatedBandNotes(
  previous: BandNotes | null,
  made: { drums: readonly NoteEvent[]; bass: readonly NoteEvent[] },
  generated: { drums: boolean; bass: boolean },
  parts: { drums: boolean; bass: boolean },
  engine: number,
  seed: number,
): BandNotes {
  const part = (kind: "drums" | "bass"): StoredNote[] => (generated[kind] ? toStoredNotes(made[kind]) : parts[kind] ? (previous?.[kind] ?? []) : []);
  return { engine, seed, drums: part("drums"), bass: part("bass") };
}
