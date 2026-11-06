import { DEFAULT_LYRICS_MODEL_ID, findLyricsModel, type LyricsModelId } from "./lyrics-models";

// What a transcription runs: the model and quality, chosen once for all songs and remembered across launches
// (localStorage, like the split's choice), and the language, kept per song in its `:options`.

export const LYRIC_LANGUAGES = ["auto", "english", "afrikaans", "dutch", "french", "german", "italian", "portuguese", "spanish"] as const;
export type LyricsLanguage = (typeof LYRIC_LANGUAGES)[number];

export type LyricsQualityId = "fast" | "balanced" | "max";

export interface LyricsQuality {
  id: LyricsQualityId;
  label: string;
  description: string;
  /** Beam search width. 1 is greedy decoding. */
  beams: number;
}

export const LYRICS_QUALITIES: readonly LyricsQuality[] = [
  { id: "fast", label: "Fast", description: "Greedy decoding. Quickest.", beams: 1 },
  { id: "balanced", label: "Balanced", description: "Three beams. Slower, with fewer wrong words.", beams: 3 },
  { id: "max", label: "Max", description: "Five beams. Slowest, and the most careful.", beams: 5 },
];

export function findLyricsQuality(id: unknown): LyricsQuality | undefined {
  return LYRICS_QUALITIES.find((q) => q.id === id);
}

export interface LyricsChoice {
  model: LyricsModelId;
  quality: LyricsQualityId;
}

const CHOICE_KEY = "gp5.song.lyrics.v1";
export const DEFAULT_LYRICS_CHOICE: LyricsChoice = { model: DEFAULT_LYRICS_MODEL_ID, quality: "fast" };

/** The model and quality chosen last. Survives missing or corrupt storage, models that no longer exist, and the old `{ language }` shape. */
export function loadLyricsChoice(): LyricsChoice {
  try {
    const stored = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? "null");
    return {
      model: findLyricsModel(stored?.model)?.id ?? DEFAULT_LYRICS_CHOICE.model,
      quality: findLyricsQuality(stored?.quality)?.id ?? DEFAULT_LYRICS_CHOICE.quality,
    };
  } catch {
    return DEFAULT_LYRICS_CHOICE;
  }
}

export function saveLyricsChoice(choice: LyricsChoice) {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    /* storage unavailable: the defaults come back next launch */
  }
}

export interface LyricsOptions extends LyricsChoice {
  language: LyricsLanguage;
}

/** The options for one song: the remembered model and quality, and the song's own language (`lyricsLanguage` in its options). */
export function lyricsOptionsFrom(songOptions: { lyricsLanguage?: unknown }): LyricsOptions {
  const language = LYRIC_LANGUAGES.find((value) => value === songOptions.lyricsLanguage) ?? "auto";
  return { ...loadLyricsChoice(), language };
}

export interface LyricsRuntime {
  device: "webgpu" | "wasm";
  dtype: "fp16" | "q8";
}

export const WASM_RUNTIME: LyricsRuntime = { device: "wasm", dtype: "q8" };
export const WEBGPU_RUNTIME: LyricsRuntime = { device: "webgpu", dtype: "fp16" };

/** Where the model runs: WebGPU (fp16 files) when an adapter is present, otherwise WASM (q8 files). */
export function runtimeFor(webgpu: boolean): LyricsRuntime {
  return webgpu ? WEBGPU_RUNTIME : WASM_RUNTIME;
}

/**
 * Whether WebGPU can really be used. `navigator.gpu` exists in browsers that have no usable adapter (for example a
 * blocked GPU), so the adapter request decides. Any failure counts as no.
 */
export async function hasWebGpuAdapter(gpu: { requestAdapter(): Promise<unknown> } | undefined): Promise<boolean> {
  try {
    return gpu !== undefined && (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

/** The runtime to retry on when `failed` didn't work: WebGPU falls back once to WASM; WASM has nothing further. */
export function fallbackRuntime(failed: LyricsRuntime): LyricsRuntime | undefined {
  return failed.device === "webgpu" ? WASM_RUNTIME : undefined;
}

/** WASM threads: more only when the page is cross-origin isolated (SharedArrayBuffer), capped at four. */
export function wasmThreads(isolated: boolean, cores: number): number {
  return isolated ? Math.max(1, Math.min(4, cores)) : 1;
}

const ANALYSIS_LYRICS_KEY = "vltn.song.analysis-lyrics.v1";

/** Whether analysing a song also transcribes its lyrics, when the song has none. Off by default: transcription is slow. */
export function loadLyricsOnAnalysis(): boolean {
  try {
    return localStorage.getItem(ANALYSIS_LYRICS_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveLyricsOnAnalysis(on: boolean) {
  try {
    localStorage.setItem(ANALYSIS_LYRICS_KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable: the setting is off next launch */
  }
}

const GRAPHICS_EMPTY_KEY = "gp5.lyrics.graphics-empty.v1";

/**
 * Remembers, on this machine, that graphics acceleration heard nothing for this model in this app version. The record holds one
 * model and one version. A record from another app version is cleared, so a fixed driver or runtime gets another chance.
 */
export function graphicsHeardNothing(model: LyricsModelId, version: string): boolean {
  try {
    const stored = JSON.parse(localStorage.getItem(GRAPHICS_EMPTY_KEY) ?? "null") as { model?: unknown; version?: unknown } | null;
    if (!stored) return false;
    if (stored.version !== version) {
      localStorage.removeItem(GRAPHICS_EMPTY_KEY);
      return false;
    }
    return stored.model === model;
  } catch {
    return false;
  }
}

/** Records that graphics acceleration heard nothing for this model in this app version. Storage that fails is not an error. */
export function rememberGraphicsHeardNothing(model: LyricsModelId, version: string): void {
  try {
    localStorage.setItem(GRAPHICS_EMPTY_KEY, JSON.stringify({ model, version }));
  } catch {
    /* storage unavailable: the CPU is tried first next time, as this time */
  }
}
