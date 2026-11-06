// The bass tone (spec 83, chains in spec 89): the generated bass played through a chain of captures and IRs, then mixed with the dry bass.
// It runs in the Generate step, after the parts are rendered and only while playback is stopped, so nothing heavy runs during a show. The
// chain itself (the NAM engine and the convolvers) is passed in as `BassChain`, so the rate, mix and level logic stays testable without
// WebAudio.

import { prepareNam } from "@shared/nam";
import { convertSampleRate } from "@/snaptone/htkpa";
import { readWavMono } from "@/userir/convert";
import { unitEnergy, type GraphStage } from "@/screens/capture/audio/chain-graph";
import { irLevelGain } from "@/screens/capture/audio/ir-level";
import { TONE_BLOCK_TYPE, type BassTone, type BassToneFile, type ToneBlock, type ToneRole } from "./arrangement";
import { PEAK_LIMIT } from "./render";
import type { PcmAudio } from "../types";

/** The rate the NAM engine and the cab IR run at. */
export const CHAIN_RATE = 48000;

/** A block of the chain as it is loaded: a capture or IR stage, with its role and whether it is on. */
export type LoadedBlock = GraphStage & { role: ToneRole; on: boolean };

/**
 * Renders mono samples at CHAIN_RATE through the blocks in order (only the blocks that are on are passed). The `fast` flag renders captures
 * at their Lite size where the file has one. The result is the input's length plus the IRs' tails, and the caller crops it.
 */
export type BassChain = (blocks: LoadedBlock[], input: Float32Array, fast: boolean) => Promise<Float32Array>;

/** Where a bass tone's files are read from: TONE3000's downloads (by tone and model), or files on this computer (by path). */
export interface BassToneFiles {
  readNam(toneId: number, modelId: number): Promise<string>;
  readIr(toneId: number): Promise<Uint8Array>;
  readLocalNam(path: string): Promise<string>;
  readLocalIr(path: string): Promise<Uint8Array>;
}

/** A bass tone with its active blocks read and ready for the chain. */
export interface LoadedBassTone {
  /** The blocks that are on, in chain order. */
  blocks: LoadedBlock[];
  /** How much of the chain's output is mixed with the dry bass (0 dry, 1 all chain). */
  dryWet: number;
  fast: boolean;
}

/** A bass after the tone was applied, or the clean bass with a notice that says why it is clean. */
export interface BassToneResult {
  bass: PcmAudio;
  notice: string | null;
}

/** A block's file could not be read or used. The name is the file's, so the notice can say which one. */
class BlockLoadError extends Error {
  constructor(
    readonly fileName: string,
    cause: unknown,
  ) {
    super(`${fileName} couldn't be loaded (${messageOf(cause)})`);
  }
}

/** The message of an error, for a notice. */
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A saved file that lacks the fields it needs is a damaged setting, not a download, so it says so instead of reading anything. */
function incomplete(file: BassToneFile): Error {
  return new Error(`the saved setting for ${file.name} is incomplete`);
}

/** The capture or IR bytes of a file: a TONE3000 download by tone and model, or a local file by path. */
async function readText(file: BassToneFile, files: BassToneFiles): Promise<string> {
  if (file.source === "tone3000") {
    if (file.toneId === undefined || file.modelId === undefined) throw incomplete(file);
    return files.readNam(file.toneId, file.modelId);
  }
  if (file.path === undefined) throw incomplete(file);
  return files.readLocalNam(file.path);
}

async function readWav(file: BassToneFile, files: BassToneFiles): Promise<Uint8Array> {
  if (file.source === "tone3000") {
    if (file.toneId === undefined) throw incomplete(file);
    return files.readIr(file.toneId);
  }
  if (file.path === undefined) throw incomplete(file);
  return files.readLocalIr(file.path);
}

async function loadCapture(file: BassToneFile, files: BassToneFiles): Promise<string> {
  return prepareNam(await readText(file, files)).json;
}

