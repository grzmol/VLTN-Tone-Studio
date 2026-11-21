// @vitest-environment node
// Local chord accuracy check (spec 81). It runs only when VLTN_CHORD_EVAL names a saved library folder, so it is skipped in every normal
// run, and nothing from a library is read otherwise. Run it from app/:
//
//   VLTN_CHORD_EVAL="/path/to/library" npx vitest run src/renderer/src/song/performance/chord-eval.test.ts
//
// The folder is the library's root (the one holding library.json). Songs whose chart has no timed chords, or whose audio cannot be read,
// are skipped. Audio and chart text are read from the folder and never copied anywhere. Each detector is scored on a 0.1 s grid against
// the chart's chords:
//   - root: the pitch class of the root matches (enharmonics count as equal);
//   - root+quality: the root and the quality class (major, minor, power, other) match;
//   - cover: the share of the chart's chord time where the detector names a chord (not N).
// N is left out of the root and root+quality accuracy on both sides, so a detector is not rewarded for saying nothing; cover shows the rest.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeFlac } from "@shared/flac";
import { parseChart } from "./chart";
import { chartChordEvents, LAST_CHORD_SECONDS, parseChordName, type ChordEvent, type ParsedChord } from "../band/harmony";
import { fft } from "../tonematch/fft";
import { detectChords, type Chord } from "./chords";
import { defaultChordSource } from "./sources";
import { bassOf, harmonyOf, sectionBoundsOf } from "../analysis/analysis-audio";
import { keyAudio, keyFromChroma, keyOfSong, type KeyEstimate } from "./key";
import { parseBeatGrid } from "../band/beat-grid";
import type { PcmAudio, StemName, Stems } from "../types";

const LIBRARY = process.env.VLTN_CHORD_EVAL ?? "";
const STEP_SECONDS = 0.1;
const STEM_NAMES: StemName[] = ["drums", "bass", "other", "vocals", "guitar", "piano"];

/**
 * A frozen copy of the spec-80 detector (`chords.ts` before spec 81), so the eval can show the change. Only this file uses it.
 */
function legacyDetectChords(audio: PcmAudio): Chord[] {
  const n = 8192,
    hop = Math.round(audio.sampleRate / 2);
  const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const result: Chord[] = [];
  for (let start = 0; start < audio.channels[0].length; start += hop) {
    const re = new Float64Array(n),
      im = new Float64Array(n),
      chroma = new Float64Array(12);
    let channel = audio.channels[0],
      loudest = -1;
    for (const candidate of audio.channels) {
      let energy = 0;
      for (let i = start; i < Math.min(candidate.length, start + n); i++) energy += candidate[i] ** 2;
      if (energy > loudest) {
        loudest = energy;
        channel = candidate;
      }
    }
    for (let i = 0; i < n; i++) {
      re[i] = channel[start + i] ?? 0;
      re[i] *= 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    }
    fft(re, im);
    for (let k = 1; k < n / 2; k++) {
      const hz = (k * audio.sampleRate) / n;
      if (hz < 65 || hz > 2000) continue;
      const midi = Math.round(69 + 12 * Math.log2(hz / 440));
      chroma[((midi % 12) + 12) % 12] += re[k] ** 2 + im[k] ** 2;
    }
    const total = chroma.reduce((a, b) => a + b, 0);
    let score = 0,
      name = "N";
    if (total > 0.01)
      for (let root = 0; root < 12; root++)
        for (const third of [4, 3]) {
          const value = (chroma[root] + chroma[(root + third) % 12] + chroma[(root + 7) % 12]) / total;
          if (value > score) {
            score = value;
            name = notes[root] + (third === 3 ? "m" : "");
          }
        }
    if (score < 0.55) name = "N";
    result.push({ time: start / audio.sampleRate, name, confidence: score });
  }
  return legacySmooth(result);
}

/** The spec-80 blip removal, copied with the baseline. */
function legacySmooth(frames: Chord[]): Chord[] {
  const stable = frames.map((frame, i) =>
    i > 0 && i + 1 < frames.length && frame.name !== "N" && frames[i - 1].name === frames[i + 1].name && frames[i - 1].name !== "N"
      ? { ...frame, name: frames[i - 1].name, confidence: Math.min(frames[i - 1].confidence, frames[i + 1].confidence) }
      : frame,
  );
  return stable.filter((frame, i) => i === 0 || frame.name !== stable[i - 1].name);
}

