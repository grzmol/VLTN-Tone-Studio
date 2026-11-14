// Assemble reusable drum passages on musical bars. The source follows the recording; the exported pattern has one steady tempo.
import { rhythmTempo } from "../performance/rhythm-tempo";
import type { SectionPlan } from "./arrangement";
import type { BeatGrid } from "./beat-grid";
import { DRUM_PITCHES, type NoteEvent } from "./note";
import { barSpans, beatSpan } from "./timing";
import type { Section } from "../performance/sections";
import { encodeDrumSmf, EXPORT_PPQ, type SmfTickNote } from "../performance/smf";
import { encodeRhythmBank, rhythmBankName, RHYTHM_BANK_MAX_NOTES, type RhythmBankPattern } from "./rhythm-bank";

export const RHYTHM_ROLES = ["intro", "pattern1", "fill1", "pattern2", "fill2", "ending"] as const;
export type RhythmRole = (typeof RHYTHM_ROLES)[number];
export const RHYTHM_LABELS: Record<RhythmRole, string> = {
  intro: "Intro",
  pattern1: "Pattern 1",
  fill1: "Fill 1",
  pattern2: "Pattern 2",
  fill2: "Fill 2",
  ending: "Ending",
};
export const RHYTHM_METERS = {
  "2/4": { numerator: 2, denominator: 4, pulses: 2, quarters: 1 },
  "3/4": { numerator: 3, denominator: 4, pulses: 3, quarters: 1 },
  "4/4": { numerator: 4, denominator: 4, pulses: 4, quarters: 1 },
  "6/8": { numerator: 6, denominator: 8, pulses: 2, quarters: 1.5 },
} as const;
export type RhythmMeter = keyof typeof RHYTHM_METERS;
/** An application limit for manageable files and previews; device limits must be checked in the converter. */
export const MAX_RHYTHM_BARS = 32;
export const WHOLE_RHYTHM_SOURCE = "song";

export interface RhythmSnapshot {
  name: string;
  duration: number;
  grid: BeatGrid;
  notes: readonly NoteEvent[];
  sections: readonly Section[];
  plans: readonly SectionPlan[];
}
export interface RhythmSelection {
  /** A section id or WHOLE_RHYTHM_SOURCE. Null means the role still needs a choice. */
  source: string | null;
  /** One-based bar within the source passage, not within the exported MIDI. */
  firstBar: number;
  bars: number;
}
export interface RhythmSetup {
  version: 1;
  /** Grid tempo when the choices were saved. A later song-tempo change updates export tempo automatically. */
  sourceBpm?: number;
  meter: RhythmMeter;
  /** Grid pulse BPM; dotted quarters for 6/8, quarter notes otherwise. */
  bpm: number;
  parts: Record<RhythmRole, RhythmSelection>;
}
export interface RhythmBar {
  startBeat: number;
  beats: number;
  start: number;
  end: number;
}
export interface RhythmSource {
  id: string;
  name: string;
  bars: RhythmBar[];
}
export interface RhythmPart {
  role: RhythmRole;
  source: string;
  firstBar: number;
  startBar: number;
  bars: number;
  notes: SmfTickNote[];
  endTick: number;
  warnings: string[];
}

/** Complete bars only. Pickup audio and a final partial bar never become extra MIDI bars. */
export function rhythmSources(snapshot: RhythmSnapshot): RhythmSource[] {
  const { grid } = snapshot;
  const bars = barSpans(grid)
    .map((span): RhythmBar => {
      const start = grid.beats[span.start];
      const endBeat = span.start + span.beats;
      const end = grid.beats[endBeat] ?? grid.beats.at(-1)! + (endBeat - grid.beats.length + 1) * beatSpan(grid.beats, grid.beats.length - 1);
      return { startBeat: span.start, beats: span.beats, start, end };
    })
    .filter((bar) => Number.isFinite(bar.end) && bar.end <= snapshot.duration + 0.001);
  return [
    { id: WHOLE_RHYTHM_SOURCE, name: "Whole song", bars },
    ...snapshot.sections.map((section) => ({
      id: section.id,
      name: section.name,
      bars: bars.filter((bar) => bar.start >= section.start - 0.001 && bar.end <= section.end + 0.001),
    })),
  ];
}

