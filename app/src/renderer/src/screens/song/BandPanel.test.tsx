import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PcmAudio } from "@/song/types";
import type { BeatGrid } from "@/song/band/beat-grid";
import { fixedBeatGrid } from "@/song/band/beat-grid";
import { parseSmf } from "@/song/performance/smf";
import type { Section } from "@/song/performance/sections";
import { useBandPanel } from "./band-panel-state";
import { ORIGINAL_PARTS, type PartChoices } from "@/song/band/part-choice";
import type { TrackInfo } from "@/song/tracks";
import { GENERATED_PART_NAMES } from "@/song/band/generated-names";
import { DEFAULT_BAND_SETTINGS } from "@/song/band/arrangement";

const mocks = vi.hoisted(() => ({
  startBeatGrid: vi.fn(),
  startBandRender: vi.fn(),
  renderPreview: vi.fn(),
  startChordDetection: vi.fn(),
  saveFiles: vi.fn(async (_files: unknown, _title: string) => null as string | null),
  tones: {
    readNam: vi.fn(async (_toneId: number, _modelId: number): Promise<string> => {
      throw new Error("Bass amp isn't there anymore");
    }),
    readIr: vi.fn(),
    readLocalNam: vi.fn(),
    readLocalIr: vi.fn(),
  },
  chain: vi.fn(async (_blocks: unknown, input: Float32Array): Promise<Float32Array> => new Float32Array(input.length)),
  decodeAudioFile: vi.fn(async (): Promise<PcmAudio> => ({ sampleRate: 44100, channels: [new Float32Array(44100 * 8), new Float32Array(44100 * 8)] })),
  store: null as unknown as { getState(): unknown; setState(patch: unknown): void },
}));

vi.mock("@/host", () => ({ host: { song: { saveFiles: mocks.saveFiles }, tones: mocks.tones }, isElectron: true }));
// The NAM engine needs an AudioWorklet, so a bass tone's chain is a stub. The capture text passes through prepareNam as itself.
vi.mock("@/song/band/bass-chain", () => ({ renderPartChain: mocks.chain, renderBassChain: mocks.chain }));
vi.mock("@shared/nam", () => ({ prepareNam: (text: string) => ({ json: text, check: {} }) }));
// A rendered file is decoded by the import's decoder; the test gives the decoded audio.
vi.mock("@/song/decode", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/song/decode")>()), decodeAudioFile: mocks.decodeAudioFile }));

vi.mock("@/song/store", async () => {
  const { create } = await import("zustand");
  const useSong = create(() => ({
    source: null as null | { name: string; audio: PcmAudio },
    stems: null,
    tracks: {} as Record<string, unknown>,
    missingParts: null,
    checkMissingParts: vi.fn(),
    applyGeneratedParts: vi.fn(() => [] as string[]),
    removeGeneratedParts: vi.fn(() => [] as string[]),
  }));
  mocks.store = useSong as unknown as typeof mocks.store;
  return { useSong, selectWholeSongStems: (s: { stems: unknown }) => s.stems };
});
vi.mock("@/song/band/beat-grid-client", () => ({ startBeatGrid: mocks.startBeatGrid }));
vi.mock("@/song/band/chord-detect-client", () => ({ startChordDetection: mocks.startChordDetection }));
vi.mock("@/song/band/band-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/song/band/band-client")>()),
  bandSampleUrls: () => ({}),
  startBandRender: mocks.startBandRender,
  renderPreview: mocks.renderPreview,
}));

// Imported after the mocks, so they see the mocked store.
const { useSong } = await import("@/song/store");
const { BandPanel, BandPanelButton } = await import("./BandPanel");

const KEY = "vltn.performance.v1:band-panel-test:8:44100";
const SECONDS = 8;
const SECTIONS: Section[] = [
  { id: "verse", name: "Verse", start: 0, end: 4, mode: "continue" },
  { id: "chorus", name: "Chorus", start: 4, end: 8, mode: "continue" },
];

/** A stored grid at 120 BPM over the eight seconds: sixteen beats, four to a bar. */
const grid: BeatGrid = fixedBeatGrid(120, 0, 4, SECONDS);

function song(): { name: string; audio: PcmAudio } {
  return { name: "Song.wav", audio: { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] } };
}

function stored(options: Record<string, unknown>) {
  localStorage.setItem(`${KEY}:options`, JSON.stringify(options));
}
function savedOptions(): Record<string, any> {
  return JSON.parse(localStorage.getItem(`${KEY}:options`) ?? "{}");
}

function renderPanel(overrides: Partial<Parameters<typeof BandPanel>[0]> = {}) {
  useBandPanel.getState().show(true);
  const props = {
    songKey: KEY,
    playing: false,
    chart: "",
    chords: [],
    sections: [] as Section[],
    beats: 4,
    bpm: 120,
    firstBeat: 0,
    onMetronome: vi.fn(),
    getPosition: () => 0,
    partChoices: ORIGINAL_PARTS,
    onPartChoice: vi.fn(),
    ...overrides,
  };
  return { ...render(<BandPanel {...props} />), props };
}

/** Picks an option of a shadcn select, opened from its trigger with the keyboard. */
function pick(trigger: HTMLElement, option: string) {
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: option }));
}

// jsdom has no layout: the Radix select and slider measure with these.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false) as unknown as typeof Element.prototype.hasPointerCapture;
  localStorage.clear();
  useSong.setState({
    source: song(),
    stems: null,
    tracks: {},
    missingParts: null,
    checkMissingParts: vi.fn(),
    applyGeneratedParts: vi.fn(() => []),
    removeGeneratedParts: vi.fn(() => []),
  });
  mocks.startBeatGrid.mockReset();
  mocks.saveFiles.mockClear();
  mocks.startBandRender.mockReset();
  mocks.renderPreview.mockReset();
  mocks.chain.mockClear();
  mocks.tones.readNam.mockClear();
  // By default the detector finds nothing, so the bass rests unless a test gives it chords.
  mocks.startChordDetection.mockReset();
  mocks.startChordDetection.mockReturnValue({ done: Promise.resolve([]), cancel: vi.fn() });
});
afterEach(() => {
  cleanup();
  useBandPanel.getState().show(false);
});

