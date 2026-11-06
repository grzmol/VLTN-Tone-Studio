// Works out what Tone Studio can about a song once its audio is known: tempo now, and meter, key, chords, loudness, missing parts and
// silence as later steps are added. Each step is a small job that returns what it found. This file runs them in order, keeps the results,
// and stops when playback starts. It imports no React or screen code, so the same run can later work through saved songs headless (spec 72).

import type { MissingParts } from "../band/detect";
import type { SilenceEnds } from "./silence";
import type { Chord } from "../performance/chords";
import type { KeyEstimate, KeySection } from "../performance/key";
import type { DetectedSection } from "./sections";
import type { BassLine, BassLineBeat } from "./bass-line";
import type { PcmAudio, Stems } from "../types";

/** The song's integrated loudness and sample peak, as the loudness control measures them. */
export interface LoudnessResult {
  lufs: number;
  peakDb: number;
}

/** A meter estimate at or above this confidence is applied to the song. Below it, the meter is only suggested. */
export const METER_CERTAIN = 0.6;

/**
 * Bump when an analysis improves, so songs analysed earlier are analysed again the next time they open. Version 2 adds sections: a saved
 * song of version 1 is analysed once more, which fills in its sections. Version 3 reads the chords from the harmony and the bass with
 * harmonic templates, decoded over the song, on the beats (spec 81). Version 4 reads the bass note of each beat from the bass stem (spec 86).
 * Version 5 reads it by harmonic summation on the stem's tuning, and stores the tuning with it.
 * What the performer set is kept (see `planWriteBack`).
 */
export const ANALYSIS_VERSION = 5;

/** The tempo the analysis found. `firstBeat` is the time of the first beat, in seconds, when the grid fits a straight line. */
export interface TempoResult {
  bpm: number;
  firstBeat: number;
  steady: boolean;
}

/** The meter the beats fall into. `confidence` is how clearly the chosen meter stands out, from 0 to 1. */
export interface MeterResult {
  beatsPerBar: 3 | 4;
  confidence: number;
}

/** The key the song was estimated to be in, and the stem it was estimated from. */
export interface KeyResult {
  source: string;
  estimate: KeyEstimate;
}

/** The chords read from one stem. The stem is recorded, so a different chord source is analysed again. */
export interface ChordsResult {
  source: string;
  chords: Chord[];
}

/** What the analysis saved for one song. It is keyed on the audio it was run on, so a re-split runs it again. */
export interface SongAnalysis {
  /** A fingerprint of the audio analysed (see `audioFingerprint`). */
  audioId: string;
  version: number;
  tempo?: TempoResult;
  meter?: MeterResult;
  loudness?: LoudnessResult;
  /** Whether the song has drums and bass, and where they are absent. Only set when the song was split or has stems. */
  parts?: MissingParts;
  /** The silence before the first sound and after the last. Offered as a trim; never applied. */
  silence?: SilenceEnds;
  key?: KeyResult;
  /** Sections whose key differs from the song's, with a strong reading. Only set when the song has sections and a key. */
  keySections?: KeySection[];
  chords?: ChordsResult;
  /** The bass note the bass stem plays on each beat of the grid, when the song has a bass stem and a grid (spec 86). */
  bassLine?: BassLine;
  /** Suggested sections, on bar lines where the music allows (or on time frames when the song has no beat grid). Empty when none were found. */
  sections?: DetectedSection[];
  /** Names of the steps that failed. A failed step is not retried until the song is analysed again. */
  failed?: string[];
}

/** A named piece of audio a step reads, such as the stem the chords come from. */
export interface NamedAudio {
  name: string;
  audio: PcmAudio;
}