/** Suggestions use labelled sections; a missing role remains unassigned for the performer to choose. */
export function suggestRhythmSetup(snapshot: RhythmSnapshot): RhythmSetup {
  const sources = rhythmSources(snapshot);
  const find = (name: RegExp) => sources.find((source) => source.id !== WHOLE_RHYTHM_SOURCE && name.test(source.name) && source.bars.length);
  const verse = find(/verse/i);
  const chorus = find(/^(?:final\s+)?chorus\b/i);
  const pick = (source: RhythmSource | undefined, pattern = false, fill = false): RhythmSelection => {
    if (!source) return { source: null, firstBar: 1, bars: 1 };
    const firstBar = fill ? source.bars.length : pattern && source.bars.length > 2 ? 2 : 1;
    const available = source.bars.length - firstBar + 1 - (pattern && source.bars.length > 2 ? 1 : 0);
    return { source: source.id, firstBar, bars: pattern ? Math.min(4, Math.max(1, available)) : 1 };
  };
  const fillOf = (source: RhythmSource | undefined) =>
    source && snapshot.plans.some((plan) => plan.sectionId === source.id && plan.fill) ? source : undefined;
  const meter: RhythmMeter = snapshot.grid.beatsPerBar === 3 ? "3/4" : snapshot.grid.beatsPerBar === 2 ? "2/4" : "4/4";
  return {
    version: 1,
    sourceBpm: snapshot.grid.bpm,
    meter,
    bpm: Math.min(350, Math.max(40, Math.round(snapshot.grid.bpm || 120))),
    parts: {
      intro: pick(find(/intro/i)),
      pattern1: pick(verse, true),
      fill1: pick(fillOf(verse), false, true),
      pattern2: pick(chorus, true),
      fill2: pick(fillOf(chorus), false, true),
      ending: pick(find(/outro|ending/i)),
    },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const positiveInteger = (value: unknown, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= max;

/** A malformed saved setup is ignored; deleted section references remain visible as unassigned. */
export function parseRhythmSetup(value: unknown, snapshot: RhythmSnapshot): RhythmSetup {
  const fallback = suggestRhythmSetup(snapshot);
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.parts)) return fallback;
  const sources = rhythmSources(snapshot);
  const parts = { ...fallback.parts };
  for (const role of RHYTHM_ROLES) {
    const part = value.parts[role];
    if (
      !isRecord(part) ||
      !(part.source === null || typeof part.source === "string") ||
      !positiveInteger(part.firstBar, 100_000) ||
      !positiveInteger(part.bars, MAX_RHYTHM_BARS)
    )
      continue;
    const source = sources.find((source) => source.id === part.source);
    parts[role] = { source: source?.id ?? null, firstBar: part.firstBar, bars: part.bars };
  }
  return {
    version: 1,
    sourceBpm: snapshot.grid.bpm,
    meter: typeof value.meter === "string" && Object.hasOwn(RHYTHM_METERS, value.meter) ? (value.meter as RhythmMeter) : fallback.meter,
    bpm:
      typeof value.sourceBpm === "number" && Math.abs(value.sourceBpm - snapshot.grid.bpm) > 0.0001
        ? fallback.bpm
        : typeof value.bpm === "number" && Number.isFinite(value.bpm) && value.bpm >= 40 && value.bpm <= 350
          ? value.bpm
          : fallback.bpm,
    parts,
  };
}

/** Fractional source pulse at a song time, including the last pulse's extrapolated interval. */
function pulseAt(grid: BeatGrid, seconds: number): number {
  let low = 0,
    high = grid.beats.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (grid.beats[mid] <= seconds) low = mid;
    else high = mid - 1;
  }
  return low + (seconds - grid.beats[low]) / beatSpan(grid.beats, low);
}