describe("Band panel", () => {
  it("exports the last Generate's notes as a MIDI file named after the song, and only after Generate", async () => {
    stored({ beatGrid: grid, bandOutOfDate: true });
    const silent = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] };
    const kick = { time: 0.5, pitch: 36, velocity: 100, duration: 0.1 };
    const bassNote = { time: 1, pitch: 40, velocity: 90, duration: 0.5 };
    mocks.startBandRender.mockReturnValue({
      done: Promise.resolve({ drums: silent, bass: silent, notes: { drums: [kick], bass: [bassNote] } }),
      onProgress: vi.fn(),
      cancel: vi.fn(),
    });
    renderPanel({ chart: "[Am] [G]", sections: SECTIONS });
    const exporting = screen.getByRole("button", { name: "Export MIDI…" }) as HTMLButtonElement;
    expect(exporting.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(exporting.disabled).toBe(false));
    fireEvent.click(exporting);
    await waitFor(() => expect(mocks.saveFiles).toHaveBeenCalledTimes(1));
    const [files, title] = mocks.saveFiles.mock.calls[0] as unknown as [{ name: string; bytes: Uint8Array }[], string];
    expect(files.map((file) => file.name)).toEqual(["Song - band.mid"]);
    expect(title).toBe("Export band MIDI");
    const messages = parseSmf(files[0].bytes).filter((message) => message.bytes.length === 3);
    expect(messages.map((message) => message.bytes)).toEqual([
      [0x99, 36, 100],
      [0x89, 36, 0],
      [0x90, 40, 90],
      [0x80, 40, 0],
    ]);
  });

  it("renders with the defaults, and checks for missing parts when it opens", () => {
    renderPanel();
    expect(useSong.getState().checkMissingParts).toHaveBeenCalled();
    expect((screen.getByRole("switch", { name: "Generate drums" }) as HTMLButtonElement).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByRole("switch", { name: "Generate bass" }) as HTMLButtonElement).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("combobox", { name: "Style" }).textContent).toContain("Rock");
    expect(screen.getByText("No generated parts yet.")).toBeTruthy();
    expect(screen.getByText("No beat grid yet. Find the beat, or use the fixed BPM.")).toBeTruthy();
    expect(screen.queryByText(/out of date/)).toBeNull();
    expect((screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables every action while playing, and says to stop playback", () => {
    stored({ beatGrid: grid, band: undefined });
    renderPanel({ playing: true });
    expect(screen.getByText("Stop playback to generate parts.")).toBeTruthy();
    const actions = [
      "Find the beat",
      "Half tempo",
      "Double tempo",
      "Downbeat ←",
      "Downbeat →",
      "Nudge −10 ms",
      "Nudge +10 ms",
      "Use fixed BPM",
      "Generate",
      "Try another",
      "Remove generated parts",
      "Preview",
    ];
    for (const name of actions) expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled, name).toBe(true);
    expect(mocks.startBeatGrid).not.toHaveBeenCalled();
  });

  it("changing the style or complexity saves at once and marks the parts out of date", () => {
    renderPanel();
    pick(screen.getByRole("combobox", { name: "Style" }), "Funk");
    expect(savedOptions().band.style).toBe("funk");
    expect(savedOptions().bandOutOfDate).toBe(true);
    expect(screen.getByText(/Parts out of date/)).toBeTruthy();
    // Funk's own swing default is saved with the style.
    expect(savedOptions().band.swing).toBe(0);

    const complexity = screen.getAllByRole("slider")[0];
    fireEvent.keyDown(complexity, { key: "ArrowRight" });
    expect(savedOptions().band.complexity).toBeCloseTo(0.55, 5);
    expect(useSong.getState().applyGeneratedParts).not.toHaveBeenCalled();
    expect(mocks.startBandRender).not.toHaveBeenCalled();
  });

  it("the humanise amount and feel save, and mark the parts out of date", () => {
    renderPanel();
    // The sliders come in order: complexity, swing, then humanise. The aria-label sits on the root, not the thumb.
    fireEvent.keyDown(screen.getAllByRole("slider")[2], { key: "ArrowRight" });
    expect(savedOptions().band.humanise.amount).toBeCloseTo(0.55, 5);
    expect(savedOptions().bandOutOfDate).toBe(true);
    pick(screen.getByRole("combobox", { name: "Humanise feel" }), "Pushed");
    expect(savedOptions().band.humanise).toEqual({ amount: expect.any(Number), feel: "pushed" });
    expect(savedOptions().band.humanise.amount).toBeCloseTo(0.55, 5);
    expect(useSong.getState().applyGeneratedParts).not.toHaveBeenCalled();
  });

  it("the follow switch saves the setting, and the source select lists only the stems that exist", () => {
    useSong.setState({ stems: { guitar: song().audio, drums: song().audio } as never });
    renderPanel();
    expect((screen.getByRole("switch", { name: "Follow my playing" }) as HTMLButtonElement).getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Follow source" }), { key: "Enter" });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Auto", "Guitar", "Mix"]);
    fireEvent.click(screen.getByRole("option", { name: "Mix" }));
    expect(savedOptions().band.followSource).toBe("mix");
    fireEvent.click(screen.getByRole("switch", { name: "Follow my playing" }));
    expect(savedOptions().band.followPlaying).toBe(false);
  });

  it("says after Generate whether the parts followed the playing, or why they did not", async () => {
    useSong.setState({ stems: { guitar: song().audio } as never });
    stored({ beatGrid: grid, bandOutOfDate: true });
    const silent = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] };
    mocks.startBandRender.mockReturnValue({
      done: Promise.resolve({ drums: silent, bass: silent, notes: { drums: [], bass: [] }, follow: { source: "guitar", following: false } }),
      onProgress: vi.fn(),
      cancel: vi.fn(),
    });
    renderPanel({ chart: "[Am] [G]", sections: SECTIONS });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(screen.getByText("Follow my playing: not enough clear rhythm in the guitar")).toBeTruthy());
    expect(mocks.startBandRender.mock.calls[0][0].follow.source).toBe("guitar");
  });

  it("says after Generate how far under the song the generated drums and bass sit, and sends the stems for the match", async () => {
    useSong.setState({ stems: { drums: song().audio, bass: song().audio } as never });
    stored({ beatGrid: grid, bandOutOfDate: true });
    const silent = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] };
    mocks.startBandRender.mockReturnValue({
      done: Promise.resolve({
        drums: silent,
        bass: silent,
        notes: { drums: [], bass: [] },
        levels: {
          drums: { gainDb: 1, belowSongDb: 4, limitedByPeak: false },
          bass: { gainDb: -2, belowSongDb: 7.2, limitedByPeak: false },
        },
      }),
      onProgress: vi.fn(),
      cancel: vi.fn(),
    });
    renderPanel({ chart: "[Am] [G]", sections: SECTIONS });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(screen.getByText("Drums set 4.0 dB under the song, bass 7.2 dB under.")).toBeTruthy());
    const request = mocks.startBandRender.mock.calls[0][0];
    expect(request.originals.drums).toBe(useSong.getState().stems?.drums);
    expect(request.mix).toBeDefined();
  });

  it("finds the beat through the beat tracker and shows the tempo", async () => {
    mocks.startBeatGrid.mockReturnValue({ done: Promise.resolve(grid), cancel: vi.fn() });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Find the beat" }));
    expect(mocks.startBeatGrid).toHaveBeenCalledWith(expect.objectContaining({ sampleRate: 44100, beatsPerBar: 4, chordChanges: [] }));
    expect(await screen.findByText(/120\.0 BPM, steady, 16 beats/)).toBeTruthy();
    expect(savedOptions().beatGrid.beats).toHaveLength(16);
  });

  it("finds the beat from the tempo the performer set, while Use my tempo is on", () => {
    mocks.startBeatGrid.mockReturnValue({ done: Promise.resolve(grid), cancel: vi.fn() });
    renderPanel({ typedTempo: true, bpm: 98 });
    // On by default, so the typed tempo is the hint.
    fireEvent.click(screen.getByRole("button", { name: "Find the beat" }));
    expect(mocks.startBeatGrid).toHaveBeenLastCalledWith(expect.objectContaining({ tempoHint: 98 }));
  });

  it("finds the beat from the tracker's own tempo once Use my tempo is off", () => {
    mocks.startBeatGrid.mockReturnValue({ done: Promise.resolve(grid), cancel: vi.fn() });
    renderPanel({ typedTempo: true, bpm: 98 });
    fireEvent.click(screen.getByRole("checkbox", { name: /Use my tempo/ }));
    fireEvent.click(screen.getByRole("button", { name: "Find the beat" }));
    expect(mocks.startBeatGrid).toHaveBeenLastCalledWith(expect.objectContaining({ tempoHint: undefined }));
  });

  it("offers Use my tempo only when the tempo was set by hand", () => {
    renderPanel();
    expect(screen.queryByRole("checkbox", { name: /Use my tempo/ })).toBeNull();
  });

  it("applies the corrections to the stored grid", () => {
    stored({ beatGrid: grid });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Half tempo" }));
    expect(savedOptions().beatGrid.beats).toHaveLength(8);
    expect(savedOptions().beatGrid.bpm).toBeCloseTo(60, 5);
    // Doubling adds a midpoint between each pair of beats, so eight beats give fifteen.
    fireEvent.click(screen.getByRole("button", { name: "Double tempo" }));
    expect(savedOptions().beatGrid.beats).toHaveLength(15);
    fireEvent.click(screen.getByRole("button", { name: "Downbeat →" }));
    expect(savedOptions().beatGrid.downbeat).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Nudge +10 ms" }));
    expect(savedOptions().beatGrid.beats[0]).toBeCloseTo(0.01, 6);
    expect(savedOptions().bandOutOfDate).toBe(true);
  });

  it("sets the metronome only when asked, from a steady grid", () => {
    stored({ beatGrid: grid });
    const { props } = renderPanel();
    expect(props.onMetronome).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Set metronome to this tempo" }));
    expect(props.onMetronome).toHaveBeenCalledWith(120, 0);
  });

  it("generates the parts with the harmony and plans, applies them, and clears the out-of-date flag", async () => {
    stored({ beatGrid: grid, bandOutOfDate: true });
    const drums = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] };
    const bass = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] };
    mocks.startBandRender.mockReturnValue({
      done: Promise.resolve({ drums, bass, notes: { drums: [], bass: [] } }),
      onProgress: vi.fn(),
      cancel: vi.fn(),
    });
    renderPanel({ chart: "[Am] [G]", sections: SECTIONS });
    expect(screen.getByText(/Parts out of date/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(useSong.getState().applyGeneratedParts).toHaveBeenCalledWith({ drums, bass }, { playing: false, remove: [] }));
    const request = mocks.startBandRender.mock.calls[0][0];
    expect(request.grid.beats).toHaveLength(16);
    expect(request.harmony).toHaveLength(16);
    expect(request.plans.map((plan: { sectionId: string }) => plan.sectionId)).toEqual(["verse", "chorus"]);
    await waitFor(() => expect(savedOptions().bandOutOfDate).toBe(false));
    expect(screen.queryByText(/Parts out of date/)).toBeNull();
  });

  it("keeps the clean bass and says why when the bass tone's capture is not on this computer", async () => {
    const bassTone = { kind: "nam", capture: { source: "tone3000", toneId: 42, modelId: 7, name: "Bass amp" }, ir: null, inputDb: 0, outputDb: 0, blend: 1 };
    stored({ beatGrid: grid, bandOutOfDate: true, band: { ...DEFAULT_BAND_SETTINGS, bassTone } });
    const drums = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] };
    const bass = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] };
    mocks.startBandRender.mockReturnValue({ done: Promise.resolve({ drums, bass, notes: { drums: [], bass: [] } }), onProgress: vi.fn(), cancel: vi.fn() });
    renderPanel({ chart: "[Am] [G]", sections: SECTIONS });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(useSong.getState().applyGeneratedParts).toHaveBeenCalledWith({ drums, bass }, { playing: false, remove: [] }));
    expect(mocks.tones.readNam).toHaveBeenCalledWith(42, 7);
    expect(mocks.chain).not.toHaveBeenCalled();
    expect(screen.getByText(/The bass plays clean, because Bass amp couldn't be loaded/)).toBeTruthy();
  });

  it("renders the bass through the capture at Generate, shows the Bass tone step, and saves the toned bass", async () => {
    const bassTone = { kind: "nam", capture: { source: "tone3000", toneId: 42, modelId: 7, name: "Bass amp" }, ir: null, inputDb: 0, outputDb: 0, blend: 1 };
    stored({ beatGrid: grid, bandOutOfDate: true, band: { ...DEFAULT_BAND_SETTINGS, bassTone } });
    mocks.tones.readNam.mockResolvedValueOnce("capture-text");
    const drums = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] };
    const bass = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS).fill(0.5)] };
    mocks.startBandRender.mockReturnValue({ done: Promise.resolve({ drums, bass, notes: { drums: [], bass: [] } }), onProgress: vi.fn(), cancel: vi.fn() });
    let finishChain: (audio: Float32Array) => void = () => {};
    mocks.chain.mockImplementationOnce(() => new Promise<Float32Array>((resolve) => (finishChain = resolve)));
    renderPanel({ chart: "[Am] [G]", sections: SECTIONS });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByText("Bass tone…")).toBeTruthy();
    const [blocks, sent] = mocks.chain.mock.calls[0] as unknown as [{ type: string; model: string }[], Float32Array];
    expect(blocks[0]).toMatchObject({ type: "capture", model: "capture-text" });
    finishChain(new Float32Array(sent.length).fill(0.25));
    await waitFor(() => expect(useSong.getState().applyGeneratedParts).toHaveBeenCalledTimes(1));
    const [saved] = (useSong.getState().applyGeneratedParts as unknown as { mock: { calls: [[{ bass: PcmAudio }]] } }).mock.calls[0];
    // The chain's level is matched to the clean bass (0.5), so a quiet chain (0.25) comes back to the clean loudness.
    expect(saved.bass.channels[0][20000]).toBeCloseTo(0.5, 2);
  });

  it("renders the drums through the drum chain before they reach the mixer, and the bass chain still works with it", async () => {
    const outboard = {
      type: "capture",
      role: "outboard",
      file: { source: "tone3000", toneId: 5, modelId: 9, name: "Bus comp" },
      inputDb: 0,
      outputDb: 0,
      mix: 1,
      on: true,
    };
    const amp = {
      type: "capture",
      role: "amp",
      file: { source: "tone3000", toneId: 42, modelId: 7, name: "Bass amp" },
      inputDb: 0,
      outputDb: 0,
      mix: 1,
      on: true,
    };
    const drumTone = { kind: "chain", blocks: [outboard], dryWet: 1, fast: false };
    const bassTone = { kind: "chain", blocks: [amp], dryWet: 1, fast: false };
    stored({ beatGrid: grid, bandOutOfDate: true, band: { ...DEFAULT_BAND_SETTINGS, drumTone, bassTone } });
    mocks.tones.readNam.mockImplementation(async (toneId: number) => `capture-${toneId}`);
    const drums = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS).fill(0.5), new Float32Array(44100 * SECONDS).fill(0.5)] };
    const bass = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS).fill(0.5)] };
    mocks.startBandRender.mockReturnValue({ done: Promise.resolve({ drums, bass, notes: { drums: [], bass: [] } }), onProgress: vi.fn(), cancel: vi.fn() });
    let finishDrums: (audio: Float32Array) => void = () => {};
    mocks.chain.mockImplementationOnce(() => new Promise<Float32Array>((resolve) => (finishDrums = resolve)));
    mocks.chain.mockImplementation(async (_blocks, input) => input.map((v) => v * 0.5));
    renderPanel({ chart: "[Am] [G]", sections: SECTIONS });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByText("Applying the drum tone…")).toBeTruthy();
    expect(useSong.getState().applyGeneratedParts).not.toHaveBeenCalled();
    const [blocks, sent] = mocks.chain.mock.calls[0] as unknown as [{ role: string; model: string }[], Float32Array];
    expect(blocks[0]).toMatchObject({ role: "outboard", model: "capture-5" });
    finishDrums(new Float32Array(sent.length).fill(0.25));
    await waitFor(() => expect(useSong.getState().applyGeneratedParts).toHaveBeenCalledTimes(1));
    const [saved] = (useSong.getState().applyGeneratedParts as unknown as { mock: { calls: [[{ drums: PcmAudio; bass: PcmAudio }]] } }).mock.calls[0];
    expect(saved.drums.channels).toHaveLength(2);
    expect(saved.drums.channels[0][20000]).toBeCloseTo(0.5, 2);
    expect(saved.drums.channels[1][20000]).toBeCloseTo(0.5, 2);
    // Each part is rendered once and then a click goes through the same chain to measure its delay: two parts, four calls.
    expect(mocks.chain).toHaveBeenCalledTimes(4);
    expect(mocks.tones.readNam).toHaveBeenCalledWith(42, 7);
  });

  it("keeps the clean drums and says why when the drum tone's capture is not on this computer", async () => {
    const outboard = {
      type: "capture",
      role: "outboard",
      file: { source: "tone3000", toneId: 5, modelId: 9, name: "Bus comp" },
      inputDb: 0,
      outputDb: 0,
      mix: 1,
      on: true,
    };
    stored({
      beatGrid: grid,
      bandOutOfDate: true,
      band: { ...DEFAULT_BAND_SETTINGS, drumTone: { kind: "chain", blocks: [outboard], dryWet: 1, fast: false } },
    });
    mocks.tones.readNam.mockRejectedValueOnce(new Error("Bus comp isn't there anymore"));
    const drums = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS), new Float32Array(44100 * SECONDS)] };
    const bass = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] };
    mocks.startBandRender.mockReturnValue({ done: Promise.resolve({ drums, bass, notes: { drums: [], bass: [] } }), onProgress: vi.fn(), cancel: vi.fn() });
    renderPanel({ chart: "[Am] [G]", sections: SECTIONS });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(useSong.getState().applyGeneratedParts).toHaveBeenCalledWith({ drums, bass }, { playing: false, remove: [] }));
    expect(screen.getByText(/The drums play clean, because Bus comp couldn't be loaded/)).toBeTruthy();
  });

  it("asks before removing the generated parts, and removes them only on confirm", async () => {
    useSong.setState({ tracks: { track1: { kind: "user", name: "Drums (generated)", bus: "main", transpose: false } } });
    stored({ beatGrid: grid });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Remove generated parts" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Remove the generated parts?")).toBeTruthy();
    expect(useSong.getState().removeGeneratedParts).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(useSong.getState().removeGeneratedParts).toHaveBeenCalledWith({ playing: false });
  });

  it("writes the section overrides, and a row's drums and fill", () => {
    renderPanel({ sections: SECTIONS });
    expect(screen.getByRole("button", { name: "Verse" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Fill at the end of Verse" }));
    expect(savedOptions().band.sections.verse.fill).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "Drums in Chorus" }));
    expect(savedOptions().band.sections.chorus.play).toEqual({ drums: false, bass: true });
    pick(screen.getByRole("combobox", { name: "Energy of Chorus" }), "5");
    expect(savedOptions().band.sections.chorus.energy).toBe(5);
  });

  it("edits the one row of a song without sections, and saves it under the whole-song key", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Whole song" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Fill at the end of Whole song" }));
    expect(savedOptions().band.sections.song.fill).toBe(false);
    pick(screen.getByRole("combobox", { name: "Energy of Whole song" }), "5");
    expect(savedOptions().band.sections.song.energy).toBe(5);
    pick(screen.getByRole("combobox", { name: "Style of Whole song" }), "Metal");
    expect(savedOptions().band.sections.song.style).toBe("metal");
    fireEvent.click(screen.getByRole("checkbox", { name: "Bass in Whole song" }));
    expect(savedOptions().band.sections.song.play).toEqual({ drums: true, bass: false });
  });

  it("sets each section's bass part, busy and loud, and saves them as the other columns do", () => {
    renderPanel({ sections: SECTIONS });
    pick(screen.getByRole("combobox", { name: "Bass part of Chorus" }), "Groove");
    expect(savedOptions().band.sections.chorus.bassPart).toBe("groove");
    pick(screen.getByRole("combobox", { name: "Busy of Chorus" }), "2");
    expect(savedOptions().band.sections.chorus.busy).toBe(2);
    pick(screen.getByRole("combobox", { name: "Loud of Chorus" }), "5");
    expect(savedOptions().band.sections.chorus.loud).toBe(5);
    expect(savedOptions().bandOutOfDate).toBe(true);
  });

  it("shows the part Auto resolved to, in muted text, and drops it once a part is chosen", () => {
    renderPanel({ sections: SECTIONS });
    // Verse is quiet (energy 2, so busy 2 and a ring), chorus is busy 4 and plays melodic.
    expect(screen.getByText("Auto · Ring out")).toBeTruthy();
    expect(screen.getByText("Auto · Melodic")).toBeTruthy();
    pick(screen.getByRole("combobox", { name: "Bass part of Verse" }), "Root pulse");
    expect(screen.queryByText("Auto · Ring out")).toBeNull();
    expect(savedOptions().band.sections.verse.bassPart).toBe("pulse");
  });

  it("saves each More option: octave, fills, hit the one, slides, dead notes and pickups", () => {
    renderPanel({ sections: SECTIONS });
    fireEvent.click(screen.getByRole("button", { name: "More bass options for Verse" }));
    pick(screen.getByRole("combobox", { name: "Octave of Verse" }), "+1 octave");
    expect(savedOptions().band.sections.verse.octave).toBe(1);
    pick(screen.getByRole("combobox", { name: "Fills of Verse" }), "3");
    expect(savedOptions().band.sections.verse.fills).toBe(3);
    fireEvent.click(screen.getByRole("checkbox", { name: "Hit the one in Verse" }));
    expect(savedOptions().band.sections.verse.hitTheOne).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Slides in Verse" }));
    expect(savedOptions().band.sections.verse.slides).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Dead notes in Verse" }));
    expect(savedOptions().band.sections.verse.deadNotes).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Pickups in Verse" }));
    expect(savedOptions().band.sections.verse.pickups).toBe(false);
  });

  it("shows the style default beside the three techniques in More", () => {
    renderPanel({ sections: SECTIONS });
    fireEvent.click(screen.getByRole("button", { name: "More bass options for Verse" }));
    // The rock style plays pickups by default and no slides or dead notes.
    expect(screen.getByText("Style: on")).toBeTruthy();
    expect(screen.getAllByText("Style: off").length).toBeGreaterThanOrEqual(2);
  });

  it("gives the whole-song row the same bass controls, saved under the whole-song key", () => {
    renderPanel();
    pick(screen.getByRole("combobox", { name: "Bass part of Whole song" }), "Melodic");
    expect(savedOptions().band.sections.song.bassPart).toBe("melodic");
    pick(screen.getByRole("combobox", { name: "Busy of Whole song" }), "4");
    expect(savedOptions().band.sections.song.busy).toBe(4);
  });

  it("saves the default bass part and the feel, and says what the default part is for", () => {
    renderPanel({ sections: SECTIONS });
    expect(screen.getByText("Used where a section is on Auto and has no rule of its own.")).toBeTruthy();
    pick(screen.getByRole("combobox", { name: "Default bass part" }), "Walking");
    expect(savedOptions().band.defaultBassPart).toBe("walking");
    const feel = document.querySelector<HTMLElement>('[aria-label="Bass feel"] [role="slider"]');
    expect(feel).toBeTruthy();
    fireEvent.keyDown(feel!, { key: "ArrowRight" });
    expect(savedOptions().band.bassFeel).toBeCloseTo(0.55, 2);
  });

  it("keeps the section table in its own scroll container, so the dialog does not widen", () => {
    renderPanel({ sections: SECTIONS });
    const table = screen.getByRole("table");
    expect(table.parentElement?.className).toContain("overflow-x-auto");
    expect(table.className).toContain("min-w-[56rem]");
    expect(screen.getByText(/Energy shapes the drums\. Busy and Loud shape the bass/)).toBeTruthy();
  });

  it("detects chords from the audio when the chart and the analysis have none, and generates with them", async () => {
    stored({ beatGrid: grid });
    mocks.startChordDetection.mockReturnValue({ done: Promise.resolve([{ time: 0, name: "Am", confidence: 0.9 }]), cancel: vi.fn() });
    const drums = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] };
    mocks.startBandRender.mockReturnValue({ done: Promise.resolve({ drums, notes: { drums: [], bass: [] } }), onProgress: vi.fn(), cancel: vi.fn() });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(mocks.startBandRender).toHaveBeenCalled());
    expect(mocks.startChordDetection).toHaveBeenCalledWith(expect.objectContaining({ harmony: expect.objectContaining({ sampleRate: 44100 }) }));
    expect(mocks.startBandRender.mock.calls[0][0].harmony[0].chord?.name).toBe("Am");
    expect(screen.queryByText(/No chords were found/)).toBeNull();
  });

  it("says the bass will rest when detection finds nothing either", async () => {
    stored({ beatGrid: grid });
    mocks.startBandRender.mockReturnValue({ done: Promise.resolve({ notes: { drums: [], bass: [] } }), onProgress: vi.fn(), cancel: vi.fn() });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByText(/No chords were found in the chart or the audio/)).toBeTruthy();
    expect(mocks.startBandRender).toHaveBeenCalled();
  });

  it("does not detect chords when the bass is off", async () => {
    stored({ beatGrid: grid, band: { parts: { drums: true, bass: false } } });
    mocks.startBandRender.mockReturnValue({ done: Promise.resolve({ notes: { drums: [], bass: [] } }), onProgress: vi.fn(), cancel: vi.fn() });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(mocks.startBandRender).toHaveBeenCalled());
    expect(mocks.startChordDetection).not.toHaveBeenCalled();
  });

  it("cancels chord detection with the Cancel button, and changes no track", async () => {
    stored({ beatGrid: grid });
    let fail: (error: Error) => void = () => {};
    const cancel = vi.fn(() => {
      const error = new Error("Chord detection was cancelled.");
      error.name = "AbortError";
      fail(error);
    });
    mocks.startChordDetection.mockReturnValue({ done: new Promise<never>((_, reject) => (fail = reject)), cancel });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalled();
    expect(await screen.findByText("Generating the parts was cancelled. The tracks were not changed.")).toBeTruthy();
    expect(mocks.startBandRender).not.toHaveBeenCalled();
    expect(useSong.getState().applyGeneratedParts).not.toHaveBeenCalled();
  });

  it("passes a turned-off part to the store, so its generated track goes in the same update", async () => {
    stored({ beatGrid: grid, band: { parts: { drums: false, bass: true } } });
    const bass = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] };
    mocks.startBandRender.mockReturnValue({ done: Promise.resolve({ bass, notes: { drums: [], bass: [] } }), onProgress: vi.fn(), cancel: vi.fn() });
    renderPanel({ chart: "[C]" });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(useSong.getState().applyGeneratedParts).toHaveBeenCalledWith({ drums: undefined, bass }, { playing: false, remove: ["drums"] }));
  });

  it("shows the notice a generation returns, and keeps the flag when the parts were refused", async () => {
    stored({ beatGrid: grid, bandOutOfDate: true });
    useSong.setState({ applyGeneratedParts: vi.fn(() => ["Stop playback to change the generated parts."]) });
    mocks.startBandRender.mockReturnValue({
      done: Promise.resolve({ drums: { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] }, notes: { drums: [], bass: [] } }),
      onProgress: vi.fn(),
      cancel: vi.fn(),
    });
    renderPanel({ chart: "[C]" });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByText("Stop playback to change the generated parts.")).toBeTruthy();
    expect(screen.getByText(/Parts out of date/)).toBeTruthy();
  });

  it("with no song loaded, disables every action and says to open a song", () => {
    useSong.setState({ source: null });
    stored({ beatGrid: grid, band: { parts: { drums: true, bass: true } } });
    renderPanel();
    expect(screen.getByText("Open a song to generate parts.")).toBeTruthy();
    for (const name of [
      "Find the beat",
      "Use fixed BPM",
      "Half tempo",
      "Double tempo",
      "Downbeat ←",
      "Downbeat →",
      "Nudge −10 ms",
      "Nudge +10 ms",
      "Set metronome to this tempo",
      "Generate",
      "Try another",
      "Preview",
    ]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled, name).toBe(true);
    }
    fireEvent.click(screen.getByRole("button", { name: "Find the beat" }));
    expect(mocks.startBeatGrid).not.toHaveBeenCalled();
    expect(useBandPanel.getState().open).toBe(true);
  });

  it("keeps the panel open and shows as a notice when the beat tracker cannot start", async () => {
    mocks.startBeatGrid.mockImplementation(() => {
      throw new Error("The beat tracker could not start.");
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Find the beat" }));
    expect(await screen.findByText("The beat tracker could not start.")).toBeTruthy();
    expect(screen.queryByText("Finding the beat…")).toBeNull();
    expect(useBandPanel.getState().open).toBe(true);
    expect((screen.getByRole("button", { name: "Find the beat" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the panel open and shows as a notice when a generation cannot start", async () => {
    mocks.startChordDetection.mockReturnValue({ done: Promise.resolve([]), cancel: vi.fn() });
    mocks.startBandRender.mockImplementation(() => {
      throw new Error("The samples could not load.");
    });
    stored({ beatGrid: grid });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByText("The samples could not load.")).toBeTruthy();
    expect(screen.queryByText("Writing the notes…")).toBeNull();
    expect(useBandPanel.getState().open).toBe(true);
    expect((screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says why nothing is generated when there is no grid, and when no part is on", () => {
    renderPanel();
    expect((screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    stored({ beatGrid: grid, band: { parts: { drums: false, bass: false } } });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(screen.getByText("Turn on drums or bass first.")).toBeTruthy();
    expect(mocks.startBandRender).not.toHaveBeenCalled();
  });
});

describe("Band panel: what plays", () => {
  const GENERATED_DRUMS = { kind: "user" as const, name: "Drums (generated)", bus: "main" as const, transpose: false };
  const pcm = () => ({ sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] });

  it("offers Generated and Both only for a part that has a generated track", () => {
    renderPanel();
    const drums = screen.getByRole("group", { name: "Drums" });
    expect(within(drums).getByRole("button", { name: "Original" }).getAttribute("aria-pressed")).toBe("true");
    expect((within(drums).getByRole("button", { name: "Generated" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(drums).getByRole("button", { name: "Both" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(drums).getByText("Generate the drums first.")).toBeTruthy();
  });

  it("shows Original pressed when the saved choice is Generated but the generated track is gone, and keeps the saved choice", () => {
    const { props } = renderPanel({ partChoices: { drums: "generated", bass: "original" } });
    const drums = screen.getByRole("group", { name: "Drums" });
    expect(within(drums).getByRole("button", { name: "Original" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(drums).getByRole("button", { name: "Generated" }).getAttribute("aria-pressed")).toBe("false");
    expect(props.onPartChoice).not.toHaveBeenCalled();
  });

  it("shows the saved Generated choice again once the generated track is back", () => {
    useSong.setState({ tracks: { track1: GENERATED_DRUMS } });
    renderPanel({ partChoices: { drums: "generated", bass: "original" } });
    const drums = screen.getByRole("group", { name: "Drums" });
    expect(within(drums).getByRole("button", { name: "Generated" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(drums).getByRole("button", { name: "Original" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("reports a choice for the part that was picked", () => {
    useSong.setState({ tracks: { track1: GENERATED_DRUMS } });
    const { props } = renderPanel();
    const drums = screen.getByRole("group", { name: "Drums" });
    fireEvent.click(within(drums).getByRole("button", { name: "Both" }));
    expect(props.onPartChoice).toHaveBeenCalledWith({ drums: "both" });
  });

  it("keeps the rows usable during playback, while the Band actions stay disabled", () => {
    useSong.setState({ tracks: { track1: GENERATED_DRUMS } });
    const { props } = renderPanel({ playing: true });
    const drums = screen.getByRole("group", { name: "Drums" });
    const generated = within(drums).getByRole("button", { name: "Generated" }) as HTMLButtonElement;
    expect(generated.disabled).toBe(false);
    fireEvent.click(generated);
    expect(props.onPartChoice).toHaveBeenCalledWith({ drums: "generated" });
    expect((screen.getByRole("button", { name: "Generate" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("switches a part that was on its original to its generated track after Generate, and says so", async () => {
    stored({ beatGrid: grid, bandOutOfDate: true });
    useSong.setState({ stems: { drums: pcm(), bass: pcm() } as never });
    mocks.startBandRender.mockReturnValue({
      done: Promise.resolve({ drums: pcm(), bass: pcm(), notes: { drums: [], bass: [] } }),
      onProgress: vi.fn(),
      cancel: vi.fn(),
    });
    const { props } = renderPanel({ chart: "[Am] [G]", sections: SECTIONS, partChoices: ORIGINAL_PARTS });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(props.onPartChoice).toHaveBeenCalledWith({ drums: "generated", bass: "generated" }));
    expect(screen.getByText("Now playing the generated drums and bass. Switch back under What plays.")).toBeTruthy();
  });

  it("keeps a Both choice when Generate runs again", async () => {
    stored({ beatGrid: grid, bandOutOfDate: true });
    mocks.startBandRender.mockReturnValue({
      done: Promise.resolve({ drums: pcm(), bass: null, notes: { drums: [], bass: [] } }),
      onProgress: vi.fn(),
      cancel: vi.fn(),
    });
    const { props } = renderPanel({ chart: "[Am] [G]", sections: SECTIONS, partChoices: { drums: "both", bass: "original" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(useSong.getState().applyGeneratedParts).toHaveBeenCalled());
    await waitFor(() => expect(savedOptions().bandOutOfDate).toBe(false));
    expect(props.onPartChoice).not.toHaveBeenCalledWith(expect.objectContaining({ drums: "generated" }));
  });

  it("resets both parts to their originals once the generated parts are removed", () => {
    useSong.setState({ tracks: { track1: GENERATED_DRUMS } });
    stored({ beatGrid: grid });
    const { props } = renderPanel({ partChoices: { drums: "generated", bass: "original" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove generated parts" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Remove" }));
    expect(props.onPartChoice).toHaveBeenCalledWith(ORIGINAL_PARTS);
  });

  it("says a found part can still be replaced, and that the parts switch under What plays", () => {
    useSong.setState({ missingParts: { drums: "present", bass: "absent", absentSections: { drums: [], bass: [] } } });
    renderPanel();
    expect(screen.getByText("Drums found in the song")).toBeTruthy();
    expect(screen.getByText("You can still generate your own and switch between them under What plays.")).toBeTruthy();
  });
});

describe("Band panel layout", () => {
  it("scrolls a long beat grid inside its own strip, not the dialog", () => {
    // 800 beats is a five-minute song at 120 BPM. The strip is wider than the dialog, so only the strip may scroll sideways.
    stored({ beatGrid: fixedBeatGrid(120, 0, 4, 400) });
    renderPanel();
    const dialog = screen.getByRole("dialog");
    const strip = screen.getByRole("list", { name: "Beat grid" });
    expect(strip.className).toContain("overflow-x-auto");
    expect(strip.className).toContain("min-w-0");
    expect(strip.querySelectorAll('[role="listitem"]').length).toBe(200);

    // Nothing between the strip and the dialog may be a second sideways scroller, and the dialog itself must not scroll sideways.
    for (let el: HTMLElement | null = strip.parentElement; el && el !== dialog; el = el.parentElement) {
      expect(el.className).not.toContain("overflow-x-auto");
    }
    expect(dialog.className).not.toContain("overflow-x-auto");
    expect(dialog.className).toContain("flex-col");
    expect(dialog.className).toContain("min-w-0");
    // The panel's own body and the grid section can shrink to the dialog's width, so the settings and the table keep to it.
    const body = dialog.querySelector('[aria-label="Band status"]')?.parentElement;
    expect(body?.className).toContain("min-w-0");
    expect(screen.getByRole("region", { name: "Beat grid" }).className).toContain("min-w-0");
  });

  it("keeps the dialog free of fixed widths wider than the dialog", () => {
    stored({ beatGrid: fixedBeatGrid(120, 0, 4, 400) });
    renderPanel();
    const dialog = screen.getByRole("dialog");
    const fixedWide = [...dialog.querySelectorAll<HTMLElement>("*")].filter((el) => /(^|\s)w-\[\d{4,}/.test(el.className) || el.style.width);
    expect(fixedWide).toEqual([]);
  });
});

describe("Band footer and preview", () => {
  it("shows progress in the footer outside the scrolling body, then Done with Close and Play from", async () => {
    stored({ beatGrid: grid });
    const drums = { sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] };
    let finish!: (value: unknown) => void;
    let stage!: (stage: string) => void;
    mocks.startBandRender.mockReturnValue({
      done: new Promise((resolve) => (finish = resolve)),
      onProgress: (callback: (stage: string) => void) => (stage = callback),
      cancel: vi.fn(),
    });
    const onPlayFrom = vi.fn();
    renderPanel({ sections: SECTIONS, onPlayFrom });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    const footer = screen.getByRole("contentinfo", { name: "Band actions" });
    await within(footer).findByText("Loading the drum and bass samples…");
    stage("rendering");
    await within(footer).findByText("Rendering the parts…");
    expect(within(footer).getByRole("button", { name: "Cancel" })).toBeTruthy();
    // The footer is not inside the scrolling body, and the beat grid section does not repeat the progress.
    const body = screen.getByRole("region", { name: "Band status" }).parentElement as HTMLElement;
    expect(body.className).toContain("overflow-y-auto");
    expect(body.contains(footer)).toBe(false);
    expect(within(screen.getByRole("region", { name: "Beat grid" })).queryByText("Rendering the parts…")).toBeNull();
    finish({ drums, notes: { drums: [], bass: [] } });
    await within(footer).findByText("Done. Drums and bass are in the mixer.");
    fireEvent.click(screen.getByRole("button", { name: "Chorus" }));
    fireEvent.click(within(footer).getByRole("button", { name: "Play from Chorus" }));
    expect(onPlayFrom).toHaveBeenCalledWith(4);
    expect(useBandPanel.getState().open).toBe(false);
  });

  it("closes from Done without playing", async () => {
    stored({ beatGrid: grid });
    mocks.startBandRender.mockReturnValue({ done: Promise.resolve({ notes: { drums: [], bass: [] } }), onProgress: vi.fn(), cancel: vi.fn() });
    renderPanel({ sections: SECTIONS, onPlayFrom: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Close" }));
    expect(useBandPanel.getState().open).toBe(false);
  });

  it("lists the sections in the preview menu and previews the chosen one from its start", async () => {
    stored({ beatGrid: grid });
    const drums = { sampleRate: 44100, channels: [new Float32Array(44100 * 4)] };
    mocks.renderPreview.mockReturnValue({ done: new Promise(() => undefined), cancel: vi.fn() });
    renderPanel({ sections: SECTIONS });
    const trigger = screen.getByRole("combobox", { name: "Preview section" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Verse", "Chorus", "From the playhead"]);
    fireEvent.click(screen.getByRole("option", { name: "Chorus" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    // The chorus starts at 4 s and runs to the song's end: 4 s at 120 BPM is 2 bars.
    await waitFor(() => expect(mocks.renderPreview).toHaveBeenCalledTimes(1));
    expect(mocks.renderPreview.mock.calls[0].slice(1)).toEqual([4, 2]);
    expect(drums).toBeTruthy();
  });

  it("previews 4 bars from the playhead", async () => {
    stored({ beatGrid: grid });
    mocks.renderPreview.mockReturnValue({ done: new Promise(() => undefined), cancel: vi.fn() });
    renderPanel({ sections: SECTIONS, getPosition: () => 1.5 });
    pick(screen.getByRole("combobox", { name: "Preview section" }), "From the playhead");
    pick(screen.getByRole("combobox", { name: "Preview length" }), "4 bars");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() => expect(mocks.renderPreview).toHaveBeenCalledTimes(1));
    expect(mocks.renderPreview.mock.calls[0].slice(1)).toEqual([1.5, 4]);
  });
});

describe("Band entry point", () => {
  const CHOICES: PartChoices = ORIGINAL_PARTS;
  const STEM: PcmAudio = { sampleRate: 44100, channels: [new Float32Array(1)] };
  const ORIGINAL_STEMS = { drums: STEM, bass: STEM };
  const GENERATED_TRACKS = {
    "gen-drums": { kind: "user" as const, name: GENERATED_PART_NAMES.drums },
    "gen-bass": { kind: "user" as const, name: GENERATED_PART_NAMES.bass },
  } as Record<string, TrackInfo>;

  function renderEntry(choices: PartChoices = CHOICES) {
    return render(<BandPanelButton sections={[]} partChoices={choices} />);
  }

  it("names the action and says what it does, without a generated part yet", () => {
    renderEntry();
    expect(screen.getByRole("button", { name: "Generate drums & bass…" })).toBeTruthy();
    expect(screen.getByText("Make drum and bass parts that follow this song, and choose what plays.")).toBeTruthy();
    expect(screen.queryByText(/Generated:/)).toBeNull();
  });

  it("shows the generated parts and what plays once the song has them", () => {
    useSong.setState({ stems: ORIGINAL_STEMS, tracks: GENERATED_TRACKS, missingParts: null });
    renderEntry({ drums: "generated", bass: "original" });
    expect(screen.getByRole("button", { name: "Drums & bass…" })).toBeTruthy();
    expect(screen.getByText("Generated: drums, bass. Playing generated drums, original bass.")).toBeTruthy();
  });

  it("names a part the split did not find", () => {
    useSong.setState({
      stems: { bass: STEM },
      tracks: {},
      missingParts: { drums: "absent", bass: "present", absentSections: { drums: [], bass: [] } },
    });
    renderEntry();
    expect(screen.getByText("No drums found.")).toBeTruthy();
    expect(screen.queryByText(/No bass found/)).toBeNull();
  });

  it("opens the Band panel when pressed", () => {
    renderEntry();
    expect(useBandPanel.getState().open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Generate drums & bass…" }));
    expect(useBandPanel.getState().open).toBe(true);
  });
});

/** Stereo audio of `seconds`, silent but for 60 ms tone bursts at each of `times`: a rendered part with its hits where the test puts them. */
function hitsAudio(seconds: number, times: number[]): PcmAudio {
  const frames = Math.round(seconds * 44100);
  const channel = new Float32Array(frames);
  for (const time of times) {
    const start = Math.round(time * 44100);
    for (let i = 0; i < Math.round(0.06 * 44100) && start + i < frames; i++) {
      channel[start + i] = 0.8 * Math.sin((2 * Math.PI * 220 * i) / 44100) * Math.exp(-i / (0.02 * 44100));
    }
  }
  return { sampleRate: 44100, channels: [channel, channel.slice()] };
}

/** The hidden file input of a row, found by its button: the row's button opens it. */
function fileInputOf(kind: "drums" | "bass"): HTMLInputElement {
  const row = screen.getByRole("button", { name: `Use my rendered ${kind}…` }).parentElement!;
  return row.querySelector<HTMLInputElement>('input[type="file"]')!;
}

function pickFile(kind: "drums" | "bass", name = `${kind}.wav`) {
  fireEvent.change(fileInputOf(kind), { target: { files: [new File(["x"], name, { type: "audio/wav" })] } });
}

describe("rendered parts", () => {
  const SILENT_NOTES = { drums: [], bass: [] };
  const silent = () => ({ sampleRate: 44100, channels: [new Float32Array(44100 * SECONDS)] });

  it("uses a rendered file that is in line with the first note, keeps What plays, and records the file", async () => {
    stored({ beatGrid: grid, band: { ...DEFAULT_BAND_SETTINGS, firstNote: { drums: 0.5 } } });
    mocks.decodeAudioFile.mockResolvedValueOnce(hitsAudio(SECONDS, [0.5, 1, 1.5]));
    const choices = { drums: "generated" as const, bass: "original" as const };
    renderPanel({ chart: "[Am] [G]", partChoices: choices });
    pickFile("drums", "drums.wav");
    await waitFor(() => expect(useSong.getState().applyGeneratedParts).toHaveBeenCalledTimes(1));
    const [parts, options] = (useSong.getState().applyGeneratedParts as unknown as { mock: { calls: [[{ drums: PcmAudio }, unknown]] } }).mock.calls[0];
    expect(Object.keys(parts)).toEqual(["drums"]);
    expect(parts.drums.channels[0].length).toBe(44100 * SECONDS);
    expect(options).toEqual({ playing: false });
    expect(savedOptions().band.rendered.drums).toMatchObject({ name: "drums.wav" });
    expect(screen.getByText("Using your rendered drums: drums.wav")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Line up with the first note/ })).toBeNull();
  });

  it("offers to line up a file whose first hit is 300 ms late, and moves it only when the performer chooses", async () => {
    stored({ beatGrid: grid, band: { ...DEFAULT_BAND_SETTINGS, firstNote: { drums: 0.5 } } });
    mocks.decodeAudioFile.mockResolvedValueOnce(hitsAudio(SECONDS, [0.8, 1.3]));
    renderPanel({ chart: "[Am] [G]" });
    pickFile("drums");
    // The hit is at about 0.80 s, so it is about 300 ms after the note.
    expect(await screen.findByText(/The first hit is 30\d ms after the first note\./)).toBeTruthy();
    expect(useSong.getState().applyGeneratedParts).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Line up with the first note \(moves it 30\d ms earlier\)/ }));
    await waitFor(() => expect(useSong.getState().applyGeneratedParts).toHaveBeenCalledTimes(1));
    const [parts] = (useSong.getState().applyGeneratedParts as unknown as { mock: { calls: [[{ drums: PcmAudio }]] } }).mock.calls[0];
    // The first hit was at 0.8 s; moved 300 ms earlier, it is at 0.5 s.
    const first = parts.drums.channels[0].findIndex((v) => Math.abs(v) > 0.05);
    expect(Math.abs(first / 44100 - 0.5)).toBeLessThan(0.02);
  });

  it("uses the file as it is when the performer declines the line-up", async () => {
    stored({ beatGrid: grid, band: { ...DEFAULT_BAND_SETTINGS, firstNote: { drums: 0.5 } } });
    mocks.decodeAudioFile.mockResolvedValueOnce(hitsAudio(SECONDS, [0.8]));
    renderPanel({ chart: "[Am] [G]" });
    pickFile("drums");
    fireEvent.click(await screen.findByRole("button", { name: "Use as it is" }));
    await waitFor(() => expect(useSong.getState().applyGeneratedParts).toHaveBeenCalledTimes(1));
    const [parts] = (useSong.getState().applyGeneratedParts as unknown as { mock: { calls: [[{ drums: PcmAudio }]] } }).mock.calls[0];
    expect(Math.abs(parts.drums.channels[0].findIndex((v) => Math.abs(v) > 0.05) / 44100 - 0.8)).toBeLessThan(0.02);
  });

  it("refuses a file more than 5 s away from the song's length, and applies nothing", async () => {
    stored({ beatGrid: grid });
    mocks.decodeAudioFile.mockResolvedValueOnce(hitsAudio(SECONDS + 6, [0.5]));
    renderPanel({ chart: "[Am] [G]" });
    pickFile("bass", "bass.wav");
    expect(await screen.findByText(/bass\.wav is 6\.0 s away from the song's length \(over 5 s\), so it was not used\./)).toBeTruthy();
    expect(useSong.getState().applyGeneratedParts).not.toHaveBeenCalled();
  });

  it("is disabled while playing, and says why", () => {
    renderPanel({ chart: "[Am] [G]", playing: true });
    expect((screen.getByRole("button", { name: "Use my rendered drums…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Use my rendered bass…" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks before Generate replaces a rendered drum, and does not generate until the performer agrees", async () => {
    stored({ beatGrid: grid, band: { ...DEFAULT_BAND_SETTINGS, rendered: { drums: { name: "drums.wav", importedAt: "2026-10-30T10:00:00.000Z" } } } });
    mocks.startBandRender.mockReturnValue({
      done: Promise.resolve({ drums: silent(), bass: silent(), notes: SILENT_NOTES }),
      onProgress: vi.fn(),
      cancel: vi.fn(),
    });
    renderPanel({ chart: "[Am] [G]", sections: SECTIONS });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    expect(await screen.findByText("Replace your rendered drums with new generated drums?")).toBeTruthy();
    expect(mocks.startBandRender).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep my rendered part" }));
    expect(mocks.startBandRender).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    await waitFor(() => expect(mocks.startBandRender).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(savedOptions().band.rendered.drums).toBeUndefined());
  });

  it("Back to generated renders that part alone, leaves the other part's track, and forgets the rendered file", async () => {
    stored({ beatGrid: grid, band: { ...DEFAULT_BAND_SETTINGS, rendered: { drums: { name: "drums.wav", importedAt: "2026-10-30T10:00:00.000Z" } } } });
    const drums = silent();
    mocks.startBandRender.mockReturnValue({
      done: Promise.resolve({ drums, notes: { drums: [{ time: 0.25, pitch: 36, velocity: 100, duration: 0.1 }], bass: [] } }),
      onProgress: vi.fn(),
      cancel: vi.fn(),
    });
    renderPanel({ chart: "[Am] [G]", sections: SECTIONS });
    fireEvent.click(screen.getByRole("button", { name: "Back to generated" }));
    await waitFor(() => expect(useSong.getState().applyGeneratedParts).toHaveBeenCalledTimes(1));
    const request = mocks.startBandRender.mock.calls[0][0];
    expect(request.parts).toEqual({ drums: true, bass: false });
    const [parts, options] = (
      useSong.getState().applyGeneratedParts as unknown as { mock: { calls: [[{ drums?: PcmAudio; bass?: PcmAudio }, { remove: string[] }]] } }
    ).mock.calls[0];
    expect(parts.drums).toBe(drums);
    expect(parts.bass).toBeUndefined();
    expect(options.remove).toEqual([]);
    await waitFor(() => expect(savedOptions().band.rendered.drums).toBeUndefined());
    expect(savedOptions().band.firstNote.drums).toBe(0.25);
  });

  it("records each generated part's first note, for the line-up", async () => {
    stored({ beatGrid: grid });
    mocks.startBandRender.mockReturnValue({
      done: Promise.resolve({
        drums: silent(),
        bass: silent(),
        notes: {
          drums: [
            { time: 0.7, pitch: 36, velocity: 100, duration: 0.1 },
            { time: 1.2, pitch: 38, velocity: 90, duration: 0.1 },
          ],
          bass: [{ time: 0.9, pitch: 40, velocity: 90, duration: 0.4 }],
        },
      }),
      onProgress: vi.fn(),
      cancel: vi.fn(),
    });
    renderPanel({ chart: "[Am] [G]", sections: SECTIONS });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(savedOptions().band.firstNote).toEqual({ drums: 0.7, bass: 0.9 }));
  });

  it("removing the generated parts takes the rendered record with them", async () => {
    stored({ beatGrid: grid, band: { ...DEFAULT_BAND_SETTINGS, rendered: { bass: { name: "bass.wav", importedAt: "2026-10-30T10:00:00.000Z" } } } });
    useSong.setState({ tracks: { track0: { kind: "user", name: "Bass (generated)" } } as never });
    renderPanel({ chart: "[Am] [G]", sections: SECTIONS });
    fireEvent.click(screen.getByRole("button", { name: "Remove generated parts" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(savedOptions().band.rendered).toEqual({}));
  });

  it("says to render with your own instruments, next to Export MIDI", () => {
    renderPanel({ chart: "[Am] [G]" });
    expect(screen.getByText("Render it with your own instruments, then use it here.")).toBeTruthy();
  });
});

describe("Band panel: bass notes (spec 87)", () => {
  it("lists the bass notes the performer set, and Remove all saves none", () => {
    stored({
      beatGrid: grid,
      band: {
        ...DEFAULT_BAND_SETTINGS,
        bassOverrides: [
          { start: 0, end: 1, pc: 4 },
          { start: 2, end: 3, pc: 9 },
        ],
      },
    });
    renderPanel();
    expect(screen.getByRole("heading", { name: "Your bass notes (2)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove all" }));
    expect(savedOptions().band.bassOverrides).toEqual([]);
    expect(savedOptions().bandOutOfDate).toBe(true);
  });

  it("sets a note on a beat from the strip, and the editor's Apply saves it", () => {
    stored({ beatGrid: grid, band: { ...DEFAULT_BAND_SETTINGS } });
    renderPanel({ chords: [{ time: 0, name: "G", confidence: 1 }] });
    fireEvent.click(screen.getByRole("button", { name: /^Beat 2,/ }));
    expect(screen.getByRole("region", { name: "Bass note editor" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(savedOptions().band.bassOverrides).toEqual([{ start: 0.5, end: 1, pc: 7 }]);
  });
});