/** The audio a run analyses: the sources and the timing context the steps need. */
export interface AnalysisAudio {
  /** The song's mix, measured for loudness. */
  mix: PcmAudio;
  /** The split stems, or null for a song that was not split. */
  stems: Stems | null;
  sources: readonly PcmAudio[];
  sampleRate: number;
  beatsPerBar: number;
  /** Chord change times, in seconds of the same audio. Empty when the song has no chords yet. */
  chordChanges: number[];
  /** The song's own sections as bounds in seconds, or none. Their ends are where a chord counts as an anchor for the key. */
  sections: readonly { start: number; end: number }[];
  /** The audio the chords are read from: the performer's chord stem, else the harmony stems added together, else the mix. */
  harmony: NamedAudio;
  /** The bass stem, when it has a signal. The chords read the bass note from it. */
  bass: PcmAudio | null;
  /** The stem the sections read the harmony from, or null when no chord stem is chosen. */
  chordSource: NamedAudio | null;
}

/** The fields a step may fill. The bookkeeping fields belong to the run. */
export type StepResult = Partial<Omit<SongAnalysis, "audioId" | "version" | "failed">>;

export interface AnalysisStep {
  /** Written to `failed` when the step throws. */
  name: string;
  /**
   * Does the work for one song. `soFar` is what the earlier steps have found, so a later step can use it (the tempo step reads the chord
   * changes from it). Throws on failure; the run records it and carries on.
   */
  run(audio: AnalysisAudio, signal: AbortSignal, soFar: SongAnalysis): Promise<StepResult>;
}

export interface AnalysisSettings {
  /** The analysis saved for the song, or null. */
  read(): SongAnalysis | null;
  /** Saves a finished analysis. Only a complete run is saved, so an interrupted one starts again. */
  write(analysis: SongAnalysis): void;
}

/** Why a run stopped early. Playback interrupts it, so it can resume once playback stops; anything else cancels it. */
export const PLAYBACK_INTERRUPT = "playback";

export interface AnalysisRun {
  audioId: string;
  audio: AnalysisAudio;
  steps: readonly AnalysisStep[];
  settings: AnalysisSettings;
  /** Runs even when the saved analysis matches. */
  force?: boolean;
  /** Where to resume, with what the earlier interrupted run found. */
  from?: number;
  partial?: SongAnalysis;
  /** Aborted to stop the run. Its reason says whether playback interrupted it or it was cancelled. */
  signal?: AbortSignal;
  /** Called before each step starts, with its index and name. */
  onStep?: (index: number, name: string) => void;
}

export type AnalysisOutcome =
  | { status: "complete"; analysis: SongAnalysis }
  | { status: "interrupted"; next: number; analysis: SongAnalysis }
  | { status: "cancelled"; analysis: SongAnalysis | null };

/**
 * The fingerprint of a song's mix and stems, the id its analysis is saved under. The generated parts (`generated`, their track keys) are
 * left out: they are made from the analysis, so adding or removing them must not make the saved analysis, or its chords, out of date.
 */
export function songAudioId(mix: PcmAudio, stems: Stems | null, generated: readonly string[] = []): string {
  const kept = Object.fromEntries(Object.entries(stems ?? {}).filter(([name]) => !generated.includes(name)));
  return audioFingerprint(mix.sampleRate, { mix, ...kept });
}

/**
 * A short fingerprint of the audio: the sample rate and the length of each source, in name order. A re-split or an added track
 * changes it, and the analysis is run again. Stems are looked up by name, so the same audio always gives the same id.
 */
export function audioFingerprint(sampleRate: number, stems: Record<string, PcmAudio | undefined>): string {
  const parts = Object.entries(stems)
    .filter((entry): entry is [string, PcmAudio] => entry[1] !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, audio]) => `${name}:${audio.channels[0]?.length ?? 0}`);
  return `${sampleRate}|${parts.join(",")}`;
}

/**
 * The track keys of the generated parts, as a song's saved options record them (`generatedParts`). Every saved analysis is keyed on the
 * audio without them (see songAudioId), so adding or removing the parts leaves the analysis current.
 */
export function generatedTrackKeysIn(options: Record<string, unknown>): string[] {
  const saved = options.generatedParts;
  if (!saved || typeof saved !== "object") return [];
  return Object.values(saved).filter((value): value is string => typeof value === "string" && value.length > 0);
}

/** The saved analysis matches the audio and the current version, so it needs no run. */
export function isCurrent(saved: SongAnalysis | null, audioId: string): saved is SongAnalysis {
  return !!saved && saved.audioId === audioId && saved.version === ANALYSIS_VERSION;
}

