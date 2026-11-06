import { doubleTempo, halveTempo, type BeatGrid } from "../band/beat-grid";

/**
 * Where a song's tempo came from. Earlier builds saved 120 for every song that was never given a tempo, so a saved 120 with no source is
 * the old default, not a choice. The analysis treats it as unknown and detects the real tempo.
 */
export type TempoSource = "detected" | "manual" | "tap" | "chart";

const SOURCES: readonly TempoSource[] = ["detected", "manual", "tap", "chart"];

/** The tempo source saved in a song's options. Anything else, including a missing field, is no source. */
export function readTempoSource(options: unknown): TempoSource | null {
  const value = options && typeof options === "object" ? (options as { tempoSource?: unknown }).tempoSource : undefined;
  return SOURCES.find((source) => source === value) ?? null;
}

/** True when no source is recorded and the saved tempo is empty or the legacy default of 120. */
export function needsTempoDetection(savedBpm: string, source: TempoSource | null): boolean {
  if (source) return false;
  return savedBpm === "" || savedBpm === "120";
}

/** The fewest beats a grid needs before its tempo is taken. A shorter grid is too little evidence for a tempo to replace a saved one. */
export const MIN_GRID_BEATS = 8;

/**
 * The tempo of a tracked grid: the straight-line fit when every beat fits one, else the median beat interval. Rounded to 0.1 BPM and kept
 * in the 30 to 300 range the song tempo allows. Null when the grid is too short to trust.
 */
export function tempoFromGrid(grid: BeatGrid): { bpm: number; firstBeat: number; steady: boolean } | null {
  if (grid.beats.length < MIN_GRID_BEATS) return null;
  const raw = grid.steady ? grid.steady.bpm : grid.bpm;
  const bpm = Math.min(300, Math.max(30, Math.round(raw * 10) / 10));
  if (!Number.isFinite(bpm) || bpm <= 0) return null;
  const firstBeat = grid.steady ? grid.steady.firstBeat : (grid.beats[grid.downbeat] ?? grid.beats[0]);
  return { bpm, firstBeat, steady: !!grid.steady };
}

/**
 * The half and double of a tempo, to 0.1 BPM, kept in the song range. A detected 140 offers 70 and 280, so the performer can pick the
 * one that matches the song when the beat tracker counted the wrong beats.
 */
export function tempoOctaves(bpm: number): number[] {
  return [bpm / 2, bpm * 2].map((value) => Math.round(value * 10) / 10).filter((value) => value >= 30 && value <= 300);
}

/**
 * The grid at another tempo from `octave`: the half keeps every other beat and the double adds the midpoints, as the Band panel's tempo
 * buttons do. Used when the performer picks a half or double tempo for a grid already laid out.
 */
export function gridAtOctave(grid: BeatGrid, from: number, to: number): BeatGrid {
  if (to < from) return halveTempo(grid);
  if (to > from) return doubleTempo(grid);
  return grid;
}
