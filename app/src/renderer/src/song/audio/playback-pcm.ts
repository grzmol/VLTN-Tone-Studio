import type { PcmAudio } from "../types";
import type { HeldTrack } from "./memory-estimate";

// A store-owned track can use its playback buffer as the canonical sample storage. Keep the PCM object's identity: library saves,
// analysis and preparation history use it as a weak key. The weak map does not keep a song alive after its owners release it.
const buffers = new WeakMap<PcmAudio, AudioBuffer>();

/** An already filled playback buffer for this exact PCM object, when its sample rate still matches. */
export function sharedPlaybackBuffer(audio: PcmAudio): AudioBuffer | undefined {
  const buffer = buffers.get(audio);
  return buffer?.sampleRate === audio.sampleRate ? buffer : undefined;
}

/**
 * Adopts a fully filled buffer for store-owned audio. Readers still get normal channel arrays, on demand, without a permanent decoded
 * copy beside the playback buffer. Do not retain getChannelData views here: Web Audio may detach them when a source acquires its data.
 * Replacing channels explicitly returns the PCM to ordinary ownership. Callers must not transfer borrowed channels to a worker.
 */
export function sharePlaybackPcm(audio: PcmAudio, buffer: AudioBuffer): void {
  const descriptor = Object.getOwnPropertyDescriptor(audio, "channels");
  if (!descriptor?.configurable) return;
  Object.defineProperty(audio, "channels", {
    configurable: true,
    enumerable: true,
    get: () => Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel)),
    set: (channels: Float32Array[]) => {
      buffers.delete(audio);
      Object.defineProperty(audio, "channels", { value: channels, writable: true, configurable: true, enumerable: true });
    },
  });
  buffers.set(audio, buffer);
}

/** Measures canonical storage without requesting channel views (which could make Web Audio allocate a copy during playback). */
export function pcmMemoryShape(audio: PcmAudio): HeldTrack {
  const buffer = sharedPlaybackBuffer(audio);
  if (buffer) return { channels: buffer.numberOfChannels, frames: buffer.length, key: buffer };
  const channels = audio.channels;
  return { channels: channels.length, frames: channels[0]?.length ?? 0, key: channels[0] };
}
