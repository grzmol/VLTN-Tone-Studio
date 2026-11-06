import type { PcmAudio, Stems } from "../types";
import { hasSignal } from "./sources";
import type { Chord } from "./chords";
import { combinedProfile, evidenceIn, keyFramesOf, type KeyEvidence } from "../analysis/key-evidence";

export const KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const SONG_KEYS = KEY_NAMES.flatMap((root) => [`${root} major`, `${root} minor`]);

/**
 * The key a song's chord names are spelled by: the performer's Key override when set, else the key saved on the library entry (an import
 * or the song details), else the automatic estimate, but only a strong one. Undefined when none is known, so the chords keep their spelling.
 */
export function effectiveSongKey(override: string, libraryKey: string | undefined, estimate: KeyEstimate | null): string | undefined {
  if (override) return override;
  if (libraryKey) return libraryKey;
  return estimate?.confidence === "strong" ? estimate.name : undefined;
}
export interface KeyEstimate {
  name: string;
  tonic: number;
  mode: "major" | "minor";
  correlation: number;
  margin: number;
  confidence: "tentative" | "strong";
  alternatives: string[];
  /**
   * A modal flavour of the key, when it is clear: Mixolydian (a major key with a major chord on the flat seventh) or Dorian (a minor key
   * with a major chord on the fourth).
   */
  flavour?: "mixolydian" | "dorian";
}
// Krumhansl-Kessler tonal profiles; correlation approach documented at
// https://music21.org/music21docs/moduleReference/moduleAnalysisDiscrete.html
const profiles = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};
/**
 * Temperley's key weights (the Temperley and Kostka-Payne set, as music21 tabulates it). The second profile set: the key score is the mean
 * of the two sets' correlations. Its corpus is common-practice harmony rather than pop, so it is a second opinion, not a pop profile.
 */
