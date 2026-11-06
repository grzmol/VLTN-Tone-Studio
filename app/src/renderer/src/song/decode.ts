import type { PcmAudio } from "./types";

/** The separation rate: Demucs models work on 44.1 kHz stereo. */
export const SONG_RATE = 44100;
/** Longest song we split: ten minutes of stems take about 1.3 GB of memory. */
export const MAX_SONG_SECONDS = 10 * 60;

const AUDIO_EXTENSIONS = ["wav", "mp3", "flac", "m4a", "aac", "ogg", "oga", "opus", "webm"];
export const AUDIO_ACCEPT = AUDIO_EXTENSIONS.map((e) => `.${e}`).join(",");

export const isAudioFileName = (name: string) => AUDIO_EXTENSIONS.includes(/\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "");

/** Stereo from any channel count: mono is doubled, more than two channels keep the first two (front L/R). */
export function toStereo(channels: Float32Array[]): Float32Array[] {
  if (channels.length === 0) throw new Error("This file has no audio channels.");
  return channels.length === 1 ? [channels[0], channels[0].slice()] : [channels[0], channels[1]];
}

/** Decode an audio file with the browser's decoders, resampled to 44.1 kHz stereo. */
export async function decodeSong(file: File): Promise<PcmAudio> {
  return decodeAudioFile(file, MAX_SONG_SECONDS);
}

/**
 * Decodes an audio file to 44.1 kHz stereo. The browser's decoder resamples it on its own thread. A file longer than `maxSeconds` is
 * refused, so one file cannot take the renderer's memory.
 */
export async function decodeAudioFile(file: File, maxSeconds: number): Promise<PcmAudio> {
  const bytes = await file.arrayBuffer();
  // decodeAudioData resamples to its context's rate.
  const ctx = new OfflineAudioContext(2, 1, SONG_RATE);
  let buffer: AudioBuffer;
  try {
    buffer = await ctx.decodeAudioData(bytes);
  } catch {
    throw new Error(`Couldn't read ${file.name}. Use a WAV, MP3, FLAC, M4A or OGG file.`);
  }
  if (buffer.duration > maxSeconds) throw new Error(`${file.name} is longer than ${Math.round(maxSeconds / 60)} minutes. Trim it and try again.`);
  if (buffer.length === 0) throw new Error(`${file.name} has no audio.`);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice());
  return { sampleRate: SONG_RATE, channels: toStereo(channels) };
}
