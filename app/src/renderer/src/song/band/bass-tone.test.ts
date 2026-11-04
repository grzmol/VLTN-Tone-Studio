import { describe, expect, it, vi } from "vitest";
import type { PcmAudio } from "../types";
import type { BassTone, BassToneFile, ToneBlock } from "./arrangement";
import { applyBassTone, CHAIN_RATE, renderBassTone, type BassChain, type BassToneFiles, type LoadedBassTone } from "./bass-tone";
import { PEAK_LIMIT } from "./render";

// The NAM engine itself needs an AudioWorklet, so the capture is passed through as its text, marked so the test can see it was prepared.
vi.mock("@shared/nam", () => ({ prepareNam: (text: string) => ({ json: `prepared:${text}`, check: {} }) }));

const RATE = 44100;

/** A stereo sine at `hz`, `frames` long, at `amp`. */
function sine(frames: number, hz: number, amp: number): PcmAudio {
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) mono[i] = amp * Math.sin((2 * Math.PI * hz * i) / RATE);
  return { sampleRate: RATE, channels: [mono, mono.slice()] };
}

/** A 16-bit mono WAV file of `samples` at `rate`. */
function wav(samples: Float32Array, rate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) => view.setInt16(44 + i * 2, Math.round(s * 0x7fff), true));
  return bytes;
}

const identity: BassChain = async (_model, input) => input.slice();
const silent: BassChain = async (_model, input) => new Float32Array(input.length);

function loaded(overrides: Partial<LoadedBassTone> = {}): LoadedBassTone {
  return { model: "capture", ir: null, inputDb: 0, outputDb: 0, blend: 1, ...overrides };
}

function noFiles(): BassToneFiles {
  const fail = async () => {
    throw new Error("not expected");
  };
  return { readNam: fail, readIr: fail, readLocalNam: fail, readLocalIr: fail };
}

/** The one-stage view of a chain: a capture, an optional cab IR, the drive and output, and the dry/wet. */
type Stage = { capture: BassToneFile; ir: BassToneFile | null; inputDb: number; outputDb: number; blend: number };

/** A chain of one amp and an optional cab, as the Band settings hold a bass tone. */
const nam = (overrides: Partial<Stage> = {}): Extract<BassTone, { kind: "chain" }> => {
  const stage: Stage = {
    capture: { source: "tone3000", toneId: 42, modelId: 7, name: "Bass amp" },
    ir: null,
    inputDb: 0,
    outputDb: 0,
    blend: 1,
    ...overrides,
  };
  const blocks: ToneBlock[] = [{ type: "capture", role: "amp", file: stage.capture, inputDb: stage.inputDb, outputDb: stage.outputDb, mix: 1, on: true }];
  if (stage.ir) blocks.push({ type: "ir", role: "cab", file: stage.ir, inputDb: 0, outputDb: 0, mix: 1, on: true });
  return { kind: "chain", blocks, dryWet: stage.blend, fast: false };
};

describe("renderBassTone", () => {
  it("gives the dry bass back exactly at blend 0", async () => {
    const bass = sine(4000, 110, 0.5);
    const out = await renderBassTone(bass, loaded({ blend: 0 }), identity);
    expect(out.channels[0]).toEqual(bass.channels[0]);
    expect(out.channels[1]).toEqual(bass.channels[1]);
  });

  it("mixes half of the dry bass with a silent chain at blend 0.5", async () => {
    const bass = sine(4000, 110, 0.5);
    const out = await renderBassTone(bass, loaded({ blend: 0.5 }), silent);
    expect(out.channels[0][100]).toBeCloseTo(bass.channels[0][100] * 0.5, 6);
    expect(out.channels[1][2000]).toBeCloseTo(bass.channels[1][2000] * 0.5, 6);
  });

  it("gives the bass back, to a close tolerance, through a chain that passes it at blend 1", async () => {
    const bass = sine(8000, 110, 0.5);
    const out = await renderBassTone(bass, loaded({ blend: 1 }), identity);
    let worst = 0;
    for (let i = 0; i < 8000; i++) worst = Math.max(worst, Math.abs(out.channels[0][i] - bass.channels[0][i]));
    expect(worst).toBeLessThan(0.02);
  });

  it("gives the bass's rate, channel count and length, for a length that is not a whole number of chain frames", async () => {
    const bass = sine(10001, 220, 0.3);
    const out = await renderBassTone(bass, loaded(), identity);
    expect(out.sampleRate).toBe(RATE);
    expect(out.channels).toHaveLength(2);
    expect(out.channels.map((c) => c.length)).toEqual([10001, 10001]);
  });

  it("passes the capture, the cab IR, and the drive and output levels to the chain", async () => {
    const chain = vi.fn(identity);
    const ir = new Float32Array([1, 0.5]);
    await renderBassTone(sine(2000, 110, 0.4), loaded({ model: "prepared", ir, inputDb: 6, outputDb: -4 }), chain);
    expect(chain).toHaveBeenCalledTimes(1);
    const [model, input, sentIr, inputDb, outputDb] = chain.mock.calls[0];
    expect(model).toBe("prepared");
    expect(input.length).toBeGreaterThanOrEqual(Math.round((2000 * CHAIN_RATE) / RATE));
    expect(sentIr).toBe(ir);
    expect([inputDb, outputDb]).toEqual([6, -4]);
  });

  it("keeps the peak at or below -1 dBFS, even for a chain that is far too loud", async () => {
    const loud: BassChain = async (_model, input) => input.map((v) => v * 4);
    const out = await renderBassTone(sine(4000, 110, 0.5), loaded({ blend: 1 }), loud);
    const peak = Math.max(...out.channels.map((c) => Math.max(...c.map(Math.abs))));
    expect(peak).toBeLessThanOrEqual(PEAK_LIMIT + 1e-6);
    expect(peak).toBeGreaterThan(PEAK_LIMIT * 0.99);
  });
});

