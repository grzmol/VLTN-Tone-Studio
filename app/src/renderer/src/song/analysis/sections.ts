// Suggests a song's sections from its audio: named spans (Intro, Verse, Chorus …) that start and end on bar lines where the music allows.
// Everything here is pure. The worker (sections-worker.ts) measures each unit of the song, a bar or a short time frame, and hands the
// measurements here. The detector finds where the music changes (a self-similarity novelty curve), then names the spans by how they
// repeat, how loud they are and whether vocals are in them.

import { MAX_SECTIONS, type Section } from "../performance/sections";

/** What the detector knows about one unit of the song: a bar, or a time frame when the song has no beat grid. */
export interface SectionUnit {
  /** Song time of the unit's start, in seconds. */
  start: number;
  /** Song time of the unit's end, in seconds. */
  end: number;
  /** Pitch-class energy of the harmony over the unit, C to B. Need not be normalised. */
  chroma: readonly number[];
  /** RMS level of the mix over the unit, linear. */
  energy: number;
  /** Whether vocals are present in the unit. */
  vocals: boolean;
  /** RMS level of the vocals stem over the unit, linear. Absent when the song has no vocals stem. */
  vocalEnergy?: number;
  /** RMS level of the drums stem over the unit, linear. Absent when the song has no drums stem. */
  drumEnergy?: number;
  /** RMS level of the bass stem over the unit, linear. Absent when the song has no bass stem. */
  bassEnergy?: number;
}

export interface DetectOptions {
  /** Boundaries prefer multiples of this many units from the start. Use 4 for bars, and 1 for time frames (no snapping). */
  snap: number;
  /** The shortest section, in units. A boundary closer than this to another boundary or to the song's ends is dropped. */
  minUnits: number;
  /** Half the width of the novelty kernel, in units. */
  halfKernel: number;
}

/** Bars: an 8-bar kernel, sections of at least 4 bars, and boundaries on 4-bar lines where the music allows. */
export const BAR_DETECT: DetectOptions = { snap: 4, minUnits: 4, halfKernel: 4 };
/** Time frames of 2 seconds (see `timeUnitSpans`): a 16-second kernel, sections of at least 8 seconds, and no snapping. */
export const TIME_DETECT: DetectOptions = { snap: 1, minUnits: 4, halfKernel: 8 };
/** The length of one time frame in the fallback, in seconds. */
export const TIME_FRAME_S = 2;

export interface DetectedSection {
  start: number;
  end: number;
  name: string;
  /** The original drums are silent here (well under the song's usual drum level). Set only when the song has a drums stem. */
  drumsOff?: boolean;
  /** The original bass is silent here. Set only when the song has a bass stem. */
  bassOff?: boolean;
  /** How loud the section is against the song's middle section, in decibels. */
  levelDb?: number;
}

/** A peak is a boundary only when it is at least this share of the strongest peak. Smaller bumps are changes inside a section. */
export const PEAK_SHARE = 0.3;
/** A boundary off a multiple of `snap` keeps this share of its strength, so an on-grid boundary of similar strength wins. */
const OFF_GRID_WEIGHT = 0.7;
/** Sections whose average features match at least this closely (cosine) are the same kind of section. */
export const SAME_KIND = 0.8;
/** Weight of the loudness in the feature vector, against the unit's chroma (which has length 1). */
const ENERGY_WEIGHT = 0.5;
/** Weight of the vocal flag in the feature vector. */
const VOCAL_WEIGHT = 0.5;
/** Weight of each stem's level (drums, bass) in the feature vector. */
const STEM_WEIGHT = 0.5;
/** A stem is off in a span when its level is this far below the median span's, in decibels. */
const STEM_OFF_DB = 12;
/** A loudness this many decibels from the song's median is the full loudness feature (plus or minus). */
const LOUDNESS_DB = 6;
/** A section with no vocals is a solo when it is at least this many times as loud as the average section. */
const SOLO_ENERGY = 1.1;
/** A vocal section that is not a repeat is named a chorus when its vocals are at least this share of the choruses' vocal level. */
const CHORUS_SHARE = 0.9;

/** A span of units, `from` inclusive and `to` exclusive. */
interface Span {
  from: number;
  to: number;
}

interface SpanInfo extends Span {
  vector: number[];
  energy: number;
  /** The mean vocal level of the span, or its mix level when the song has no vocals stem. The chorus is the loudest in vocals. */
  vocalEnergy: number;
  /** The mean drums and bass levels of the span, when the song has those stems. */
  drumEnergy?: number;
  bassEnergy?: number;
  vocals: boolean;
  kind: number;
}

