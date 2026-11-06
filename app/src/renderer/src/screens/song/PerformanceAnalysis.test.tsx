import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PerformanceSession } from "@/song/performance/session";
import type { PcmAudio, Stems } from "@/song/types";
import { ANALYSIS_VERSION, songAudioId } from "@/song/analysis/song-analysis";
import { useChordAnalysis } from "./PerformanceAnalysis";

const constructed = vi.hoisted(() => ({ count: 0 }));
class CountingWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    constructed.count++;
  }
  postMessage() {}
  terminate() {}
}

const stem: PcmAudio = { sampleRate: 44100, channels: [new Float32Array(4)] };
const stems = { other: stem } as Stems;
const session = { fail: vi.fn() } as unknown as PerformanceSession;

afterEach(() => {
  vi.unstubAllGlobals();
  constructed.count = 0;
  localStorage.clear();
});

describe("useChordAnalysis", () => {
  it("uses the chords the song analysis saved for this audio and stem, without a worker", async () => {
    vi.stubGlobal("Worker", CountingWorker);
    const chords = [{ time: 0, name: "Em", confidence: 0.9 }];
    localStorage.setItem(
      "analysis-test:options",
      JSON.stringify({ analysis: { audioId: "id-1", version: ANALYSIS_VERSION, chords: { source: "other", chords } } }),
    );
    const { result } = renderHook(() => useChordAnalysis(session, { name: "other", audio: stems.other! }, null, { songKey: "analysis-test", audioId: "id-1" }));
    expect(result.current.chords).toEqual(chords);
    expect(constructed.count).toBe(0);
  });

  it("keeps the saved chords when a generated part is added to the song", async () => {
    vi.stubGlobal("Worker", CountingWorker);
    const mix: PcmAudio = { sampleRate: 44100, channels: [new Float32Array(100)] };
    const chords = [{ time: 0, name: "E5", confidence: 0.9 }];
    const beforeStems = { other: stem } as Stems;
    const afterStems = { other: stem, track1: stem } as Stems;
    localStorage.setItem(
      "analysis-test:options",
      JSON.stringify({
        analysis: { audioId: songAudioId(mix, beforeStems), version: ANALYSIS_VERSION, chords: { source: "other", chords } },
        generatedParts: { drums: "track1" },
      }),
    );
    const { result, rerender } = renderHook(
      ({ current }: { current: Stems }) =>
        useChordAnalysis(session, { name: "other", audio: current.other! }, null, {
          songKey: "analysis-test",
          audioId: songAudioId(mix, current, ["track1"]),
        }),
      { initialProps: { current: beforeStems } },
    );
    rerender({ current: afterStems });
    expect(result.current.chords).toEqual(chords);
    expect(constructed.count).toBe(0);
  });

  it("analyses again when the saved chords are for another stem", async () => {
    vi.stubGlobal("Worker", CountingWorker);
    localStorage.setItem(
      "analysis-test:options",
      JSON.stringify({ analysis: { audioId: "id-1", version: ANALYSIS_VERSION, chords: { source: "vocals", chords: [] } } }),
    );
    renderHook(() => useChordAnalysis(session, { name: "other", audio: stems.other! }, null, { songKey: "analysis-test", audioId: "id-1" }));
    await waitFor(() => expect(constructed.count).toBe(1));
  });
});
