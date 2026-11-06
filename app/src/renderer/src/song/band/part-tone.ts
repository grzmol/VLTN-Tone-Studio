// A part's tone (bass in spec 83 and 89, drums in spec 104): a generated part played through a chain of captures and IRs, then mixed with the
// dry part. It runs in the Generate step, after the parts are rendered and only while playback is stopped, so nothing heavy runs during a
// show. The chain itself (the NAM engine and the convolvers) is passed in as `PartChain` and stays mono, so the rate, mix, level and stereo
// logic here stays testable without WebAudio.

import { prepareNam } from "@shared/nam";
import { convertSampleRate } from "@/snaptone/htkpa";
import { readWavStereo } from "@/userir/convert";
import { unitEnergy, type GraphStage } from "@/screens/capture/audio/chain-graph";
import { irLevelGain } from "@/screens/capture/audio/ir-level";
import { TONE_BLOCK_TYPE, type PartTone, type PartToneFile, type ToneBlock, type ToneRole, type TonePart } from "./arrangement";
import { PEAK_LIMIT } from "./render";
import type { PcmAudio } from "../types";

/** The rate the NAM engine and the cab IR run at. */
export const CHAIN_RATE = 48000;

/** A block of the chain as it is loaded: a capture or IR stage, with its role and whether it is on. */
export type LoadedBlock = GraphStage & {
  role: ToneRole;
  on: boolean;
  /** The right channel of a stereo IR for a stereo part. The chain plays `ir`; a stereo part's tone plays this one on its right channel. */
  irRight?: Float32Array;
};

/**
 * Renders mono samples at CHAIN_RATE through the blocks in order (only the blocks that are on are passed). The `fast` flag renders captures
 * at their Lite size where the file has one. The result is the input's length plus the IRs' tails, and the caller crops it.
 */
export type PartChain = (blocks: LoadedBlock[], input: Float32Array, fast: boolean) => Promise<Float32Array>;

export type BassChain = PartChain;

/** Where a part tone's files are read from: TONE3000's downloads (by tone and model), or files on this computer (by path). */
export interface PartToneFiles {
  readNam(toneId: number, modelId: number): Promise<string>;
  readIr(toneId: number): Promise<Uint8Array>;
  readLocalNam(path: string): Promise<string>;
  readLocalIr(path: string): Promise<Uint8Array>;
}

export type BassToneFiles = PartToneFiles;

/** A part tone with its active blocks read and ready for the chain. */
export interface LoadedPartTone {
  /** The blocks that are on, in chain order. */
  blocks: LoadedBlock[];
  /** How much of the chain's output is mixed with the dry bass (0 dry, 1 all chain). */
  dryWet: number;
  fast: boolean;
}

export type LoadedBassTone = LoadedPartTone;

/** A part after the tone was applied, or the clean part with a notice that says why it is clean. */
export interface PartToneResult {
  audio: PcmAudio;
  notice: string | null;
}

/** The bass's result, which names its audio `bass` as it always has. */
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
function incomplete(file: PartToneFile): Error {
  return new Error(`the saved setting for ${file.name} is incomplete`);
}

/** The capture or IR bytes of a file: a TONE3000 download by tone and model, or a local file by path. */
async function readText(file: PartToneFile, files: PartToneFiles): Promise<string> {
  if (file.source === "tone3000") {
    if (file.toneId === undefined || file.modelId === undefined) throw incomplete(file);
    return files.readNam(file.toneId, file.modelId);
  }
  if (file.path === undefined) throw incomplete(file);
  return files.readLocalNam(file.path);
}

async function readWav(file: PartToneFile, files: PartToneFiles): Promise<Uint8Array> {
  if (file.source === "tone3000") {
    if (file.toneId === undefined) throw incomplete(file);
    return files.readIr(file.toneId);
  }
  if (file.path === undefined) throw incomplete(file);
  return files.readLocalIr(file.path);
}

async function loadCapture(file: PartToneFile, files: PartToneFiles): Promise<string> {
  return prepareNam(await readText(file, files)).json;
}

/**
 * The IR as samples at CHAIN_RATE: its left channel, and for a stereo part also its right channel when the file has one (a mono file plays
 * on both channels). A cab is scaled to unit energy, so it changes the tone and not the level (chain-graph.ts). Other IRs (rooms, plates) are
 * kept as they are, so their own level, and their tail, play as recorded.
 */
async function loadIr(file: PartToneFile, files: PartToneFiles, role: ToneRole, stereo: boolean): Promise<{ ir: Float32Array; irRight?: Float32Array }> {
  const { left, right, rate } = readWavStereo(await readWav(file, files));
  const prepare = (samples: Float32Array) => {
    const ir = rate === CHAIN_RATE ? samples : convertSampleRate(samples, rate, CHAIN_RATE);
    return role === "cab" ? unitEnergy(ir) : ir;
  };
  return stereo && right ? { ir: prepare(left), irRight: prepare(right) } : { ir: prepare(left) };
}