/** The unit spans cut at the given times. `cuts` are sorted, and the song starts at `start` and ends at `end`. */
export function spansBetween(cuts: readonly number[], start: number, end: number): Array<{ start: number; end: number }> {
  const edges = [start, ...cuts.filter((t) => t > start && t < end), end];
  return edges.slice(1).map((edge, i) => ({ start: edges[i], end: edge }));
}

/**
 * The bar lines of a song, as the unit spans of one bar each: a bar starts at every `beatsPerBar`th beat from the first downbeat. The
 * song starts at 0, so a pickup before the first downbeat is a unit of its own. Returns null when the grid has too few beats to bar.
 */
export function barUnitSpans(
  beats: readonly number[],
  downbeat: number,
  beatsPerBar: number,
  duration: number,
  barStarts?: readonly number[],
): Array<{ start: number; end: number }> | null {
  if (!(beatsPerBar >= 1) || beats.length < beatsPerBar) return null;
  const first = ((downbeat % beatsPerBar) + beatsPerBar) % beatsPerBar;
  // The grid's own bar starts when its bar lines move, else every `beatsPerBar`th beat.
  const starts: number[] = [];
  if (barStarts && barStarts.length) starts.push(...barStarts.filter((beat) => beat < beats.length));
  else for (let i = first; i < beats.length; i += beatsPerBar) starts.push(i);
  const lines = starts.map((beat) => beats[beat]).filter((time) => time > 0 && time < duration);
  // The beat tracker can stop before the song does, where the drums stop (an outro). Bars carry on there at the last bar's length, so
  // the end of the song is bars like the rest and not one long unit.
  if (lines.length >= 2) {
    const length = lines[lines.length - 1] - lines[lines.length - 2];
    for (let t = lines[lines.length - 1] + length; length > 0 && t < duration - length / 2; t += length) lines.push(t);
  }
  return spansBetween(lines, 0, duration);
}

/** Fixed frames of `TIME_FRAME_S` seconds, for a song with no beat grid. */
export function timeUnitSpans(duration: number): Array<{ start: number; end: number }> {
  const cuts: number[] = [];
  for (let t = TIME_FRAME_S; t < duration; t += TIME_FRAME_S) cuts.push(t);
  return spansBetween(cuts, 0, duration);
}

/** The cosine of the angle between two vectors, from -1 to 1. A zero vector matches nothing. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

/**
 * The feature vector of every unit. The chroma of each unit is centred on the song's average chroma, so a chord that the whole song
 * shares does not hide a change of chord. Loudness is in decibels from the song's median, so a chorus a few decibels louder than the
 * verses is a clear difference (a compressed mix barely moves the linear level). The vocal flag is a signed value, so vocals against no
 * vocals is a full step.
 */
function featureVectors(units: readonly SectionUnit[]): number[][] {
  const unitChroma = units.map((unit) => {
    const norm = Math.hypot(...unit.chroma) || 1;
    return unit.chroma.map((value) => value / norm);
  });
  const centre = new Array<number>(12).fill(0);
  unitChroma.forEach((chroma) => chroma.forEach((value, k) => (centre[k] += value / units.length)));
  const median = medianOf(units.map((unit) => decibels(unit.energy)));
  const drums = stemFeature(units, (unit) => unit.drumEnergy);
  const bass = stemFeature(units, (unit) => unit.bassEnergy);
  return units.map((unit, i) => [
    ...unitChroma[i].map((value, k) => value - centre[k]),
    ENERGY_WEIGHT * Math.max(-1, Math.min(1, (decibels(unit.energy) - median) / LOUDNESS_DB)),
    unit.vocals ? VOCAL_WEIGHT : -VOCAL_WEIGHT,
    drums[i],
    bass[i],
  ]);
}

