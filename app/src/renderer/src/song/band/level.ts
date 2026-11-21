// Level matching for the generated parts (spec 85, stage 1). A generated drum or bass part is set to the song's loudness rather than to
// its peak: its integrated loudness is moved to a target, and the gain is held back if that would push the peak past the ceiling. Pure:
// the band job calls these in the worker, where the loudness reads are off the window's thread.
//
// Every signal is measured the same way: its mono average (monoAverage), so the song, the original stems and the parts sit on one scale.
// The offsets between them hold, even though the absolute values differ a little from a stereo BS.1770 reading. The average is not
// scaled to a peak of 1 the way the beat tracker's monoSum is, because the level is the point here.

import { integratedLoudness } from "../audio/loudness";
import type { PcmAudio } from "../types";

/** The highest a matched part may peak, in dBFS. The same -1 dBFS ceiling the renderer uses. */
export const LEVEL_CEILING_DB = -1;
/** A generated bass sits this many LU under the song's loudness when there is no original bass stem to match. */
export const BASS_BELOW_SONG_LU = 7;
/** A generated drum part sits this many LU under the song's loudness when there is no original drums stem to match. */
export const DRUMS_BELOW_SONG_LU = 4;
/** An original stem at or below this loudness is treated as silent, so the song's loudness is used instead. */
export const STEM_SILENT_LUFS = -60;

export type LevelKind = "drums" | "bass";

/** How far under the song each generated part sits, when there is no original stem to match. */
export const BELOW_SONG_LU: Readonly<Record<LevelKind, number>> = { drums: DRUMS_BELOW_SONG_LU, bass: BASS_BELOW_SONG_LU };

/** The loudness a part is matched to, in LUFS. */
export interface LevelTarget {
  lufs: number;
}

/** The result of matching one part: the audio at its new level, the gain, and whether the ceiling held the gain back. */
export interface LevelMatch {
  audio: PcmAudio;
  /** The gain applied, in dB. */
  gainDb: number;
  /** True when the peak ceiling held the gain below what the target asked for. */
  limitedByPeak: boolean;
  /** The part's integrated loudness after the gain, in LUFS. */
  lufs: number;
}

/** What the panel shows for a part that was matched: how far under the song it sits, and whether the peak held it back. */
export interface LevelReport {
  gainDb: number;
  /** The song's loudness minus the part's loudness after the gain, in LU. */
  belowSongDb: number;
  limitedByPeak: boolean;
}

/** The parts that were matched in one render. A part that could not be measured has no entry. */
export interface PartLevels {
  drums?: LevelReport;
  bass?: LevelReport;
}

/** The mono average of a signal: its channels added and divided by their count, with the level kept (no scaling to a peak). */
export function monoAverage(audio: PcmAudio): Float32Array {
  const length = audio.channels[0]?.length ?? 0;
  const mono = new Float32Array(length);
  for (const channel of audio.channels) for (let i = 0; i < length; i++) mono[i] += channel[i] / audio.channels.length;
  return mono;
}

/** Integrated loudness of a signal, measured on its mono average. Silence, or audio too quiet to pass the gates, is -Infinity. */
export function loudnessOf(audio: PcmAudio): number {
  return integratedLoudness([monoAverage(audio)], audio.sampleRate);
}

/**
 * The loudness a part is matched to. An original stem that is above STEM_SILENT_LUFS is the target as it is. Otherwise the target is the
 * song's loudness less the kind's offset. `songLufs` is the song's loudness when the caller has already measured it.
 */
export function targetLoudness(kind: LevelKind, song: PcmAudio, originalStem?: PcmAudio, songLufs: number = loudnessOf(song)): LevelTarget {
  if (originalStem) {
    const stemLufs = loudnessOf(originalStem);
    if (stemLufs > STEM_SILENT_LUFS) return { lufs: stemLufs };
  }
  return { lufs: songLufs - BELOW_SONG_LU[kind] };
}

/** The sample peak of a part, in dBFS over every channel. */
function peakDbOf(audio: PcmAudio): number {
  let peak = 0;
  for (const channel of audio.channels) for (let i = 0; i < channel.length; i++) peak = Math.max(peak, Math.abs(channel[i]));
  return 20 * Math.log10(peak);
}

/**
 * Moves a part's integrated loudness to the target. The gain is the difference, held back when the peak would pass `ceilingDb`. A part
 * that cannot be measured (silent, or too quiet for the gates) is returned as it is, with a gain of 0.
 */
export function matchLoudness(part: PcmAudio, target: LevelTarget, ceilingDb = LEVEL_CEILING_DB): LevelMatch {
  const lufs = loudnessOf(part);
  if (!Number.isFinite(lufs) || !Number.isFinite(target.lufs)) return { audio: part, gainDb: 0, limitedByPeak: false, lufs };
  const wanted = target.lufs - lufs;
  const headroom = ceilingDb - peakDbOf(part);
  const gainDb = Math.min(wanted, headroom);
  const scale = 10 ** (gainDb / 20);
  const channels = part.channels.map((channel) => {
    const out = new Float32Array(channel.length);
    for (let i = 0; i < channel.length; i++) out[i] = channel[i] * scale;
    return out;
  });
  return { audio: { sampleRate: part.sampleRate, channels }, gainDb, limitedByPeak: wanted > headroom, lufs: lufs + gainDb };
}

/**
 * The line the Band panel shows after Generate, for the parts that were matched. Null when none was. For example "Drums set 4.0 dB under
 * the song, bass 7.2 dB under." A part held back by the peak says so.
 */
export function levelStatus(levels: PartLevels | undefined): string | null {
  if (!levels) return null;
  const named: [string, LevelReport][] = [];
  if (levels.drums) named.push(["Drums", levels.drums]);
  if (levels.bass) named.push(["Bass", levels.bass]);
  if (named.length === 0) return null;
  const phrases = named.map(([name, level], index) => {
    const amount = `${level.belowSongDb.toFixed(1)} dB under`;
    const held = level.limitedByPeak ? " (held back by the peak)" : "";
    if (index === 0) return `${name} set ${amount} the song${held}`;
    return `${name.toLowerCase()} ${amount}${held}`;
  });
  return `${phrases.join(", ")}.`;
}
