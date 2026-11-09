import { describe, expect, it, vi } from "vitest";
import type { PcmAudio } from "../types";
import type { BassTone, BassToneFile, ToneBlock } from "./arrangement";
import {
  applyBassTone,
  applyPartTone,
  chainLatency,
  BASS_TONE_PRESETS,
  DRUM_TONE_PRESETS,
  loadPartTone,
  renderPartTone,
  CHAIN_RATE,
  captureRenderSeconds,
  presetBlocks,
  renderBassTone,
  type BassChain,
  type PartChain,
  type BassToneFiles,
  type LoadedBassTone,
  type LoadedBlock,
} from "./part-tone";
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

/** The chain of the given blocks is the identity: it passes its input back, as a chain of one unity capture would. */
const identity: BassChain = async (_blocks, input) => input.slice();
const silent: BassChain = async (_blocks, input) => new Float32Array(input.length);

/** A capture stage, on, at unity levels. */
const amp = (model = "capture"): LoadedBlock => ({ type: "capture", role: "amp", model, on: true, inputDb: 0, outputDb: 0, mix: 1 });

function loaded(overrides: Partial<LoadedBassTone> = {}): LoadedBassTone {
  return { blocks: [amp()], dryWet: 1, fast: false, ...overrides };
}

function noFiles(): BassToneFiles {
  const fail = async () => {
    throw new Error("not expected");
  };
  return { readNam: fail, readIr: fail, readLocalNam: fail, readLocalIr: fail };
}

/** A chain of an amp and an optional cab, as the Band settings hold a bass tone. */
type Stage = { capture: BassToneFile; ir: BassToneFile | null; inputDb: number; outputDb: number; blend: number };
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
  it("gives the dry bass back exactly at dry/wet 0", async () => {
    const bass = sine(4000, 110, 0.5);
    const out = await renderBassTone(bass, loaded({ dryWet: 0 }), identity);
    expect(out.channels[0]).toEqual(bass.channels[0]);
    expect(out.channels[1]).toEqual(bass.channels[1]);
  });

  it("keeps the dry bass's shape and loudness with a silent chain at dry/wet 0.5", async () => {
    const bass = sine(4000, 110, 0.5);
    const out = await renderBassTone(bass, loaded({ dryWet: 0.5 }), silent);
    expect(out.channels[0][100]).toBeCloseTo(bass.channels[0][100], 6);
    expect(out.channels[1][2000]).toBeCloseTo(bass.channels[1][2000], 6);
  });

  it("keeps the loudness of a blend whose chain shifts the phase, where dry and chain partly cancel", async () => {
    const bass = sine(8000, 110, 0.5);
    // A delay of a third of the sine's period: half dry plus half delayed is about 6 dB quieter than the bass before matching.
    const delay = Math.round(RATE / 110 / 3);
    const delayed: BassChain = async (_blocks, input) => {
      const out = new Float32Array(input.length);
      out.set(input.subarray(0, input.length - delay), delay);
      return out;
    };
    const out = await renderBassTone(bass, loaded({ dryWet: 0.5 }), delayed);
    const rms = (c: Float32Array) => Math.sqrt(c.reduce((sum, v) => sum + v * v, 0) / c.length);
    expect(rms(out.channels[0])).toBeCloseTo(rms(bass.channels[0]), 2);
  });

  it("gives the bass back, to a close tolerance, through a chain that passes it at dry/wet 1", async () => {
    const bass = sine(8000, 110, 0.5);
    const out = await renderBassTone(bass, loaded({ dryWet: 1 }), identity);
    let worst = 0;
    for (let i = 0; i < 8000; i++) worst = Math.max(worst, Math.abs(out.channels[0][i] - bass.channels[0][i]));
    expect(worst).toBeLessThan(0.02);
  });

  it("matches the whole chain's level to the clean bass, so a quiet or loud chain keeps the loudness", async () => {
    const bass = sine(8000, 110, 0.5);
    const quiet = await renderBassTone(bass, loaded(), async (_blocks, input) => input.map((v) => v * 0.1));
    const loud = await renderBassTone(bass, loaded(), async (_blocks, input) => input.map((v) => v * 3));
    const rms = (c: Float32Array) => Math.sqrt(c.reduce((sum, v) => sum + v * v, 0) / c.length);
    expect(rms(quiet.channels[0])).toBeCloseTo(rms(bass.channels[0]), 3);
    expect(rms(loud.channels[0])).toBeCloseTo(rms(bass.channels[0]), 3);
  });

  it("passes the blocks that are on, in order, with the fast flag, and does not call the chain when none is on", async () => {
    const chain = vi.fn(identity);
    const cab: LoadedBlock = { type: "ir", role: "cab", ir: new Float32Array([1, 0.5]), on: true, inputDb: 2, outputDb: -4, mix: 1 };
    await renderBassTone(sine(2000, 110, 0.4), loaded({ blocks: [amp("prepared"), cab], fast: true }), chain);
    expect(chain).toHaveBeenCalledTimes(1);
    const [blocks, input, fast] = chain.mock.calls[0];
    expect(blocks).toEqual([amp("prepared"), cab]);
    expect(input.length).toBeGreaterThanOrEqual(Math.round((2000 * CHAIN_RATE) / RATE));
    expect(fast).toBe(true);

    const none = vi.fn(identity);
    const out = await renderBassTone(sine(2000, 110, 0.4), loaded({ blocks: [] }), none);
    expect(none).not.toHaveBeenCalled();
    expect(out.channels[0].length).toBe(2000);
  });

  it("crops the chain's output, which runs past the song, back to the song's length", async () => {
    const longer: BassChain = async (_blocks, input) => new Float32Array(input.length + 5000).fill(0.1);
    const out = await renderBassTone(sine(3000, 110, 0.4), loaded(), longer);
    expect(out.channels.map((c) => c.length)).toEqual([3000, 3000]);
  });

  it("gives the bass's rate, channel count and length, for a length that is not a whole number of chain frames", async () => {
    const bass = sine(10001, 220, 0.3);
    const out = await renderBassTone(bass, loaded(), identity);
    expect(out.sampleRate).toBe(RATE);
    expect(out.channels).toHaveLength(2);
    expect(out.channels.map((c) => c.length)).toEqual([10001, 10001]);
  });

  it("keeps the peak at or below -1 dBFS, even when the chain makes a spike", async () => {
    const spiky: BassChain = async (_blocks, input) => {
      const out = input.slice();
      out[1000] = 1;
      return out;
    };
    const out = await renderBassTone(sine(4000, 110, 0.5), loaded(), spiky);
    const peak = Math.max(...out.channels.map((c) => Math.max(...c.map(Math.abs))));
    expect(peak).toBeLessThanOrEqual(PEAK_LIMIT + 1e-6);
  });
});

