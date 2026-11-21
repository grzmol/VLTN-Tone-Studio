// The transcriber's passes over the windows. A pass runs every window on one runtime. When graphics acceleration hears too
// little, the whole pass runs again on the CPU. The worker supplies the pipeline; this module has no browser or model code,
// so the retry rules are tested with a fake pipeline.

import { windowWords } from "./lyrics";
import type { TimedWord } from "./lyrics-align";
import { fallbackRuntime, runtimeFor, type LyricsRuntime } from "./lyrics-options";
import type { Region } from "./vocal-activity";

type Chunks = Parameters<typeof windowWords>[0];

const SAMPLE_RATE = 16000;

/** A loaded transcriber. `run` takes one window's audio (16 kHz mono) and returns the transformers.js result. */
export interface Recogniser {
  run(piece: Float32Array): Promise<{ chunks?: Chunks }>;
  dispose(): Promise<void>;
}

export type LoadRecogniser = (runtime: LyricsRuntime) => Promise<Recogniser>;

/** The windows: audio, song start of each, and the span of song time each owns. */
export interface WindowInput {
  pieces: Float32Array[];
  starts: number[];
  spans: Region[];
}

export interface Pass {
  runtime: LyricsRuntime;
  /** The words kept, in song time. */
  words: TimedWord[];
  /** Chunks the transcriber returned before the windows kept their words. */
  rawWords: number;
  /** The preferred pass heard too little, so this pass is the CPU run that followed it. */
  retried: boolean;
}

/** What the main thread needs to explain an empty result. */
export interface LyricsDiagnostic {
  runtime: LyricsRuntime["device"];
  parts: number;
  rawWords: number;
  keptWords: number;
  /** The run went to the CPU because graphics acceleration heard too little. */
  cpuRetry: boolean;
}

/** The status shown when graphics acceleration is skipped because it heard nothing here before. */
export const SKIP_GRAPHICS_STATUS = "Transcribing on the CPU (graphics acceleration heard nothing here before)";

/** The runtime to start with: WebGPU when it is present and has not heard nothing here before, otherwise the CPU. */
export function preferredRuntime(webgpu: boolean, graphicsHeardNothing: boolean): LyricsRuntime {
  return runtimeFor(webgpu && !graphicsHeardNothing);
}

export interface PassHooks {
  onStatus(status: string): void;
  onPiece(index: number): void;
}

/** A pass that keeps fewer words than one per this many seconds of window audio is tried again on the CPU. */
export const SECONDS_PER_WORD = 30;

export function windowSeconds(input: WindowInput): number {
  return input.pieces.reduce((sum, piece) => sum + piece.length / SAMPLE_RATE, 0);
}

/** Whether a pass heard enough words to be trusted: at least one per SECONDS_PER_WORD of window audio. */
export function heardEnough(words: number, seconds: number): boolean {
  return words * SECONDS_PER_WORD >= seconds;
}

/** One pass over every window on one runtime. The recogniser is disposed on the way out. */
export async function runPass(load: LoadRecogniser, runtime: LyricsRuntime, input: WindowInput, onPiece: (index: number) => void): Promise<Pass> {
  const recogniser = await load(runtime);
  try {
    const words: TimedWord[] = [];
    let rawWords = 0;
    for (let i = 0; i < input.pieces.length; i++) {
      onPiece(i);
      const chunks = (await recogniser.run(input.pieces[i])).chunks ?? [];
      rawWords += chunks.length;
      // Times from a window are relative to it; windowWords moves them to song time and keeps the words it owns.
      words.push(...windowWords(chunks, input.pieces[i].length / SAMPLE_RATE, input.starts[i], input.spans[i]));
    }
    return { runtime, words, rawWords, retried: false };
  } finally {
    await recogniser.dispose();
  }
}

/**
 * The windows on the preferred runtime. If that throws, or hears too little, the whole run goes again on the CPU, which is the
 * fallback runtime. A CPU pass is the last word: its result is used even when it is empty.
 */
export async function transcribeAll(load: LoadRecogniser, input: WindowInput, preferred: LyricsRuntime, hooks: PassHooks): Promise<Pass> {
  const fallback = fallbackRuntime(preferred);
  let pass: Pass;
  try {
    pass = await runPass(load, preferred, input, hooks.onPiece);
  } catch (e) {
    if (!fallback) throw e;
    hooks.onStatus("Graphics acceleration unavailable, using the CPU");
    return runPass(load, fallback, input, hooks.onPiece);
  }
  if (!fallback || heardEnough(pass.words.length, windowSeconds(input))) return pass;
  hooks.onStatus("No words from graphics acceleration; transcribing again on the CPU");
  return { ...(await runPass(load, fallback, input, hooks.onPiece)), retried: true };
}

export function diagnosticOf(pass: Pass, parts: number): LyricsDiagnostic {
  return { runtime: pass.runtime.device, parts, rawWords: pass.rawWords, keptWords: pass.words.length, cpuRetry: pass.retried };
}

/** The message for an empty result: how many parts were run, where, and whether the words were heard or dropped. */
export function noSingingMessage(diagnostic: LyricsDiagnostic): string {
  const where = diagnostic.runtime === "wasm" ? "CPU" : "graphics acceleration";
  const dropped =
    diagnostic.rawWords > 0 && diagnostic.keptWords === 0
      ? ` The transcriber returned ${diagnostic.rawWords} words, but none were kept.`
      : "";
  return (
    `No singing found in the vocals (${diagnostic.parts} parts, ${diagnostic.keptWords} words heard on the ${where}). ` +
    `Import or type lyrics, or retry transcription.${dropped}`
  );
}
