// The layout of the part view: one section's notes laid out as bars, with every drum hit and bass note placed by its position in its bar.
// Pure, so it is tested without a canvas. A position is a fraction of the bar (0 at its first beat, 1 at the next bar's), and lanes are
// rows, so the canvas only has to scale them.

import type { BeatGrid } from "@/song/band/beat-grid";
import type { ChordAtBeat } from "@/song/band/harmony";
import { CLOSED_HAT, CRASH, HIGH_TOM, KICK, LOW_TOM, MID_TOM, OPEN_HAT, PEDAL_HAT, RIDE, SIDE_STICK, SNARE, type NoteEvent } from "@/song/band/note";
import { barSpans, beatSpan } from "@/song/band/timing";

/** The drum lanes, top to bottom. The toms share one lane at three heights. */
export const DRUM_LANES = ["crash", "ride", "open-hat", "hat", "toms", "snare", "kick"] as const;
export type DrumLane = (typeof DRUM_LANES)[number];

/** A drum hit under this velocity is a ghost note, drawn small and hollow. */
export const GHOST_BELOW = 50;
/** Bars on one line of the view. A phrase is four bars, so a phrase end is the last bar of a line. */
export const BARS_PER_LINE = 4;

export interface DrumDot {
  lane: DrumLane;
  /** 0 to 1 across the bar. */
  x: number;
  /** For the toms lane: 0 the highest tom, 2 the lowest. 0 for the other lanes. */
  height: number;
  velocity: number;
  /** A ghost note, a cross-stick or a pedal hat: drawn hollow. */
  hollow: boolean;
  ghost: boolean;
}

export interface BassBlock {
  /** 0 to 1 across the bar. */
  x: number;
  /** The note's length as a share of the bar, cut at the bar's end. */
  width: number;
  pitch: number;
  velocity: number;
  dead: boolean;
  slide: boolean;
  /** A note the performer set by hand. */
  byHand: boolean;
}

export interface BarChord {
  x: number;
  name: string;
}

export interface PartBar {
  /** The bar's place in the song's bars, which a mark is kept against. */
  barIndex: number;
  /** The bar's number counted from the section's start, from 1. */
  number: number;
  /** Song seconds of the bar's start and end. */
  start: number;
  end: number;
  /** The last bar of a four-bar phrase, drawn with a heavier bar line. */
  phraseEnd: boolean;
  chords: BarChord[];
  drums: DrumDot[];
  bass: BassBlock[];
  /** A bar of fill: toms, or a snare roll. */
  fill: boolean;
  /** A crash on the bar's downbeat. */
  crashOnOne: boolean;
  /** What a screen reader hears for the bar. */
  label: string;
}

export interface BassScale {
  low: number;
  high: number;
  /** The notes the section plays, named, lowest first and thinned so two labels are never a semitone apart. */
  labels: { pitch: number; name: string }[];
}

