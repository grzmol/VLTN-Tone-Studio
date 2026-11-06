import { flacName, USER_TRACKS_MAX, userFileName, type TrackKind } from "@shared/song-library";
import { decodeAudioFile, isAudioFileName, SONG_RATE } from "../decode";
import type { PcmAudio } from "../types";
import { defaultBus, LENGTH_REJECT_S, lengthVerdict, medianSeconds, parseTrackName, type TrackNameOptions } from "../tracks";
import type { BusName } from "../audio/outputs";
import { alignInWorker } from "./align-client";

// Imports the user's own audio files as tracks of a song (pure orchestration; the decoder and the worker are passed in). Each file is
// decoded one at a time, checked against the song's length, then aligned to one frame count in a worker. Refused files and padded
// tracks are reported as notices, so a song that imports partly still says what it left out.

/** The longest file a track may be. Longer than this and the file is refused, so one file cannot take the renderer's memory. */
export const MAX_IMPORT_SECONDS = 15 * 60;
/** The largest file that is read at all */
export const MAX_IMPORT_FILE_BYTES = 300 * 1024 * 1024;
/** Decoded audio held at once across one import. Past this, the next file is refused. */
export const MAX_IMPORT_BYTES = 1024 * 1024 * 1024;

export interface ImportedTrack {
  /** The track's key: its stored file name without the extension, `track0` to `track31` */
  key: string;
  file: string;
  kind: Extract<TrackKind, "user">;
  name: string;
  bus: BusName;
  color?: string;
  gain?: number;
  pan?: number;
  transpose?: boolean;
  muteGroups?: number[];
  pcm: PcmAudio;
}

export interface ImportOutcome {
  tracks: ImportedTrack[];
  /** Set when the song has no source yet: the sum of the imported tracks, which the analysis reads as the song */
  source: PcmAudio | null;
  /** What was refused, padded or cut, one line each */
  notices: string[];
}

export interface ImportOptions {
  /** Keys the song already uses, so new tracks take free track numbers */
  taken: readonly string[];
  /** The song's length in frames at the session rate, or null when the song has no source */
  reference: number | null;
  decode?: (file: File) => Promise<PcmAudio>;
  align?: typeof alignInWorker;
}

/** The first free track key, `track0` to `track31`, that is not in `taken`. */
export function freeTrackKeys(taken: readonly string[], count: number): string[] {
  const used = new Set(taken);
  const free: string[] = [];
  for (let i = 0; i < USER_TRACKS_MAX && free.length < count; i++) {
    const key = userFileName(i).replace(/\.flac$/, "");
    if (!used.has(key)) free.push(key);
  }
  return free;
}

/** The settings a track starts with: its file name's options, and a click on the click bus, not stretched. */
function trackSettings(options: TrackNameOptions) {
  const bus = options.bus ?? defaultBus(options.name);
  const transpose = options.transpose ?? (bus === "click" ? false : undefined);
  return {
    name: options.name,
    bus,
    color: options.color,
    gain: options.gain,
    pan: options.pan,
    transpose,
    muteGroups: options.muteGroups,
  };
}

/** What happened to a track that is a few seconds away from the song's length. Without a song, the longest track sets the length. */
function paddingNotice(name: string, difference: number, hasSong: boolean): string {
  const gap = Math.abs(difference).toFixed(1);
  if (difference < 0) return `${name} is ${gap} s shorter than the song. It was padded with silence.`;
  if (hasSong) return `${name} is ${gap} s longer than the song. It was cut to the song's length.`;
  return `${name} is ${gap} s longer than the rest. The shorter tracks were padded with silence to match it.`;
}

interface Decoded {
  file: File;
  options: TrackNameOptions;
  pcm: PcmAudio;
  frames: number;
}

/** Imports `files` as tracks. Throws only when nothing can be imported at all; a file that fails is a notice. */
export async function importTracks(files: File[], options: ImportOptions): Promise<ImportOutcome> {
  const decode = options.decode ?? ((file: File) => decodeAudioFile(file, MAX_IMPORT_SECONDS));
  const align = options.align ?? alignInWorker;
  const notices: string[] = [];
  const taken = options.taken.filter((key) => key.startsWith("track")).length;
  if (taken + files.length > USER_TRACKS_MAX) throw new Error(`A song can hold up to ${USER_TRACKS_MAX} imported tracks.`);

  const decoded: Decoded[] = [];
  let bytes = 0;
  for (const file of files) {
    if (!isAudioFileName(file.name)) {
      notices.push(`${file.name} is not a supported audio file, so it was not imported.`);
      continue;
    }
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      notices.push(`${file.name} is larger than ${MAX_IMPORT_FILE_BYTES / (1024 * 1024)} MB, so it was not imported.`);
      continue;
    }
    let pcm: PcmAudio;
    try {
      pcm = await decode(file);
    } catch (error) {
      notices.push(error instanceof Error ? error.message : `Couldn't read ${file.name}.`);
      continue;
    }
    const size = pcm.channels.length * pcm.channels[0].length * 4;
    if (bytes + size > MAX_IMPORT_BYTES) {
      notices.push(`${file.name} would take this import past ${MAX_IMPORT_BYTES / (1024 * 1024 * 1024)} GB of memory, so it was not imported.`);
      continue;
    }
    bytes += size;
    decoded.push({ file, options: parseTrackName(file.name), pcm, frames: pcm.channels[0].length });
  }
  if (!decoded.length) return { tracks: [], source: null, notices };

  const referenceSeconds = options.reference === null ? medianSeconds(decoded.map((d) => d.frames / SONG_RATE)) : options.reference / SONG_RATE;
  const kept: Decoded[] = [];
  for (const item of decoded) {
    const seconds = item.frames / SONG_RATE;
    const verdict = lengthVerdict(seconds, referenceSeconds);
    const gap = Math.abs(seconds - referenceSeconds);
    if (verdict === "reject") {
      notices.push(`${item.options.name} is ${Math.round(gap)} s away from the song's length (over ${LENGTH_REJECT_S} s), so it was not imported.`);
      continue;
    }
    if (verdict === "pad") notices.push(paddingNotice(item.options.name, seconds - referenceSeconds, options.reference !== null));
    kept.push(item);
  }
  if (!kept.length) return { tracks: [], source: null, notices };

  const frames = options.reference ?? Math.max(...kept.map((d) => d.frames));
  const keys = freeTrackKeys(options.taken, kept.length);
  if (keys.length < kept.length) throw new Error(`A song can hold up to ${USER_TRACKS_MAX} imported tracks.`);
  const aligned = await align({
    frames,
    mix: options.reference === null,
    tracks: kept.map((item, i) => ({ key: keys[i], channels: item.pcm.channels })),
  });
  const tracks: ImportedTrack[] = kept.map((item, i) => {
    const key = keys[i];
    const { channels } = aligned.tracks[i];
    return { key, file: flacName(key), kind: "user", ...trackSettings(item.options), pcm: { sampleRate: SONG_RATE, channels } };
  });
  const source = aligned.mix ? { sampleRate: SONG_RATE, channels: aligned.mix } : null;
  return { tracks, source, notices };
}
