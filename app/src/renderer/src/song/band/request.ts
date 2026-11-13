// Builds what the band worker needs from the song: the beat sources, the harmony and plans, and the preview mix. Pure: the Band panel
// passes in the song's values and the sample URLs, and gets back plain data.

import type { Cue } from "../performance/chart";
import type { Chord } from "../performance/chords";
import type { Section } from "../performance/sections";
import type { PcmAudio, Stems } from "../types";
import { WHOLE_SONG_ID, planSections, type BandSettings, type SectionBandHint, type SectionPlan } from "./arrangement";
import type { BandFollow, BandRequest, BandResult } from "./band-job";
import type { BassLineBeat } from "../analysis/bass-line";
import { parseKey } from "../analysis/chord-hmm";
import { parseAnalysis } from "../analysis/song-analysis";
import { bassRangeFor } from "./bass";
import type { BandKey } from "./bass-phrases";
import type { BeatGrid } from "./beat-grid";
import { FOLLOW_STEMS, resolveFollowSource } from "./feel";
import { chartChordEvents, harmonyForSong, type ChordAtBeat } from "./harmony";
import { findStyle } from "./styles";
import { barBeats, barStarts } from "./timing";
import { KEY_NAMES } from "../performance/key";

/**
 * The audio the beat tracker reads. The drums stem when there is one. Otherwise the pitched stems (everything but drums and vocals,
 * since voices smear the onsets), and otherwise the song's own mix.
 */
export function beatSources(stems: Stems | null, mix: PcmAudio): PcmAudio[] {
  if (stems?.drums) return [stems.drums];
  const pitched = Object.entries(stems ?? {})
    .filter((entry): entry is [string, PcmAudio] => entry[1] !== undefined && entry[0] !== "drums" && entry[0] !== "vocals")
    .map(([, audio]) => audio);
  return pitched.length ? pitched : [mix];
}

/** Adds the audio sources together, sample for sample, padding the shorter ones with silence. */
export function sumAudio(sources: readonly PcmAudio[]): PcmAudio {
  const channels = Math.max(...sources.map((source) => source.channels.length));
  const length = Math.max(...sources.map((source) => source.channels[0]?.length ?? 0));
  const out = Array.from({ length: channels }, () => new Float32Array(length));
  for (const source of sources) {
    source.channels.forEach((channel, c) => {
      for (let i = 0; i < channel.length; i++) out[c][i] += channel[i];
    });
  }
  return { sampleRate: sources[0].sampleRate, channels: out };
}

/** The chord change times the chart gives, in song seconds. Used to pick the bar phase when the beat is found. */
export function chartChordTimes(cues: readonly Cue[]): number[] {
  return chartChordEvents(cues).map((event) => event.time);
}

export interface BandInputs {
  grid: BeatGrid;
  cues: readonly Cue[];
  chords: readonly Chord[];
  sections: readonly Section[];
  settings: BandSettings;
  /** The song's length in seconds, at the song's own rate. */
  songEnd: number;
  /** The song's trim end in seconds, when it has one. The parts end there: the ending goes on the last full bar before it. */
  trimEnd?: number;
  /** The song's length in samples. The parts are rendered to exactly this length. */
  lengthFrames: number;
  sampleUrls: Record<string, string>;
  /** The follow-my-playing audio, from followFor. Absent when the setting is off. */
  follow?: BandFollow;
  /** The song's key as a name such as "A major": the performer's override, else a strong estimate (keysFromOptions). Unknown when absent. */
  songKey?: string;
  /** Spans of the song in another key than `songKey`, in seconds, with the key as a name. */
  keySections?: readonly { start: number; end: number; key: string }[];
  /** The bass note the song's bass stem plays on each beat (analysis/bass-line.ts), when the song has a bass stem and it was read. */
  bassLine?: readonly BassLineBeat[] | null;
  /** What the song's own band does in each detected section (where its drums or bass stop, and how loud), as defaults for the plans. */
  hints?: readonly SectionBandHint[];
  /** The song's source mix. The beat levels read it, and the generated parts are levelled to its loudness (level.ts). */
  mix?: PcmAudio;
  /** The split's original drums and bass, from levelStems. Absent when the song has no split. */
  originals?: LevelStems;
}

/** The original drums and bass stems a generated part is levelled against. */
export type LevelStems = NonNullable<BandRequest["originals"]>;

/** The original drums and bass of the split, when there is one. The other stems are not used for levels. */
export function levelStems(stems: Stems | null): LevelStems {
  return { drums: stems?.drums, bass: stems?.bass };
}

/** The follow sources the song has: the stems among FOLLOW_STEMS that were split, then the mix, which is always there. */
export function followSourcesIn(stems: Stems | null): string[] {
  return [...FOLLOW_STEMS.filter((name) => stems?.[name] !== undefined), "mix"];
}

