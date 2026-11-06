import type { PcmAudio } from "../types";

// Lengths and mixes for imported tracks (pure). Every track of a song must have the same number of frames, so a track is padded with
// silence or cut to the song's length. A song made of imported tracks alone gets a source: the sum of its tracks, which the analysis
// reads as the song. The import worker runs these, so a long song is not copied and summed on the renderer's thread.

/** `channels` at exactly `frames` frames: padded with silence at the end, or cut. The same arrays come back when nothing changes. */
export function alignChannels(channels: Float32Array[], frames: number): Float32Array[] {
  return channels.map((channel) => {
    if (channel.length === frames) return channel;
    const out = new Float32Array(frames);
    out.set(channel.subarray(0, Math.min(frames, channel.length)));
    return out;
  });
}

/** Stereo from any channel count: mono is copied to the right channel, and more than two keep the first two. */
export function stereoOf(channels: Float32Array[]): Float32Array[] {
  if (channels.length === 0) throw new Error("This file has no audio channels.");
  return channels.length === 1 ? [channels[0], channels[0].slice()] : [channels[0], channels[1]];
}

/**
 * The sum of stereo tracks, all of `frames` frames. The sum is not scaled: a mix of loud tracks may clip, which only the analysis
 * sees, since the song itself plays each track on its own.
 */
export function mixDown(tracks: Float32Array[][], frames: number): Float32Array[] {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (const track of tracks) {
    const [l, r] = stereoOf(alignChannels(track, frames));
    for (let i = 0; i < frames; i++) {
      left[i] += l[i];
      right[i] += r[i];
    }
  }
  return [left, right];
}

/** The PCM of a track, stereo, at `frames` frames. */
export function alignPcm(pcm: PcmAudio, frames: number): PcmAudio {
  return { sampleRate: pcm.sampleRate, channels: stereoOf(alignChannels(pcm.channels, frames)) };
}