interface LibraryTrack {
  name: string;
  file?: string;
  codec?: string;
}
interface LibrarySongRecord {
  id: string;
  title: string;
  /** The key the performer set on the song, such as "A minor", "Bb" or "E major". Often unset. */
  key?: string;
  audio: LibraryTrack[];
  settings: Record<string, string>;
}
interface LibraryIndex {
  songs: LibrarySongRecord[];
  revisions: Record<string, string>;
}

/** One song as the eval sees it: the audio the app would analyse, its stems, its chord choice, saved beat grid and sections, and the chart's chords. */
interface EvalSong {
  title: string;
  mix: PcmAudio;
  stems: Stems;
  chordChoice: StemName | "";
  beats: number[] | null;
  sections: { start: number; end: number }[];
  /** The key the performer set on the library entry, or empty. */
  libraryKey: string;
  truth: ChordEvent[];
  duration: number;
}

/** The detectors the eval compares. The first is the frozen baseline; the last is the detector under test. */
const DETECTORS: { name: string; run: (song: EvalSong) => Chord[] }[] = [
  { name: "baseline (spec 80)", run: (song) => legacyDetectChords(chordAudio(song)) },
  // The current detector gets the inputs the app gives it: the harmony and bass of the analysis, and the song's saved beat grid.
  {
    name: "current",
    run: (song) => detectChords({ harmony: harmonyOf(song.stems, song.mix, song.chordChoice).audio, bass: bassOf(song.stems), beats: song.beats }),
  },
];

/** The audio the chord analysis reads when no chord stem is chosen: the first stem with a signal, else the mix. */
function chordAudio(song: EvalSong): PcmAudio {
  const name = defaultChordSource(song.stems);
  return name ? song.stems[name]! : song.mix;
}

async function readTrack(root: string, revision: string, track: LibraryTrack): Promise<PcmAudio | null> {
  if (track.codec !== "flac") return null;
  const bytes = new Uint8Array(await readFile(join(root, revision, track.file ?? `${track.name}.flac`)));
  return decodeFlac(bytes);
}

/** A song's saved options, or none when they are missing or damaged. */
function parseOptions(text: string | undefined): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The chart's cues, or none when the chart does not parse (for example it uses a MIDI macro the library does not define). Such a song still has a key. */
function cuesOf(text: string): ReturnType<typeof parseChart> {
  try {
    return parseChart(text);
  } catch {
    return [];
  }
}

/** Reads one saved song's audio and chart. Null for a song the eval cannot use: no timed chords, no revision, or no readable mix. */
async function loadSong(root: string, index: LibraryIndex, record: LibrarySongRecord): Promise<EvalSong | null> {
  const truth = chartChordEvents(cuesOf(record.settings[""] ?? "")).sort((a, b) => a.time - b.time);
  const revision = index.revisions[record.id];
  if (!revision) return null;
  const options = parseOptions(record.settings[":options"]);
  const chordChoice = STEM_NAMES.includes(options.chordChoice as StemName) ? (options.chordChoice as StemName) : "";
  const beats = parseBeatGrid(options.beatGrid)?.beats ?? null;
  const sections = sectionBoundsOf(options.sections);
  const stems: Stems = {};
  let mix: PcmAudio | null = null;
  for (const track of record.audio) {
    if (track.name === "source") mix = await readTrack(root, revision, track);
    else if (STEM_NAMES.includes(track.name as StemName)) stems[track.name as StemName] = (await readTrack(root, revision, track)) ?? undefined;
  }
  if (!mix) return null;
  return {
    title: record.title,
    mix,
    stems,
    chordChoice,
    beats,
    sections,
    libraryKey: record.key ?? "",
    truth,
    duration: mix.channels[0].length / mix.sampleRate,
  };
}

type Quality = "major" | "minor" | "power" | "other";

function qualityClass(parsed: ParsedChord): Quality {
  if (parsed.quality === "major" || parsed.quality === "minor" || parsed.quality === "power") return parsed.quality;
  return "other";
}

interface Score {
  /** Grid points where the chart and the detector both name a chord. */
  both: number;
  root: number;
  rootQuality: number;
  /** Grid points where the chart names a chord. */
  chart: number;
  /** Grid points where the detector names a chord, counted over `chart`. */
  named: number;
}

const zero = (): Score => ({ both: 0, root: 0, rootQuality: 0, chart: 0, named: 0 });