/**
 * The audio follow-my-playing reads for these settings, or undefined when it is off. The source is the stem the choice names, or the one
 * auto picks; the mix stands in when no stem is there.
 */
export function followFor(settings: BandSettings, stems: Stems | null, mix: PcmAudio): BandFollow | undefined {
  if (!settings.followPlaying) return undefined;
  const source = resolveFollowSource(settings.followSource, followSourcesIn(stems));
  return { source, audio: (source !== "mix" ? stems?.[source] : undefined) ?? mix };
}

/**
 * The harmony the bass is written from: the chord on each beat, with the bass note the song's bassist played where the settings take the
 * original bass and the song has a reading for it (spec 86). The Band panel shows this same harmony, so the strip matches the bass.
 */
export function bandHarmony(input: Pick<BandInputs, "grid" | "cues" | "chords" | "songEnd" | "settings" | "bassLine">): ChordAtBeat[] {
  const original = input.settings.bassFrom === "original" ? (input.bassLine ?? null) : null;
  return harmonyForSong(input.grid, [...input.cues], [...input.chords], input.songEnd, original, input.settings.bassOverrides);
}

/**
 * The song's keys for the bass, in song seconds. The song's key covers the song, and each section in another key covers its own span.
 * Where no key is known the span has no entry, and with none known at all the list is empty.
 */
export function bandKeys(songKey: string | undefined, keySections: BandInputs["keySections"], songEnd: number): BandKey[] {
  const song = parseKey(songKey);
  const own = (keySections ?? [])
    .flatMap((span): BandKey[] => {
      const key = parseKey(span.key);
      return key && span.end > span.start ? [{ start: Math.max(0, span.start), end: Math.min(songEnd, span.end), ...key }] : [];
    })
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);
  const keys: BandKey[] = [];
  let at = 0;
  for (const span of own) {
    if (span.start < at) continue;
    if (song && span.start > at) keys.push({ start: at, end: span.start, ...song });
    keys.push(span);
    at = span.end;
  }
  if (song && at < songEnd) keys.push({ start: at, end: songEnd, ...song });
  return keys;
}

/**
 * The key inputs of a song from its saved options: the performer's key override wins, then a strong estimate (the key the chord names are
 * spelled by, SongKey.tsx), and the sections of the song analysis that read as another key.
 */
export function keysFromOptions(options: Record<string, unknown>): Pick<BandInputs, "songKey" | "keySections"> {
  const override = typeof options.songKey === "string" && options.songKey ? options.songKey : undefined;
  const estimate = options.detectedKey as { name?: unknown; confidence?: unknown } | null | undefined;
  const detected = estimate?.confidence === "strong" && typeof estimate.name === "string" ? estimate.name : undefined;
  const analysis = parseAnalysis(options.analysis);
  const keySections = (analysis?.keySections ?? []).flatMap((entry) => {
    const section = analysis?.sections?.[Number(entry.sectionId)];
    return section ? [{ start: section.start, end: section.end, key: entry.key.name }] : [];
  });
  return { songKey: override ?? detected, keySections };
}

/**
 * The line the Band panel shows when the bass plans with the extended range because the song's key is low, such as "Bass range: extended
 * low, for a song in D". Null when the range is the performer's own or the key is not low.
 */
export function extendedRangeNote(request: Pick<BandRequest, "settings" | "keys">): string | null {
  const { tonic } = bassRangeFor(request.settings, request.keys);
  return tonic === null ? null : `Bass range: extended low, for a song in ${KEY_NAMES[tonic]}`;
}

/** The beat intervals the end of a grid is continued with: the median of its last few. */
const END_INTERVALS = 4;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * The grid the band plays on, continued through every section that starts after its last beat. The beat tracker stops where the drums
 * stop, so a section after that (an outro with no drums, say) would get no parts at all. Its beats carry on at the grid's last tempo, up
 * to the end of the last such section, and a bar starts where each of those sections starts. A grid whose sections all start inside it
 * is returned as it is, so a song that ends on a last hit keeps its ending.
 */