/** The middle value of a list, in order. Zero for an empty list. */
function medianOf(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** One stem's level per unit, as a signed feature: its decibels from the song's median, clamped. Zero where the song has no such stem. */
function stemFeature(units: readonly SectionUnit[], level: (unit: SectionUnit) => number | undefined): number[] {
  const present = units.some((unit) => level(unit) !== undefined);
  if (!present) return units.map(() => 0);
  const median = medianOf(units.map((unit) => decibels(level(unit) ?? 0)));
  return units.map((unit) => STEM_WEIGHT * Math.max(-1, Math.min(1, (decibels(level(unit) ?? 0) - median) / LOUDNESS_DB)));
}

/** The level in decibels, with silence at a floor of −120 dB. */
function decibels(linear: number): number {
  return linear > 0 ? Math.max(-120, 20 * Math.log10(linear)) : -120;
}

/**
 * The checkerboard novelty of each unit boundary: how much the music before the boundary differs from the music after it. A boundary
 * between two sections that each repeat their own material scores high; a boundary inside a section scores near zero. Entry `i` is the
 * boundary before unit `i`, and entry 0 is always 0.
 */
export function noveltyCurve(vectors: readonly number[][], halfKernel: number): number[] {
  const n = vectors.length;
  const novelty = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let a = -halfKernel; a < halfKernel; a++) {
      for (let b = -halfKernel; b < halfKernel; b++) {
        const p = i + a;
        const q = i + b;
        if (p < 0 || q < 0 || p >= n || q >= n) continue;
        // Same side of the boundary is positive, across it negative.
        const sign = a < 0 === b < 0 ? 1 : -1;
        sum += sign * cosine(vectors[p], vectors[q]);
        count++;
      }
    }
    novelty[i] = count ? sum / count : 0;
  }
  return novelty;
}

/**
 * The unit indices where a section starts (never 0 and never the end). A boundary is a local peak of the novelty curve that is at
 * least `PEAK_SHARE` of the strongest peak. Peaks are taken strongest first; one closer than `minUnits` to a kept boundary, or to either
 * end of the song, is dropped. Peaks on a multiple of `snap` are preferred. At most `MAX_SECTIONS − 1` boundaries are kept.
 */
export function pickBoundaries(novelty: readonly number[], options: DetectOptions): number[] {
  const n = novelty.length;
  // The strongest peak is taken among the places a boundary may go. A peak at the song's first or last unit is an edge effect of the
  // kernel, and would otherwise hide the real boundaries.
  let strongest = 0;
  for (let i = options.minUnits; i < n - options.minUnits; i++) strongest = Math.max(strongest, novelty[i]);
  const candidates: Array<{ at: number; score: number }> = [];
  for (let i = 1; i < n - 1; i++) {
    const peak = novelty[i] >= novelty[i - 1] && novelty[i] > novelty[i + 1];
    if (!peak || novelty[i] < PEAK_SHARE * strongest || novelty[i] <= 0) continue;
    if (i < options.minUnits || n - i < options.minUnits) continue;
    const onGrid = i % options.snap === 0;
    candidates.push({ at: i, score: onGrid ? novelty[i] : novelty[i] * OFF_GRID_WEIGHT });
  }
  candidates.sort((a, b) => b.score - a.score);
  const kept: number[] = [];
  for (const { at } of candidates) {
    if (kept.length >= MAX_SECTIONS - 1) break;
    if (kept.every((other) => Math.abs(other - at) >= options.minUnits)) kept.push(at);
  }
  return kept.sort((a, b) => a - b);
}

/** Turns cut positions (unit indices) into the spans between them, covering all `count` units. */
function spansFromCuts(cuts: readonly number[], count: number): Span[] {
  const edges = [0, ...cuts, count];
  return edges.slice(1).map((to, i) => ({ from: edges[i], to }));
}

/** Averages the feature vectors of a span, and reads how loud it is, whether it has vocals, and how it compares to the rest. */
function summarise(span: Span, units: readonly SectionUnit[], vectors: readonly number[][]): Omit<SpanInfo, "kind"> {
  const width = span.to - span.from;
  const vector = new Array<number>(vectors[0].length).fill(0);
  let energy = 0;
  let vocalEnergy = 0;
  let drumEnergy = 0;
  let bassEnergy = 0;
  let vocalUnits = 0;
  for (let i = span.from; i < span.to; i++) {
    vectors[i].forEach((value, k) => (vector[k] += value / width));
    energy += units[i].energy / width;
    vocalEnergy += (units[i].vocalEnergy ?? units[i].energy) / width;
    drumEnergy += (units[i].drumEnergy ?? 0) / width;
    bassEnergy += (units[i].bassEnergy ?? 0) / width;
    if (units[i].vocals) vocalUnits++;
  }
  const stems = units.slice(span.from, span.to);
  return {
    ...span,
    vector,
    energy,
    vocalEnergy,
    drumEnergy: stems.some((unit) => unit.drumEnergy !== undefined) ? drumEnergy : undefined,
    bassEnergy: stems.some((unit) => unit.bassEnergy !== undefined) ? bassEnergy : undefined,
    vocals: vocalUnits * 2 > width,
  };
}