/** One chain block read and checked. */
async function loadBlock(block: ToneBlock & { file: PartToneFile }, files: PartToneFiles, stereo: boolean): Promise<LoadedBlock> {
  const common = { role: block.role, on: block.on, inputDb: block.inputDb, outputDb: block.outputDb, mix: block.mix };
  try {
    if (block.type === "capture") return { ...common, type: "capture", model: await loadCapture(block.file, files) };
    return { ...common, type: "ir", ...(await loadIr(block.file, files, block.role, stereo)) };
  } catch (error) {
    throw new BlockLoadError(block.file.name, error);
  }
}

/**
 * Reads and checks the files of the blocks that are on, in order. An empty slot (no file yet) plays nothing, so it is left out like an off
 * block. Throws a BlockLoadError naming the first file that cannot be read, so the notice can say which one it was.
 */
export async function loadPartTone(tone: Extract<PartTone, { kind: "chain" }>, files: PartToneFiles, stereo = false): Promise<LoadedPartTone> {
  const blocks: LoadedBlock[] = [];
  for (const block of tone.blocks) if (block.on && block.file) blocks.push(await loadBlock({ ...block, file: block.file }, files, stereo));
  return { blocks, dryWet: tone.dryWet, fast: tone.fast };
}

/** Reads the bass tone's files (a mono part: only the left channel of an IR is read). */
export const loadBassTone = (tone: Extract<PartTone, { kind: "chain" }>, files: PartToneFiles): Promise<LoadedPartTone> => loadPartTone(tone, files);

/** A preset starts a chain of empty slots, one per role, so the performer fills the gear in. */
export interface TonePreset {
  name: string;
  blocks: { role: ToneRole; mix?: number }[];
}

export const BASS_TONE_PRESETS: readonly TonePreset[] = [
  { name: "Bass DI + amp", blocks: [{ role: "amp" }, { role: "cab" }] },
  { name: "Driven bass", blocks: [{ role: "pedal" }, { role: "amp" }, { role: "cab" }] },
  { name: "Studio bass", blocks: [{ role: "pedal" }, { role: "amp" }, { role: "cab" }, { role: "space", mix: 0.2 }] },
];

/** The drum presets: a compressor or console for glue, a room for space, or both. */
export const DRUM_TONE_PRESETS: readonly TonePreset[] = [
  { name: "Glued kit", blocks: [{ role: "outboard" }] },
  { name: "Room kit", blocks: [{ role: "space", mix: 0.3 }] },
  { name: "Recorded kit", blocks: [{ role: "outboard" }, { role: "space", mix: 0.25 }] },
];

/** The presets for each part. */
export const PART_TONE_PRESETS: Record<TonePart, readonly TonePreset[]> = { bass: BASS_TONE_PRESETS, drums: DRUM_TONE_PRESETS };

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
export function captureRenderSeconds(blocks: readonly ToneBlock[], songSeconds: number, fast: boolean, stereo = false): number {
  const captures = blocks.filter((block) => block.on && block.file && block.type === "capture").length;
  // A stereo part renders a mid and a side pass, so it takes twice as long.
  return captures * (stereo ? 2 : 1) * songSeconds * (fast ? CAPTURE_SECONDS_PER_SONG_SECOND.lite : CAPTURE_SECONDS_PER_SONG_SECOND.full);
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

/** The root mean square of the samples. */
function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

/** Runs of blocks of one kind: captures play on the mid signal, IRs play on each channel. */
function runs(blocks: readonly LoadedBlock[]): LoadedBlock[][] {
  const out: LoadedBlock[][] = [];
  for (const block of blocks) {
    const last = out[out.length - 1];
    if (last && last[0].type === block.type) last.push(block);
    else out.push([block]);
  }
  return out;
}

/**
 * A stereo part through the chain. A run of captures plays on the mid signal ((L+R)/2), and the side ((L-R)/2) is added back after it at
 * the level change the mid had, so a mono capture does not collapse the stereo image. A run of IRs plays on each channel: a stereo IR's
 * left channel on the left and its right on the right, a mono IR on both. Returns the two channels at `frames`.
 */
async function stereoChain(blocks: readonly LoadedBlock[], left: Float32Array, right: Float32Array, chain: PartChain, fast: boolean): Promise<Float32Array[]> {
  const frames = left.length;
  let l = left;
  let r = right;
  for (const run of runs(blocks)) {
    if (run[0].type === "capture") {
      const mid = new Float32Array(frames);
      const side = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        mid[i] = (l[i] + r[i]) / 2;
        side[i] = (l[i] - r[i]) / 2;
      }
      const wet = fit(await chain(run, mid, fast), frames);
      const before = rms(mid);
      const change = before > 0 ? rms(wet) / before : 1;
      l = new Float32Array(frames);
      r = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        l[i] = wet[i] + side[i] * change;
        r[i] = wet[i] - side[i] * change;
      }
    } else {
      const rightRun = run.map((block) => (block.type === "ir" && block.irRight ? { ...block, ir: block.irRight } : block));
      [l, r] = [fit(await chain(run, l, fast), frames), fit(await chain(rightRun, r, fast), frames)];
    }
  }
  return [l, r];
}

