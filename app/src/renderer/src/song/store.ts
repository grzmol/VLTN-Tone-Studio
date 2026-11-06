import { create, type StoreApi, type UseBoundStore } from "zustand";
import { findModel } from "@shared/host/song";
import { decodeSong } from "./decode";
import { separateStems, type Separation, type SeparationProgress, type SplitSettings } from "./stems/engine";
import { audioSeconds, clampRange, sliceAudio } from "./range";
import { findQuality, loadSplitChoice, saveSplitChoice, type SplitChoice } from "./stems/options";
import { importTracks, type ImportOutcome, type ImportOptions } from "./import/import-tracks";
import { mergeTrackDefaults, type TrackInfo } from "./tracks";
import { sourceBitDepth } from "@shared/source-bits";
import { getSetting, performanceKey, setSetting } from "./performance/settings";
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
  /** Imports audio files as tracks. Defaults to the import flow (decode, check lengths, align in a worker). */
  importTracks?(files: File[], options: ImportOptions): Promise<ImportOutcome>;
}

export interface SongStore extends SongState {
  /** How the current stems were made (shown under the player) */
  lastSplit: SplitInfo | null;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const PLAYING_NOTICE = "Stop playback to add tracks. Adding tracks rebuilds the song's audio, which would stop the music.";

/** The imported tracks of a song's stems, with their info, so a split can keep them. */
const userTracksOf = (stems: Stems | null, tracks: Record<string, TrackInfo>): [string, PcmAudio][] =>
  Object.entries(stems ?? {}).filter((entry): entry is [string, PcmAudio] => entry[1] !== undefined && tracks[entry[0]]?.kind === "user");
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
    tracks: {},
    status: { kind: "idle" },
    choice: deps.loadChoice(),
    lastSplit: null,

    async load(file) {
      const ctrl = begin();
      set({ source: null, stems: null, tracks: {}, range: null, lastSplit: null, status: { kind: "decoding" } });
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
      // Imported tracks are not made by the split, so they stay with the song.
      const kept = userTracksOf(get().stems, get().tracks);
      set({
        stems: null,
        lastSplit: null,
        status: { kind: "splitting", fraction: 0, backend: null, pass: 1, passes: model.passes.length },
      });
      const onProgress = (p: SeparationProgress) => {
        if (ctrl.signal.aborted) return;
        set({
          status:
            p.stage === "model"
              ? { kind: "model", fraction: p.fraction, bytes: p.bytes }
              : { kind: "splitting", fraction: p.fraction, backend: p.backend, pass: p.pass, passes: p.passes },
        });
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
        for (const [key, pcm] of kept) stems[key] = pcm;
        set({
          stems,
          lastSplit: { model: model.id, quality: quality.id, backends: res.backends, seconds: res.seconds, ...(range && { range }) },
          status: { kind: "done" },
        });
      } catch (e) {
        if (!ctrl.signal.aborted && !isAbort(e)) set({ status: { kind: "error", message: message(e) } });
      } finally {
        if (job === ctrl) job = null;
      }
    },

    async addTracks(files, options) {
      // Refused, not queued: the caller shows the notice, and the music keeps playing.
      if (options?.playing) return [PLAYING_NOTICE];
      const { source, stems, tracks, status } = get();
      if (["decoding", "model", "splitting"].includes(status.kind)) throw new Error("Wait for the song to finish loading or splitting before adding tracks.");
      const outcome = await (deps.importTracks ?? importTracks)(files, {
        taken: Object.keys(stems ?? {}),
        reference: source ? source.audio.channels[0].length : null,
      });
      // The song may have changed while the files were read. Then the tracks belong to nothing, so they are not added.
      if (get().source !== source || get().stems !== stems)
        return [...outcome.notices, "The song changed while the tracks were imported, so they were not added."];
      if (!outcome.tracks.length) return outcome.notices;
      // A song saved without a split plays its source as one track. Once tracks are imported it must stay one, or the player would play
      // only the imported tracks and the mixer would lose the song.
      const sourceTrack = source && !Object.keys(stems ?? {}).length ? source.audio : null;
      const nextStems: Stems = sourceTrack ? { source: sourceTrack } : { ...stems };
      const nextTracks: Record<string, TrackInfo> = sourceTrack ? { source: { kind: "source", name: "Song" } } : { ...tracks };
      for (const track of outcome.tracks) {
        nextStems[track.key] = track.pcm;
        nextTracks[track.key] = {
          kind: "user",
          name: track.name,
          bus: track.bus,
          color: track.color,
          gain: track.gain,
          pan: track.pan,
          transpose: track.transpose,
          muteGroups: track.muteGroups,
        };
        // Drop the fields that were not set, so a default still applies to them.
        for (const field of Object.keys(nextTracks[track.key]) as (keyof TrackInfo)[]) {
          if (nextTracks[track.key][field] === undefined) delete nextTracks[track.key][field];
        }
      }
      const nextSource = source ?? { name: "Imported tracks", audio: outcome.source! };
      // A track's saved pitch choice is written into the song's options now, before the session reads them for the new stems.
      const key = performanceKey(nextSource);
      setSetting(key, ":options", mergeTrackDefaults(getSetting(key, ":options"), nextTracks));
      set({ source: nextSource, stems: nextStems, tracks: nextTracks, status: { kind: "idle" } });
      return outcome.notices;
    },

    setTrackInfo(key, patch) {
      const current = get().tracks[key];
      if (!current) return;
      set({ tracks: { ...get().tracks, [key]: { ...current, ...patch } } });
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
      // Imported tracks are not made by a split, so they stay.
      const kept = userTracksOf(get().stems, get().tracks);
      set({ stems: kept.length ? Object.fromEntries(kept) : null, lastSplit: null, status: { kind: "idle" } });
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
      set({ source: null, stems: null, tracks: {}, range: null, lastSplit: null, status: { kind: "idle" } });
    },
  }));
}

export const useSong = createSongStore({ decode: decodeSong, separate: separateStems, loadChoice: loadSplitChoice, saveChoice: saveSplitChoice });
