// Transcribes a song's vocals into a lyrics chart, with no screen state and no settings. The lyrics panel (lyrics-jobs.ts) and the
// analysis steps (analysis/steps.ts) both call it, so a song gets the same lyrics whichever way it is made. Stopping is by an abort signal:
// the transcriber's worker is ended at once, and nothing is returned.

import type { PcmAudio } from "../types";
import { keepWordsWithin, lyricsLrc, songLines } from "./lyrics";
import { alignLyrics, type TimedWord } from "./lyrics-align";
import { highPass, normalisePeak } from "./lyrics-input";
import { graphicsHeardNothing, rememberGraphicsHeardNothing, type LyricsOptions } from "./lyrics-options";
import type { LyricsDiagnostic } from "./lyrics-passes";
import { host } from "@/host";
import { ownedSpans, singingRegions, transcriptionWindows, type Region } from "./vocal-activity";

export const LYRICS_RATE = 16000;

/** Thrown when the signal stops the transcription. Nothing was written, and the worker is gone. */
export class LyricsCancelled extends Error {
  constructor() {
    super("Lyrics transcription was cancelled.");
    this.name = "LyricsCancelled";
  }
}

export interface LyricsRequest {
  /** The vocals to transcribe. Any sample rate; they are resampled to 16 kHz mono. */
  audio: PcmAudio;
  options: LyricsOptions;
  /** Lines of the performer's own lyrics (from `pastedLines`, "" for a break). Given, the lyrics are timed instead of transcribed. */
  pasted?: string[];
  signal?: AbortSignal;
  onStatus?: (status: string) => void;
}

export interface LyricsResult {
  /** The chart text. Empty when the vocals have no singing or no words were heard. */
  text: string;
  /** Lines with no heard words, placed between their neighbours. Only set when timing pasted lyrics. */
  placed: number;
  /** How the transcriber ran, set when it ran. Explains an empty text. */
  diagnostic?: LyricsDiagnostic;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new LyricsCancelled();
}

/** Resamples to 16 kHz mono, the rate the transcriber takes. */
export async function mono16k(audio: PcmAudio): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, Math.ceil((audio.channels[0].length * LYRICS_RATE) / audio.sampleRate), LYRICS_RATE);
  const buffer = context.createBuffer(audio.channels.length, audio.channels[0].length, audio.sampleRate);
  audio.channels.forEach((channel, i) => buffer.copyToChannel(new Float32Array(channel), i));
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  return (await context.startRendering()).getChannelData(0);
}

/** The app's version, the key for remembering what graphics acceleration did. "unknown" when the host can't say. */
async function appVersion(): Promise<string> {
  try {
    return await host.app.version();
  } catch {
    return "unknown";
  }
}

/** Runs the transcriber in a worker over the pieces, and resolves with every word it heard, in song time, and its diagnostic. */
function transcribe(
  pieces: Float32Array[],
  starts: number[],
  spans: Region[],
  options: LyricsOptions,
  signal: AbortSignal | undefined,
  onStatus: ((status: string) => void) | undefined,
  skipGraphics: boolean,
): Promise<{ words: TimedWord[]; diagnostic?: LyricsDiagnostic }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new LyricsCancelled());
    const worker = new Worker(new URL("./lyrics-worker.ts", import.meta.url), { type: "module" });
    const stop = () => {
      worker.terminate();
      reject(new LyricsCancelled());
    };
    const done = () => {
      worker.terminate();
      signal?.removeEventListener("abort", stop);
    };
    signal?.addEventListener("abort", stop, { once: true });
    worker.onmessage = (event: MessageEvent<{ status?: string; error?: string; words?: TimedWord[]; diagnostic?: LyricsDiagnostic }>) => {
      if (event.data.status) onStatus?.(event.data.status);
      if (event.data.error) {
        done();
        reject(new Error(event.data.error));
      } else if (event.data.words) {
        done();
        resolve({ words: event.data.words, diagnostic: event.data.diagnostic });
      }
    };
    worker.onerror = (e) => {
      done();
      reject(new Error(e.message || "Lyrics worker could not start. Retry transcription."));
    };
    worker.postMessage(
      { pieces, starts, spans, options, graphicsHeardNothing: skipGraphics },
      pieces.map((piece) => piece.buffer),
    );
  });
}

/**
 * Transcribes (or times, with `pasted`) the vocals. Only the windows with singing are sent to the transcriber, since Whisper invents
 * words over silence and bleed. Throws LyricsCancelled when the signal stops the run.
 */
export async function transcribeLyrics(request: LyricsRequest): Promise<LyricsResult> {
  throwIfAborted(request.signal);
  const pcm = await mono16k(request.audio);
  throwIfAborted(request.signal);
  const duration = pcm.length / LYRICS_RATE;
  const clean = normalisePeak(highPass(pcm, LYRICS_RATE));
  const regions = singingRegions(clean, LYRICS_RATE);
  const windows = transcriptionWindows(regions, duration);
  if (!windows.length) return { text: "", placed: 0 };
  const pieces = windows.map((w) => clean.slice(Math.round(w.start * LYRICS_RATE), Math.round(w.end * LYRICS_RATE)));
  const version = await appVersion();
  const model = request.options.model;
  const skipGraphics = graphicsHeardNothing(model, version);
  const { words, diagnostic } = await transcribe(
    pieces,
    windows.map((w) => w.start),
    ownedSpans(windows),
    request.options,
    request.signal,
    request.onStatus,
    skipGraphics,
  );
  // Graphics acceleration heard too little and the CPU heard words: remember it, so the CPU goes first next time.
  // Both empty proves nothing about the machine (the song may have no singing), so nothing is remembered then.
  if (diagnostic?.cpuRetry && diagnostic.keptWords > 0) rememberGraphicsHeardNothing(model, version);
  const heard = keepWordsWithin(words, regions);
  if (request.pasted) {
    const aligned = alignLyrics(request.pasted, heard, duration);
    return { text: lyricsLrc(aligned), placed: aligned.filter((line) => line.estimated).length };
  }
  const text = lyricsLrc(songLines(heard));
  return text ? { text, placed: 0 } : { text, placed: 0, diagnostic };
}
