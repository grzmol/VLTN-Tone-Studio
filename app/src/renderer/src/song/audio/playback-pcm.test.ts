import { expect, it, vi } from "vitest";
import type { PcmAudio } from "../types";
import { pcmMemoryShape, sharedPlaybackBuffer, sharePlaybackPcm } from "./playback-pcm";
import { songFootprint } from "./memory-estimate";

function fixture() {
  const audio: PcmAudio = { sampleRate: 44100, bits: 24, channels: [new Float32Array([0.25, -0.5, 0.75])] };
  let data = audio.channels.map((channel) => channel.slice());
  const buffer = {
    sampleRate: audio.sampleRate,
    length: data[0].length,
    numberOfChannels: data.length,
    getChannelData: vi.fn((channel: number) => data[channel]),
  } as unknown as AudioBuffer;
  return {
    audio,
    buffer,
    acquire() {
      const old = data;
      data = old.map((channel) => channel.slice());
      for (const channel of old) structuredClone(channel.buffer, { transfer: [channel.buffer] });
    },
  };
}

it("preserves PCM identity, samples, depth and enumerable channels when a filled playback buffer becomes its owner", () => {
  const { audio, buffer } = fixture();
  const stored = new WeakMap([[audio, "saved FLAC"]]);
  sharePlaybackPcm(audio, buffer);
  expect(sharedPlaybackBuffer(audio)).toBe(buffer);
  expect(stored.get(audio)).toBe("saved FLAC");
  expect(audio.bits).toBe(24);
  expect(audio.channels[0]).toEqual(new Float32Array([0.25, -0.5, 0.75]));
  const copy = structuredClone(audio);
  expect(copy.sampleRate).toBe(44100);
  expect(copy.bits).toBe(24);
  expect(Array.isArray(copy.channels)).toBe(true);
  expect(Array.from(copy.channels[0])).toEqual([0.25, -0.5, 0.75]);
});

it("gets fresh channel views if Web Audio detaches a previously borrowed view", () => {
  const { audio, buffer, acquire } = fixture();
  sharePlaybackPcm(audio, buffer);
  const before = audio.channels[0];
  acquire();
  expect(before.length).toBe(0);
  expect(audio.channels[0].length).toBe(3);
  expect(audio.channels[0]).toEqual(new Float32Array([0.25, -0.5, 0.75]));
});

it("counts canonical audio once across the store and player without creating any channel views", () => {
  const { audio, buffer } = fixture();
  sharePlaybackPcm(audio, buffer);
  const store = pcmMemoryShape(audio);
  expect(buffer.getChannelData).not.toHaveBeenCalled();
  const footprint = songFootprint({ store: [store], player: [{ channels: 1, frames: 3, key: buffer }], prepared: [], renders: [] });
  expect(footprint.total).toBe(12);
  expect(footprint.player).toBe(0);
});

it("returns to decoded ownership when channels are replaced explicitly", () => {
  const { audio, buffer } = fixture();
  sharePlaybackPcm(audio, buffer);
  const replacement = [new Float32Array([1, 2])];
  audio.channels = replacement;
  expect(audio.channels).toBe(replacement);
  expect(sharedPlaybackBuffer(audio)).toBeUndefined();
  expect(pcmMemoryShape(audio)).toEqual({ channels: 1, frames: 2, key: replacement[0] });
});

it("leaves a frozen PCM object unchanged and does not reuse a buffer at another sample rate", () => {
  const { audio, buffer } = fixture();
  const frozen = Object.freeze({ ...audio });
  sharePlaybackPcm(frozen, buffer);
  expect(sharedPlaybackBuffer(frozen)).toBeUndefined();
  sharePlaybackPcm(audio, buffer);
  audio.sampleRate = 48000;
  expect(sharedPlaybackBuffer(audio)).toBeUndefined();
});