describe("applyBassTone", () => {
  it("leaves a clean bass alone and reads no files", async () => {
    const bass = sine(2000, 110, 0.4);
    const files = noFiles();
    const result = await applyBassTone(bass, { kind: "clean" }, files, identity);
    expect(result).toEqual({ bass, notice: null });
    expect(result.bass).toBe(bass);
  });

  it("reads a TONE3000 capture and cab IR by tone and model, and prepares the capture", async () => {
    const files = {
      readNam: vi.fn(async () => "capture-text"),
      readIr: vi.fn(async () => wav(new Float32Array([1, 0, 0]), CHAIN_RATE)),
      readLocalNam: noFiles().readLocalNam,
      readLocalIr: noFiles().readLocalIr,
    };
    const chain = vi.fn(identity);
    const tone = nam({ ir: { source: "tone3000", toneId: 43, modelId: 8, name: "4x10 cab" } });
    const result = await applyBassTone(sine(2000, 110, 0.4), tone, files, chain);
    expect(files.readNam).toHaveBeenCalledWith(42, 7);
    expect(files.readIr).toHaveBeenCalledWith(43);
    expect(chain.mock.calls[0][0]).toBe("prepared:capture-text");
    expect(result.notice).toBeNull();
  });

  it("reads local files by path, and resamples a cab IR at another rate to the chain rate", async () => {
    const ir44 = wav(new Float32Array(2205).fill(0.1), RATE);
    const files = {
      ...noFiles(),
      readLocalNam: vi.fn(async () => "local-capture"),
      readLocalIr: vi.fn(async () => ir44),
    };
    const chain = vi.fn(identity);
    const tone = nam({
      capture: { source: "file", path: "/music/bass.nam", name: "bass" },
      ir: { source: "file", path: "/music/cab.wav", name: "cab" },
    });
    await applyBassTone(sine(2000, 110, 0.4), tone, files, chain);
    expect(files.readLocalNam).toHaveBeenCalledWith("/music/bass.nam");
    expect(files.readLocalIr).toHaveBeenCalledWith("/music/cab.wav");
    const sentIr = chain.mock.calls[0][2] as Float32Array;
    expect(sentIr.length).toBe(2400);
  });

  it("gives the clean bass with a notice when the capture file is missing", async () => {
    const bass = sine(2000, 110, 0.4);
    const files = { ...noFiles(), readNam: vi.fn(async () => Promise.reject(new Error("Bass amp isn't there anymore"))) };
    const chain = vi.fn(identity);
    const result = await applyBassTone(bass, nam(), files, chain);
    expect(result.bass).toBe(bass);
    expect(result.notice).toContain("Bass amp");
    expect(result.notice).toContain("isn't there anymore");
    expect(chain).not.toHaveBeenCalled();
  });

  it("gives the clean bass with a notice when the cab IR is missing, and does not render the capture alone", async () => {
    const bass = sine(2000, 110, 0.4);
    const files = { ...noFiles(), readNam: async () => "capture", readIr: async () => Promise.reject(new Error("cab isn't there")) };
    const chain = vi.fn(identity);
    const result = await applyBassTone(bass, nam({ ir: { source: "tone3000", toneId: 43, modelId: 8, name: "cab" } }), files, chain);
    expect(result.bass).toBe(bass);
    expect(result.notice).toContain("cab isn't there");
    expect(chain).not.toHaveBeenCalled();
  });

  it("gives the clean bass with a notice when the chain fails to render", async () => {
    const bass = sine(2000, 110, 0.4);
    const files = { ...noFiles(), readNam: async () => "capture" };
    const broken: BassChain = async () => {
      throw new Error("The audio engine couldn't be loaded (500)");
    };
    const result = await applyBassTone(bass, nam(), files, broken);
    expect(result.bass).toBe(bass);
    expect(result.notice).toContain("couldn't be rendered");
    expect(result.notice).toContain("audio engine");
  });

  it("gives the clean bass with a notice for a saved file that lacks its model", async () => {
    const bass = sine(2000, 110, 0.4);
    const result = await applyBassTone(
      bass,
      nam({ capture: { source: "tone3000", toneId: 42, name: "Bass amp" } }),
      { ...noFiles(), readNam: async () => "capture" },
      identity,
    );
    expect(result.bass).toBe(bass);
    expect(result.notice).toContain("incomplete");
  });
});
