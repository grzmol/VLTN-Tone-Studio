// The bass tone (spec 83): the generated bass played through a NAM capture and a cab IR, then mixed with the dry bass. It runs in the
// Generate step, after the parts are rendered and only while playback is stopped, so nothing heavy runs during a show. The chain itself
// (the NAM engine and the convolver) is passed in as `BassChain`, so the rate, mix and limit logic stays testable without WebAudio.

import { prepareNam } from "@shared/nam";
import { convertSampleRate } from "@/snaptone/htkpa";
import { readWavMono } from "@/userir/convert";
import type { BassTone, BassToneFile } from "./arrangement";
import { PEAK_LIMIT } from "./render";
import type { PcmAudio } from "../types";

/** The rate the NAM engine and the cab IR run at. */
export const CHAIN_RATE = 48000;

/**
 * Renders mono samples at CHAIN_RATE through a capture and an optional cab IR (also at CHAIN_RATE). The drive and the output level are in
 * dB. The result has the input's length.
 */
export type BassChain = (model: string, input: Float32Array, ir: Float32Array | null, inputDb: number, outputDb: number) => Promise<Float32Array>;

/** Where a bass tone's files are read from: TONE3000's downloads (by tone and model), or files on this computer (by path). */
export interface BassToneFiles {
  readNam(toneId: number, modelId: number): Promise<string>;
  readIr(toneId: number): Promise<Uint8Array>;
  readLocalNam(path: string): Promise<string>;
  readLocalIr(path: string): Promise<Uint8Array>;
}

/** A bass tone with its files read and ready for the chain. */
export interface LoadedBassTone {
  /** The capture as the NAM engine loads it (A1 reshaped to the 0.5.x layout, as the capture editor does). */
  model: string;
  /** Mono, at CHAIN_RATE. Null when the tone has no cab IR. */
  ir: Float32Array | null;
  inputDb: number;
  outputDb: number;
  blend: number;
}

/** A bass after the tone was applied, or the clean bass with a notice that says why it is clean. */
export interface BassToneResult {
  bass: PcmAudio;
  notice: string | null;
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

/** The cab IR as mono samples at CHAIN_RATE. */
async function loadIr(file: BassToneFile, files: BassToneFiles): Promise<Float32Array> {
  const { samples, rate } = readWavMono(await readWav(file, files));
  return rate === CHAIN_RATE ? samples : convertSampleRate(samples, rate, CHAIN_RATE);
}

/**
 * The one capture and cab IR a chain plays through, as spec 83 had them: the first active capture and the first active cab. This is the
 * bridge until the whole chain renders; the blend is the chain's dry/wet.
 */
export function singleStage(
  tone: Extract<BassTone, { kind: "chain" }>,
): { capture: BassToneFile; ir: BassToneFile | null; inputDb: number; outputDb: number; blend: number } | null {
  const capture = tone.blocks.find((block) => block.on && block.type === "capture");
  if (!capture) return null;
  const cab = tone.blocks.find((block) => block.on && block.type === "ir" && block.role === "cab");
  return { capture: capture.file, ir: cab?.file ?? null, inputDb: capture.inputDb, outputDb: capture.outputDb, blend: tone.dryWet };
}

/** Reads and checks the files of a bass tone's single stage. Throws with a message the notice can show. */
export async function loadBassTone(tone: Extract<BassTone, { kind: "chain" }>, files: BassToneFiles): Promise<LoadedBassTone> {
  const stage = singleStage(tone);
  if (!stage) throw new Error("the chain has no capture switched on");
  const model = await loadCapture(stage.capture, files);
  const ir = stage.ir ? await loadIr(stage.ir, files) : null;
  return { model, ir, inputDb: stage.inputDb, outputDb: stage.outputDb, blend: stage.blend };
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
 * Plays the bass through the loaded tone and mixes it with the dry bass by the blend. The result has the bass's rate, channels and length,
 * and peaks at most at PEAK_LIMIT. The dry bass is not resampled; only the chain's output is brought back to its rate.
 */
export async function renderBassTone(bass: PcmAudio, tone: LoadedBassTone, chain: BassChain): Promise<PcmAudio> {
  const frames = bass.channels[0].length;
  const padded = new Float32Array(frames + TAIL_FRAMES);
  padded.set(monoOf(bass.channels));
  const wetMono = await chain(tone.model, toRate(padded, bass.sampleRate, CHAIN_RATE), tone.ir, tone.inputDb, tone.outputDb);
  const wet = fit(toRate(wetMono, CHAIN_RATE, bass.sampleRate), frames);
  const channels = bass.channels.map((dry) => {
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) out[i] = dry[i] * (1 - tone.blend) + wet[i] * tone.blend;
    return out;
  });
  let peak = 0;
  for (const channel of channels) for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(channel[i]));
  if (peak > PEAK_LIMIT) {
    const gain = PEAK_LIMIT / peak;
    for (const channel of channels) for (let i = 0; i < frames; i++) channel[i] *= gain;
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
    const name = singleStage(tone)?.capture.name ?? "the bass tone";
    return { bass, notice: `The bass plays clean, because ${name} couldn't be loaded (${messageOf(error)}).` };
  }
  try {
    return { bass: await renderBassTone(bass, loaded, chain), notice: null };
  } catch (error) {
    return { bass, notice: `The bass plays clean, because the bass tone couldn't be rendered (${messageOf(error)}).` };
  }
}