/**
 * Plays the part through the loaded chain and mixes the result with the dry part by `dryWet`. The whole chain is level-matched to the clean
 * part's loudness over the song, so the gear changes the tone and not the level. The result has the part's rate, channels and length, and
 * peaks at most at PEAK_LIMIT. The dry part is not resampled; only the chain's output is brought back to its rate.
 *
 * A mono part (the bass) is summed to mono and the one result plays on every channel. With `stereo` (the drums) the two channels go through
 * the chain on their own, as stereoChain describes.
 */
export async function renderPartTone(audio: PcmAudio, tone: LoadedPartTone, chain: PartChain, stereo = false): Promise<PcmAudio> {
  const frames = audio.channels[0].length;
  const dry = monoOf(audio.channels);
  const padded = (samples: Float32Array) => {
    const out = new Float32Array(frames + TAIL_FRAMES);
    out.set(samples);
    return out;
  };
  let wets: Float32Array[];
  if (tone.blocks.length === 0) {
    // With no block on, the chain is the part itself: nothing to render.
    wets = [padded(dry)];
  } else if (stereo) {
    const [left, right] = audio.channels.length > 1 ? audio.channels : [audio.channels[0], audio.channels[0]];
    const atChain = [left, right].map((channel) => toRate(padded(channel), audio.sampleRate, CHAIN_RATE));
    const wet = await stereoChain(tone.blocks, atChain[0], atChain[1], chain, tone.fast);
    wets = wet.map((channel) => toRate(channel, CHAIN_RATE, audio.sampleRate));
  } else {
    wets = [toRate(await chain(tone.blocks, toRate(padded(dry), audio.sampleRate, CHAIN_RATE), tone.fast), CHAIN_RATE, audio.sampleRate)];
  }
  wets = wets.map((wet) => fit(wet, frames));
  const gain = irLevelGain(dry, monoOf(wets));
  for (const wet of wets) for (let i = 0; i < frames; i++) wet[i] *= gain;
  const channels = audio.channels.map((channel, c) => {
    const wet = wets[Math.min(c, wets.length - 1)];
    const out = new Float32Array(frames);
    for (let i = 0; i < frames; i++) out[i] = channel[i] * (1 - tone.dryWet) + wet[i] * tone.dryWet;
    return out;
  });
  // The chain shifts the phase, so a blend of the dry part and the chain partly cancels and comes out quieter than either. Match the
  // blend to the clean part as well.
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
  return { sampleRate: audio.sampleRate, channels };
}

/** Renders the bass tone: a mono part (see renderPartTone). */
export const renderBassTone = (bass: PcmAudio, tone: LoadedPartTone, chain: PartChain): Promise<PcmAudio> => renderPartTone(bass, tone, chain);

/** What each part is called in a notice: the subject and the verb that goes with it. */
const PART_NOTICE: Record<TonePart, { subject: string; plays: string; noun: string }> = {
  bass: { subject: "The bass", plays: "plays", noun: "bass tone" },
  drums: { subject: "The drums", plays: "play", noun: "drum tone" },
};

/**
 * The part as the Generate step saves it. A clean tone returns the part unchanged. A tone whose files can't be read, or that fails to
 * render, returns the clean part with a notice, so one missing file never fails the whole Generate. Drums are rendered in stereo.
 */
export async function applyPartTone(audio: PcmAudio, tone: PartTone, files: PartToneFiles, chain: PartChain, part: TonePart): Promise<PartToneResult> {
  if (tone.kind === "clean") return { audio, notice: null };
  const { subject, plays, noun } = PART_NOTICE[part];
  const stereo = part === "drums";
  let loaded: LoadedPartTone;
  try {
    loaded = await loadPartTone(tone, files, stereo);
  } catch (error) {
    const reason = error instanceof BlockLoadError ? error.message : `the ${noun} couldn't be loaded (${messageOf(error)})`;
    return { audio, notice: `${subject} ${plays} clean, because ${reason}.` };
  }
  try {
    return { audio: await renderPartTone(audio, loaded, chain, stereo), notice: null };
  } catch (error) {
    return { audio, notice: `${subject} ${plays} clean, because the ${noun} couldn't be rendered (${messageOf(error)}).` };
  }
}

/** Applies the bass tone to the generated bass. */
export async function applyBassTone(bass: PcmAudio, tone: PartTone, files: PartToneFiles, chain: PartChain): Promise<BassToneResult> {
  const { audio, notice } = await applyPartTone(bass, tone, files, chain, "bass");
  return { bass: audio, notice };
}
