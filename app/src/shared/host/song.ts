// Song screen (renderer/src/song, screens/song): the stem separation models and saving audio files.
// No model is bundled: each file is downloaded on first use, checked against its pinned SHA-256 and cached
// (desktop: userData/models, src/main/ipc/song.ts; browser: Cache Storage, renderer/src/host/web/song.ts).

/** Every stem a split can produce, in htdemucs_6s's output order (also the order the mixer lists them). */
export const STEM_NAMES = ["drums", "bass", "other", "vocals", "guitar", "piano"] as const;
export type StemName = (typeof STEM_NAMES)[number];

const SIX: readonly StemName[] = STEM_NAMES;
const FOUR: readonly StemName[] = ["drums", "bass", "other", "vocals"];

/**
 * One ONNX file of a Demucs model (facebookresearch/demucs, MIT): input `mix` [1, 2, 343980] (7.8 s of 44.1 kHz
 * stereo), output `stems` [1, sources, 2, 343980]; STFT/iSTFT are inside the graph. Pinned to a Hugging Face
 * commit, so the bytes can't change under the checksum.
 */
export interface ModelFile {
  /** Local file name (desktop: userData/models/<file>); unique across the registry */
  file: string;
  url: string;
  sha256: string;
  bytes: number;
  /** The output's source rows, in order */
  sources: readonly StemName[];
  /**
   * "webgpu": runs on onnxruntime-web's WebGPU build (else its WebAssembly fallback), graph optimised.
   * "wasm": runs only on the plain WebAssembly build with graph optimisation off. These exports' iSTFT has a
   * ConstantOfShape node that neither the WebGPU build (not even on its CPU fallback) nor graph optimisation in
   * wasm32 (std::bad_alloc) can handle; checked with onnxruntime-web 1.30.
   */
  runtime: "webgpu" | "wasm";
}

/** One run of `file` over the whole song, keeping the `take` rows of its output. */
export interface SeparationPass {
  file: ModelFile;
  take: readonly StemName[];
}

export type SeparationModelId = "htdemucs_6s" | "hybrid" | "htdemucs_ft";

export interface SeparationModel {
  id: SeparationModelId;
  label: string;
  description: string;
  /** The stems a split produces, in STEM_NAMES order */
  stems: readonly StemName[];
  /** Run one after another; each stem comes from exactly one pass */
  passes: readonly SeparationPass[];
}

/** htdemucs_6s, constant-folded so the WebGPU build runs it (kramp/htdemucs-6s-webgpu-onnx, MIT, from StemSplitio/htdemucs-6s-onnx). */
const HTDEMUCS_6S: ModelFile = {
  file: "htdemucs_6s.onnx",
  url: "https://huggingface.co/kramp/htdemucs-6s-webgpu-onnx/resolve/0c850a01007f48d94900b21b49a0d0ae1a17239f/htdemucs_6s.onnx",
  sha256: "a3f5050696cda4b2344d465123acb21ee699dad7d0634dba1d282497a04ac86a",
  bytes: 284_797_240,
  sources: SIX,
  runtime: "webgpu",
};

/**
 * htdemucs_ft's specialists (StemSplitio/htdemucs-ft-onnx, MIT), fp16-stored weights: half the download, output
 * within 3.2e-4 of the fp32 files. The bag's weights are one-hot: each specialist contributes only its own stem.
 */
const ft = (stem: "drums" | "bass" | "other" | "vocals", sha256: string): ModelFile => ({
  file: `htdemucs_ft_${stem}_fp16weights.onnx`,
  url: `https://huggingface.co/StemSplitio/htdemucs-ft-onnx/resolve/8616370ed541bc183dbe15fb0d54d5f49918f47e/htdemucs_ft_${stem}_fp16weights.onnx`,
  sha256,
  bytes: 165_612_636,
  sources: FOUR,
  runtime: "wasm",
});
const FT_DRUMS = ft("drums", "047764dff888cfb87da917013377d4ec7a134f7419cbe486d9c339aa17975ddd");
const FT_BASS = ft("bass", "b533037176b14b2df31c92a5d5b3d5660d0811b9b360d3db761964768b079961");
const FT_OTHER = ft("other", "b739171a7057b3107bb0711c6222d4a619b41b13a8f04026431d30f32ad2bd71");
const FT_VOCALS = ft("vocals", "0cbe651f535415c9d26a7bb614f7d322dd5a080fa0298f2e50f478030a994dce");

