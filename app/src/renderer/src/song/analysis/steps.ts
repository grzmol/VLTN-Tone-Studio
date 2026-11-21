// The analysis steps the song pass runs. Each one is a small job built on an existing analysis: the beat tracker for tempo. A step gives its
// result to the run and returns nothing to the screen, so it can run headless.

import { startBeatGrid } from "../band/beat-grid-client";
import { chordChangeTimesOf, withChordDownbeat, type BeatGrid, type TempoHintOptions } from "../band/beat-grid";
import { tempoFromGrid } from "../performance/tempo-source";
import type { Chord, ChordsInput } from "../performance/chords";
import type { KeyEstimate, KeyInput, KeySection } from "../performance/key";
import { hasSignal } from "../performance/sources";
import { measureLoudnessInWorker } from "../audio/loudness-client";
import { detectMissingParts } from "../band/detect";
import { silenceEnds } from "./silence";
import { BAR_DETECT, TIME_DETECT, barUnitSpans, timeUnitSpans, type DetectedSection } from "./sections";
import type { SectionsInput } from "./sections-measure";
import type { AnalysisStep } from "./song-analysis";
import type { BassLine } from "./bass-line";
import { transcribeLyrics } from "../performance/lyrics-run";
import type { LyricsOptions } from "../performance/lyrics-options";

/**
 * Tracks the beat of the song's audio, and reads the meter from the same beats. `onGrid` receives the whole grid, which the caller saves
 * with the band settings, since the grid is too large for the analysis record. The tempo goes to the analysis; the grid is only passed on
 * when it is long enough to trust. `hint` is a tempo the performer typed: the tracker refines it, or keeps it when locked. Without it the
 * tracker picks the tempo itself. The tempo runs before the chords, so its chord changes come from the chart only.
 */
export function tempoStep(onGrid?: (grid: BeatGrid) => void, hint: TempoHintOptions = {}): AnalysisStep {
  return {
    name: "tempo",
    async run(audio, signal) {
      const job = startBeatGrid({
        sources: audio.sources,
        sampleRate: audio.sampleRate,
        beatsPerBar: audio.beatsPerBar,
        chordChanges: audio.chordChanges,
        tempoHint: hint.tempoHint,
        lockTempo: hint.lockTempo,
      });
      const stop = () => job.cancel();
      signal.addEventListener("abort", stop, { once: true });
      let grid: BeatGrid;
      try {
        grid = await job.done;
      } finally {
        signal.removeEventListener("abort", stop);
      }
      const meter = await job.meter;
      const tempo = tempoFromGrid(grid);
      if (!tempo) return meter ? { meter } : {};
      onGrid?.(grid);
      return meter ? { tempo, meter } : { tempo };
    },
  };
}

/**
 * Runs a one-shot worker on `payload` and resolves with its reply. The worker is ended when it answers, fails, or the run is aborted, so a
 * song that is left or re-analysed does not keep a thread busy.
 */
function runWorker<T>(createWorker: () => Worker, payload: unknown, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // The worker is built inline with `new Worker(new URL(...))`: Vite only bundles a worker written that way. A URL passed in from
    // elsewhere is treated as an asset and inlined as a data URL, which the packaged app's Content Security Policy blocks.
    const worker = createWorker();
    const stop = () => {
      worker.terminate();
      reject(new Error("The analysis was stopped."));
    };
    signal.addEventListener("abort", stop, { once: true });
    worker.onmessage = (event: MessageEvent<T & { error?: string }>) => {
      worker.terminate();
      signal.removeEventListener("abort", stop);
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data);
    };
    worker.onerror = () => {
      worker.terminate();
      signal.removeEventListener("abort", stop);
      reject(new Error("The analysis could not finish."));
    };
    worker.postMessage(payload);
  });
}

/**
 * Measures the song's loudness and sample peak, in the loudness worker. The worker cannot be stopped, so an aborted run finishes the
 * measurement and drops it. Nothing is saved for a silent song, which has no level to normalise to.
 */