/**
 * Groups the spans into kinds of section: a span joins the first kind whose first member it matches at `SAME_KIND`, and starts a new
 * kind otherwise. Sets each span's `kind` to its kind's index.
 */
function assignKinds(infos: Array<Omit<SpanInfo, "kind">>): SpanInfo[] {
  const heads: number[][] = [];
  return infos.map((info) => {
    const found = heads.findIndex((head) => cosine(head, info.vector) >= SAME_KIND);
    if (found >= 0) return { ...info, kind: found };
    heads.push(info.vector);
    return { ...info, kind: heads.length - 1 };
  });
}

/**
 * Names each span by its role. The first span is an Intro when it has no vocals and vocals come later; the last is an Outro in the
 * same way. Among repeated vocal kinds, the loudest is the Chorus, the next loudest is a Verse, and any other vocal span is a Bridge when
 * a Chorus exists, else a Verse. A span with no vocals and above-average loudness is a
 * Solo. Everything else is a Section. Names that occur more than once are numbered in song order: Verse 1, Verse 2.
 */
export function nameSections(infos: readonly SpanInfo[]): string[] {
  const drumsMedian = medianOf(infos.flatMap((info) => (info.drumEnergy === undefined ? [] : [decibels(info.drumEnergy)])));
  const bassMedian = medianOf(infos.flatMap((info) => (info.bassEnergy === undefined ? [] : [decibels(info.bassEnergy)])));
  const drumsOff = (info: SpanInfo) => info.drumEnergy !== undefined && decibels(info.drumEnergy) < drumsMedian - STEM_OFF_DB;
  const bassOff = (info: SpanInfo) => info.bassEnergy !== undefined && decibels(info.bassEnergy) < bassMedian - STEM_OFF_DB;
  const repeats = new Map<number, { count: number; vocalEnergy: number }>();
  for (const info of infos) {
    const seen = repeats.get(info.kind) ?? { count: 0, vocalEnergy: 0 };
    repeats.set(info.kind, { count: seen.count + 1, vocalEnergy: seen.vocalEnergy + info.vocalEnergy });
  }
  const repeated = [...repeats.entries()]
    .filter(([kind, stats]) => stats.count >= 2 && infos.some((info) => info.kind === kind && info.vocals))
    .sort(([, a], [, b]) => b.vocalEnergy / b.count - a.vocalEnergy / a.count || b.count - a.count)
    .map(([kind]) => kind);
  const chorus = repeated[0];
  const verse = repeated[1];
  const averageEnergy = infos.reduce((sum, info) => sum + info.energy, 0) / infos.length;
  const chorusSpans = infos.filter((info) => info.kind === chorus);
  const chorusVocalEnergy = chorusSpans.reduce((sum, info) => sum + info.vocalEnergy, 0) / Math.max(1, chorusSpans.length);
  const names = infos.map((info, i) => {
    const before = infos.slice(0, i);
    const last = i === infos.length - 1;
    if (i === 0 && !info.vocals && infos.slice(1).some((other) => other.vocals)) return "Intro";
    if (last && ((!info.vocals && before.some((other) => other.vocals)) || (drumsOff(info) && before.some((other) => !drumsOff(other))))) return "Outro";
    // A middle section where the bass drops out is a bridge or breakdown, whether or not the singer goes on over it.
    if (i > 0 && !last && bassOff(info)) return "Bridge";
    if (info.vocals) {
      if (info.kind === chorus) return "Chorus";
      if (info.kind === verse) return "Verse";
      // A vocal section that is not a repeat: as loud as the choruses, it is a chorus with other chords (a last chorus often changes);
      // quieter, it is a bridge.
      if (chorus !== undefined && info.vocalEnergy >= CHORUS_SHARE * chorusVocalEnergy) return "Chorus";
      return chorus === undefined ? "Verse" : "Bridge";
    }
    if (info.energy > SOLO_ENERGY * averageEnergy) return "Solo";
    return "Section";
  });
  return numberRepeats(names);
}

