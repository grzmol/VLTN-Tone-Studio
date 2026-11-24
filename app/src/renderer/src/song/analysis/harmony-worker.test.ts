import { expect, it, vi } from "vitest";
import { readKey } from "../performance/key";
import { detectChords } from "../performance/chords";
import { sumAudio } from "../band/request";
import type { HarmonyRequest } from "./harmony-worker";

it("runs both existing estimators from one stored harmony with unchanged results", async () => {
  const self = { onmessage: null as null | ((event: { data: HarmonyRequest }) => void), postMessage: vi.fn() };
  vi.stubGlobal("self", self);
  try {
    await import("./harmony-worker");
    self.onmessage!({ data: { kind: "key", id: 0, harmony: 0, input: { bass: null, chords: [], sections: [] } } });
    expect(self.postMessage).toHaveBeenLastCalledWith({ id: 0, error: expect.stringContaining("No harmony audio") });
    const channel = Float32Array.from({ length: 16000 }, (_, i) =>
      [261.6256, 329.6276, 391.9954].reduce((sum, hz) => sum + 0.15 * Math.sin((2 * Math.PI * hz * i) / 8000), 0),
    );
    const audio = { sampleRate: 8000, channels: [channel, channel.map((sample) => -sample)] };
    const keyInput = { bass: null, chords: [], sections: [{ start: 0, end: 2 }] };
    const chordInput = { bass: null, beats: [0, 0.5, 1, 1.5], key: "C major" };
    self.onmessage!({ data: { kind: "audio", index: 0, audio } });
    self.onmessage!({ data: { kind: "key", id: 1, harmony: 0, input: keyInput } });
    expect(self.postMessage).toHaveBeenLastCalledWith({ id: 1, result: readKey({ ...keyInput, harmony: audio }) });
    self.onmessage!({ data: { kind: "chords", id: 2, harmony: [0], input: chordInput } });
    expect(self.postMessage).toHaveBeenLastCalledWith({ id: 2, result: detectChords({ ...chordInput, harmony: audio }) });
    expect(audio.channels[0]).toBe(channel);
    expect(channel).toHaveLength(16000);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("derives the key stem and the summed chord harmony from stems posted once", async () => {
  const self = { onmessage: null as null | ((event: { data: HarmonyRequest }) => void), postMessage: vi.fn() };
  vi.stubGlobal("self", self);
  vi.resetModules();
  try {
    await import("./harmony-worker");
    const tone = (hz: number[]) => Float32Array.from({ length: 16000 }, (_, i) => hz.reduce((sum, f) => sum + 0.15 * Math.sin((2 * Math.PI * f * i) / 8000), 0));
    const guitar = { sampleRate: 8000, channels: [tone([261.6256, 329.6276])] };
    const other = { sampleRate: 8000, channels: [tone([391.9954])] };
    const keyInput = { bass: null, chords: [], sections: [{ start: 0, end: 2 }] };
    const chordInput = { bass: null, beats: [0, 0.5, 1, 1.5], key: "C major" };
    self.onmessage!({ data: { kind: "audio", index: 0, audio: guitar } });
    self.onmessage!({ data: { kind: "audio", index: 1, audio: other } });
    self.onmessage!({ data: { kind: "key", id: 1, harmony: 0, input: keyInput } });
    expect(self.postMessage).toHaveBeenLastCalledWith({ id: 1, result: readKey({ ...keyInput, harmony: guitar }) });
    self.onmessage!({ data: { kind: "chords", id: 2, harmony: [1, 0], input: chordInput } });
    expect(self.postMessage).toHaveBeenLastCalledWith({ id: 2, result: detectChords({ ...chordInput, harmony: sumAudio([other, guitar]) }) });
  } finally {
    vi.unstubAllGlobals();
  }
});

it("ignores an audio message whose index is not a slot number", async () => {
  const self = { onmessage: null as null | ((event: { data: HarmonyRequest }) => void), postMessage: vi.fn() };
  vi.stubGlobal("self", self);
  vi.resetModules();
  try {
    await import("./harmony-worker");
    const audio = { sampleRate: 8000, channels: [new Float32Array(16)] };
    for (const index of ["__proto__", -1, 0.5] as unknown as number[]) {
      self.onmessage!({ data: { kind: "audio", index, audio } });
    }
    expect(({} as Record<string, unknown>).sampleRate).toBeUndefined();
    self.onmessage!({ data: { kind: "key", id: 1, harmony: -1, input: { bass: null, chords: [], sections: [] } } });
    expect(self.postMessage).toHaveBeenLastCalledWith({ id: 1, error: expect.stringContaining("No harmony audio") });
  } finally {
    vi.unstubAllGlobals();
  }
});