/**
 * Runs the steps in order and returns what they found. A step that throws is recorded in `failed` and the run carries on. The run stops
 * early when `signal` is aborted: with the playback reason it reports where to resume, otherwise it is cancelled and nothing is saved.
 */
export async function runSongAnalysis(run: AnalysisRun): Promise<AnalysisOutcome> {
  const saved = run.settings.read();
  if (!run.force && !run.from && isCurrent(saved, run.audioId)) return { status: "complete", analysis: saved };
  const analysis: SongAnalysis = run.partial ?? { audioId: run.audioId, version: ANALYSIS_VERSION };
  const failed = [...(analysis.failed ?? [])];
  const signal = run.signal ?? new AbortController().signal;
  const snapshot = (): SongAnalysis => ({ ...analysis, failed: failed.length ? [...failed] : undefined });
  for (let index = run.from ?? 0; index < run.steps.length; index++) {
    if (signal.aborted) return stopped(signal, index, snapshot());
    const step = run.steps[index];
    run.onStep?.(index, step.name);
    try {
      Object.assign(analysis, await step.run(run.audio, signal, analysis));
    } catch (e) {
      if (signal.aborted) return stopped(signal, index, snapshot());
      failed.push(step.name);
    }
  }
  // Playback that started during the last step still stops the run: nothing is saved over the music.
  if (signal.aborted) return stopped(signal, run.steps.length, snapshot());
  const result = snapshot();
  run.settings.write(result);
  return { status: "complete", analysis: result };
}

function stopped(signal: AbortSignal, next: number, analysis: SongAnalysis): AnalysisOutcome {
  if (signal.reason === PLAYBACK_INTERRUPT) return { status: "interrupted", next, analysis };
  return { status: "cancelled", analysis: null };
}

/** Reads an analysis saved in a song's options. Anything that is not an analysis of the current shape gives null, so the song is analysed again. */
export function parseAnalysis(value: unknown): SongAnalysis | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.audioId !== "string" || typeof record.version !== "number") return null;
  const tempo = record.tempo as Record<string, unknown> | undefined;
  const validTempo = !!tempo && typeof tempo.bpm === "number" && typeof tempo.firstBeat === "number" && typeof tempo.steady === "boolean";
  const parts = record.parts as Record<string, unknown> | undefined;
  const validParts = typeof parts?.drums === "string" && typeof parts.bass === "string" && !!parts.absentSections && typeof parts.absentSections === "object";
  const silence = record.silence as Record<string, unknown> | undefined;
  const validSilence = typeof silence?.start === "number" && typeof silence.end === "number";
  const loudness = record.loudness as Record<string, unknown> | undefined;
  const validLoudness = typeof loudness?.lufs === "number" && typeof loudness.peakDb === "number";
  const key = record.key as { source?: unknown; estimate?: { name?: unknown } } | undefined;
  const validKey = typeof key?.source === "string" && typeof key.estimate?.name === "string";
  const keySections = Array.isArray(record.keySections) && record.keySections.every(isKeySection) ? (record.keySections as KeySection[]) : undefined;
  const chords = record.chords as { source?: unknown; chords?: unknown } | undefined;
  const validChords = typeof chords?.source === "string" && Array.isArray(chords.chords);
  const meter = record.meter as Record<string, unknown> | undefined;
  const validMeter = !!meter && (meter.beatsPerBar === 3 || meter.beatsPerBar === 4) && typeof meter.confidence === "number";
  const sections = Array.isArray(record.sections) && record.sections.every(isSection) ? (record.sections as DetectedSection[]) : undefined;
  const bassLine = isBassLine(record.bassLine) ? (record.bassLine as BassLine) : undefined;
  const failed = Array.isArray(record.failed) && record.failed.every((name) => typeof name === "string") ? record.failed : undefined;
  return {
    audioId: record.audioId,
    version: record.version,
    ...(validTempo ? { tempo: { bpm: tempo.bpm as number, firstBeat: tempo.firstBeat as number, steady: tempo.steady as boolean } } : {}),
    ...(validMeter ? { meter: { beatsPerBar: meter.beatsPerBar as 3 | 4, confidence: meter.confidence as number } } : {}),
    ...(validParts ? { parts: parts as unknown as MissingParts } : {}),
    ...(validSilence ? { silence: { start: silence!.start as number, end: silence!.end as number } } : {}),
    ...(validLoudness ? { loudness: { lufs: loudness!.lufs as number, peakDb: loudness!.peakDb as number } } : {}),
    ...(validKey ? { key: { source: key!.source as string, estimate: key!.estimate as KeyEstimate } } : {}),
    ...(keySections ? { keySections } : {}),
    ...(validChords ? { chords: { source: chords!.source as string, chords: chords!.chords as Chord[] } } : {}),
    ...(sections ? { sections } : {}),
    ...(bassLine ? { bassLine } : {}),
    ...(failed?.length ? { failed } : {}),
  };
}