describe("bass tone presets and the render-time estimate", () => {
  it("starts a preset as empty slots with their roles, at unity levels, and a space IR at 20% mix", () => {
    const blocks = presetBlocks([{ role: "pedal" }, { role: "amp" }, { role: "cab" }, { role: "space", mix: 0.2 }]);
    expect(blocks.map((b) => [b.type, b.role, b.file, b.mix, b.on])).toEqual([
      ["capture", "pedal", null, 1, true],
      ["capture", "amp", null, 1, true],
      ["ir", "cab", null, 1, true],
      ["ir", "space", null, 0.2, true],
    ]);
  });

  it("has the three presets, each a chain of its roles", () => {
    expect(BASS_TONE_PRESETS.map((preset) => preset.name)).toEqual(["Bass DI + amp", "Driven bass", "Studio bass"]);
    expect(BASS_TONE_PRESETS[2].blocks.map((block) => block.role)).toEqual(["pedal", "amp", "cab", "space"]);
  });

  it("estimates the captures' render time per song second, and less for Lite; IRs and empty slots are not counted", () => {
    const amp = presetBlocks([{ role: "amp" }])[0];
    const withFile = { ...amp, file: { source: "file" as const, path: "/a.nam", name: "a" } };
    const cab = { ...withFile, type: "ir" as const, role: "cab" as const, file: { source: "file" as const, path: "/c.wav", name: "c" } };
    expect(captureRenderSeconds([withFile], 480, false)).toBeCloseTo(38.4, 6);
    expect(captureRenderSeconds([withFile], 480, true)).toBeCloseTo(24, 6);
    expect(captureRenderSeconds([withFile, withFile], 480, false)).toBeCloseTo(76.8, 6);
    expect(captureRenderSeconds([cab], 480, false)).toBe(0);
    expect(captureRenderSeconds([amp], 480, false)).toBe(0);
    expect(captureRenderSeconds([{ ...withFile, on: false }], 480, false)).toBe(0);
  });

  it("leaves an empty slot out of the chain, so loading never reads a file it does not have", async () => {
    const files = { ...noFiles(), readNam: vi.fn(async () => "capture") };
    const chain = vi.fn(identity);
    const tone: BassTone = { kind: "chain", blocks: presetBlocks([{ role: "pedal" }, { role: "amp" }]), dryWet: 1, fast: false };
    await applyBassTone(sine(2000, 110, 0.4), tone, files, chain);
    expect(files.readNam).not.toHaveBeenCalled();
    expect(chain).not.toHaveBeenCalled();
  });
});