/** Assemble one part independently, so its preview and exported notes share the same timing. */
export function assembleRhythmPart(snapshot: RhythmSnapshot, setup: RhythmSetup, role: RhythmRole): RhythmPart {
  const label = RHYTHM_LABELS[role];
  const meter = RHYTHM_METERS[setup.meter];
  if (!meter || !Number.isFinite(setup.bpm) || setup.bpm < 40 || setup.bpm > 350 || setup.bpm * meter.quarters > 350)
    throw new Error("Choose a tempo from 40–350 BPM. In 6/8 the dotted-quarter tempo must be at most 233.33 BPM.");
  const { grid } = snapshot;
  if (grid.beats.length < 2 || grid.beats.some((beat, i) => !Number.isFinite(beat) || (i > 0 && beat <= grid.beats[i - 1])))
    throw new Error("Find the beat and generate drums again before exporting.");
  if (grid.beatsPerBar !== meter.pulses)
    throw new Error(`${setup.meter} needs ${meter.pulses} grid beats per bar. Choose the matching meter or correct the beat grid and generate again.`);
  const selection = setup.parts[role];
  if ((role === "fill1" || role === "fill2") && selection.bars !== 1) throw new Error(`${label}: the converter requires a one-bar fill.`);
  const source = rhythmSources(snapshot).find((source) => source.id === selection.source);
  if (!source) throw new Error(`Choose a source passage for ${label}.`);
  if (!positiveInteger(selection.firstBar, source.bars.length) || !positiveInteger(selection.bars, MAX_RHYTHM_BARS))
    throw new Error(`${label}: choose a first bar and 1–${MAX_RHYTHM_BARS} bars.`);
  const selected = source.bars.slice(selection.firstBar - 1, selection.firstBar - 1 + selection.bars);
  if (selected.length !== selection.bars) throw new Error(`${label}: the selected passage goes past the source's complete bars.`);
  if (selected.some((bar) => bar.beats !== meter.pulses)) throw new Error(`${label}: this passage has an irregular bar. Choose bars with the same meter.`);
  const start = selected[0],
    end = selected.at(-1)!;
  const ticksPerPulse = EXPORT_PPQ * meter.quarters;
  const endTick = selection.bars * meter.pulses * ticksPerPulse;
  let clipped = 0;
  const notes: SmfTickNote[] = [];
  for (const note of snapshot.notes) {
    if (!Number.isFinite(note.time)) throw new Error("A generated drum hit has an invalid time. Generate the drums again.");
    if (note.time < start.start || note.time >= end.end) continue;
    if (!DRUM_PITCHES.includes(note.pitch)) throw new Error(`${label}: drum note ${note.pitch} is not supported by this export.`);
    if (!Number.isInteger(note.velocity) || note.velocity < 1 || note.velocity > 127 || !Number.isFinite(note.duration) || note.duration <= 0)
      throw new Error("A generated drum hit is invalid. Generate the drums again.");
    const rawTick = Math.round((pulseAt(grid, note.time) - start.startBeat) * ticksPerPulse);
    const tick = Math.max(0, Math.min(endTick - 1, rawTick));
    const rawOff = Math.round((pulseAt(grid, note.time + note.duration) - start.startBeat) * ticksPerPulse);
    const off = Math.max(tick + 1, Math.min(endTick, rawOff));
    if (rawTick !== tick || rawOff > endTick) clipped++;
    notes.push({ tick, duration: off - tick, pitch: note.pitch, velocity: note.velocity });
  }
  if (!notes.length) throw new Error(`${label}: this passage has no generated drum hits. Choose another passage.`);
  notes.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
  // A repeated pitch must release before its next hit. Simultaneous duplicate hits are merged at their stronger velocity.
  const merged: SmfTickNote[] = [];
  const previous = new Map<number, SmfTickNote>();
  for (const note of notes) {
    const last = previous.get(note.pitch);
    if (last?.tick === note.tick) {
      last.velocity = Math.max(last.velocity, note.velocity);
      continue;
    }
    if (last) last.duration = Math.min(last.duration, note.tick - last.tick);
    merged.push(note);
    previous.set(note.pitch, note);
  }
  const warnings = clipped ? [`${label}: ${clipped} hit(s) shortened or adjusted at the passage boundary.`] : [];
  const early = snapshot.notes.filter((note) => note.time >= start.start - 0.04 && note.time < start.start).length;
  if (early) warnings.push(`${label}: ${early} hit(s) just before the first bar are excluded. Preview the start of this passage.`);
  return { role, source: source.name, firstBar: selection.firstBar, startBar: 1, bars: selection.bars, notes: merged, endTick, warnings };
}

/** The complete export and human-readable assignment table are built together. */
export function assembleRhythm(snapshot: RhythmSnapshot, setup: RhythmSetup) {
  let endTick = 0,
    startBar = 1;
  const notes: SmfTickNote[] = [];
  const parts = RHYTHM_ROLES.map((role) => {
    const part = { ...assembleRhythmPart(snapshot, setup, role), startBar };
    notes.push(...part.notes.map((note) => ({ ...note, tick: note.tick + endTick })));
    endTick += part.endTick;
    startBar += part.bars;
    return part;
  });
  if (notes.length > RHYTHM_BANK_MAX_NOTES) throw new Error("The converter accepts at most 9999 drum hits per rhythm. Choose shorter passages.");
  return { parts, notes, endTick, quarterBpm: rhythmTempo(setup.bpm, setup.meter === "6/8").quarterBpm, warnings: parts.flatMap((part) => part.warnings) };
}

