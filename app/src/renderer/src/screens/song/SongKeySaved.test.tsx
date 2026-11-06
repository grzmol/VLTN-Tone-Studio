import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ANALYSIS_VERSION, songAudioId } from "@/song/analysis/song-analysis";
import type { PcmAudio, Stems } from "@/song/types";
import { SongKey } from "./SongKey";

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

const loud = (): PcmAudio => ({ sampleRate: 44100, channels: [Float32Array.from({ length: 4410 }, (_, i) => (i % 2 ? 0.5 : -0.5))] });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  constructed.count = 0;
  localStorage.clear();
});

describe("SongKey with a saved analysis", () => {
  it("keeps the saved key when a generated part is added to the song", () => {
    vi.stubGlobal("Worker", CountingWorker);
    const mix = loud();
    const stems = { guitar: loud() } as Stems;
    const estimate = { name: "E minor", tonic: 4, mode: "minor", correlation: 0.8, margin: 0.2, confidence: "strong", alternatives: [] };
    localStorage.setItem(
      "song-key-test:options",
      JSON.stringify({ analysis: { audioId: songAudioId(mix, stems), version: ANALYSIS_VERSION, key: { source: "guitar", estimate } } }),
    );
    const { rerender } = render(<SongKey stems={stems} original={mix} storageKey="song-key-test" />);
    // Generate adds a track and records it as the drums part. The saved key must still be the one shown.
    localStorage.setItem(
      "song-key-test:options",
      JSON.stringify({
        analysis: { audioId: songAudioId(mix, stems), version: ANALYSIS_VERSION, key: { source: "guitar", estimate } },
        generatedParts: { drums: "track1" },
      }),
    );
    rerender(<SongKey stems={{ ...stems, track1: loud() } as Stems} original={mix} storageKey="song-key-test" />);
    expect(screen.getByText("Song key: E minor")).toBeTruthy();
    expect(constructed.count).toBe(0);
  });

  it("shows the key the analysis saved for this audio and stem, without running the key worker", () => {
    vi.stubGlobal("Worker", CountingWorker);
    const mix = loud();
    const stems = { guitar: loud() } as Stems;
    const estimate = { name: "E minor", tonic: 4, mode: "minor", correlation: 0.8, margin: 0.2, confidence: "strong", alternatives: [] };
    localStorage.setItem(
      "song-key-test:options",
      JSON.stringify({ analysis: { audioId: songAudioId(mix, stems), version: ANALYSIS_VERSION, key: { source: "guitar", estimate } } }),
    );
    render(<SongKey stems={stems} original={mix} storageKey="song-key-test" />);
    expect(screen.getByText("Song key: E minor")).toBeTruthy();
    expect(constructed.count).toBe(0);
  });
});