describe("applyBassTone", () => {
  it("leaves a clean bass alone and reads no files", async () => {
    const bass = sine(2000, 110, 0.4);
    const result = await applyBassTone(bass, { kind: "clean" }, noFiles(), identity);
    expect(result).toEqual({ bass, notice: null });
    expect(result.bass).toBe(bass);
  });

  it("reads a TONE3000 capture and cab IR by tone and model, prepares the capture, and scales the cab to unit energy", async () => {
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
    const [blocks] = chain.mock.calls[0];
    expect(blocks[0]).toMatchObject({ type: "capture", role: "amp", model: "prepared:capture-text" });
    expect(blocks[1]).toMatchObject({ type: "ir", role: "cab" });
    expect((blocks[1] as { ir: Float32Array }).ir[0]).toBeCloseTo(1, 4);
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
    const sentIr = (chain.mock.calls[0][0][1] as { ir: Float32Array }).ir;
    expect(sentIr.length).toBe(2400);
  });

  it("keeps a space IR as it was recorded, so its level and its tail are its own", async () => {
    const room = new Float32Array([0.5, 0.25, 0.1]);
    const files = { ...noFiles(), readLocalIr: vi.fn(async () => wav(room, CHAIN_RATE)) };
    const chain = vi.fn(identity);
    const tone: BassTone = {
      kind: "chain",
      blocks: [
        { type: "capture", role: "amp", file: { source: "file", path: "/a.nam", name: "amp" }, inputDb: 0, outputDb: 0, mix: 1, on: true },
        { type: "ir", role: "space", file: { source: "file", path: "/room.wav", name: "room" }, inputDb: 0, outputDb: 0, mix: 0.2, on: true },
      ],
      dryWet: 1,
      fast: false,
    };
    await applyBassTone(sine(2000, 110, 0.4), tone, { ...files, readLocalNam: async () => "amp" }, chain);
    const sent = (chain.mock.calls[0][0][1] as { ir: Float32Array }).ir;
    expect(sent[0]).toBeCloseTo(0.5, 3);
    expect(sent[1]).toBeCloseTo(0.25, 3);
  });

  it("leaves an off block out: its files are not read and it is not in the chain", async () => {
    const files = { ...noFiles(), readNam: vi.fn(async () => "capture"), readLocalIr: vi.fn(async () => wav(new Float32Array([1]), CHAIN_RATE)) };
    const chain = vi.fn(identity);
    const tone: BassTone = {
      kind: "chain",
      blocks: [
        { type: "capture", role: "pedal", file: { source: "file", path: "/comp.nam", name: "comp" }, inputDb: 0, outputDb: 0, mix: 1, on: false },
        { type: "capture", role: "amp", file: { source: "tone3000", toneId: 42, modelId: 7, name: "amp" }, inputDb: 0, outputDb: 0, mix: 1, on: true },
        { type: "ir", role: "cab", file: { source: "file", path: "/cab.wav", name: "cab" }, inputDb: 0, outputDb: 0, mix: 1, on: false },
      ],
      dryWet: 1,
      fast: false,
    };
    await applyBassTone(sine(2000, 110, 0.4), tone, files, chain);
    expect(files.readNam).toHaveBeenCalledTimes(1);
    expect(files.readLocalIr).not.toHaveBeenCalled();
    expect(chain.mock.calls[0][0]).toHaveLength(1);
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

// ---- Drums (spec 104): stereo, outboard and space roles ----

/** A 16-bit stereo WAV of two channels at `rate`. */
function stereoWav(left: Float32Array, right: Float32Array, rate: number): Uint8Array {
  const frames = left.length;
  const bytes = new Uint8Array(44 + frames * 4);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + frames * 4, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, frames * 4, true);
  for (let i = 0; i < frames; i++) {
    view.setInt16(44 + i * 4, Math.round(left[i] * 0x7fff), true);
    view.setInt16(46 + i * 4, Math.round(right[i] * 0x7fff), true);
  }
  return bytes;
}

/** A kit that is not mono: the left and right channels differ. */
function kit(frames: number): PcmAudio {
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    left[i] = 0.4 * Math.sin((2 * Math.PI * 200 * i) / RATE);
    right[i] = 0.2 * Math.sin((2 * Math.PI * 330 * i) / RATE);
  }
  return { sampleRate: RATE, channels: [left, right] };
}

const outboardBlock = (): LoadedBlock => ({ type: "capture", role: "outboard", model: "comp", on: true, inputDb: 0, outputDb: 0, mix: 1 });
const roomBlock = (ir: Float32Array, irRight?: Float32Array): LoadedBlock => ({
  type: "ir",
  role: "space",
  ir,
  ...(irRight ? { irRight } : {}),
  on: true,
  inputDb: 0,
  outputDb: 0,
  mix: 1,
});

describe("renderPartTone for stereo drums", () => {
  it("gives the chain the mid signal, and a chain that changes nothing returns the input", async () => {
    const drums = kit(6000);
    const chain = vi.fn<PartChain>(async (_blocks, input) => input.slice());
    const out = await renderPartTone(drums, loaded({ blocks: [outboardBlock()] }), chain, true);
    const sent = chain.mock.calls[0][1];
    expect(sent.length).toBeGreaterThan(6000);
    // The mid at the chain rate is (L+R)/2, resampled; the 44.1 kHz sample at 100 is close to what was sent near 100 * 48000/44100.
    const mid = (drums.channels[0][3000] + drums.channels[1][3000]) / 2;
    expect(Math.abs(sent[Math.round((3000 * CHAIN_RATE) / RATE)] - mid)).toBeLessThan(0.02);
    for (let c = 0; c < 2; c++) for (const i of [100, 3000, 5900]) expect(out.channels[c][i]).toBeCloseTo(drums.channels[c][i], 2);
  });

  it("keeps the stereo image through a mono capture, adding the side back at the mid's level change", async () => {
    const drums = kit(6000);
    const halve: PartChain = async (_blocks, input) => input.map((v) => v * 0.5);
    const out = await renderPartTone(drums, loaded({ blocks: [outboardBlock()] }), halve, true);
    // The whole result is level-matched to the clean kit afterwards, so compare the channels' balance, which the side keeps.
    const rmsOf = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
    const cleanBalance = rmsOf(drums.channels[0]) / rmsOf(drums.channels[1]);
    expect(rmsOf(out.channels[0]) / rmsOf(out.channels[1])).toBeCloseTo(cleanBalance, 1);
    expect(rmsOf(out.channels[0]) + rmsOf(out.channels[1])).toBeCloseTo(rmsOf(drums.channels[0]) + rmsOf(drums.channels[1]), 1);
  });

  it("plays a stereo IR's channels on their own sides, and a mono IR on both", async () => {
    const drums = kit(3000);
    const calls: { ir: Float32Array; length: number }[] = [];
    const record: PartChain = async (blocks, input) => {
      calls.push({ ir: (blocks[0] as { ir: Float32Array }).ir, length: input.length });
      return input.slice();
    };
    const left = Float32Array.of(1, 0.5);
    const right = Float32Array.of(0.25, 0.1);
    await renderPartTone(drums, loaded({ blocks: [roomBlock(left, right)] }), record, true);
    expect(calls.map((call) => call.ir)).toEqual([left, right]);
    calls.length = 0;
    await renderPartTone(drums, loaded({ blocks: [roomBlock(left)] }), record, true);
    expect(calls.map((call) => call.ir)).toEqual([left, left]);
  });

  it("applies dry/wet and the output of the blend as it does for the bass", async () => {
    const drums = kit(6000);
    const dryOnly = await renderPartTone(drums, loaded({ blocks: [outboardBlock()], dryWet: 0 }), silent, true);
    expect(dryOnly.channels[0]).toEqual(drums.channels[0]);
    expect(dryOnly.channels[1]).toEqual(drums.channels[1]);
    const out = await renderPartTone(drums, loaded({ blocks: [outboardBlock()], dryWet: 1 }), async (_b, input) => input.map((v) => v * 4), true);
    expect(out.channels).toHaveLength(2);
    expect(out.channels[0]).toHaveLength(6000);
    let peak = 0;
    for (const channel of out.channels) for (const v of channel) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(PEAK_LIMIT + 1e-6);
  });

  it("leaves a mono part as it was: one chain call with every block", async () => {
    const chain = vi.fn<PartChain>(async (_blocks, input) => input.slice());
    await renderPartTone(sine(2000, 110, 0.4), loaded({ blocks: [outboardBlock(), roomBlock(Float32Array.of(1))] }), chain);
    expect(chain).toHaveBeenCalledTimes(1);
    expect(chain.mock.calls[0][0]).toHaveLength(2);
  });
});

describe("the drum tone's files, presets and estimate", () => {
  const outboardFile = { source: "tone3000" as const, toneId: 5, modelId: 9, name: "Bus comp" };
  const roomFile = { source: "file" as const, path: "/music/room.wav", name: "Room" };
  const drumChain = (blocks: ToneBlock[]): Extract<BassTone, { kind: "chain" }> => ({ kind: "chain", blocks, dryWet: 1, fast: false });
  const block = (role: ToneBlock["role"], file: BassToneFile | null, mix = 1): ToneBlock => ({
    type: role === "space" ? "ir" : "capture",
    role,
    file,
    inputDb: 0,
    outputDb: 0,
    mix,
    on: true,
  });

  it("has the three drum presets, filling the outboard and space roles", () => {
    expect(DRUM_TONE_PRESETS.map((preset) => preset.name)).toEqual(["Glued kit", "Room kit", "Recorded kit"]);
    expect(presetBlocks(DRUM_TONE_PRESETS[0].blocks).map((b) => [b.role, b.type, b.mix])).toEqual([["outboard", "capture", 1]]);
    expect(presetBlocks(DRUM_TONE_PRESETS[1].blocks).map((b) => [b.role, b.type, b.mix])).toEqual([["space", "ir", 0.3]]);
    expect(presetBlocks(DRUM_TONE_PRESETS[2].blocks).map((b) => [b.role, b.mix])).toEqual([
      ["outboard", 1],
      ["space", 0.25],
    ]);
  });

  it("doubles the capture estimate for stereo drums", () => {
    const blocks = [block("outboard", outboardFile), block("space", roomFile)];
    expect(captureRenderSeconds(blocks, 100, false, true)).toBeCloseTo(2 * captureRenderSeconds(blocks, 100, false), 6);
  });

  it("reads a stereo IR's two channels for the drums, and only the left for a mono part", async () => {
    const right = Float32Array.of(0.5, 0.25);
    const files = { ...noFiles(), readLocalIr: vi.fn(async () => stereoWav(Float32Array.of(1, 0), right, CHAIN_RATE)) };
    const tone = drumChain([block("space", roomFile)]);
    const stereo = await loadPartTone(tone, files, true);
    const [space] = stereo.blocks as Extract<LoadedBlock, { type: "ir" }>[];
    expect(space.ir[0]).toBeCloseTo(1, 3);
    expect(space.irRight?.[0]).toBeCloseTo(0.5, 3);
    const mono = await loadPartTone(tone, files);
    expect((mono.blocks[0] as { irRight?: Float32Array }).irRight).toBeUndefined();
  });

  it("renders the drums through the chain, and says which part is clean when a file is missing", async () => {
    const drums = kit(3000);
    const files = {
      ...noFiles(),
      readNam: vi.fn(async () => "comp-text"),
      readLocalIr: vi.fn(async () => Promise.reject(new Error("room.wav is gone"))),
    };
    const chain = vi.fn<PartChain>(async (_blocks, input) => input.slice());
    const missing = await applyPartTone(drums, drumChain([block("outboard", outboardFile), block("space", roomFile)]), files, chain, "drums");
    expect(missing.audio).toBe(drums);
    expect(missing.notice).toMatch(/^The drums play clean, because Room couldn't be loaded/);
    expect(chain).not.toHaveBeenCalled();
    const ok = await applyPartTone(drums, drumChain([block("outboard", outboardFile)]), files, chain, "drums");
    expect(ok.notice).toBeNull();
    expect(ok.audio).not.toBe(drums);
    expect((chain.mock.calls[0][0][0] as { model: string }).model).toBe("prepared:comp-text");
  });

  it("leaves clean drums alone and reads no files", async () => {
    const drums = kit(100);
    const result = await applyPartTone(drums, { kind: "clean" }, noFiles(), identity, "drums");
    expect(result).toEqual({ audio: drums, notice: null });
  });
});

/** Repeatable noise in -1..1, so the tests don't depend on Math.random. */
function noise(length: number, seed = 1): Float32Array {
  let state = seed;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = state / 0x80000000 - 1;
  }
  return out;
}

/** Short decaying noise bursts every `period` frames, from `first`: hits with a sharp attack, like a kit's. */
function hits(frames: number, period: number, first = 2000): Float32Array {
  const out = new Float32Array(frames);
  const burst = noise(1200, 7);
  for (let at = first; at < frames; at += period) {
    for (let i = 0; i < burst.length && at + i < frames; i++) out[at + i] = 0.8 * burst[i] * Math.exp(-i / 250);
  }
  return out;
}

/** `samples` delayed by `delay` frames, plus a quieter reverb-like tail of a few decaying taps after the direct one. */
function delayed(samples: Float32Array, delay: number, tail = false): Float32Array {
  const out = new Float32Array(samples.length);
  const taps = tail ? [[0, 1], ...[1, 2, 3, 4, 5, 6, 7, 8].map((k) => [k * 211, 0.35 * Math.exp(-k / 3)])] : [[0, 1]];
  for (const [offset, gain] of taps) for (let i = 0; i + delay + offset < samples.length; i++) out[i + delay + offset] += samples[i] * gain;
  return out;
}

/** The first frame at or after `from` where the channel passes a fifth of its peak in the next `span` frames. */
function attackAfter(channel: Float32Array, from: number, span = 1500): number {
  let peak = 0;
  for (let i = from; i < from + span; i++) peak = Math.max(peak, Math.abs(channel[i]));
  for (let i = from; i < from + span; i++) if (Math.abs(channel[i]) > peak * 0.2) return i;
  return -1;
}

const ms = (milliseconds: number, rate = RATE) => Math.round((milliseconds / 1000) * rate);

describe("chainLatency", () => {
  const dry = noise(RATE * 3, 3);

  for (const delay of [0, 5, 21, 40]) {
    it(`finds a ${delay} ms delay of noise to the sample`, () => {
      expect(chainLatency(dry, delayed(dry, ms(delay)), RATE)).toBe(ms(delay));
    });

    it(`finds a ${delay} ms delay when a quieter tail follows the direct sound`, () => {
      expect(chainLatency(dry, delayed(dry, ms(delay), true), RATE)).toBe(ms(delay));
    });

    it(`finds a ${delay} ms delay of a hit train to the sample`, () => {
      const train = hits(RATE * 4, ms(250));
      expect(chainLatency(train, delayed(train, ms(delay), true), RATE)).toBe(ms(delay));
    });
  }

  it("decides on the loudest stretch, not on a long quiet intro", () => {
    const part = new Float32Array(RATE * 12);
    part.set(hits(RATE * 4, ms(250)), RATE * 8);
    part.set(
      noise(RATE * 7, 9).map((v) => v * 0.001),
      0,
    );
    expect(chainLatency(part, delayed(part, ms(21)), RATE)).toBe(ms(21));
  });

  it("gives 0 for a silent part, a silent chain and an empty part", () => {
    const silence = new Float32Array(RATE);
    expect(chainLatency(silence, silence, RATE)).toBe(0);
    expect(chainLatency(dry, new Float32Array(dry.length), RATE)).toBe(0);
    expect(chainLatency(new Float32Array(0), new Float32Array(0), RATE)).toBe(0);
  });

  it("does not look past the longest delay", () => {
    expect(chainLatency(dry, delayed(dry, ms(100)), RATE)).toBeLessThanOrEqual(ms(60));
  });

  it("takes well under a second for a five minute stereo part", () => {
    const five = RATE * 300;
    const part = hits(five, ms(500));
    const wet = delayed(part, ms(21), true);
    const started = performance.now();
    const lag = chainLatency(part, wet, RATE);
    const took = performance.now() - started;
    expect(lag).toBe(ms(21));
    expect(took).toBeLessThan(1000);
  });
});

describe("renderPartTone lines the part up with the beat", () => {
  const frames = RATE * 3;
  const period = ms(500);
  const kitHits = hits(frames, period);
  const mono: PcmAudio = { sampleRate: RATE, channels: [kitHits, kitHits.slice()] };
  const stereoKit: PcmAudio = { sampleRate: RATE, channels: [kitHits, hits(frames, period).map((v) => v * 0.7)] };
  const clicks = Array.from({ length: 5 }, (_, k) => 2000 + k * period);

  /** A chain that delays its input by `delay` frames at the chain rate. */
  const delaying =
    (delay: number): PartChain =>
    async (_blocks, input) =>
      delayed(input, delay);

  /** A chain that convolves with an IR whose direct tap is at `delay` frames and whose few later taps decay. */
  const room =
    (delay: number): PartChain =>
    async (_blocks, input) =>
      delayed(input, delay, true);

  const expectOnTheBeat = (out: PcmAudio, reference: PcmAudio) => {
    for (let c = 0; c < out.channels.length; c++) {
      for (const at of clicks) expect(Math.abs(attackAfter(out.channels[c], at - 200) - attackAfter(reference.channels[c], at - 200))).toBeLessThanOrEqual(2);
    }
  };

  for (const [name, chain] of [
    ["a delay of 21 ms", delaying(ms(21, CHAIN_RATE))],
    ["a room IR with its direct sound at 20 ms and a tail", room(ms(20, CHAIN_RATE))],
  ] as const) {
    it(`puts a mono part's attacks where the dry part's are through ${name}`, async () => {
      expectOnTheBeat(await renderPartTone(mono, loaded({ blocks: [amp()] }), chain), mono);
    });

    it(`puts a stereo part's attacks where the dry part's are through ${name}`, async () => {
      const out = await renderPartTone(stereoKit, loaded({ blocks: [outboardBlock()] }), chain, true);
      expectOnTheBeat(out, stereoKit);
    });
  }

  it("keeps a blend of 0.5 through a delaying chain as loud as the dry part, within 1 dB", async () => {
    const out = await renderPartTone(mono, loaded({ blocks: [amp()], dryWet: 0.5 }), delaying(ms(21, CHAIN_RATE)));
    const rmsOf = (samples: Float32Array) => Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
    expect(20 * Math.log10(rmsOf(out.channels[0]) / rmsOf(mono.channels[0]))).toBeGreaterThan(-1);
  });

  it("does not cancel a blend of dry and delayed hits: the attack stays as sharp as the dry one", async () => {
    const out = await renderPartTone(mono, loaded({ blocks: [amp()], dryWet: 0.5 }), delaying(ms(21, CHAIN_RATE)));
    expectOnTheBeat(out, mono);
  });

  it("shifts nothing for a chain that adds no delay", async () => {
    const out = await renderPartTone(mono, loaded({ blocks: [amp()] }), async (_blocks, input) => input.slice());
    expectOnTheBeat(out, mono);
  });

  it("returns a clean tone and an empty chain unchanged", async () => {
    const files = noFiles();
    expect((await applyPartTone(mono, { kind: "clean" }, files, delaying(1000), "bass")).audio).toBe(mono);
    const empty = await renderPartTone(mono, loaded({ blocks: [] }), delaying(1000));
    for (let c = 0; c < 2; c++) for (const i of [0, 2100, 5000, frames - 1]) expect(empty.channels[c][i]).toBeCloseTo(mono.channels[c][i], 5);
  });

  it("renders a silent part without throwing", async () => {
    const silence: PcmAudio = { sampleRate: RATE, channels: [new Float32Array(RATE), new Float32Array(RATE)] };
    const out = await renderPartTone(silence, loaded({ blocks: [amp()] }), delaying(ms(21, CHAIN_RATE)));
    expect(out.channels[0]).toHaveLength(RATE);
    expect(Math.max(...out.channels[0].map(Math.abs))).toBe(0);
  });
});
