import { create, type StoreApi, type UseBoundStore } from "zustand";
import { findModel } from "@shared/host/song";
import { decodeSong } from "./decode";
import { separateStems, type Separation, type SeparationProgress, type SplitSettings } from "./stems/engine";
import { detectMissingParts, type MissingParts } from "./band/detect";
import { GENERATED_PART_NAMES } from "./band/generated-names";
import { findQuality, loadSplitChoice, saveSplitChoice, type SplitChoice } from "./stems/options";
import { freeTrackKeys, importTracks, type ImportOutcome, type ImportOptions } from "./import/import-tracks";
import { mergeTrackDefaults, type TrackInfo } from "./tracks";
import { USER_TRACKS_MAX } from "@shared/song-library";
import { getSetting, performanceKey, setSetting } from "./performance/settings";
import type { PcmAudio, SongState, SplitInfo, Stems } from "./types";
import { sourceBitDepth } from "@shared/source-bits";

/** The bit depth of an opened file, from its header. Lossy and unreadable files give undefined, which stores the source at 16 bits. */
async function originalBits(file: File): Promise<number | undefined> {
  try {
    return sourceBitDepth(new Uint8Array(await file.slice(0, 64).arrayBuffer()));
  } catch {
    return undefined;
  }
}

// The loaded song and its stems (contract: types.ts). One job at a time: loading another song or splitting
// again aborts the running split; results of a superseded job are dropped.

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
  /** Whether the split has drums or bass, set when a split finishes. Null until then. */
  missingParts: MissingParts | null;
  /**
   * Computes `missingParts` for the loaded stems if it is still null and the stems include drums or bass. Not run at song load, which
   * happens while a set is walked; the Band panel calls it when it opens, while stopped.
   */
  checkMissingParts(): void;
  /**
   * Adds the rendered drum and bass parts as user tracks, replacing the earlier generated part of the same kind. `remove` names the parts
   * turned off: their generated tracks go in the same update. Returns the notices for what was refused; an empty list means the parts were
   * added. Refused while playing, like addTracks.
   */
  applyGeneratedParts(parts: GeneratedAudio, options?: { playing?: boolean; remove?: readonly PartKind[] }): string[];
  /** Removes the generated drum and bass tracks and nothing else. Returns notices, as applyGeneratedParts does. */
  removeGeneratedParts(options?: { playing?: boolean }): string[];
}

/** The rendered parts, at the song's length and rate. Each one is optional, so a part can be replaced without the other. */
export interface GeneratedAudio {
  drums?: PcmAudio;
  bass?: PcmAudio;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const PLAYING_NOTICE = "Stop playback to add tracks. Adding tracks rebuilds the song's audio, which would stop the music.";
export const GENERATED_PLAYING_NOTICE = "Stop playback to change the generated parts. Changing them rebuilds the song's audio, which would stop the music.";
const BUSY_NOTICE = "Wait for the song to finish loading or splitting before generating parts.";

/** The kinds of generated part, and what each one is called in the mixer. Bass follows the song's pitch shift; drums do not. */
const PART_KINDS = ["drums", "bass"] as const;
type PartKind = (typeof PART_KINDS)[number];
const PART_TRACK: Record<PartKind, { name: string; transpose: boolean }> = {
  drums: { name: GENERATED_PART_NAMES.drums, transpose: false },
  bass: { name: GENERATED_PART_NAMES.bass, transpose: true },
};

/**
 * The track key of each generated part. A user track's key must be `track<n>` to be saved in the library, so the key cannot say
 * which part a track is. The song's options keep that record instead (`generatedParts`).
 */
type GeneratedKeys = Partial<Record<PartKind, string>>;

function optionsOf(key: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(getSetting(key, ":options") || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // A damaged options entry is treated as empty; the next save writes a clean one.
  }
  return {};
}

/**
 * The generated keys the song's options record, kept only where the track still is that part: a user track with the part's name. A record
 * that no longer matches is ignored, so the key is never deleted when it now belongs to the user's own track. The record is dropped the
 * next time it is saved.
 */
function generatedKeysOf(options: Record<string, unknown>, tracks: Record<string, TrackInfo>): GeneratedKeys {
  const saved = options.generatedParts;
  if (!saved || typeof saved !== "object") return {};
  const keys: GeneratedKeys = {};
  for (const kind of PART_KINDS) {
    const value = (saved as Record<string, unknown>)[kind];
    if (typeof value !== "string") continue;
    const track = tracks[value];
    if (track?.kind === "user" && track.name === PART_TRACK[kind].name) keys[kind] = value;
  }
  return keys;
}

/**
 * Writes the generated keys and the pitch choices of the song's tracks into its options. A removed track loses its pitch choice, so a
 * track that takes its key later starts from the default for its part.
 */
function saveGeneratedKeys(key: string, removed: readonly string[], tracks: Record<string, TrackInfo>, generated: GeneratedKeys): void {
  const options = optionsOf(key);
  const follows: Record<string, unknown> = options.followsPitch && typeof options.followsPitch === "object" ? { ...options.followsPitch } : {};
  for (const track of removed) delete follows[track];
  const next: Record<string, unknown> = { ...options, followsPitch: follows };
  if (Object.keys(generated).length) next.generatedParts = generated;
  else delete next.generatedParts;
  setSetting(key, ":options", mergeTrackDefaults(JSON.stringify(next), tracks));
}
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
    tracks: {},
    status: { kind: "idle" },
    choice: deps.loadChoice(),
    lastSplit: null,
    missingParts: null,