/**
 * The cab IR as mono samples at CHAIN_RATE. A cab is scaled to unit energy, so it changes the tone and not the level (chain-graph.ts). A
 * space IR is kept as it is, so its own level, and its tail, play as recorded.
 */
async function loadIr(file: BassToneFile, files: BassToneFiles, role: ToneRole): Promise<Float32Array> {
  const { samples, rate } = readWavMono(await readWav(file, files));
  const ir = rate === CHAIN_RATE ? samples : convertSampleRate(samples, rate, CHAIN_RATE);
  return role === "cab" ? unitEnergy(ir) : ir;
}

/** One chain block read and checked. */
async function loadBlock(block: ToneBlock & { file: BassToneFile }, files: BassToneFiles): Promise<LoadedBlock> {
  const common = { role: block.role, on: block.on, inputDb: block.inputDb, outputDb: block.outputDb, mix: block.mix };
  try {
    if (block.type === "capture") return { ...common, type: "capture", model: await loadCapture(block.file, files) };
    return { ...common, type: "ir", ir: await loadIr(block.file, files, block.role) };
  } catch (error) {
    throw new BlockLoadError(block.file.name, error);
  }
}

/**
 * Reads and checks the files of the blocks that are on, in order. An empty slot (no file yet) plays nothing, so it is left out like an off
 * block. Throws a BlockLoadError naming the first file that cannot be read, so the notice can say which one it was.
 */
export async function loadBassTone(tone: Extract<BassTone, { kind: "chain" }>, files: BassToneFiles): Promise<LoadedBassTone> {
  const blocks: LoadedBlock[] = [];
  for (const block of tone.blocks) if (block.on && block.file) blocks.push(await loadBlock({ ...block, file: block.file }, files));
  return { blocks, dryWet: tone.dryWet, fast: tone.fast };
}

/** A preset starts a chain of empty slots, one per role, so the performer fills the gear in. */
export const BASS_TONE_PRESETS: readonly { name: string; blocks: { role: ToneRole; mix?: number }[] }[] = [
  { name: "Bass DI + amp", blocks: [{ role: "amp" }, { role: "cab" }] },
  { name: "Driven bass", blocks: [{ role: "pedal" }, { role: "amp" }, { role: "cab" }] },
  { name: "Studio bass", blocks: [{ role: "pedal" }, { role: "amp" }, { role: "cab" }, { role: "space", mix: 0.2 }] },
];

/** The blocks of a preset: empty slots with their roles set, at unity levels, on. */
export function presetBlocks(roles: readonly { role: ToneRole; mix?: number }[]): ToneBlock[] {
  return roles.map(({ role, mix }) => ({ type: TONE_BLOCK_TYPE[role], role, file: null, inputDb: 0, outputDb: 0, mix: mix ?? 1, on: true }));
}

/** Seconds a capture renders at for a song of `songSeconds`, per capture, from the spec 83 measure (30 s of A2-Full is about 2.4 s). */
const CAPTURE_SECONDS_PER_SONG_SECOND = { full: 0.08, lite: 0.05 };

/**
 * The estimated time Generate takes to render the chain for a song: the captures that are on and have a file, each at the time it takes per
 * song second (Lite is quicker). IRs are convolutions and add little, so they are not counted.
 */
export function captureRenderSeconds(blocks: readonly ToneBlock[], songSeconds: number, fast: boolean): number {
  const captures = blocks.filter((block) => block.on && block.file && block.type === "capture").length;
  return captures * songSeconds * (fast ? CAPTURE_SECONDS_PER_SONG_SECOND.lite : CAPTURE_SECONDS_PER_SONG_SECOND.full);
}

/** The bass's samples at `rate` for the chain. Resampling uses the project's converter, which the cab IRs already go through. */
function toRate(samples: Float32Array, from: number, to: number): Float32Array {
  return from === to ? samples : convertSampleRate(samples, from, to);
}