/** Numbers each name that occurs more than once, in song order: Verse 1, Verse 2. A name that occurs once is left alone. */
function numberRepeats(names: readonly string[]): string[] {
  const total = new Map<string, number>();
  for (const name of names) total.set(name, (total.get(name) ?? 0) + 1);
  const seen = new Map<string, number>();
  return names.map((name) => {
    if ((total.get(name) ?? 0) < 2) return name;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return `${name} ${n}`;
  });
}

/**
 * Suggests the sections of a song from its units, in song order. Returns nothing for a song too short to hold two sections. The result
 * covers the whole song, from the first unit's start to the last unit's end, with no gaps.
 */
export function detectSections(units: readonly SectionUnit[], options: DetectOptions): DetectedSection[] {
  if (units.length < 2 * options.minUnits) return [];
  const vectors = featureVectors(units);
  const cuts = pickBoundaries(noveltyCurve(vectors, options.halfKernel), options);
  const infos = assignKinds(spansFromCuts(cuts, units.length).map((span) => summarise(span, units, vectors)));
  const names = nameSections(infos);
  const band = bandActivity(infos);
  return infos.map((info, i) => ({ start: units[info.from].start, end: units[info.to - 1].end, name: names[i], ...band[i] }));
}

/**
 * What the song's own band does in each span: whether the drums or the bass stop (more than STEM_OFF_DB under the song's middle span),
 * and how loud the span is against the middle span. The generated parts follow it where the performer has not chosen otherwise.
 */
function bandActivity(infos: readonly SpanInfo[]): Array<Pick<DetectedSection, "drumsOff" | "bassOff" | "levelDb">> {
  const drumsMedian = medianOf(infos.flatMap((info) => (info.drumEnergy === undefined ? [] : [decibels(info.drumEnergy)])));
  const bassMedian = medianOf(infos.flatMap((info) => (info.bassEnergy === undefined ? [] : [decibels(info.bassEnergy)])));
  const levelMedian = medianOf(infos.map((info) => decibels(info.energy)));
  return infos.map((info) => ({
    ...(info.drumEnergy === undefined ? {} : { drumsOff: decibels(info.drumEnergy) < drumsMedian - STEM_OFF_DB }),
    ...(info.bassEnergy === undefined ? {} : { bassOff: decibels(info.bassEnergy) < bassMedian - STEM_OFF_DB }),
    levelDb: Math.round((decibels(info.energy) - levelMedian) * 10) / 10,
  }));
}

/**
 * The sections a song gets from a detection. Each one is a new section with its stored mode set to continue, marked as detected. `newId`
 * gives each section its id; the default is a fresh random id.
 */
export function sectionsFromDetected(detected: readonly DetectedSection[], newId: () => string = () => crypto.randomUUID()): Section[] {
  return detected.map((section) => ({ id: newId(), name: section.name, start: section.start, end: section.end, mode: "continue", source: "detected" }));
}

/**
 * What a finished detection does to a song's sections. A song with no sections takes the detected ones. A song that already has sections
 * keeps them, and this returns null: the performer replaces them from the section editor, where Undo is offered.
 */
export function sectionsToApply(current: readonly Section[], detected: readonly DetectedSection[] | undefined, newId?: () => string): Section[] | null {
  if (current.length || !detected?.length) return null;
  return sectionsFromDetected(detected, newId);
}

/**
 * Whether the song's sections are still the ones detection suggested last time, untouched by hand. Only those may be replaced by a new
 * detection. A name, a boundary, a mode or a colour the performer changed, or a section added or removed, keeps them as they are.
 */
export function sectionsFollowDetection(current: readonly Section[], previous: readonly DetectedSection[]): boolean {
  return (
    current.length > 0 &&
    current.length === previous.length &&
    current.every((section, i) => {
      const was = previous[i];
      const untouched = section.mode === "continue" && section.color === undefined;
      return section.source === "detected" && untouched && section.name === was.name && section.start === was.start && section.end === was.end;
    })
  );
}

/**
 * How many of the `truth` boundaries have a `found` boundary within `tolerance` seconds. Each found boundary counts for at most one truth
 * boundary. Used to measure the detector on fixtures with known boundaries.
 */
export function boundaryHits(found: readonly number[], truth: readonly number[], tolerance: number): number {
  const free = [...found];
  let hits = 0;
  for (const t of truth) {
    const near = free.findIndex((f) => Math.abs(f - t) <= tolerance);
    if (near >= 0) {
      hits++;
      free.splice(near, 1);
    }
  }
  return hits;
}
