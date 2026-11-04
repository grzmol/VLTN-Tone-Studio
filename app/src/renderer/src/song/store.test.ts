import { describe, expect, it, vi } from "vitest";
import { STEM_NAMES } from "@shared/host/song";
import type { Separation, SeparationProgress } from "./stems/engine";
import type { SplitChoice } from "./stems/options";
import type { PcmAudio } from "./types";
// vi.mock is hoisted above this import: the real engine needs a worker and the model; the store gets fakes.
import { createSongStore, type SongDeps } from "./store";

vi.mock("./stems/engine", () => ({ separateStems: vi.fn() }));

const audio = (n = 4): PcmAudio => ({ sampleRate: 44100, channels: [new Float32Array(n), new Float32Array(n)] });
const file = (name: string) => new File([new Uint8Array(4)], name);
const separation = (names: readonly string[] = STEM_NAMES): Separation => ({
  stems: Object.fromEntries(names.map((n) => [n, [new Float32Array(4).fill(STEM_NAMES.indexOf(n as never)), new Float32Array(4)]])),
  backends: ["webgpu"],
  seconds: 1.5,
});

function store(deps: Partial<SongDeps> = {}, choice: SplitChoice = { model: "htdemucs_6s", quality: "fast" }) {
  return createSongStore({ decode: async () => audio(), separate: async () => separation(), loadChoice: () => choice, saveChoice: () => {}, ...deps });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("song store", () => {
  it("decodes a file into the source and clears the stems", async () => {
    const useSong = store();
    const loading = useSong.getState().load(file("a.mp3"));
    expect(useSong.getState().status).toEqual({ kind: "decoding" });
    await loading;
    expect(useSong.getState().source?.name).toBe("a.mp3");
    expect(useSong.getState().status).toEqual({ kind: "idle" });
  });

  it("shows decode errors", async () => {
    const useSong = store({ decode: async () => Promise.reject(new Error("bad file")) });
    await useSong.getState().load(file("x.ogg"));
    expect(useSong.getState().status).toEqual({ kind: "error", message: "bad file" });
    expect(useSong.getState().source).toBeNull();
  });

  it("walks model download → model starting → splitting → done and maps stems by name", async () => {
    const statuses: string[] = [];
    const useSong = store({
      separate: async (_a, settings, onProgress: (p: SeparationProgress) => void) => {
        expect([settings.model.id, settings.quality.id]).toEqual(["htdemucs_6s", "fast"]);
        onProgress({ stage: "model", fraction: 0.5, bytes: 2e8 });
        statuses.push(JSON.stringify(useSong.getState().status));
        onProgress({ stage: "split", fraction: 0, backend: null, pass: 1, passes: 1 });
        statuses.push(JSON.stringify(useSong.getState().status));
        onProgress({ stage: "split", fraction: 0.25, backend: "wasm", pass: 1, passes: 1 });
        statuses.push(JSON.stringify(useSong.getState().status));
        return separation();
      },
    });
    await useSong.getState().load(file("a.wav"));
    await useSong.getState().split();
    expect(statuses).toEqual([
      JSON.stringify({ kind: "model", fraction: 0.5, bytes: 2e8 }),
      JSON.stringify({ kind: "splitting", fraction: 0, backend: null, pass: 1, passes: 1 }),
      JSON.stringify({ kind: "splitting", fraction: 0.25, backend: "wasm", pass: 1, passes: 1 }),
    ]);
    const s = useSong.getState();
    expect(s.status).toEqual({ kind: "done" });
    expect(s.stems?.guitar?.channels[0][0]).toBe(4);
    expect(s.stems?.drums?.channels[0][0]).toBe(0);
    expect(s.lastSplit).toEqual({ model: "htdemucs_6s", quality: "fast", backends: ["webgpu"], seconds: 1.5 });
  });

  it("keeps just the four stems of a four-stem model", async () => {
    const useSong = store({ separate: async () => separation(["drums", "bass", "other", "vocals"]) }, { model: "htdemucs_ft", quality: "max" });
    await useSong.getState().load(file("a.wav"));
    await useSong.getState().split();
    const s = useSong.getState();
    expect(Object.keys(s.stems ?? {})).toEqual(["drums", "bass", "other", "vocals"]);
    expect(s.stems?.guitar).toBeUndefined();
    expect(s.stems?.vocals?.channels[0][0]).toBe(3);
    expect(s.lastSplit).toMatchObject({ model: "htdemucs_ft", quality: "max" });
  });

  it("fails a split that lacks one of the model's stems", async () => {
    const useSong = store({ separate: async () => separation(["drums", "bass", "other"]) }, { model: "htdemucs_ft", quality: "fast" });
    await useSong.getState().load(file("a.wav"));
    await useSong.getState().split();
    expect(useSong.getState().status).toEqual({ kind: "error", message: "The split returned no vocals stem." });
    expect(useSong.getState().stems).toBeNull();
  });

  it("splits with the chosen model and quality and keeps the choice", async () => {
    const saved: SplitChoice[] = [];
    const separate = vi.fn<SongDeps["separate"]>(async () => separation());
    const useSong = store({ separate, saveChoice: (c) => saved.push(c) });
    useSong.getState().setChoice({ model: "hybrid" });
    useSong.getState().setChoice({ quality: "balanced" });
    expect(saved).toEqual([
      { model: "hybrid", quality: "fast" },
      { model: "hybrid", quality: "balanced" },
    ]);
    await useSong.getState().load(file("a.wav"));
    await useSong.getState().split();
    const settings = separate.mock.calls[0][1];
    expect([settings.model.id, settings.quality.overlap, settings.quality.shifts]).toEqual(["hybrid", 0.5, 2]);
  });

  it("cancel aborts the split and drops its result", async () => {
    const d = deferred<Separation>();
    let signal: AbortSignal | null = null;
    const useSong = store({
      separate: (_a, _s, _p, s) => {
        signal = s;
        return d.promise;
      },
    });
    await useSong.getState().load(file("a.wav"));
    const running = useSong.getState().split();
    useSong.getState().cancel();
    expect(signal!.aborted).toBe(true);
    expect(useSong.getState().status).toEqual({ kind: "idle" });
    d.resolve(separation());
    await running;
    expect(useSong.getState().stems).toBeNull();
    expect(useSong.getState().status).toEqual({ kind: "idle" });
  });

  it("loading another song aborts a running split; errors after abort are ignored", async () => {
    const d = deferred<Separation>();
    let signal: AbortSignal | null = null;
    const useSong = store({
      separate: (_a, _s, _p, s) => {
        signal = s;
        return d.promise;
      },
    });
    await useSong.getState().load(file("a.wav"));
    const running = useSong.getState().split();
    await useSong.getState().load(file("b.flac"));
    expect(signal!.aborted).toBe(true);
    d.reject(new DOMException("Separation cancelled", "AbortError"));
    await running;
    expect(useSong.getState().source?.name).toBe("b.flac");
    expect(useSong.getState().status).toEqual({ kind: "idle" });
  });

  it("shows split errors and reset clears everything", async () => {
    const useSong = store({ separate: async () => Promise.reject(new Error("offline")) });
    await useSong.getState().load(file("a.wav"));
    await useSong.getState().split();
    expect(useSong.getState().status).toEqual({ kind: "error", message: "offline" });
    useSong.getState().reset();
    expect(useSong.getState()).toMatchObject({ source: null, stems: null, status: { kind: "idle" } });
  });

  it("split without a song does nothing", async () => {
    const separate = vi.fn();
    const useSong = store({ separate });
    await useSong.getState().split();
    expect(separate).not.toHaveBeenCalled();
  });

  it("splits only the chosen part and keeps it in the split info", async () => {
    const song: PcmAudio = { sampleRate: 10, channels: [Float32Array.from({ length: 200 }, (_, i) => i), new Float32Array(200)] };
    const separate = vi.fn<SongDeps["separate"]>(async () => separation());
    const useSong = store({ decode: async () => song, separate });
    await useSong.getState().load(file("a.mp3"));
    useSong.getState().setRange({ start: 3, end: 9 });
    expect(useSong.getState().range).toEqual({ start: 3, end: 9 });
    await useSong.getState().split();
    const part = separate.mock.calls[0][0];
    expect(part.channels[0].length).toBe(60);
    expect(part.channels[0][0]).toBe(30);
    expect(useSong.getState().lastSplit?.range).toEqual({ start: 3, end: 9 });
  });

  it("splits the whole song without a range, and a range covering it is no range", async () => {
    const separate = vi.fn<SongDeps["separate"]>(async () => separation());
    const useSong = store({ decode: async () => audio(441000), separate });
    await useSong.getState().load(file("a.mp3"));
    useSong.getState().setRange({ start: 0, end: 10 });
    expect(useSong.getState().range).toBeNull();
    await useSong.getState().split();
    expect(separate.mock.calls[0][0].channels[0].length).toBe(441000);
    expect(useSong.getState().lastSplit).not.toHaveProperty("range");
  });

  it("ignores a range before a song is loaded, and loading another song clears it", async () => {
    const useSong = store({ decode: async () => audio(441000) });
    useSong.getState().setRange({ start: 1, end: 7 });
    expect(useSong.getState().range).toBeNull();
    await useSong.getState().load(file("a.mp3"));
    useSong.getState().setRange({ start: 1, end: 7 });
    await useSong.getState().load(file("b.mp3"));
    expect(useSong.getState().range).toBeNull();
  });

  it("clearStems goes back to choosing a part of the same song", async () => {
    const useSong = store({ decode: async () => audio(441000) });
    await useSong.getState().load(file("a.mp3"));
    useSong.getState().setRange({ start: 2, end: 8 });
    await useSong.getState().split();
    useSong.getState().clearStems();
    expect(useSong.getState()).toMatchObject({ stems: null, lastSplit: null, range: { start: 2, end: 8 }, status: { kind: "idle" } });
    expect(useSong.getState().source?.name).toBe("a.mp3");
  });
});