export function loudnessStep(): AnalysisStep {
  return {
    name: "loudness",
    async run(audio) {
      const { lufs, peakDb } = await measureLoudnessInWorker(audio.mix);
      return Number.isFinite(lufs) ? { loudness: { lufs, peakDb } } : {};
    },
  };
}

/** Finds the silence at the start and end of the mix. Nothing is saved for a silent song. */
export function silenceStep(): AnalysisStep {
  return {
    name: "silence",
    async run(audio) {
      const ends = silenceEnds(audio.mix);
      return ends ? { silence: ends } : {};
    },
  };
}

/** Checks whether the drums and bass stems carry the mix, so a missing part is noticed before it is played. Nothing is saved without stems. */
export function partsStep(): AnalysisStep {
  return {
    name: "parts",
    async run(audio) {
      if (!audio.stems || !(audio.stems.drums || audio.stems.bass)) return {};
      return { parts: detectMissingParts(audio.mix, audio.stems) };
    },
  };
}

/**
 * Estimates the song's key from its harmony and bass, with the chords the run found before it (the key runs after the chords) and the
 * song's section ends. Nothing is saved when the harmony has no signal or no clear key is found.
 */
export function keyStep(): AnalysisStep {
  return {
    name: "key",
    async run(audio, signal, soFar) {
      if (!hasSignal(audio.harmony.audio)) return {};
      const input: KeyInput = { harmony: audio.harmony.audio, bass: audio.bass, chords: soFar.chords?.chords ?? [], sections: audio.sections };
      const { estimate } = await runWorker<{ estimate: KeyEstimate | null }>(
        () => new Worker(new URL("../performance/key-worker.ts", import.meta.url), { type: "module" }),
        input,
        signal,
      );
      return estimate ? { key: { source: audio.harmony.name, estimate } } : {};
    },
  };
}

/**
 * Reads the key of each section that the song's sections name, after the sections step has found them. Only where the song has a key and
 * the sections are known; a section reported is in another key from the song's. Nothing is saved otherwise.
 */
export function sectionKeysStep(): AnalysisStep {
  return {
    name: "sectionKeys",
    async run(audio, signal, soFar) {
      const songKey = soFar.key?.estimate.name;
      const sections = soFar.sections ?? [];
      if (!songKey || !sections.length || !hasSignal(audio.harmony.audio)) return {};
      const input: KeyInput = {
        harmony: audio.harmony.audio,
        bass: audio.bass,
        chords: soFar.chords?.chords ?? [],
        sections: sections.map(({ start, end }) => ({ start, end })),
        songKey,
      };
      const { keySections } = await runWorker<{ keySections: KeySection[] }>(
        () => new Worker(new URL("../performance/key-worker.ts", import.meta.url), { type: "module" }),
        input,
        signal,
      );
      return { keySections };
    },
  };
}

/**
 * Reads the chords from the harmony (the chosen stem, else the harmony stems added together, else the mix), with the bass stem when there
 * is one. The chords change on the beats of the grid `gridOf` gives (the one the tempo step just tracked, or the saved one); without a
 * grid they are read on a fixed hop.
 */
export function chordsStep(gridOf: () => BeatGrid | null = () => null, onGrid?: (grid: BeatGrid) => void): AnalysisStep {
  return {
    name: "chords",
    async run(audio, signal, soFar) {
      // The key runs after the chords, so the key prior is normally the harmony's own estimate. A run that resumes with a key already found
      // passes it on here instead.
      const grid = gridOf();
      const input: ChordsInput = { harmony: audio.harmony.audio, bass: audio.bass, beats: grid?.beats ?? null, key: soFar.key?.estimate.name ?? null };
      const { chords } = await runWorker<{ chords: Chord[] }>(
        () => new Worker(new URL("../performance/chords-worker.ts", import.meta.url), { type: "module" }),
        input,
        signal,
      );
      // The beat tracker chose the downbeat from the chart's chords only. Now the chords are known, the bar phase is picked again from them.
      // The chord changes are a short list, so this runs on the calling thread after the worker has answered.
      if (grid && onGrid) {
        const regridded = withChordDownbeat(grid, chordChangeTimesOf(chords));
        if (regridded !== grid) onGrid(regridded);
      }
      return { chords: { source: audio.harmony.name, chords } };
    },
  };
}