const TEMPERLEY = {
  major: [0.748, 0.06, 0.488, 0.082, 0.67, 0.46, 0.096, 0.715, 0.104, 0.366, 0.057, 0.4],
  minor: [0.712, 0.084, 0.474, 0.618, 0.049, 0.46, 0.105, 0.747, 0.404, 0.067, 0.133, 0.33],
};
const PROFILE_SETS = [profiles, TEMPERLEY];
/** Two keys within this correlation count as near enough for the alternatives to be listed. */
const NEAR_SCORE = 0.1;
/** Relatives closer than this are decided by the chords at the anchors and the bass, not by the profiles. */
const RELATIVE_MARGIN = 0.05;
/** A modal chord must fill at least this share of the chord time, or the key is given without a flavour. */
const FLAVOUR_SHARE = 0.15;
export function keyAudio(stems: Stems | null, original?: PcmAudio): { name: string; audio: PcmAudio } | null {
  for (const name of ["guitar", "piano", "other", "bass", "vocals"] as const) {
    if (hasSignal(stems?.[name])) return { name, audio: stems![name]! };
  }
  return hasSignal(original) ? { name: "original mix", audio: original! } : null;
}
export function keyFromChroma(chroma: ArrayLike<number>): KeyEstimate | null {
  const values = Array.from(chroma);
  if (values.length !== 12 || values.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const max = Math.max(...values),
    mean = values.reduce((a, b) => a + b, 0) / 12;
  if (!max || values.filter((n) => n > max * 0.1).length < 3) return null;
  const centered = values.map((n) => n - mean),
    variance = centered.reduce((a, b) => a + b * b, 0);
  if (Math.sqrt(variance / 12) < mean * 0.12) return null;
  const scores: { tonic: number; mode: "major" | "minor"; score: number; name: string }[] = [];
  for (const mode of ["major", "minor"] as const) {
    const profile = profiles[mode],
      average = profile.reduce((a, b) => a + b, 0) / 12;
    const norm = Math.sqrt(variance * profile.reduce((a, b) => a + (b - average) ** 2, 0));
    for (let tonic = 0; tonic < 12; tonic++) {
      const score = centered.reduce((sum, value, i) => sum + value * (profile[(i - tonic + 12) % 12] - average), 0) / norm;
      scores.push({ tonic, mode, score, name: `${KEY_NAMES[tonic]} ${mode}` });
    }
  }
  scores.sort((a, b) => b.score - a.score);
  const first = scores[0],
    margin = first.score - scores[1].score;
  if (first.score < 0.55) return null;
  return {
    name: first.name,
    tonic: first.tonic,
    mode: first.mode,
    correlation: first.score,
    margin,
    confidence: first.score >= 0.75 && margin >= 0.12 ? "strong" : "tentative",
    alternatives: scores.slice(1, 3).map((s) => s.name),
  };
}
/** The whole song's key from its harmony, bass, chords and sections (see `readKey`). */
export interface KeyInput {
  harmony: PcmAudio;
  bass: PcmAudio | null;
  chords: Chord[];
  /** The song's sections, as bounds in seconds. Their ends are where a chord counts as an anchor, and each one's key is read. */
  sections: readonly { start: number; end: number }[];
  /** The song's key name, such as "G major". When given, each section's key is read and reported where it differs from this one. */
  songKey?: string;
}

/** A section whose key differs from the song's, with a strong reading. `sectionId` is the section's index in the song's sections. */
export interface KeySection {
  sectionId: string;
  key: KeyEstimate;
}

export interface KeyReading {
  estimate: KeyEstimate | null;
  keySections: KeySection[];
}

/**
 * The song's key and, when `songKey` is given, the sections that are in another key (spec 82). The frames are read once. A section is
 * read over its own frames, with the chords that fall in it; only a strong reading that differs from the song's key is reported.
 */
export function readKey(input: KeyInput): KeyReading {
  const frames = keyFramesOf(input.harmony, input.bass, input.chords, input.sections.map((section) => section.end));
  const estimate = detectKeyFrom(evidenceIn(frames, 0, Infinity));
  const keySections: KeySection[] = [];
  if (input.songKey) {
    input.sections.forEach((section, index) => {
      const key = detectKeyFrom(evidenceIn(frames, section.start, section.end));
      if (key?.confidence === "strong" && key.name !== input.songKey) keySections.push({ sectionId: String(index), key });
    });
  }
  return { estimate, keySections };
}

/** The key of a song from its harmony, bass, chords and section ends (spec 82). Null when the harmony has no clear key. */
export function keyOfSong(input: KeyInput): KeyEstimate | null {
  return readKey(input).estimate;
}

/**
 * Whole-song estimate from the audio's own chroma, with no chords and no bass. No model download or audio upload. Without the chords and
 * the bass to back it, a tentative key is not trusted: only a strong one is returned.
 */
export function detectKey(audio: PcmAudio): KeyEstimate | null {
  if (!hasSignal(audio) || !Number.isFinite(audio.sampleRate) || audio.sampleRate <= 0) return null;
  const estimate = keyOfSong({ harmony: audio, bass: null, chords: [], sections: [] });
  return estimate?.confidence === "strong" ? estimate : null;
}

interface KeyScore {
  tonic: number;
  mode: "major" | "minor";
  score: number;
  name: string;
}

/** The correlation of a chroma with every key, averaged over the profile sets, best first. */
function scoreKeys(chroma: ArrayLike<number>): KeyScore[] {
  const values = Array.from(chroma);
  const mean = values.reduce((a, b) => a + b, 0) / 12;
  const centered = values.map((n) => n - mean);
  const variance = centered.reduce((a, b) => a + b * b, 0);
  const scores: KeyScore[] = [];
  for (const mode of ["major", "minor"] as const) {
    for (let tonic = 0; tonic < 12; tonic++) scores.push({ tonic, mode, score: 0, name: `${KEY_NAMES[tonic]} ${mode}` });
  }
  for (const set of PROFILE_SETS) {
    for (const entry of scores) {
      const profile = set[entry.mode];
      const average = profile.reduce((a, b) => a + b, 0) / 12;
      const norm = Math.sqrt(variance * profile.reduce((a, b) => a + (b - average) ** 2, 0));
      const correlation = centered.reduce((sum, value, i) => sum + value * (profile[(i - entry.tonic + 12) % 12] - average), 0) / norm;
      entry.score += correlation / PROFILE_SETS.length;
    }
  }
  return scores.sort((a, b) => b.score - a.score);
}

/** Whether a chroma has a clear shape: a peak with at least three pitch classes above a tenth of it, and enough spread around its mean. */
function hasShape(values: readonly number[]): boolean {
  const max = Math.max(...values),
    mean = values.reduce((a, b) => a + b, 0) / 12;
  if (!(max > 0) || values.filter((n) => n > max * 0.1).length < 3) return false;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0);
  return Math.sqrt(variance / 12) >= mean * 0.12;
}

