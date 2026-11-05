import { create, type StoreApi, type UseBoundStore } from "zustand";
import { findModel } from "@shared/host/song";
import { decodeSong } from "./decode";
import { separateStems, type Separation, type SeparationProgress, type SplitSettings } from "./stems/engine";
import { audioSeconds, clampRange, sliceAudio } from "./range";
import { findQuality, loadSplitChoice, saveSplitChoice, type SplitChoice } from "./stems/options";
import { sourceBitDepth } from "@shared/source-bits";
import type { PcmAudio, SongState, SplitInfo, Stems } from "./types";

/** The bit depth of an opened file, from its header. Lossy and unreadable files give undefined, which stores the source at 16 bits. */
async function originalBits(file: File): Promise<number | undefined> {
  try {
    return sourceBitDepth(new Uint8Array(await file.slice(0, 64).arrayBuffer()));
  } catch {
    return undefined;
  }
}

// The loaded song and its stems (contract: types.ts). One job at a time: loading another song or splitting
// again aborts the running split; results of a superseded job are dropped. A split takes the chosen part of the
// song (`range`), or all of it.

export interface SongDeps {
  decode(file: File): Promise<PcmAudio>;
  separate(audio: PcmAudio, settings: SplitSettings, onProgress: (p: SeparationProgress) => void, signal: AbortSignal): Promise<Separation>;
  /** The model and quality chosen last time, and where a new choice is kept */
  loadChoice(): SplitChoice;
  saveChoice(choice: SplitChoice): void;
}

export interface SongStore extends SongState {
  /** How the current stems were made (shown under the player) */
  lastSplit: SplitInfo | null;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

export function createSongStore(deps: SongDeps): UseBoundStore<StoreApi<SongStore>> {
  let job: AbortController | null = null;
  const begin = () => {
    job?.abort();
    job = new AbortController();
    return job;
  };

  return create<SongStore>((set, get) => ({
    source: null,
    stems: null,
    range: null,
    status: { kind: "idle" },
    choice: deps.loadChoice(),
    lastSplit: null,

    async load(file) {
      const ctrl = begin();
      set({ source: null, stems: null, range: null, lastSplit: null, status: { kind: "decoding" } });
      try {
        const audio = await deps.decode(file);
        if (ctrl.signal.aborted) return;
        set({ source: { name: file.name, audio, bits: await originalBits(file) }, status: { kind: "idle" } });
      } catch (e) {
        if (!ctrl.signal.aborted) set({ status: { kind: "error", message: message(e) } });
      } finally {
        if (job === ctrl) job = null;
      }
    },

    async split() {
      const { source, choice, range } = get();
      const model = findModel(choice.model);
      const quality = findQuality(choice.quality);
      if (!source || !model || !quality) return;
      const audio = sliceAudio(source.audio, range);
      const ctrl = begin();
      set({ stems: null, lastSplit: null, status: { kind: "splitting", fraction: 0, backend: null, pass: 1, passes: model.passes.length } });
      const onProgress = (p: SeparationProgress) => {
        if (ctrl.signal.aborted) return;
        set({ status: p.stage === "model" ? { kind: "model", fraction: p.fraction, bytes: p.bytes } : { kind: "splitting", fraction: p.fraction, backend: p.backend, pass: p.pass, passes: p.passes } });
      };
      try {
        const res = await deps.separate(audio, { model, quality }, onProgress, ctrl.signal);
        if (ctrl.signal.aborted || get().source !== source) return;
        const stems: Stems = {};
        for (const name of model.stems) {
          const channels = res.stems[name];
          if (!channels) throw new Error(`The split returned no ${name} stem.`);
          stems[name] = { sampleRate: source.audio.sampleRate, channels };
        }
        const lastSplit: SplitInfo = { model: model.id, quality: quality.id, backends: res.backends, seconds: res.seconds, ...(range && { range }) };
        set({ stems, lastSplit, status: { kind: "done" } });
      } catch (e) {
        if (!ctrl.signal.aborted && !isAbort(e)) set({ status: { kind: "error", message: message(e) } });
      } finally {
        if (job === ctrl) job = null;
      }
    },

    setChoice(patch) {
      const choice = { ...get().choice, ...patch };
      deps.saveChoice(choice);
      set({ choice });
    },

    setRange(range) {
      const { source } = get();
      if (source) set({ range: clampRange(range, audioSeconds(source.audio)) });
    },

    clearStems() {
      if (get().status.kind !== "done") return;
      set({ stems: null, lastSplit: null, status: { kind: "idle" } });
    },

    cancel() {
      if (!job) return;
      job.abort();
      job = null;
      set({ status: { kind: "idle" } });
    },

    reset() {
      job?.abort();
      job = null;
      set({ source: null, stems: null, range: null, lastSplit: null, status: { kind: "idle" } });
    },
  }));
}

export const useSong = createSongStore({ decode: decodeSong, separate: separateStems, loadChoice: loadSplitChoice, saveChoice: saveSplitChoice });