export function gridThroughSections(grid: BeatGrid, sections: readonly Section[], songEnd: number): BeatGrid {
  if (grid.beats.length < 2) return grid;
  const lastBeat = grid.beats[grid.beats.length - 1];
  const intervals = grid.beats
    .slice(-END_INTERVALS - 1)
    .map((beat, i, beats) => (i === 0 ? 0 : beat - beats[i - 1]))
    .slice(1);
  const interval = median(intervals);
  if (!(interval > 0)) return grid;
  const later = sections.filter((section) => section.start > lastBeat + interval / 2);
  if (later.length === 0) return grid;
  const end = Math.min(songEnd, Math.max(...later.map((section) => section.end)));

  const beats = [...grid.beats];
  for (let next = lastBeat + interval; next < end - interval / 100; next += interval) beats.push(next);
  if (beats.length === grid.beats.length) return grid;

  // Bars carry on from the grid's last bar, except that each later section starts a bar of its own.
  const perBar = barBeats(grid);
  const kept = barStarts(grid);
  const nearestBeat = (time: number) => beats.reduce((best, beat, i) => (Math.abs(beat - time) < Math.abs(beats[best] - time) ? i : best), 0);
  const sectionStarts = later.map((section) => nearestBeat(section.start)).sort((a, b) => a - b);
  const added: number[] = [];
  let next = (kept.length ? kept[kept.length - 1] : Math.round(grid.downbeat)) + perBar;
  for (const start of sectionStarts) {
    while (next < start) {
      added.push(next);
      next += perBar;
    }
    if (start > (added.at(-1) ?? kept.at(-1) ?? -1)) added.push(start);
    next = start + perBar;
  }
  while (next < beats.length) {
    added.push(next);
    next += perBar;
  }
  const regular = !grid.barStarts && added.every((start) => (start - Math.round(grid.downbeat)) % perBar === 0);
  return regular ? { ...grid, beats } : { ...grid, beats, barStarts: [...kept, ...added.filter((start) => start < beats.length)] };
}

/** The line the Band panel shows when a 3/4 song's plans were given the 3/4 style. */
export const THREE_FOUR_NOTE = "3/4 song: playing the 3/4 style";

/**
 * The plans of a song with three beats to the bar. A section whose style the user did not choose, and whose style has four beats,
 * plays the 3/4 style instead, so the four-beat groove is not squeezed into three beats. A section with a style of its own keeps it.
 */
export function plansForMeter(grid: BeatGrid, plans: readonly SectionPlan[], settings: BandSettings): SectionPlan[] {
  if (barBeats(grid) !== 3) return [...plans];
  return plans.map((plan) => {
    const chosen = settings.sections[plan.sectionId ?? WHOLE_SONG_ID]?.style !== undefined;
    return !chosen && findStyle(plan.style)?.meter.beatsPerBar === 4 ? { ...plan, style: "three-four" } : plan;
  });
}

/** Whether the plans play the 3/4 style where the song's own style has four beats, so the panel can say so. */
export function playsThreeFourDefault(request: BandRequest): boolean {
  return request.plans.some((plan) => plan.style === "three-four") && findStyle(request.settings.style)?.meter.beatsPerBar === 4;
}

/**
 * The request for the whole song: the harmony snapped to the grid, the plans from the sections, and the settings' seed. The grid is
 * continued through any section after its last beat (see gridThroughSections), so those sections get their parts too.
 */
export function bandRequest(input: BandInputs): BandRequest {
  const grid = gridThroughSections(input.grid, input.sections, input.songEnd);
  // The parts are planned to the trim end, so nothing is generated after the place the song is cut. The audio keeps the song's length.
  const songEnd = input.trimEnd === undefined ? input.songEnd : Math.min(input.songEnd, input.trimEnd);
  const harmony = bandHarmony({ ...input, grid, songEnd });
  const request: BandRequest = {
    grid,
    harmony,
    keys: bandKeys(input.songKey, input.keySections, songEnd),
    plans: plansForMeter(grid, planSections(input.sections, songEnd, input.settings, input.hints ?? []), input.settings),
    settings: input.settings,
    seed: input.settings.seed,
    lengthFrames: input.lengthFrames,
    parts: { ...input.settings.parts },
    sampleUrls: input.sampleUrls,
  };
  if (input.trimEnd !== undefined) request.trimEnd = input.trimEnd;
  if (input.follow) request.follow = input.follow;
  if (input.mix) request.mix = input.mix;
  if (input.originals) request.originals = input.originals;
  return request;
}

/**
 * The song from `fromTime` with the rendered parts added on top, for a listening preview. The parts share the song's rate (the song is decoded to 44.1 kHz), and
 * the window is as long as the parts. Samples past the end of the song are silence. The sum is held to −1 to 1.
 */
export function previewMix(song: PcmAudio, fromTime: number, result: BandResult): PcmAudio {
  const parts = [result.drums, result.bass].filter((part): part is PcmAudio => part !== undefined);
  const frames = parts.reduce((longest, part) => Math.max(longest, part.channels[0]?.length ?? 0), 0);
  const first = Math.max(0, Math.round(fromTime * song.sampleRate));
  const channels = song.channels.map((channel, c) => {
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const sample = channel[first + i];
      if (sample !== undefined) out[i] = sample;
    }
    for (const part of parts) {
      const source = part.channels[Math.min(c, part.channels.length - 1)];
      for (let i = 0; i < frames && i < source.length; i++) out[i] += source[i];
    }
    for (let i = 0; i < frames; i++) out[i] = Math.max(-1, Math.min(1, out[i]));
    return out;
  });
  return { sampleRate: song.sampleRate, channels };
}