/** A saved section key: an id and a key with a name. Anything else in the list makes the saved section keys unreadable. */
function isKeySection(value: unknown): value is KeySection {
  const section = value as Partial<KeySection> | null;
  return !!section && typeof section.sectionId === "string" && typeof section.key?.name === "string";
}

/** A saved bass line: the stem's tuning in cents, and a bass note for each beat. Anything else makes the saved bass line unreadable. */
function isBassLine(value: unknown): boolean {
  const line = value as Partial<BassLine> | null;
  return !!line && typeof line.tuningCents === "number" && Number.isFinite(line.tuningCents) && Array.isArray(line.beats) && line.beats.every(isBassLineBeat);
}

/** A saved bass note: a beat, a pitch class or none, and a finite confidence. Anything else makes the saved bass line unreadable. */
function isBassLineBeat(value: unknown): value is BassLineBeat {
  const entry = value as Partial<BassLineBeat> | null;
  return (
    !!entry &&
    typeof entry.beat === "number" &&
    Number.isInteger(entry.beat) &&
    (entry.pc === null || (Number.isInteger(entry.pc) && (entry.pc as number) >= 0 && (entry.pc as number) < 12)) &&
    typeof entry.confidence === "number" &&
    Number.isFinite(entry.confidence)
  );
}

/** A saved section: a name and two finite times. Anything else in the list makes the saved sections unreadable. */
function isSection(value: unknown): value is DetectedSection {
  const section = value as Partial<DetectedSection> | null;
  return (
    !!section &&
    typeof section.name === "string" &&
    typeof section.start === "number" &&
    typeof section.end === "number" &&
    Number.isFinite(section.start) &&
    Number.isFinite(section.end)
  );
}

/** One line for the status under the song: what was found, and what failed. */
export function describeAnalysis(analysis: SongAnalysis): string {
  const found = analysis.tempo ? `Tempo ${analysis.tempo.bpm} BPM${analysis.tempo.steady ? "" : " (the tempo varies)"}` : "No steady tempo found";
  const meter = analysis.meter ? `. Meter ${analysis.meter.beatsPerBar}/4${analysis.meter.confidence < METER_CERTAIN ? " (not certain)" : ""}` : "";
  const loudness = analysis.loudness ? `. Loudness ${analysis.loudness.lufs.toFixed(1)} LUFS` : "";
  const absent = (["drums", "bass"] as const).filter((part) => analysis.parts?.[part] === "absent");
  const parts = absent.length ? `. Missing ${absent.join(" and ")}` : "";
  const key = analysis.key ? `. Key ${analysis.key.estimate.name}` : "";
  const chords = analysis.chords ? `. ${analysis.chords.chords.length} chords` : "";
  const sections = analysis.sections ? `. ${analysis.sections.length} section${analysis.sections.length === 1 ? "" : "s"}` : "";
  const sectionKeys = analysis.keySections?.length ? `. ${analysis.keySections.length} section key${analysis.keySections.length === 1 ? "" : "s"}` : "";
  const failed = analysis.failed?.length ? `. Could not work out: ${analysis.failed.join(", ")}` : "";
  return `${found}${meter}${loudness}${parts}${key}${sectionKeys}${chords}${sections}${failed}`;
}