/** Scores one detector's chords against the chart's chords on a fixed time grid. */
export function scoreChords(truth: readonly ChordEvent[], detected: readonly Chord[], duration: number): Score {
  const score = zero();
  let ti = 0,
    di = 0;
  // The grid stops where the chart's last chord stops (see chartChordEvents), so a silent tail after it is not scored. It is indexed,
  // not summed, so each point lands on the same side of a chord change every run.
  const end = Math.min(duration, truth[truth.length - 1].time + LAST_CHORD_SECONDS);
  for (let i = 0; truth[0].time + i * STEP_SECONDS < end; i++) {
    const t = truth[0].time + i * STEP_SECONDS;
    while (ti + 1 < truth.length && truth[ti + 1].time <= t) ti++;
    while (di + 1 < detected.length && detected[di + 1].time <= t) di++;
    if (truth[ti].time > t) continue;
    const reference = parseChordName(truth[ti].name);
    if (!reference) continue;
    score.chart++;
    const guess = detected.length && detected[di].time <= t ? parseChordName(detected[di].name) : null;
    if (!guess) continue;
    score.named++;
    score.both++;
    if (guess.root === reference.root) {
      score.root++;
      if (qualityClass(guess) === qualityClass(reference)) score.rootQuality++;
    }
  }
  return score;
}

const pct = (part: number, whole: number) => (whole ? `${((100 * part) / whole).toFixed(1)}%` : "n/a");
const cells = (s: Score) => `${pct(s.root, s.both).padStart(6)} ${pct(s.rootQuality, s.both).padStart(7)} ${pct(s.named, s.chart).padStart(6)}`;

/** A table with, per detector, root accuracy, root+quality accuracy and cover, one row per song and a time-weighted total. */
function report(rows: { title: string; scores: Score[] }[], names: string[]): string {
  const total = names.map((_, i) =>
    rows.reduce((acc, row) => {
      const s = row.scores[i];
      return { both: acc.both + s.both, root: acc.root + s.root, rootQuality: acc.rootQuality + s.rootQuality, chart: acc.chart + s.chart, named: acc.named + s.named };
    }, zero()),
  );
  const head = `${"Song".padEnd(36)} | ${names.map((n) => n.slice(0, 21).padEnd(21)).join(" | ")}`;
  const sub = `${"".padEnd(36)} | ${names.map(() => "  root  r+qual  cover").join(" | ")}`;
  const rule = "-".repeat(36) + "-+-" + names.map(() => "-".repeat(21)).join("-+-");
  const body = rows.map((row) => `${row.title.slice(0, 36).padEnd(36)} | ${row.scores.map(cells).join(" | ")}`);
  return [head, sub, rule, ...body, rule, `${"All songs (time-weighted)".padEnd(36)} | ${total.map(cells).join(" | ")}`].join("\n");
}

describe.skipIf(!LIBRARY)("chord accuracy on a local library (spec 81)", () => {
  it(
    "compares the detectors with the chart chords",
    async () => {
      const index = JSON.parse(await readFile(join(LIBRARY, "library.json"), "utf8")) as LibraryIndex;
      const rows: { title: string; scores: Score[] }[] = [];
      let skipped = 0;
      for (const record of index.songs) {
        const song = await loadSong(LIBRARY, index, record);
        if (!song || !song.truth.length) {
          skipped++;
          continue;
        }
        const scores = DETECTORS.map((detector) => scoreChords(song.truth, detector.run(song), song.duration));
        if (scores.every((s) => s.chart === 0)) continue;
        rows.push({ title: song.title, scores });
      }
      console.log(`\nSkipped (no timed chords, no readable mix): ${skipped} of ${index.songs.length}\n`);
      console.log(report(rows, DETECTORS.map((d) => d.name)));
    },
    60 * 60 * 1000,
  );
});

/**
 * A frozen copy of the spec-82 baseline key detector (`detectKey` before spec 82): a spectral chroma of the stem over up to 600 windows,
 * scored with the Krumhansl-Kessler profiles. Only this file uses it.
 */
