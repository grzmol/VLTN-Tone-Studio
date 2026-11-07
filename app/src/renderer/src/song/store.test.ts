import { beforeEach, describe, expect, it, vi } from "vitest";
import { STEM_NAMES } from "@shared/host/song";
import { USER_TRACKS_MAX } from "@shared/song-library";
import type { Separation, SeparationProgress } from "./stems/engine";
import type { SplitChoice } from "./stems/options";
import type { PcmAudio, SplitInfo, Stems } from "./types";
// vi.mock is hoisted above this import: the real engine needs a worker and the model; the store gets fakes.
import { createSongStore, GENERATED_PLAYING_NOTICE, partSplitNote, PLAYING_NOTICE, selectWholeSongStems, wholeSongStems, type SongDeps } from "./store";
import { getSetting, performanceKey, setSetting } from "./performance/settings";

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

  it("finds a silent drums stem once a split finishes, and forgets it on reset", async () => {
    const length = 88200;
    const tone = () => new Float32Array(length).map((_, i) => 0.5 * Math.sin(i * 0.05));
    const useSong = store({
      decode: async () => ({ sampleRate: 44100, channels: [tone(), tone()] }),
      separate: async () => ({
        stems: Object.fromEntries(STEM_NAMES.map((name) => [name, name === "drums" ? [new Float32Array(length), new Float32Array(length)] : [tone(), tone()]])),
        backends: ["webgpu"],
        seconds: 1,
      }),
    });
    await useSong.getState().load(file("a.wav"));
    expect(useSong.getState().missingParts).toBeNull();
    await useSong.getState().split();
    expect(useSong.getState().missingParts).toMatchObject({ drums: "absent", bass: "present" });
    useSong.getState().reset();
    expect(useSong.getState().missingParts).toBeNull();
  });

  it("checkMissingParts fills in the check for loaded stems with a silent drums stem", () => {
    const length = 88200;
    const tone = () => new Float32Array(length).map((_, i) => 0.5 * Math.sin(i * 0.05));
    const useSong = store();
    useSong.setState({
      source: { name: "a.wav", audio: { sampleRate: 44100, channels: [tone(), tone()] } },
      stems: {
        drums: { sampleRate: 44100, channels: [new Float32Array(length), new Float32Array(length)] },
        bass: { sampleRate: 44100, channels: [tone(), tone()] },
      },
      missingParts: null,
    });
    useSong.getState().checkMissingParts();
    expect(useSong.getState().missingParts).toMatchObject({ drums: "absent", bass: "present" });
  });

  it("checkMissingParts does nothing without drums or bass stems", () => {
    const useSong = store();
    const other = { sampleRate: 44100, channels: [new Float32Array(88200)] };
    useSong.setState({ source: { name: "a.wav", audio: other }, stems: { other }, missingParts: null });
    useSong.getState().checkMissingParts();
    expect(useSong.getState().missingParts).toBeNull();
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

describe("imported tracks in the song store", () => {
  /** An import that gives each file the next track key, and a source sum when the song has none. */
  const importFake: SongDeps["importTracks"] = async (files, options) => ({
    tracks: files.map((f, i) => ({
      key: `track${options.taken.length + i}`,
      file: `track${options.taken.length + i}.flac`,
      kind: "user",
      name: f.name,
      bus: "main",
      pcm: audio(),
    })),
    source: options.reference === null ? audio() : null,
    notices: [],
  });

  it("gives a song with no source the sum of its tracks as its source", async () => {
    const useSong = store({ importTracks: importFake });
    const notices = await useSong.getState().addTracks([file("Click.wav"), file("Keys.wav")]);
    expect(notices).toEqual([]);
    expect(useSong.getState().source?.name).toBe("Imported tracks");
    expect(Object.keys(useSong.getState().stems ?? {})).toEqual(["track0", "track1"]);
    expect(useSong.getState().tracks.track0).toMatchObject({ kind: "user", name: "Click.wav" });
  });

  it("adds tracks beside a split song's stems and keeps its source", async () => {
    const useSong = store({ importTracks: importFake });
    await useSong.getState().load(file("song.mp3"));
    const source = useSong.getState().source;
    await useSong.getState().split();
    await useSong.getState().addTracks([file("Keys.wav")]);
    expect(useSong.getState().source).toBe(source);
    // The fake import numbers new tracks after the six stems, so the first one is track6.
    expect(Object.keys(useSong.getState().stems ?? {})).toEqual(expect.arrayContaining(["drums", "vocals", "track6"]));
    expect(useSong.getState().tracks.track6.kind).toBe("user");
    expect(useSong.getState().tracks.drums).toBeUndefined();
  });

  it("keeps a one-file song's own track when a folder of tracks is imported", async () => {
    const useSong = store({ importTracks: importFake });
    await useSong.getState().load(file("click-90-1min.wav"));
    const source = useSong.getState().source;
    await useSong.getState().addTracks([file("Keys.wav"), file("Bass.wav"), file("Click.wav")]);
    expect(useSong.getState().source).toBe(source);
    expect(Object.keys(useSong.getState().stems ?? {})).toEqual(["source", "track0", "track1", "track2"]);
    expect(useSong.getState().stems?.source).toBe(source?.audio);
    expect(useSong.getState().tracks.source).toMatchObject({ kind: "source", name: "Song" });
    expect(useSong.getState().tracks.track2).toMatchObject({ kind: "user", name: "Click.wav" });
  });

  it("keeps imported tracks when the song is split again", async () => {
    const useSong = store({ importTracks: importFake });
    await useSong.getState().load(file("song.mp3"));
    await useSong.getState().addTracks([file("Keys.wav")]);
    await useSong.getState().split();
    expect(useSong.getState().stems?.track0).toBeDefined();
    expect(useSong.getState().tracks.track0?.name).toBe("Keys.wav");
  });

  it("refuses to add tracks while playing, with a notice, and leaves the song as it was", async () => {
    const importer = vi.fn(importFake!);
    const useSong = store({ importTracks: importer });
    await useSong.getState().addTracks([file("Click.wav")]);
    const before = useSong.getState().stems;
    const notices = await useSong.getState().addTracks([file("Keys.wav")], { playing: true });
    expect(notices).toEqual([PLAYING_NOTICE]);
    expect(importer).toHaveBeenCalledTimes(1);
    expect(useSong.getState().stems).toBe(before);
    expect(Object.keys(useSong.getState().tracks)).toEqual(["track0"]);
  });

  it("refuses to add tracks while the song is splitting", async () => {
    const pending = deferred<Separation>();
    const useSong = store({ importTracks: importFake, separate: () => pending.promise });
    await useSong.getState().load(file("song.mp3"));
    const splitting = useSong.getState().split();
    await expect(useSong.getState().addTracks([file("Keys.wav")])).rejects.toThrow("Wait for the song");
    pending.resolve(separation());
    await splitting;
  });

  it("changes a track's mute groups without touching its audio", async () => {
    const useSong = store({ importTracks: importFake });
    await useSong.getState().addTracks([file("Click.wav")]);
    const pcm = useSong.getState().stems?.track0;
    useSong.getState().setTrackInfo("track0", { muteGroups: [2] });
    expect(useSong.getState().tracks.track0).toMatchObject({ kind: "user", name: "Click.wav", muteGroups: [2] });
    expect(useSong.getState().stems?.track0).toBe(pcm);
  });
});

describe("generated parts in the song store", () => {
  beforeEach(() => localStorage.clear());

  const importFake: SongDeps["importTracks"] = async (files, options) => ({
    tracks: files.map((f, i) => ({
      key: `track${options.taken.length + i}`,
      file: `track${options.taken.length + i}.flac`,
      kind: "user",
      name: f.name,
      bus: "main",
      pcm: audio(),
    })),
    source: options.reference === null ? audio() : null,
    notices: [],
  });

  const options = (source: { name: string; audio: PcmAudio } | null) => JSON.parse(getSetting(performanceKey(source), ":options") || "{}");

  it("adds the drums and bass as user tracks, and only the bass follows the pitch shift", async () => {
    const useSong = store();
    await useSong.getState().load(file("song.mp3"));
    const source = useSong.getState().source;
    expect(useSong.getState().applyGeneratedParts({ drums: audio(), bass: audio() })).toEqual([]);
    expect(Object.keys(useSong.getState().stems ?? {})).toEqual(["source", "track0", "track1"]);
    expect(useSong.getState().tracks.track0).toMatchObject({ kind: "user", name: "Drums (generated)", bus: "main", transpose: false });
    expect(useSong.getState().tracks.track1).toMatchObject({ kind: "user", name: "Bass (generated)", bus: "main", transpose: true });
    expect(options(source).followsPitch).toEqual({ track0: false, track1: true });
    expect(options(source).generatedParts).toEqual({ drums: "track0", bass: "track1" });
  });

  it("applying twice replaces the generated tracks instead of adding more", async () => {
    const useSong = store();
    await useSong.getState().load(file("song.mp3"));
    useSong.getState().applyGeneratedParts({ drums: audio(), bass: audio() });
    useSong.getState().applyGeneratedParts({ drums: audio(), bass: audio() });
    expect(Object.keys(useSong.getState().stems ?? {})).toEqual(["source", "track0", "track1"]);
    expect(Object.keys(useSong.getState().tracks)).toEqual(["source", "track0", "track1"]);
  });

  it("applying one part leaves the other part's generated track alone", async () => {
    const useSong = store();
    await useSong.getState().load(file("song.mp3"));
    const bass = audio();
    useSong.getState().applyGeneratedParts({ drums: audio(), bass });
    useSong.getState().applyGeneratedParts({ drums: audio() });
    expect(useSong.getState().tracks.track1).toMatchObject({ name: "Bass (generated)" });
    expect(useSong.getState().stems?.track1).toBe(bass);
  });

  it("a rendered drum takes the drums' generated track, keeps the bass, and keeps the generated record What plays reads", async () => {
    const useSong = store();
    await useSong.getState().load(file("song.mp3"));
    useSong.getState().applyGeneratedParts({ drums: audio(), bass: audio() });
    const rendered = audio();
    expect(useSong.getState().applyGeneratedParts({ drums: rendered })).toEqual([]);
    expect(useSong.getState().stems?.track0).toBe(rendered);
    expect(useSong.getState().tracks.track0).toMatchObject({ kind: "user", name: "Drums (generated)" });
    expect(Object.keys(useSong.getState().tracks).sort()).toEqual(["source", "track0", "track1"]);
    expect(options(useSong.getState().source).generatedParts).toEqual({ drums: "track0", bass: "track1" });
  });

  it("removes the generated track of a part that is turned off, in the same update as the parts that are on", async () => {
    const useSong = store();
    await useSong.getState().load(file("song.mp3"));
    useSong.getState().applyGeneratedParts({ drums: audio(), bass: audio() });
    let updates = 0;
    const unsubscribe = useSong.subscribe(() => updates++);
    // The drums are turned off and the bass is generated again: one store update, and the drums track goes with it.
    expect(useSong.getState().applyGeneratedParts({ bass: audio() }, { remove: ["drums"] })).toEqual([]);
    unsubscribe();
    expect(updates).toBe(1);
    // The new bass takes the lowest free key, which the drums and the old bass have just given up.
    expect(Object.keys(useSong.getState().tracks)).toEqual(["source", "track0"]);
    expect(useSong.getState().tracks.track0).toMatchObject({ name: "Bass (generated)" });
    expect(options(useSong.getState().source).generatedParts).toEqual({ bass: "track0" });
  });

  it("removes a turned-off part's track even when no part is applied", async () => {
    const useSong = store();
    await useSong.getState().load(file("song.mp3"));
    useSong.getState().applyGeneratedParts({ drums: audio(), bass: audio() });
    expect(useSong.getState().applyGeneratedParts({}, { remove: ["bass"] })).toEqual([]);
    expect(Object.keys(useSong.getState().tracks)).toEqual(["source", "track0"]);
    expect(options(useSong.getState().source).generatedParts).toEqual({ drums: "track0" });
  });

  it("does nothing when a part is turned off that has no generated track", async () => {
    const useSong = store();
    await useSong.getState().load(file("song.mp3"));
    let updates = 0;
    const unsubscribe = useSong.subscribe(() => updates++);
    expect(useSong.getState().applyGeneratedParts({}, { remove: ["drums"] })).toEqual([]);
    unsubscribe();
    expect(updates).toBe(0);
    expect(useSong.getState().stems).toBeNull();
  });

  it("keeps a split song's stems and imported tracks, and removes only the generated tracks", async () => {
    const useSong = store({ importTracks: importFake });
    await useSong.getState().load(file("song.mp3"));
    await useSong.getState().split();
    await useSong.getState().addTracks([file("Keys.wav")]);
    // Track numbers are given out lowest first, so the generated parts take track0 and track1, and the imported track stays track6.
    useSong.getState().applyGeneratedParts({ drums: audio(), bass: audio() });
    expect(useSong.getState().tracks.track0).toMatchObject({ name: "Drums (generated)" });
    expect(useSong.getState().removeGeneratedParts()).toEqual([]);
    expect(Object.keys(useSong.getState().stems ?? {})).toEqual(expect.arrayContaining(["drums", "vocals", "track6"]));
    expect(Object.keys(useSong.getState().stems ?? {})).not.toContain("track0");
    expect(Object.keys(useSong.getState().stems ?? {})).not.toContain("track1");
    expect(Object.keys(useSong.getState().tracks)).not.toContain("track0");
    expect(useSong.getState().tracks.track6).toMatchObject({ name: "Keys.wav" });
  });

  it("an unsplit song goes back to its source alone when its generated parts are removed", async () => {
    const useSong = store({ importTracks: importFake });
    await useSong.getState().load(file("song.mp3"));
    useSong.getState().applyGeneratedParts({ drums: audio() });
    useSong.getState().removeGeneratedParts();
    expect(useSong.getState().stems).toBeNull();
    expect(useSong.getState().tracks).toEqual({});
    expect(options(useSong.getState().source).generatedParts).toBeUndefined();
  });

  it("removing keeps an imported track beside the source", async () => {
    const useSong = store({ importTracks: importFake });
    await useSong.getState().load(file("song.mp3"));
    await useSong.getState().addTracks([file("Keys.wav")]);
    useSong.getState().applyGeneratedParts({ drums: audio() });
    useSong.getState().removeGeneratedParts();
    expect(Object.keys(useSong.getState().stems ?? {})).toEqual(["source", "track0"]);
    expect(useSong.getState().tracks.track0).toMatchObject({ kind: "user", name: "Keys.wav" });
  });

  it("refuses to add or remove parts while playing, and leaves the song as it was", async () => {
    const useSong = store();
    await useSong.getState().load(file("song.mp3"));
    expect(useSong.getState().applyGeneratedParts({ drums: audio() }, { playing: true })).toEqual([GENERATED_PLAYING_NOTICE]);
    expect(useSong.getState().stems).toBeNull();
    useSong.getState().applyGeneratedParts({ drums: audio() });
    const before = useSong.getState().stems;
    expect(useSong.getState().removeGeneratedParts({ playing: true })).toEqual([GENERATED_PLAYING_NOTICE]);
    expect(useSong.getState().stems).toBe(before);
  });

  it("refuses a part whose length or sample rate is not the song's", async () => {
    const useSong = store();
    await useSong.getState().load(file("song.mp3"));
    const longer = useSong.getState().applyGeneratedParts({ drums: audio(5) });
    expect(longer).toEqual([expect.stringContaining("does not match the song's length")]);
    const otherRate = useSong.getState().applyGeneratedParts({ bass: { ...audio(), sampleRate: 48000 } });
    expect(otherRate).toEqual([expect.stringContaining("does not match the song's length")]);
    expect(useSong.getState().stems).toBeNull();
  });

  it("needs a loaded song before it adds parts", () => {
    const useSong = store();
    expect(useSong.getState().applyGeneratedParts({ drums: audio() })).toEqual(["Load a song before generating parts."]);
  });

  it("refuses when the song already has the most imported tracks", async () => {
    const useSong = store();
    await useSong.getState().load(file("song.mp3"));
    const full: Stems = { source: audio() };
    for (let i = 0; i < USER_TRACKS_MAX; i++) full[`track${i}`] = audio();
    useSong.setState({ stems: full });
    expect(useSong.getState().applyGeneratedParts({ drums: audio() })).toEqual([expect.stringContaining("can hold up to 32")]);
    expect(useSong.getState().stems).toBe(full);
  });

  /** A song whose options record a generated drum on track2, where the user now has a guide track of their own. */
  async function staleRecord() {
    const useSong = store();
    await useSong.getState().load(file("song.mp3"));
    const source = useSong.getState().source;
    const guide = audio();
    useSong.setState({
      stems: { source: audio(), track2: guide },
      tracks: { source: { kind: "source", name: "Song" }, track2: { kind: "user", name: "Guide.wav" } },
    });
    setSetting(performanceKey(source), ":options", JSON.stringify({ generatedParts: { drums: "track2", bass: "track3" } }));
    return { useSong, source, guide };
  }

  it("applying parts keeps a user track that a stale record points at, and cleans the record up", async () => {
    const { useSong, source, guide } = await staleRecord();
    expect(useSong.getState().applyGeneratedParts({ drums: audio() })).toEqual([]);
    expect(useSong.getState().stems?.track2).toBe(guide);
    expect(useSong.getState().tracks.track2).toMatchObject({ kind: "user", name: "Guide.wav" });
    expect(useSong.getState().tracks.track0).toMatchObject({ name: "Drums (generated)" });
    // Only the record that still matches is kept: the stale bass record is dropped.
    expect(options(source).generatedParts).toEqual({ drums: "track0" });
  });

  it("removing with a stale record deletes nothing, and cleans the record up", async () => {
    const { useSong, source, guide } = await staleRecord();
    expect(useSong.getState().removeGeneratedParts()).toEqual([]);
    expect(useSong.getState().stems?.track2).toBe(guide);
    expect(useSong.getState().tracks.track2).toMatchObject({ kind: "user", name: "Guide.wav" });
    expect(options(source).generatedParts).toBeUndefined();
  });
});

describe("the whole song after a part split", () => {
  const split = { model: "htdemucs_6s", quality: "fast", backends: ["webgpu"], seconds: 1 } as SplitInfo;
  const part: SplitInfo = { ...split, range: { start: 23, end: 60 } };
  const song = audio(8);
  const stems: Stems = { guitar: audio(), drums: audio(), user1: audio(8) };
  const tracks = { user1: { kind: "user" as const, name: "Keys" } };

  it("keeps a whole-song split as it is", () => {
    expect(wholeSongStems(stems, split, tracks, song)).toBe(stems);
    expect(wholeSongStems(null, part, tracks, song)).toBeNull();
  });

  it("leaves a part split's stems out and plays the source with the imported tracks", () => {
    expect(wholeSongStems(stems, part, tracks, song)).toEqual({ source: song, user1: stems.user1 });
  });

  it("plays the source alone when a part split has nothing else", () => {
    expect(wholeSongStems({ guitar: audio(), drums: audio() }, part, {}, song)).toBeNull();
  });

  it("gives the same object back while the song does not change, so it works as a selector", () => {
    const state = { stems, lastSplit: part, tracks, source: { name: "a.wav", audio: song } } as never;
    expect(selectWholeSongStems(state)).toBe(selectWholeSongStems(state));
  });

  it("says why the stems are missing only for a part split", () => {
    const format = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
    expect(partSplitNote(split, format)).toBeNull();
    expect(partSplitNote(part, format)).toContain("only 0:23 – 1:00");
  });
});
