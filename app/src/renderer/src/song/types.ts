// Song: a user's audio file split into stems (Stem Splitter) and analysed for a preset on the pedal (Tone Match).
// The store (song/store.ts, `useSong`) owns the loaded song and its stems; Tone Match only reads them.
import type { SeparationModelId, StemName } from "@shared/host/song";
import type { SongRange } from "./range";
import type { QualityId, SplitChoice } from "./stems/options";
import type { Backend } from "./stems/protocol";

// The stem names belong to the model registry, shared with the hosts; the song code reads them from here.
export { STEM_NAMES, type StemName } from "@shared/host/song";

/** Planar PCM: one Float32Array per channel, all the same length. */
export interface PcmAudio {
  sampleRate: number;
  channels: Float32Array[];
}

/** The decoded song, resampled to the separation rate (44.1 kHz stereo). */
export interface SongSource {
  /** File name as dropped or picked, shown in the UI */
  name: string;
  audio: PcmAudio;
}

/** A split's stems: the model's subset of STEM_NAMES (four-stem models have no guitar or piano). */
export type Stems = Partial<Record<StemName, PcmAudio>>;

export type SplitStatus =
  | { kind: "idle" }
  | { kind: "decoding" }
  /** The chosen model's files are being downloaded and verified (`bytes` in all) */
  | { kind: "model"; fraction: number; bytes: number }
  /**
   * `backend` null while a pass's model starts; then where its chunks run (the CPU is several times slower).
   * `pass` of `passes`: the model file running now (a bag of models runs one after another).
   */
  | { kind: "splitting"; fraction: number; backend: Backend | null; pass: number; passes: number }
  | { kind: "done" }
  | { kind: "error"; message: string };

/** How the current stems were made (shown under the mixer) */
export interface SplitInfo {
  model: SeparationModelId;
  quality: QualityId;
  /** Where the passes ran */
  backends: Backend[];
  seconds: number;
  /** The part of the song that was split; absent for the whole song */
  range?: SongRange;
}

export interface SongState {
  source: SongSource | null;
  /** Present once a split finished for `source`; cleared when another song loads */
  stems: Stems | null;
  /** The part of `source` the next split takes; null for the whole song. Cleared when another song loads */
  range: SongRange | null;
  status: SplitStatus;
  /** Model and quality the next split uses (remembered across launches) */
  choice: SplitChoice;
  /** Decode a file (wav, mp3, flac, m4a/aac, ogg) into `source`; clears stems */
  load(file: File): Promise<void>;
  /** Split `source` with `choice` (downloads the model on first use); cancels a running split when called again */
  split(): Promise<void>;
  setChoice(patch: Partial<SplitChoice>): void;
  /** Choose the part to split (kept inside the song, at least MIN_RANGE_SECONDS long); null for the whole song */
  setRange(range: SongRange | null): void;
  /** Drop the stems to choose another part of the same song */
  clearStems(): void;
  cancel(): void;
  reset(): void;
}