/** The chords at the anchors (the first and last chord and the ones ending a section) that name the candidate's tonic chord, and its bass. */
function tonicSupport(evidence: KeyEvidence, candidate: KeyScore): number {
  const anchors = evidence.runs.filter((run) => run.anchor);
  const wanted = candidate.mode === "major" ? "major" : "minor";
  const chords = anchors.length ? anchors.filter((run) => run.root === candidate.tonic && run.quality === wanted).length / anchors.length : 0;
  return chords + (evidence.bass ? evidence.bass[candidate.tonic] : 0);
}

/** The flavour of a key, from the share of the chord time on the modal chord: bVII in a major key, IV in a minor key. */
function flavourOf(evidence: KeyEvidence, key: KeyScore): KeyEstimate["flavour"] {
  const total = evidence.runs.reduce((sum, run) => sum + run.seconds, 0);
  if (!total) return undefined;
  const share = (root: number) => evidence.runs.filter((run) => run.root === root && run.quality === "major").reduce((sum, run) => sum + run.seconds, 0) / total;
  if (key.mode === "major" && share((key.tonic + 10) % 12) >= FLAVOUR_SHARE) return "mixolydian";
  if (key.mode === "minor" && share((key.tonic + 5) % 12) >= FLAVOUR_SHARE) return "dorian";
  return undefined;
}

/** Whether two keys are relatives: the same notes in the other mode, so a major key and the minor key on its sixth degree. */
function areRelatives(a: KeyScore, b: KeyScore): boolean {
  if (a.mode === b.mode) return false;
  const major = a.mode === "major" ? a : b,
    minor = a.mode === "major" ? b : a;
  return minor.tonic === (major.tonic + 9) % 12;
}

/**
 * The key of a song from its evidence (spec 82): the mean correlation of the combined profile with each key, and the relative tiebreak when
 * the top two are relatives within `RELATIVE_MARGIN`. The tonic chord at the anchors and the bass on the tonic decide it. The alternatives
 * are the relative key and the nearer fifth-related key, when either is near the top. Null when the evidence has no clear key.
 */
export function detectKeyFrom(evidence: KeyEvidence): KeyEstimate | null {
  const chroma = combinedProfile(evidence);
  if (!chroma || !hasShape(Array.from(chroma))) return null;
  const scores = scoreKeys(chroma);
  let [first, second] = scores;
  if (areRelatives(first, second) && first.score - second.score < RELATIVE_MARGIN && tonicSupport(evidence, second) > tonicSupport(evidence, first)) {
    [first, second] = [second, first];
  }
  if (first.score < 0.55) return null;
  const margin = first.score - second.score;
  const find = (tonic: number, mode: "major" | "minor") => scores.find((s) => s.tonic === tonic && s.mode === mode)!;
  const relative = find((first.tonic + (first.mode === "major" ? 9 : 3)) % 12, first.mode === "major" ? "minor" : "major");
  const fifths = [find((first.tonic + 7) % 12, first.mode), find((first.tonic + 5) % 12, first.mode)].sort((a, b) => b.score - a.score);
  const alternatives = [relative, fifths[0]].filter((s) => first.score - s.score < NEAR_SCORE);
  const flavour = flavourOf(evidence, first);
  return {
    name: first.name,
    tonic: first.tonic,
    mode: first.mode,
    correlation: first.score,
    margin: Math.abs(margin),
    confidence: first.score >= 0.75 && Math.abs(margin) >= 0.12 ? "strong" : "tentative",
    alternatives: alternatives.map((s) => s.name),
    ...(flavour ? { flavour } : {}),
  };
}