/** The native pattern carries the same notes and section assignments as the MIDI export. */
export function rhythmBankPattern(snapshot: RhythmSnapshot, setup: RhythmSetup): RhythmBankPattern {
  const result = assembleRhythm(snapshot, setup);
  const meter = RHYTHM_METERS[setup.meter];
  return {
    name: snapshot.name.replace(/\.[^.]+$/, ""),
    bpm: result.quarterBpm,
    numerator: meter.numerator,
    denominator: meter.denominator,
    totalBars: result.parts.reduce((sum, part) => sum + part.bars, 0),
    endTick: result.endTick,
    parts: result.parts,
    notes: result.notes,
  };
}

/** Preview the exact musical positions at the export tempo with the local clean drum kit. */
export function rhythmPreview(part: RhythmPart, setup: RhythmSetup): { notes: NoteEvent[]; duration: number } {
  const secondsPerTick = 60 / (rhythmTempo(setup.bpm, setup.meter === "6/8").quarterBpm * EXPORT_PPQ);
  return {
    duration: part.endTick * secondsPerTick,
    notes: part.notes.map((note) => ({
      time: note.tick * secondsPerTick,
      duration: note.duration * secondsPerTick,
      pitch: note.pitch,
      velocity: note.velocity,
    })),
  };
}

export function rhythmExportFiles(snapshot: RhythmSnapshot, setup: RhythmSetup): { name: string; bytes: Uint8Array }[] {
  const result = assembleRhythm(snapshot, setup);
  const meter = RHYTHM_METERS[setup.meter];
  const title =
    snapshot.name
      .replace(/\.[^.]+$/, "")
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
      .trim()
      .slice(0, 100) || "Song";
  const base = `${title} - RC10R`;
  const guide = [
    `${title} — BOSS RC-10R drum rhythm`,
    "",
    `File: ${base}.mid`,
    `Ready-to-import rhythm: ${base}.RC0`,
    `Native name: ${rhythmBankName(title)}; native tempo: ${Math.round(result.quarterBpm)} quarter-note BPM; Studio kit.`,
    `Tempo: ${setup.bpm} ${setup.meter === "6/8" ? "dotted-quarter" : "quarter-note"} BPM`,
    `Meter: ${setup.meter}; MIDI tempo: ${result.quarterBpm} quarter-note BPM`,
    "SMF Format 0; one drum track; channel 10; 480 ticks per quarter note.",
    "",
    "Part\tStart bar\tBars\tSource passage\tFirst source bar",
    ...result.parts.map((part) => `${RHYTHM_LABELS[part.role]}\t${part.startBar}\t${part.bars}\t${part.source.replace(/[\t\r\n]/g, " ")}\t${part.firstBar}`),
    "",
    "Bar numbers start at 1. Passages are packed consecutively, without a count-in or pickup audio.",
    "",
    "1. In RC-10R Rhythm Converter choose File > Import and select the .RC0 file. All six part assignments are included.",
    "Import replaces the converter's working list. Export a backup first to keep existing rhythms. Device transfer is a separate Apply action.",
    "2. Check the imported name, tempo, kit and six ranges. The native file uses 96 ticks per quarter note and integer BPM.",
    "3. Choose an available user rhythm location (1–50) and transfer using Apply in the converter.",
    "4. Select the User rhythm on the pedal, assign it to the desired phrase memory and save that memory.",
    "5. Listen to each part, both repeating patterns, the fills and the ending. Reload the memory to check it was saved.",
    "",
    "The pedal plays its own drum kit. VLTN samples and tone effects are not included. Notes 45 and 47 may play the same low tom.",
    "This is a set of reusable parts, not automatic playback of the song's full arrangement.",
    "MIDI alternative: File > Open MIDI File opens the .mid file, but then assign the six ranges manually using the table above.",
    ...(setup.meter === "6/8" ? ["6/8 uses two dotted-quarter pulses per bar. Verify this meter in your converter before transferring."] : []),
    ...result.warnings.map((warning) => `Note: ${warning}`),
    "",
  ].join("\n");
  return [
    { name: `${base}.mid`, bytes: encodeDrumSmf(result.notes, result.quarterBpm, meter.numerator, meter.denominator, result.endTick) },
    { name: `${base} Import.txt`, bytes: new TextEncoder().encode(guide) },
    { name: `${base}.RC0`, bytes: encodeRhythmBank([rhythmBankPattern(snapshot, setup)]) },
  ];
}