function legacyDetectKey(audio: PcmAudio): KeyEstimate | null {
  if (!audio.channels[0]?.length || !(audio.sampleRate > 0)) return null;
  const n = 16384,
    length = audio.channels[0].length;
  const windows = Math.min(600, Math.max(1, Math.ceil(length / (audio.sampleRate * 0.5))));
  const chroma = new Float64Array(12);
  for (let window = 0; window < windows; window++) {
    const start = windows === 1 ? 0 : Math.floor((window * Math.max(0, length - n)) / (windows - 1));
    let channel = audio.channels[0],
      loudest = -1;
    for (const candidate of audio.channels) {
      let energy = 0;
      for (let i = start; i < Math.min(length, start + n); i++) energy += candidate[i] ** 2;
      if (energy > loudest) {
        loudest = energy;
        channel = candidate;
      }
    }
    if (loudest / Math.min(n, length) < 1e-7) continue;
    const re = new Float64Array(n),
      im = new Float64Array(n),
      frame = new Float64Array(12);
    for (let i = 0; i < n; i++) re[i] = (channel[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
    fft(re, im);
    const power = (k: number) => re[k] ** 2 + im[k] ** 2;
    for (let k = 2; k < n / 2 - 1; k++) {
      const hz = (k * audio.sampleRate) / n;
      if (hz < 55 || hz > 2000) continue;
      const peak = power(k),
        left = power(k - 1),
        right = power(k + 1);
      if (peak <= left || peak < right) continue;
      const offset =
        (0.5 * (Math.log(left + 1e-20) - Math.log(right + 1e-20))) / (Math.log(left + 1e-20) - 2 * Math.log(peak + 1e-20) + Math.log(right + 1e-20));
      const midi = 69 + 12 * Math.log2(((k + Math.max(-0.5, Math.min(0.5, offset))) * audio.sampleRate) / n / 440);
      if (Math.abs(midi - Math.round(midi)) > 0.35) continue;
      frame[((Math.round(midi) % 12) + 12) % 12] += Math.sqrt(peak);
    }
    const total = frame.reduce((a, b) => a + b, 0);
    if (total) for (let i = 0; i < 12; i++) chroma[i] += frame[i] / total;
  }
  return keyFromChroma(chroma);
}

/** A key the library names: its tonic, and its mode when it gives one ("Bb" gives none). */
export interface KeyTarget {
  tonic: number;
  mode: "major" | "minor" | null;
}

/** Reads a library key such as "A minor", "Eb", "G major" or "Fm". Null when the text is empty or is not a key. */
export function keyTargetOf(text: string | undefined): KeyTarget | null {
  const match = /^([A-G])(#|b)?\s*(major|minor|maj|min|m)?$/i.exec((text ?? "").trim());
  if (!match) return null;
  const natural: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const tonic = (natural[match[1].toUpperCase()] + (match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0) + 12) % 12;
  const word = match[3]?.toLowerCase();
  const mode = !word ? null : word.startsWith("maj") ? "major" : "minor";
  return { tonic, mode };
}

/**
 * Whether an estimate is the library key (exact), or its relative (the same notes in the other mode). A target with no mode counts as
 * exact when the tonic matches, and is never a relative.
 */
export function keyMatch(estimate: KeyEstimate | null, target: KeyTarget): { exact: boolean; relative: boolean } {
  if (!estimate) return { exact: false, relative: false };
  const sameTonic = estimate.tonic === target.tonic;
  if (target.mode === null) return { exact: sameTonic, relative: false };
  const exact = sameTonic && estimate.mode === target.mode;
  const relativeTonic = estimate.mode === "major" ? (estimate.tonic + 9) % 12 : (estimate.tonic + 3) % 12;
  return { exact, relative: !exact && estimate.mode !== target.mode && relativeTonic === target.tonic };
}

describe("keyTargetOf and keyMatch", () => {
  it("reads library keys with and without a mode, and matches exact and relative keys", () => {
    expect(keyTargetOf("A minor")).toEqual({ tonic: 9, mode: "minor" });
    expect(keyTargetOf("Bb")).toEqual({ tonic: 10, mode: null });
    expect(keyTargetOf("Eb major")).toEqual({ tonic: 3, mode: "major" });
    expect(keyTargetOf("Fm")).toEqual({ tonic: 5, mode: "minor" });
    expect(keyTargetOf("")).toBeNull();
    expect(keyTargetOf("Hmm")).toBeNull();
    const estimate = (name: string, tonic: number, mode: "major" | "minor") => ({
      name,
      tonic,
      mode,
      correlation: 0.8,
      margin: 0.2,
      confidence: "strong" as const,
      alternatives: [],
    });
    // G major is the relative of E minor.
    expect(keyMatch(estimate("G major", 7, "major"), { tonic: 4, mode: "minor" })).toEqual({ exact: false, relative: true });
    expect(keyMatch(estimate("E minor", 4, "minor"), { tonic: 4, mode: "minor" })).toEqual({ exact: true, relative: false });
    expect(keyMatch(estimate("E minor", 4, "minor"), { tonic: 4, mode: null })).toEqual({ exact: true, relative: false });
    expect(keyMatch(null, { tonic: 4, mode: "minor" })).toEqual({ exact: false, relative: false });
  });
});

describe("scoreChords", () => {
  it("counts root and quality agreement, and leaves N out of the accuracy", () => {
    const truth = [
      { time: 0, name: "C" },
      { time: 2, name: "N" },
      { time: 4, name: "Am" },
    ];
    const detected = [
      { time: 0, name: "C", confidence: 1 },
      { time: 2, name: "G", confidence: 1 },
      { time: 4, name: "A5", confidence: 1 },
    ];
    // 0 to 2 s: C against C, all right. 2 to 4 s is N in the chart, so skipped. 4 to 6 s: A5 against Am is the root but not the quality.
    const score = scoreChords(truth, detected, 6);
    expect(score.both).toBe(20 + 20);
    expect(score.root).toBe(20 + 20);
    expect(score.rootQuality).toBe(20);
    expect(score.chart).toBe(40 + 0);
  });
});

const KEY_LABELS = { old: "old detectKey", current: "current (spec 82)" };

/** One line per song: the library key, and each detector's estimate with a mark for exact (=) and relative (~) matches. */
type KeyTotals = Record<"old" | "current", { n: number; exact: number; either: number }>;

function keyReport(rows: { title: string; library: string; old: string; current: string }[], totals: KeyTotals): string {
  const head = `${"Song".padEnd(34)} | ${"Library".padEnd(10)} | ${"Old".padEnd(16)} | Current`;
  const body = rows.map((row) => `${row.title.slice(0, 34).padEnd(34)} | ${row.library.padEnd(10)} | ${row.old.padEnd(16)} | ${row.current}`);
  const line = (label: string, t: { n: number; exact: number; either: number }) =>
    `${label.padEnd(20)} exact ${pct(t.exact, t.n)}, exact or relative ${pct(t.either, t.n)} (${t.n} songs with a library key)`;
  return [head, ...body, "", line(KEY_LABELS.old, totals.old), line(KEY_LABELS.current, totals.current)].join("\n");
}

describe.skipIf(!LIBRARY)("key accuracy on a local library (spec 82)", () => {
  it(
    "compares the old and the current key detectors with the library keys",
    async () => {
      const index = JSON.parse(await readFile(join(LIBRARY, "library.json"), "utf8")) as LibraryIndex;
      const rows: { title: string; library: string; old: string; current: string }[] = [];
      const totals = { old: { n: 0, exact: 0, either: 0 }, current: { n: 0, exact: 0, either: 0 } };
      for (const record of index.songs) {
        const song = await loadSong(LIBRARY, index, record);
        const target = keyTargetOf(song?.libraryKey);
        if (!song || !target) continue;
        // The app's order: the harmony and bass, the chords, then the key with the performer's sections.
        const harmony = harmonyOf(song.stems, song.mix, song.chordChoice).audio;
        const bass = bassOf(song.stems);
        const chords = detectChords({ harmony, bass, beats: song.beats });
        const current = keyOfSong({ harmony, bass, chords, sections: song.sections });
        const old = legacyDetectKey(keyAudio(song.stems, song.mix)?.audio ?? song.mix);
        for (const [which, estimate] of [
          ["old", old],
          ["current", current],
        ] as const) {
          const match = keyMatch(estimate, target);
          totals[which].n++;
          if (match.exact) totals[which].exact++;
          if (match.exact || match.relative) totals[which].either++;
        }
        const mark = (estimate: KeyEstimate | null) => {
          const match = keyMatch(estimate, target);
          return `${estimate?.name ?? "none"}${match.exact ? " =" : match.relative ? " ~" : ""}`;
        };
        rows.push({ title: song.title, library: song.libraryKey, old: mark(old), current: mark(current) });
      }
      console.log(`\n${keyReport(rows, totals)}\n`);
      expect(totals.old.n).toBe(totals.current.n);
    },
    60 * 60 * 1000,
  );
});