export interface SectionLayout {
  bars: PartBar[];
  /** The bars in lines of BARS_PER_LINE. */
  lines: PartBar[][];
  /** Null when the section has no bass notes. */
  bassScale: BassScale | null;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** The name of a MIDI note with its octave, where 28 is E1 (a bass guitar's low string). */
export function noteName(pitch: number): string {
  return `${NOTE_NAMES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

/** The drum lane of a pitch, or null for a pitch the view has no lane for. */
export function laneOf(pitch: number): { lane: DrumLane; height: number; hollow: boolean } | null {
  switch (pitch) {
    case CRASH:
      return { lane: "crash", height: 0, hollow: false };
    case RIDE:
      return { lane: "ride", height: 0, hollow: false };
    case OPEN_HAT:
      return { lane: "open-hat", height: 0, hollow: false };
    case CLOSED_HAT:
      return { lane: "hat", height: 0, hollow: false };
    case PEDAL_HAT:
      return { lane: "hat", height: 0, hollow: true };
    case HIGH_TOM:
      return { lane: "toms", height: 0, hollow: false };
    case MID_TOM:
      return { lane: "toms", height: 1, hollow: false };
    case LOW_TOM:
      return { lane: "toms", height: 2, hollow: false };
    case SNARE:
      return { lane: "snare", height: 0, hollow: false };
    case SIDE_STICK:
      return { lane: "snare", height: 0, hollow: true };
    case KICK:
      return { lane: "kick", height: 0, hollow: false };
    default:
      return null;
  }
}

/** A bar with this many toms, or this many snare hits, is a fill. */
const FILL_TOMS = 2;
const FILL_SNARES = 5;
/** A note this close to a bar's end belongs to the next bar. */
const EDGE_SECONDS = 0.001;

/** What a screen reader hears for a bar: "Bar 4: kick 3, snare 2, hats 8, fill". */
export function barLabel(number: number, drums: readonly DrumDot[], fill: boolean, extra = ""): string {
  const count = (lanes: readonly DrumLane[]) => drums.filter((dot) => lanes.includes(dot.lane)).length;
  const parts = (
    [
      ["kick", count(["kick"])],
      ["snare", count(["snare"])],
      ["hats", count(["hat", "open-hat"])],
      ["ride", count(["ride"])],
      ["toms", count(["toms"])],
      ["crash", count(["crash"])],
    ] as const
  )
    .filter(([, n]) => n > 0)
    .map(([name, n]) => `${name} ${n}`);
  if (fill) parts.push("fill");
  return `Bar ${number}: ${parts.length > 0 ? parts.join(", ") : "no drums"}${extra}`;
}

/** The end time of a bar that starts at beat `start` and has `beats` beats. The last bar extends the grid's last beat interval. */
function barEndTime(beats: readonly number[], start: number, length: number): number {
  const end = start + length;
  if (end < beats.length) return beats[end];
  const last = beats.length - 1;
  return beats[last] + (end - last) * beatSpan(beats, last);
}

/** The index of the beat a time falls in: the last beat at or before it. */
function beatAt(beats: readonly number[], time: number): number {
  let low = 0;
  let high = beats.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (beats[middle] <= time + EDGE_SECONDS) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** The bass scale of a section's blocks: the range of pitches and a label for each pitch the section plays. */
function scaleOf(blocks: readonly BassBlock[]): BassScale | null {
  if (blocks.length === 0) return null;
  const pitches = [...new Set(blocks.map((block) => block.pitch))].sort((a, b) => a - b);
  const labels: BassScale["labels"] = [];
  for (const pitch of pitches) {
    if (labels.length === 0 || pitch - labels[labels.length - 1].pitch >= 2) labels.push({ pitch, name: noteName(pitch) });
  }
  return { low: pitches[0], high: pitches[pitches.length - 1], labels };
}

/**
 * Lays out the bars of one section. A bar belongs to the section that covers its middle, as the generators place it. `harmony` is the
 * band's harmony per beat, for the chord names and for the notes the performer set by hand.
 */
export function layoutSection(
  notes: { drums: readonly NoteEvent[]; bass: readonly NoteEvent[] },
  grid: BeatGrid,
  section: { start: number; end: number },
  harmony: readonly ChordAtBeat[] = [],
): SectionLayout {
  const beats = grid.beats;
  const bars: PartBar[] = [];
  if (beats.length === 0) return { bars, lines: [], bassScale: null };
  const spans = barSpans(grid);
  const allBlocks: BassBlock[] = [];
  spans.forEach((span, barIndex) => {
    const start = beats[span.start];
    const end = barEndTime(beats, span.start, span.beats);
    const middle = (start + end) / 2;
    if (middle < section.start || middle >= section.end) return;
    const length = end - start;
    const within = (note: NoteEvent) => note.time >= start - EDGE_SECONDS && note.time < end - EDGE_SECONDS;
    const x = (time: number) => Math.min(1, Math.max(0, (time - start) / length));

    const drums: DrumDot[] = [];
    for (const note of notes.drums.filter(within)) {
      const place = laneOf(note.pitch);
      if (!place) continue;
      const ghost = note.velocity < GHOST_BELOW;
      drums.push({ lane: place.lane, x: x(note.time), height: place.height, velocity: note.velocity, hollow: place.hollow || ghost, ghost });
    }
    const bass: BassBlock[] = notes.bass.filter(within).map((note) => ({
      x: x(note.time),
      width: Math.max(0.01, Math.min(note.duration / length, 1 - x(note.time))),
      pitch: note.pitch,
      velocity: note.velocity,
      dead: note.dead === true,
      slide: note.slideFrom !== undefined,
      byHand: harmony[beatAt(beats, note.time)]?.chord?.byHand === true,
    }));
    allBlocks.push(...bass);

    const chords: BarChord[] = [];
    for (let beat = span.start; beat < span.start + span.beats && beat < beats.length; beat++) {
      const name = harmony[beat]?.chord?.name;
      if (name && name !== chords[chords.length - 1]?.name) chords.push({ x: x(beats[beat]), name });
    }

    const number = bars.length + 1;
    const toms = drums.filter((dot) => dot.lane === "toms").length;
    const snares = drums.filter((dot) => dot.lane === "snare").length;
    const fill = toms >= FILL_TOMS || snares >= FILL_SNARES;
    const crashOnOne = drums.some((dot) => dot.lane === "crash" && dot.x < 0.05);
    bars.push({
      barIndex,
      number,
      start,
      end,
      phraseEnd: number % BARS_PER_LINE === 0,
      chords,
      drums,
      bass,
      fill,
      crashOnOne,
      label: barLabel(number, drums, fill),
    });
  });
  const lines: PartBar[][] = [];
  for (let i = 0; i < bars.length; i += BARS_PER_LINE) lines.push(bars.slice(i, i + BARS_PER_LINE));
  return { bars, lines, bassScale: scaleOf(allBlocks) };
}