/**
 * Reads the bass note the bass stem plays on each beat of the grid `gridOf` gives (spec 86), in the bass-line worker. Nothing is saved
 * without a bass stem or a grid, so a song without them keeps its chords' own bass.
 */
export function bassLineStep(gridOf: () => BeatGrid | null): AnalysisStep {
  return {
    name: "bassLine",
    async run(audio, signal) {
      const beats = gridOf()?.beats;
      if (!audio.bass || !beats || beats.length < 2) return {};
      const { bassLine } = await runWorker<{ bassLine: BassLine }>(
        () => new Worker(new URL("./bass-line-worker.ts", import.meta.url), { type: "module" }),
        { bass: audio.bass, beats },
        signal,
      );
      return { bassLine };
    },
  };
}

/**
 * Suggests the song's sections on the bar lines of its beat grid, or on two-second frames when there is no grid. `gridOf` gives the grid the
 * tempo step tracked: the grid is too large for the analysis record, so the caller holds it, as `tempoStep`'s `onGrid` does. The harmony
 * is read from the chord stem, or from the mix when none is chosen. The vocals come from the vocals stem; without one, every unit counts
 * as having vocals. The chords the chords step found, when it ran, give each unit its harmony. The measuring and the detection run in the
 * sections worker.
 */
export function sectionsStep(gridOf: () => BeatGrid | null): AnalysisStep {
  return {
    name: "sections",
    async run(audio, signal, soFar) {
      const duration = (audio.mix.channels[0]?.length ?? 0) / audio.mix.sampleRate;
      const grid = gridOf();
      const bars = grid ? barUnitSpans(grid.beats, grid.downbeat, grid.beatsPerBar, duration, grid.barStarts) : null;
      const input: SectionsInput = {
        mix: audio.mix,
        harmony: audio.chordSource?.audio ?? audio.mix,
        vocals: audio.stems?.vocals ?? null,
        spans: bars ?? timeUnitSpans(duration),
        options: bars ? BAR_DETECT : TIME_DETECT,
        chords: soFar.chords?.chords ?? [],
        drums: audio.stems?.drums ?? null,
        bass: audio.stems?.bass ?? null,
      };
      const { sections } = await runWorker<{ sections: DetectedSection[] }>(
        () => new Worker(new URL("./sections-worker.ts", import.meta.url), { type: "module" }),
        input,
        signal,
      );
      return { sections };
    },
  };
}

export interface LyricsStepInput {
  /** The model and quality to transcribe with, and the song's language. */
  options: LyricsOptions;
  /** The performer's own lines, to time instead of transcribing. Not set for a transcription. */
  pasted?: string[];
  /** Receives the chart text when the step found words. The caller decides whether to save it. */
  onText(text: string): void;
  /** Called when the vocals had no words to chart, such as an instrumental passage or a song with no singing, so the caller can say so. */
  onNone?(): void;
  /** Receives the transcriber's status as it goes, such as a model download. */
  onStatus?(status: string): void;
  /** Receives why the step failed, before the error goes on to the run. A stop is not a failure, so nothing is reported for it. */
  onError?(reason: string): void;
}

/**
 * Transcribes the vocals stem into lyrics, or times `pasted` lines. Runs last in the song pass, since it is the slowest step. Nothing is
 * reported when the vocals have no words. A stop (playback or cancel) ends the transcriber at once and the run resumes or stops with it.
 */
export function lyricsStep(input: LyricsStepInput): AnalysisStep {
  return {
    name: "lyrics",
    async run(audio, signal) {
      const vocals = audio.stems?.vocals;
      if (!vocals) return {};
      try {
        const { text } = await transcribeLyrics({ audio: vocals, options: input.options, pasted: input.pasted, signal, onStatus: input.onStatus });
        if (text) input.onText(text);
        else input.onNone?.();
      } catch (e) {
        if (!signal.aborted) input.onError?.(e instanceof Error ? e.message : String(e));
        throw e;
      }
      return {};
    },
  };
}