export const SEPARATION_MODELS: readonly SeparationModel[] = [
  {
    id: "htdemucs_6s",
    label: "Standard",
    description: "Six stems, with guitar and piano. One pass, on the graphics card when it can.",
    stems: SIX,
    passes: [{ file: HTDEMUCS_6S, take: SIX }],
  },
  {
    id: "hybrid",
    label: "Best",
    description: "Six stems: drums, bass and vocals from the fine-tuned models, guitar, piano and the rest from Standard. Four passes, three of them on the processor.",
    stems: SIX,
    // "other" comes from Standard too: the fine-tuned "other" still holds the guitar and piano.
    passes: [
      { file: HTDEMUCS_6S, take: ["other", "guitar", "piano"] },
      { file: FT_DRUMS, take: ["drums"] },
      { file: FT_BASS, take: ["bass"] },
      { file: FT_VOCALS, take: ["vocals"] },
    ],
  },
  {
    id: "htdemucs_ft",
    label: "Fine-tuned",
    description: "Four stems without guitar or piano (Tone match can't use it), with the cleanest vocals, drums and bass. Four passes on the processor.",
    stems: FOUR,
    passes: [
      { file: FT_DRUMS, take: ["drums"] },
      { file: FT_BASS, take: ["bass"] },
      { file: FT_OTHER, take: ["other"] },
      { file: FT_VOCALS, take: ["vocals"] },
    ],
  },
];

export const DEFAULT_MODEL_ID: SeparationModelId = "htdemucs_6s";

export function findModel(id: string): SeparationModel | undefined {
  return SEPARATION_MODELS.find((m) => m.id === id);
}

/** The distinct files `model` needs, in pass order. */
export function modelFiles(model: SeparationModel): ModelFile[] {
  return [...new Map(model.passes.map((p) => [p.file.file, p.file])).values()];
}

/** Every file of every model, by local name: what the hosts may download, read or delete. */
export const MODEL_FILES: ReadonlyMap<string, ModelFile> = new Map(SEPARATION_MODELS.flatMap(modelFiles).map((f) => [f.file, f]));

/** Bytes of `model` still to download, given the names of the files already downloaded. */
export function missingBytes(model: SeparationModel, downloaded: ReadonlySet<string>): number {
  return modelFiles(model).reduce((sum, f) => sum + (downloaded.has(f.file) ? 0 : f.bytes), 0);
}

/** Bytes of all of `model`'s files. */
export function modelBytes(model: SeparationModel): number {
  return modelFiles(model).reduce((sum, f) => sum + f.bytes, 0);
}

export interface ModelProgress {
  received: number;
  total: number;
}

export interface SaveFile {
  /** File name only (no folders) */
  name: string;
  bytes: Uint8Array;
}

export interface SongHostApi {
  /** Desktop-only renewable sleep prevention while stage playback is active. */
  stagePower?(token:string, enabled:boolean):Promise<void>;
  /** Desktop managed song library, including copied PCM audio and ordered playlists. */
  library?: import("../song-library").SongLibraryApi;
  /** Local names (ModelFile.file) of the model files downloaded and checked already */
  downloadedFiles(): Promise<string[]>;
  /**
   * Download every missing file of model `id` (one after another, resuming where the host can), check each against
   * its SHA-256 and keep it. Progress via onModelProgress, over all the missing files together. Throws HostError
   * "network" when offline, "invalid" on a checksum mismatch.
   */
  downloadModel(id: SeparationModelId): Promise<void>;
  /** The bytes of a downloaded model file (ModelFile.file). Throws HostError "not-found" when it isn't downloaded. */
  modelFile(file: string): Promise<Uint8Array>;
  /** Delete model `id`'s files (files another model shares go too) and partial downloads, to free disk space */
  deleteModel(id: SeparationModelId): Promise<void>;
  /** Download progress of downloadModel(); returns the unsubscribe function */
  onModelProgress(cb: (p: ModelProgress) => void): () => void;
  /**
   * Save files the user exports: one file through a Save dialog, several into a folder the user picks (the browser
   * build downloads them). Returns where they went (file or folder; the file name in the browser), null when
   * the dialog is cancelled.
   */
  saveFiles(files: SaveFile[], title: string): Promise<string | null>;
}

/** Hex SHA-256 of `bytes` (browser and Node 20+: WebCrypto). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** User-facing message for a model download that failed with `status` (HTTP) or a network error. */
export function modelDownloadError(status: number | null): string {
  if (status === null) return "Couldn't download the separation model. Check your internet connection and try again.";
  return `Couldn't download the separation model (the server answered ${status}). Try again later.`;
}

export const MODEL_CHECKSUM_ERROR = "The downloaded separation model is damaged (its checksum doesn't match). Try again.";
export const MODEL_MISSING_ERROR = "This separation model isn't downloaded. Split again to download it.";
export const UNKNOWN_MODEL_ERROR = "Unknown separation model.";
