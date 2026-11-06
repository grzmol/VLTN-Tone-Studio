// The automatic run with the real song store (spec 80): a file opened starts a run on its mix, a split parks that run while it works,
// and the split's stems start a fresh run. The separation is faked; the store and the runner are the real ones.
import { describe, expect, it, vi } from "vitest";
import { STEM_NAMES } from "@shared/host/song";
import type { Separation } from "../stems/engine";
import type { PcmAudio } from "../types";
import type { AnalysisAudio, AnalysisStep, StepResult } from "./song-analysis";
import { songAudioId } from "./song-analysis";
import { createSongStore } from "../store";
import { createSongRunner, isSplitting, watchSongStore, type RunOptions, type SavedSong } from "./song-runner";

vi.mock("../stems/engine", () => ({ separateStems: vi.fn() }));

const audio = (n = 4): PcmAudio => ({ sampleRate: 44100, channels: [new Float32Array(n), new Float32Array(n)] });
const file = (name: string) => new File([new Uint8Array(4)], name);
const separation = (): Separation => ({
  stems: Object.fromEntries(STEM_NAMES.map((n) => [n, [new Float32Array(4), new Float32Array(4)]])),
  backends: ["webgpu"],
  seconds: 1,
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A store, a runner over it the way the app wires one, and the saved settings the runner writes. */
function wired(separate: () => Promise<Separation>) {
  const store = createSongStore({
    decode: async () => audio(),
    separate: async () => separate(),
    loadChoice: () => ({ model: "htdemucs_6s", quality: "fast" }),
    saveChoice: () => {},
  });
  const saved: Record<string, string> = {};
  const writes: Record<string, string>[] = [];
  // The step reports 99 when the run sees the split's stems, and 77 for the mix alone, so the saved tempo says which run wrote it.
  const step: AnalysisStep = {
    name: "tempo",
    run: (_audio: AnalysisAudio, signal: AbortSignal) =>
      new Promise<StepResult>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("stopped")));
        setTimeout(() => resolve({ tempo: { bpm: store.getState().stems ? 99 : 77, firstBeat: 0, steady: true } }), 0);
      }),
  };
  const audioId = () => {
    const { source, stems } = store.getState();
    return source ? songAudioId(source.audio, stems) : null;
  };
  const runner = createSongRunner({
    target: () => {
      const { source, stems } = store.getState();
      if (!source) return null;
      return { key: "song", title: source.name, audioId: songAudioId(source.audio, stems), audio: {} as AnalysisAudio };
    },
    audioId,
    read: (): SavedSong => ({ bpm: saved[":bpm"] ?? "120", options: JSON.parse(saved[":options"] ?? "{}"), chart: "", lyrics: "" }),
    write: (_key, values) => {
      writes.push(values);
      Object.assign(saved, values);
    },
    steps: (_key: string, _options: RunOptions) => [step],
    busy: () => isSplitting(store.getState().status.kind),
    onBusyChange: (listener) =>
      store.subscribe((state, previous) => {
        if (isSplitting(state.status.kind) !== isSplitting(previous.status.kind)) listener(isSplitting(state.status.kind));
      }),
  });
  const unwatch = watchSongStore(store, () => runner.analyse());
  return { store, runner, saved, writes, unwatch };
}

describe("the automatic run with the song store", () => {
  it("starts once when a file opens, and again when its split is done, with the new stems", async () => {
    const analysed: string[] = [];
    const store = createSongStore({
      decode: async () => audio(),
      separate: async () => separation(),
      loadChoice: () => ({ model: "htdemucs_6s", quality: "fast" }),
      saveChoice: () => {},
    });
    const unwatch = watchSongStore(store, () => analysed.push(Object.keys(store.getState().stems ?? {}).join(",") || "mix"));
    await store.getState().load(file("Song.wav"));
    expect(analysed).toEqual(["mix"]);
    await store.getState().split();
    expect(analysed).toHaveLength(2);
    expect(analysed[1]).toContain("vocals");
    unwatch();
  });
});

describe("a split parks the mix-only run", () => {
  it("parks the run on the mix while the split works, and runs the split's stems afterwards", async () => {
    let finishSplit!: (value: Separation) => void;
    const { store, runner, saved, writes, unwatch } = wired(() => new Promise<Separation>((resolve) => (finishSplit = resolve)));
    await store.getState().load(file("Song.wav"));
    expect(runner.state.getState().running).toBe(true);

    const splitting = store.getState().split();
    await settle();
    expect(runner.state.getState().waiting).toBe(true);
    expect(writes).toHaveLength(0);

    finishSplit(separation());
    await splitting;
    await settle();
    expect(saved[":bpm"]).toBe("99");
    expect(writes).toHaveLength(1);
    expect(runner.state.getState().running).toBe(false);
    unwatch();
  });
});

describe("a split after the mix-only run has finished", () => {
  it("starts the split's own run without a click once the mix-only run has finished", async () => {
    const { store, runner, saved, writes, unwatch } = wired(async () => separation());
    await store.getState().load(file("Song.wav"));
    for (let i = 0; i < 20 && runner.state.getState().running; i++) await settle();
    expect(saved[":bpm"]).toBe("77");

    await store.getState().split();
    for (let i = 0; i < 20 && runner.state.getState().running; i++) await settle();
    expect(saved[":bpm"]).toBe("99");
    expect(writes).toHaveLength(2);
    unwatch();
  });
});