/** The samples fitted to exactly `frames`: cut short, or padded with silence. */
function fit(samples: Float32Array, frames: number): Float32Array {
  if (samples.length === frames) return samples;
  const out = new Float32Array(frames);
  out.set(samples.subarray(0, Math.min(samples.length, frames)));
  return out;
}

/** The mono sum of a bass's channels, at its own rate. */
function monoOf(channels: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(channels[0].length);
  for (const channel of channels) for (let i = 0; i < out.length; i++) out[i] += channel[i] / channels.length;
  return out;
}

/**
 * Silence (in frames of the bass's rate) added after the song before the chain. The resampler and the IR's tail finish inside it, so the
 * song's last frames are not cut short, and the output is cropped back to the song's length.
 */
const TAIL_FRAMES = 4096;

/**
 * Plays the bass through the loaded chain and mixes the result with the dry bass by `dryWet`. The whole chain is level-matched to the clean
 * bass's loudness over the song, so the amp and the pedals change the tone and not the level. The result has the bass's rate, channels and
 * length, and peaks at most at PEAK_LIMIT. The dry bass is not resampled; only the chain's output is brought back to its rate.
 */
export async function renderBassTone(bass: PcmAudio, tone: LoadedBassTone, chain: BassChain): Promise<PcmAudio> {
  const frames = bass.channels[0].length;
  const dry = monoOf(bass.channels);
  const padded = new Float32Array(frames + TAIL_FRAMES);
  padded.set(dry);
  // With no block on, the chain is the bass itself: nothing to render.
  const wetAtRate =
    tone.blocks.length === 0 ? padded : toRate(await chain(tone.blocks, toRate(padded, bass.sampleRate, CHAIN_RATE), tone.fast), CHAIN_RATE, bass.sampleRate);
  const wet = fit(wetAtRate, frames);
  const gain = irLevelGain(dry, wet);
  for (let i = 0; i < frames; i++) wet[i] *= gain;
  const channels = bass.channels.map((channel) => {
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) out[i] = channel[i] * (1 - tone.dryWet) + wet[i] * tone.dryWet;
    return out;
  });
  // The chain shifts the phase, so a blend of the dry bass and the chain partly cancels and comes out quieter than either. Match the
  // blend to the clean bass as well.
  if (tone.dryWet > 0 && tone.dryWet < 1) {
    const blendGain = irLevelGain(dry, monoOf(channels));
    for (const channel of channels) for (let i = 0; i < frames; i++) channel[i] *= blendGain;
  }
  let peak = 0;
  for (const channel of channels) for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(channel[i]));
  if (peak > PEAK_LIMIT) {
    const limit = PEAK_LIMIT / peak;
    for (const channel of channels) for (let i = 0; i < frames; i++) channel[i] *= limit;
  }
  return { sampleRate: bass.sampleRate, channels };
}

/**
 * The bass as the Generate step saves it. A clean tone returns the bass unchanged. A tone whose files can't be read, or that fails to
 * render, returns the clean bass with a notice, so one missing file never fails the whole Generate.
 */
export async function applyBassTone(bass: PcmAudio, tone: BassTone, files: BassToneFiles, chain: BassChain): Promise<BassToneResult> {
  if (tone.kind === "clean") return { bass, notice: null };
  let loaded: LoadedBassTone;
  try {
    loaded = await loadBassTone(tone, files);
  } catch (error) {
    const reason = error instanceof BlockLoadError ? error.message : `the bass tone couldn't be loaded (${messageOf(error)})`;
    return { bass, notice: `The bass plays clean, because ${reason}.` };
  }
  try {
    return { bass: await renderBassTone(bass, loaded, chain), notice: null };
  } catch (error) {
    return { bass, notice: `The bass plays clean, because the bass tone couldn't be rendered (${messageOf(error)}).` };
  }
}
