// Builds what the band worker needs from the song: the beat sources, the harmony and plans, and the preview mix. Pure: the Band panel
// passes in the song's values and the sample URLs, and gets back plain data.

import type { Cue } from "../performance/chart";
import type { Chord } from "../performance/chords";
import type { Section } from "../performance/sections";
import type { PcmAudio, Stems } from "../types";
import { planSections, type BandSettings, type SectionBandHint } from "./arrangement";
import type { BandFollow, BandRequest, BandResult } from "./band-job";
import type { BassLineBeat } from "../analysis/bass-line";
import type { BeatGrid } from "./beat-grid";
import { FOLLOW_STEMS, resolveFollowSource } from "./feel";
import { chartChordEvents, harmonyForSong, type ChordAtBeat } from "./harmony";

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
  /** The song's length in samples. The parts are rendered to exactly this length. */
  lengthFrames: number;
  sampleUrls: Record<string, string>;
  /** The follow-my-playing audio, from followFor. Absent when the setting is off. */
  follow?: BandFollow;
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

/** The request for the whole song: the harmony snapped to the grid, the plans from the sections, and the settings' seed. */
export function bandRequest(input: BandInputs): BandRequest {
  const harmony = bandHarmony(input);
  const request: BandRequest = {
    grid: input.grid,
    harmony,
    plans: planSections(input.sections, input.songEnd, input.settings, input.hints ?? []),
    settings: input.settings,
    seed: input.settings.seed,
    lengthFrames: input.lengthFrames,
    parts: { ...input.settings.parts },
    sampleUrls: input.sampleUrls,
  };
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
