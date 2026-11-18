import { expect, it, vi } from "vitest";
import { readKey } from "../performance/key";
import { detectChords } from "../performance/chords";
import type { HarmonyRequest } from "./harmony-worker";

it("runs both existing estimators from one stored harmony with unchanged results", async () => {
  const self = { onmessage: null as null | ((event: { data: HarmonyRequest }) => void), postMessage: vi.fn() };
  vi.stubGlobal("self", self);
  try {
    await import("./harmony-worker");
    self.onmessage!({ data: { kind: "key", id: 0, input: { bass: null, chords: [], sections: [] } } });
    expect(self.postMessage).toHaveBeenLastCalledWith({ id: 0, error: expect.stringContaining("No harmony audio") });
    const channel = Float32Array.from({ length: 16000 }, (_, i) =>
      [261.6256, 329.6276, 391.9954].reduce((sum, hz) => sum + 0.15 * Math.sin((2 * Math.PI * hz * i) / 8000), 0),
    );
    const audio = { sampleRate: 8000, channels: [channel, channel.map((sample) => -sample)] };
    const keyInput = { bass: null, chords: [], sections: [{ start: 0, end: 2 }] };
    const chordInput = { bass: null, beats: [0, 0.5, 1, 1.5], key: "C major" };
    self.onmessage!({ data: { kind: "audio", audio } });
    self.onmessage!({ data: { kind: "key", id: 1, input: keyInput } });
    expect(self.postMessage).toHaveBeenLastCalledWith({ id: 1, result: readKey({ ...keyInput, harmony: audio }) });
    self.onmessage!({ data: { kind: "chords", id: 2, input: chordInput } });
    expect(self.postMessage).toHaveBeenLastCalledWith({ id: 2, result: detectChords({ ...chordInput, harmony: audio }) });
    expect(audio.channels[0]).toBe(channel);
    expect(channel).toHaveLength(16000);
  } finally {
    vi.unstubAllGlobals();
  }
});