    async load(file) {
      const ctrl = begin();
      set({ source: null, stems: null, tracks: {}, lastSplit: null, missingParts: null, status: { kind: "decoding" } });
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
      const { source, choice } = get();
      const model = findModel(choice.model);
      const quality = findQuality(choice.quality);
      if (!source || !model || !quality) return;
      const ctrl = begin();
      // Imported tracks are not made by the split, so they stay with the song.
      const kept = userTracksOf(get().stems, get().tracks);
      set({
        stems: null,
        lastSplit: null,
        missingParts: null,
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
        const res = await deps.separate(source.audio, { model, quality }, onProgress, ctrl.signal);
        if (ctrl.signal.aborted || get().source !== source) return;
        const stems: Stems = {};
        for (const name of model.stems) {
          const channels = res.stems[name];
          if (!channels) throw new Error(`The split returned no ${name} stem.`);
          stems[name] = { sampleRate: source.audio.sampleRate, channels };
        }
        for (const [key, pcm] of kept) stems[key] = pcm;
        const missingParts = detectMissingParts(source.audio, stems);
        set({
          stems,
          lastSplit: { model: model.id, quality: quality.id, backends: res.backends, seconds: res.seconds },
          missingParts,
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

    checkMissingParts() {
      const { source, stems, missingParts } = get();
      if (!source || !stems || missingParts || !(stems.drums || stems.bass)) return;
      set({ missingParts: detectMissingParts(source.audio, stems) });
    },

    applyGeneratedParts(parts, options) {
      // Refused, not queued, as addTracks is: the caller shows the notice, and the music keeps playing.
      if (options?.playing) return [GENERATED_PLAYING_NOTICE];
      const { source, stems, tracks, status } = get();
      const pending: { kind: PartKind; part: PcmAudio }[] = [];
      for (const kind of PART_KINDS) {
        const part = parts[kind];
        if (part) pending.push({ kind, part });
      }
      const turnedOff = options?.remove ?? [];
      if (!pending.length && !turnedOff.length) return [];
      if (["decoding", "model", "splitting"].includes(status.kind)) return [BUSY_NOTICE];
      if (!source) return ["Load a song before generating parts."];
      // The parts play beside the song, so they must line up with it sample for sample.
      const frames = source.audio.channels[0].length;
      for (const { kind, part } of pending) {
        if (part.sampleRate !== source.audio.sampleRate || part.channels.some((channel) => channel.length !== frames)) {
          return [`The generated ${kind} part does not match the song's length, so it was not added.`];
        }
      }

      const key = performanceKey(source);
      const previous = generatedKeysOf(optionsOf(key), tracks);
      // A song without a split keeps its source as one track, as addTracks does. Otherwise the player would lose the song.
      const sourceTrack = Object.keys(stems ?? {}).length ? null : source.audio;
      const nextStems: Stems = sourceTrack ? { source: sourceTrack } : { ...stems };
      const nextTracks: Record<string, TrackInfo> = sourceTrack ? { source: { kind: "source", name: "Song" } } : { ...tracks };
      // A part being applied replaces its generated track, and a part that is turned off loses its track. Both happen in this one update,
      // so the mixer never shows a part that the user has turned off.
      const kinds = new Set<PartKind>([...pending.map(({ kind }) => kind), ...turnedOff]);
      const removed: string[] = [];
      for (const kind of kinds) {
        const old = previous[kind];
        if (old) {
          delete nextStems[old];
          delete nextTracks[old];
          removed.push(old);
        }
      }
      // Nothing to add and nothing to take away: the song stays as it is.
      if (!pending.length && !removed.length) return [];
      const keys = freeTrackKeys(Object.keys(nextStems), pending.length);
      if (keys.length < pending.length) return [`A song can hold up to ${USER_TRACKS_MAX} imported tracks, so the generated parts were not added.`];

      const generated: GeneratedKeys = { ...previous };
      for (const kind of kinds) delete generated[kind];
      pending.forEach(({ kind, part }, index) => {
        const trackKey = keys[index];
        nextStems[trackKey] = part;
        nextTracks[trackKey] = { kind: "user", name: PART_TRACK[kind].name, bus: "main", transpose: PART_TRACK[kind].transpose };
        generated[kind] = trackKey;
      });
      saveGeneratedKeys(key, removed, nextTracks, generated);
      // Taking away the last generated part of a song that was never split leaves it as it was before the parts were added, as removeGeneratedParts does.
      const remaining = Object.keys(nextStems);
      if (!pending.length && (remaining.length === 0 || (remaining.length === 1 && remaining[0] === "source"))) set({ stems: null, tracks: {} });
      else set({ stems: nextStems, tracks: nextTracks });
      return [];
    },

    removeGeneratedParts(options) {
      if (options?.playing) return [GENERATED_PLAYING_NOTICE];
      const { source, stems, tracks, status } = get();
      if (!source) return [];
      if (["decoding", "model", "splitting"].includes(status.kind)) return [BUSY_NOTICE];
      const key = performanceKey(source);
      const saved = optionsOf(key);
      const generated = Object.values(generatedKeysOf(saved, tracks)).filter((value): value is string => Boolean(value));
      if (!generated.length) {
        // Nothing to remove, but a record that no longer matches a generated part is still dropped.
        if (saved.generatedParts !== undefined) saveGeneratedKeys(key, [], tracks, {});
        return [];
      }
      if (!stems) return [];
      const nextStems: Stems = { ...stems };
      const nextTracks: Record<string, TrackInfo> = { ...tracks };
      for (const track of generated) {
        delete nextStems[track];
        delete nextTracks[track];
      }
      saveGeneratedKeys(key, generated, nextTracks, {});
      // A song whose only track left is its source goes back to the unsplit state it had before the parts were added.
      const remaining = Object.keys(nextStems);
      if (remaining.length === 0 || (remaining.length === 1 && remaining[0] === "source")) set({ stems: null, tracks: {} });
      else set({ stems: nextStems, tracks: nextTracks });
      return [];
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

    cancel() {
      if (!job) return;
      job.abort();
      job = null;
      set({ status: { kind: "idle" } });
    },

    reset() {
      job?.abort();
      job = null;
      set({ source: null, stems: null, tracks: {}, lastSplit: null, missingParts: null, status: { kind: "idle" } });
    },
  }));
}

export const useSong = createSongStore({ decode: decodeSong, separate: separateStems, loadChoice: loadSplitChoice, saveChoice: saveSplitChoice });
